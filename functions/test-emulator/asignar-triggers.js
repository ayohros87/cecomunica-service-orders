// onSerialWrite de punta a punta contra el emulador de FIRESTORE a secas
// (2026-09-07). Sin el emulador de Functions: su runtime pierde
// admin.firestore.FieldValue (memoria reference_emulador_functions_stub_fieldvalue);
// el trigger v2 se invoca por `.run(event)` con snapshots reales, mismo
// patrón que resumen-bodega.js.
//
// Congela el contrato entre Almacén · Asignar y el pool:
//   1) asignar un serial en contratos/{cid}/seriales → la unidad pasa de
//      en_bodega a asignado_contrato con la asignación del contrato, queda
//      kardex `asignacion_contrato` y el contrato recibe seriales_count = 1;
//   2) quitar el serial → la unidad vuelve a en_bodega sin asignación y
//      verificado:false, kardex `liberacion`, seriales_count = 0;
//   3) contrato Propio → la unidad nace con propiedad 'cliente'.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-asignar-triggers \
//     "node functions/test-emulator/asignar-triggers.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-asignar-triggers";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const trigger = require("../src/triggers/contratos/onSerialWrite");
assert.equal(typeof trigger.run, "function", "el trigger v2 debe exponer .run(event)");

const SERIAL = "23905A0401";
let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

async function escribirSerial(cid, sid, data) {
  const ref = db.doc(`contratos/${cid}/seriales/${sid}`);
  const before = await ref.get();
  if (data) await ref.set(data); else await ref.delete();
  const after = await ref.get();
  await trigger.run({ data: { before, after }, params: { cid, sid } });
}

(async () => {
  await db.doc("contratos/c1").set({ contrato_id: "CT-1", cliente_id: "cli-1", cliente_nombre: "TRANSPORTES COLON", estado: "aprobado",
    tipo_contrato: "Alquiler", codigo_tipo: "ALQ", seriales_estado: "pendiente" });
  await db.doc("contratos/cp").set({ contrato_id: "CT-P", cliente_id: "cli-2", cliente_nombre: "SKYCHEF", estado: "aprobado",
    tipo_contrato: "Propio", codigo_tipo: "PROP", seriales_estado: "pendiente" });
  await db.doc(`equipos_pool/${SERIAL}`).set({ serial: SERIAL, serial_norm: SERIAL, modelo_id: "m1", modelo_label: "PNC360S",
    estado: "en_bodega", condicion: "nuevo", propiedad: "cecomunica", verificado: true });

  // 1) Asignar (lo que hace "Guardar avance" / "Listo para programar").
  await escribirSerial("c1", "s1", { serial: SERIAL, modelo: "PNC360S", modelo_id: "m1", contrato_doc_id: "c1", contrato_id: "CT-1",
    cliente_id: "cli-1", cliente_nombre: "TRANSPORTES COLON", source: "manual" });
  let u = (await db.doc(`equipos_pool/${SERIAL}`).get()).data();
  assert.equal(u.estado, "asignado_contrato");
  assert.equal(u.asignacion?.contrato_doc_id, "c1");
  assert.equal(u.asignacion?.cliente_nombre, "TRANSPORTES COLON");
  assert.equal(u.propiedad, "cecomunica", "alquiler: flota Cecomunica");
  let c = (await db.doc("contratos/c1").get()).data();
  assert.equal(c.seriales_count, 1);
  let mov = await db.collection(`equipos_pool/${SERIAL}/movimientos`).get();
  assert.ok(mov.docs.some(d => d.data().tipo === "asignacion_contrato"), "kardex asignacion_contrato");
  ok("asignar: en_bodega → asignado_contrato con asignación, kardex y seriales_count = 1");

  // 2) Quitar (reconciliación de saveSerialesManual al borrar la fila).
  await escribirSerial("c1", "s1", null);
  u = (await db.doc(`equipos_pool/${SERIAL}`).get()).data();
  assert.equal(u.estado, "en_bodega");
  assert.equal(u.asignacion, null);
  assert.equal(u.verificado, false, "vuelve a bodega para verificar físicamente");
  c = (await db.doc("contratos/c1").get()).data();
  assert.equal(c.seriales_count, 0);
  mov = await db.collection(`equipos_pool/${SERIAL}/movimientos`).get();
  assert.ok(mov.docs.some(d => d.data().tipo === "liberacion"), "kardex liberacion");
  ok("quitar: asignado_contrato → en_bodega sin asignación, verificado:false, seriales_count = 0");

  // 3) Contrato Propio. La propiedad EXISTENTE nunca se pisa (upsertContacto,
  //    2026-09-01): una unidad que ya era flota Cecomunica sigue siéndolo aunque
  //    entre a un Propio; una sin propiedad definida nace del cliente.
  const SERIAL2 = "23905A0402";
  await db.doc(`equipos_pool/${SERIAL2}`).set({ serial: SERIAL2, serial_norm: SERIAL2, modelo_id: "m1", modelo_label: "PNC360S",
    estado: "en_bodega", condicion: "nuevo", propiedad: "desconocida", verificado: true });
  await escribirSerial("cp", "s1", { serial: SERIAL, modelo: "PNC360S", modelo_id: "m1", contrato_doc_id: "cp", contrato_id: "CT-P",
    cliente_id: "cli-2", cliente_nombre: "SKYCHEF", source: "manual" });
  await escribirSerial("cp", "s2", { serial: SERIAL2, modelo: "PNC360S", modelo_id: "m1", contrato_doc_id: "cp", contrato_id: "CT-P",
    cliente_id: "cli-2", cliente_nombre: "SKYCHEF", source: "manual" });
  u = (await db.doc(`equipos_pool/${SERIAL}`).get()).data();
  const u2 = (await db.doc(`equipos_pool/${SERIAL2}`).get()).data();
  assert.equal(u.estado, "asignado_contrato");
  assert.equal(u.asignacion?.contrato_doc_id, "cp");
  assert.equal(u.propiedad, "cecomunica", "la propiedad existente no se pisa");
  assert.equal(u2.estado, "asignado_contrato");
  assert.equal(u2.propiedad, "cliente", "sin propiedad definida + Propio → del cliente");
  c = (await db.doc("contratos/cp").get()).data();
  assert.equal(c.seriales_count, 2);
  ok("Propio: la propiedad existente se respeta; la indefinida pasa al cliente; seriales_count = 2");

  console.log(`\nOK — ${n} comprobaciones de onSerialWrite contra el emulador`);
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
