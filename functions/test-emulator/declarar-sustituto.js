// Integración de declararSustitutoContrato (núcleo `ejecutar`) contra el
// emulador de Firestore. Corre con el emulador arriba (8080):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test-emulator/declarar-sustituto.js
// Vive FUERA de test/ para que `npm test` no lo levante.
//
// Qué protege (plan de autoservicio 2026-10-07, B3): declarar el sustituto
// DESPUÉS de anular tiene que dejar lo mismo que la anulación con sustituto a
// tiempo: vínculo en el origen, filas de seriales en el sustituto, señal
// `asignados`, Base PoC reapuntada, órdenes señaladas repuntadas y la marca
// `sustitucion_vinculo_pendiente` apagada. Y los candados: otro cliente,
// sustituto anulado, origen vivo, devolución abierta → no se escribe nada.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-declarar-sustituto" });
const { ejecutar } = require("../src/callable/declararSustitutoContrato");
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const CLI = "cli-1";
const LINEAS = [{ modelo: "HYTERA PNC360S-R", modelo_id: "m1", cantidad: 2, precio: 25, modalidad: "alquiler" }];

async function borrarColeccion(ref) {
  for (const d of (await ref.get()).docs) {
    for (const sub of await d.ref.listCollections()) await borrarColeccion(sub);
    await d.ref.delete();
  }
}
async function limpiar() {
  for (const c of ["contratos", "equipos_pool", "ordenes_de_servicio", "poc_devices", "mail_queue", "modelos"]) await borrarColeccion(db.collection(c));
}
async function sembrar({ sustAsignados = false } = {}) {
  await limpiar();
  await db.collection("modelos").doc("m1").set({ modelo: "PNC360S-R", marca: "HYTERA", activo: true, estado: "R" });
  await db.collection("contratos").doc("c-viejo").set({
    cliente_id: CLI, cliente_nombre: "CLIENTE PRUEBA", contrato_id: "ALQ-VIEJO", estado: "anulado",
    anulacion_tipo: "sustitucion", anulado_motivo: "se rehízo", entrega_confirmada: true, equipos: LINEAS,
    sustitucion_vinculo_pendiente: true, sustitucion_vinculo_motivo: "sin contrato sustituto indicado",
    fecha_entrega_ultima: admin.firestore.Timestamp.fromDate(new Date("2026-08-01T12:00:00Z")),
  });
  for (const s of ["AAA111", "BBB222"]) {
    await db.collection("contratos").doc("c-viejo").collection("seriales").doc(s).set({ serial: s, modelo: "HYTERA PNC360S-R", modelo_id: "m1", contrato_doc_id: "c-viejo", contrato_id: "ALQ-VIEJO", cliente_id: CLI });
    await db.collection("equipos_pool").doc(s).set({ serial: s, serial_norm: s, modelo_id: "m1", modelo_label: "HYTERA PNC360S-R", estado: "en_cliente", propiedad: "cecomunica",
      asignacion: { contrato_doc_id: "c-viejo", contrato_id: "ALQ-VIEJO", cliente_id: CLI, cliente_nombre: "CLIENTE PRUEBA" } });
    await db.collection("poc_devices").doc(`poc-${s}`).set({ serial: s, cliente_id: CLI, cliente: "CLIENTE PRUEBA", contrato_doc_id: "c-viejo", contrato_id: "ALQ-VIEJO", activo: true });
  }
  const nuevo = { cliente_id: CLI, cliente_nombre: "CLIENTE PRUEBA", contrato_id: "ALQ-NUEVO", estado: "activo", equipos: LINEAS, seriales_estado: "pendiente" };
  if (sustAsignados) {
    nuevo.seriales_estado = "asignados";
    await db.collection("contratos").doc("c-nuevo").set(nuevo);
    await db.collection("contratos").doc("c-nuevo").collection("seriales").doc("AAA111").set({ serial: "AAA111", modelo: "HYTERA PNC360S-R", modelo_id: "m1", contrato_doc_id: "c-nuevo", contrato_id: "ALQ-NUEVO", cliente_id: CLI });
  } else {
    await db.collection("contratos").doc("c-nuevo").set(nuevo);
  }
  await db.collection("contratos").doc("c-otro").set({ cliente_id: "cli-2", contrato_id: "ALQ-OTRO", estado: "activo", equipos: LINEAS });
  await db.collection("contratos").doc("c-anulado2").set({ cliente_id: CLI, contrato_id: "ALQ-ANULADO2", estado: "anulado", equipos: LINEAS });
  await db.collection("contratos").doc("c-vivo").set({ cliente_id: CLI, contrato_id: "ALQ-VIVO", estado: "activo", equipos: LINEAS });
  await db.collection("ordenes_de_servicio").doc("2026090101").set({
    estado_reparacion: "ASIGNADO", cliente_id: CLI, tipo_de_servicio: "PROGRAMACION",
    contrato: { aplica: true, contrato_doc_id: "c-viejo", contrato_id: "ALQ-VIEJO" },
    equipos: [{ numero_de_serie: "AAA111", modelo: "PNC360S-R" }],
    contrato_anulado_revisar: { contrato: "ALQ-VIEJO", contrato_doc_id: "c-viejo", equipos_n: 1 },
  });
}
const rechaza = async (args, re) => {
  let err = null;
  try { await ejecutar({ usuario: "test@x", ...args }); } catch (e) { err = e; }
  assert.ok(err, `debía rechazar: ${JSON.stringify(args)}`);
  assert.match(String(err.message), re);
};

(async () => {
  await sembrar();
  // ── Candados ──
  await rechaza({ origenId: "c-viejo", sustitutoId: "c-viejo" }, /mismo contrato/);
  await rechaza({ origenId: "c-viejo", sustitutoId: "c-otro" }, /otro cliente/);
  await rechaza({ origenId: "c-viejo", sustitutoId: "c-anulado2" }, /anulado/);
  await rechaza({ origenId: "c-vivo", sustitutoId: "c-nuevo" }, /no está anulado/);
  await rechaza({ origenId: "c-viejo", sustitutoId: "c-nope" }, /no existe/);
  const intacto = (await db.collection("contratos").doc("c-viejo").get()).data();
  assert.equal(intacto.sustituido_por_id, undefined, "los candados no escriben nada");
  // Devolución abierta del origen → se frena.
  await db.collection("ordenes_de_servicio").doc("2026090102").set({ estado_reparacion: "POR ASIGNAR", tipo_de_servicio: "DEVOLUCION", cliente_id: CLI });
  await db.collection("contratos").doc("c-viejo").set({ orden_devolucion_id: "2026090102" }, { merge: true });
  await rechaza({ origenId: "c-viejo", sustitutoId: "c-nuevo" }, /DEVOLUCIÓN 2026090102/);
  await db.collection("contratos").doc("c-viejo").set({ orden_devolucion_id: FV.delete() }, { merge: true });
  console.log("  ok   candados: nada escrito");

  // ── Camino feliz: sustituto sin seriales ──
  const r = await ejecutar({ usuario: "vendedor@x", origenId: "c-viejo", sustitutoId: "c-nuevo", motivo: "se creó después" });
  assert.equal(r.ok, true);
  assert.equal(r.copiados, 2, "copió los 2 seriales");
  assert.equal(r.completo, true);
  assert.equal(r.pendientes.length, 0);
  const viejo = (await db.collection("contratos").doc("c-viejo").get()).data();
  assert.equal(viejo.sustituido_por_id, "c-nuevo");
  assert.equal(viejo.sustituido_por_contrato_id, "ALQ-NUEVO");
  assert.equal(viejo.anulacion_tipo, "sustitucion");
  assert.equal(viejo.sustitucion_vinculo_pendiente, undefined, "la marca pendiente se apagó");
  assert.equal(viejo.sustitucion_declarada_por, "vendedor@x");
  const filas = await db.collection("contratos").doc("c-nuevo").collection("seriales").get();
  assert.deepEqual(filas.docs.map((d) => d.data().serial).sort(), ["AAA111", "BBB222"]);
  const senal = (await db.collection("contratos").doc("c-nuevo").collection("seriales_estado").doc("current").get()).data();
  assert.equal(senal?.estado, "asignados", "señal de asignados escrita");
  const nuevo = (await db.collection("contratos").doc("c-nuevo").get()).data();
  assert.equal(nuevo.sustituye_a_id, "c-viejo");
  assert.equal(nuevo.entrega_confirmada, true, "hereda la entrega del origen");
  const poc = (await db.collection("poc_devices").doc("poc-AAA111").get()).data();
  assert.equal(poc.contrato_doc_id, "c-nuevo", "la ficha PoC apunta al sustituto");
  const os = (await db.collection("ordenes_de_servicio").doc("2026090101").get()).data();
  assert.equal(os.contrato.contrato_doc_id, "c-nuevo", "la orden señalada pasó al sustituto");
  assert.equal(os.contrato_anulado_revisar, undefined, "la marca de la orden se apagó");
  assert.deepEqual(r.ordenes_repuntadas, ["2026090101"]);
  console.log("  ok   camino feliz: vínculo, filas, señal, PoC y orden");

  // Idempotente: repetir no duplica filas ni rompe.
  const r2 = await ejecutar({ usuario: "vendedor@x", origenId: "c-viejo", sustitutoId: "c-nuevo" });
  assert.equal(r2.ok, true);
  assert.equal(r2.copiados, 0);
  assert.equal((await db.collection("contratos").doc("c-nuevo").collection("seriales").get()).size, 2);
  console.log("  ok   repetirlo no duplica");

  // ── Sustituto con seriales YA asignados (caso SHEVET) ──
  await sembrar({ sustAsignados: true });
  // AAA111 ya figura en el sustituto (el pool lo sabría por onSerialWrite); BBB222 no.
  await db.collection("equipos_pool").doc("AAA111").set({ asignacion: { contrato_doc_id: "c-nuevo", contrato_id: "ALQ-NUEVO", cliente_id: CLI } }, { merge: true });
  const r3 = await ejecutar({ usuario: "vendedor@x", origenId: "c-viejo", sustitutoId: "c-nuevo" });
  assert.equal(r3.ok, true);
  assert.equal(r3.copiados, 0, "no copia: el sustituto ya cerró sus seriales");
  assert.equal(r3.ya_en_sustituto, 1);
  assert.equal(r3.poc_reapuntados, 1, "reapunta la PoC del serial que el sustituto lista");
  assert.equal(r3.pendientes.length, 1);
  assert.equal(r3.pendientes[0].serial, "BBB222");
  const viejo3 = (await db.collection("contratos").doc("c-viejo").get()).data();
  assert.equal(viejo3.sustituido_por_id, "c-nuevo");
  assert.equal(viejo3.sustitucion_vinculo_pendiente, true, "queda dicho lo que faltó");
  assert.match(viejo3.sustitucion_vinculo_motivo, /1 unidad/);
  assert.equal((await db.collection("poc_devices").doc("poc-AAA111").get()).data().contrato_doc_id, "c-nuevo");
  assert.equal((await db.collection("poc_devices").doc("poc-BBB222").get()).data().contrato_doc_id, "c-viejo");
  console.log("  ok   sustituto ya asignado: solo vínculo + PoC, y el resto queda explicado");

  await limpiar();
  console.log("\nTODO OK");
  process.exit(0);
})().catch((e) => { console.error("\nFALLA:", e); process.exit(1); });
