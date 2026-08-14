// Integración de traspasarASustituto contra el emulador de Firestore.
// Corre con: firebase emulators:exec --only firestore "node test-emulator/sustitucion-contrato.js"
// (emulators:exec exporta FIRESTORE_EMULATOR_HOST). Vive FUERA de test/ para
// que `node --test` (npm test) no lo levante — requiere el emulador.
//
// Qué protege: `traspasarASustituto` escribe en un contrato que NO es el que se
// está anulando —le copia seriales, le hereda la entrega y le mueve el pool por
// vía de onSerialWrite—. Es la operación con más filo de la anulación por
// sustitución, así que lo que se prueba aquí son sobre todo los CANDADOS: cada
// forma de equivocarse de contrato debe terminar en un "no hago nada" con su
// motivo, nunca en una escritura a medias.
//
// El caso que lo origina: ALQ20260715-01 → ALQ20260806-03 (SOCIEDAD ISRAELITA,
// 32 radios, 2026-08-06). Ver test/anulacionSustitucion.test.js para la lógica
// de clasificación, que no necesita emulador.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-sustitucion-contrato" });

// Requerir DESPUÉS de initializeApp (lib/admin llama admin.firestore()).
const { traspasarASustituto } = require("../src/lib/sustitucionContrato");
const db = admin.firestore();

const ORIGEN = {
  cliente_id: "cli-1", cliente_nombre: "CLIENTE PRUEBA",
  contrato_id: "ALQ-VIEJO", entrega_confirmada: true,
  fecha_entrega_ultima: admin.firestore.Timestamp.fromDate(new Date("2026-07-24T15:24:02Z")),
};
const UNIDADES = [
  { serial: "AAA111", modelo: "PNC360S-R", modelo_id: "m1", pool_doc_id: "AAA111" },
  { serial: "BBB222", modelo: "PNC360S-R", modelo_id: "m1", pool_doc_id: "BBB222" },
];
const DOCS = ["c-origen", "c-sust", "c-otro-cliente", "c-anulado", "c-con-seriales", "c-borrado"];

async function limpiar() {
  for (const c of DOCS) {
    const ref = db.collection("contratos").doc(c);
    for (const d of (await ref.collection("seriales").get()).docs) await d.ref.delete();
    await ref.delete();
  }
}
const traspasar = (sustitutoId, over = {}) => traspasarASustituto({
  origenId: "c-origen", origen: { ...ORIGEN, ...over }, sustitutoId, unidades: UNIDADES,
});

(async () => {
  await limpiar();
  await db.collection("contratos").doc("c-origen").set({ ...ORIGEN });

  // ── Candados: cada uno debe rechazar SIN escribir nada ──────────────────
  let r = await traspasarASustituto({ origenId: "c-origen", origen: ORIGEN, sustitutoId: null, unidades: UNIDADES });
  assert.equal(r.ok, false); assert.match(r.motivo, /sin contrato sustituto/);

  r = await traspasar("c-origen");
  assert.equal(r.ok, false); assert.match(r.motivo, /mismo contrato/);

  r = await traspasarASustituto({ origenId: "c-origen", origen: ORIGEN, sustitutoId: "c-sust", unidades: [] });
  assert.equal(r.ok, false); assert.match(r.motivo, /sin unidades/);

  r = await traspasar("no-existe");
  assert.equal(r.ok, false); assert.match(r.motivo, /no existe/);

  await db.collection("contratos").doc("c-borrado").set({ cliente_id: "cli-1", deleted: true, estado: "aprobado" });
  r = await traspasar("c-borrado");
  assert.equal(r.ok, false); assert.match(r.motivo, /borrado/);

  await db.collection("contratos").doc("c-anulado").set({ cliente_id: "cli-1", estado: "anulado" });
  r = await traspasar("c-anulado");
  assert.equal(r.ok, false); assert.match(r.motivo, /también está anulado/);

  // Traspasar a otro cliente no es una sustitución, es un traslado de equipo.
  await db.collection("contratos").doc("c-otro-cliente").set({ cliente_id: "cli-2", estado: "aprobado" });
  r = await traspasar("c-otro-cliente");
  assert.equal(r.ok, false); assert.match(r.motivo, /otro cliente/);

  // Si alguien ya cargó seriales a mano, sus decisiones mandan.
  await db.collection("contratos").doc("c-con-seriales").set({ cliente_id: "cli-1", estado: "aprobado", contrato_id: "ALQ-CS" });
  await db.collection("contratos").doc("c-con-seriales").collection("seriales").add({ serial: "ZZZ999" });
  r = await traspasar("c-con-seriales");
  assert.equal(r.ok, false); assert.match(r.motivo, /ya tiene seriales/);
  assert.equal((await db.collection("contratos").doc("c-con-seriales").collection("seriales").get()).size, 1,
    "un rechazo no puede haber tocado el sustituto");

  // ── Camino feliz ────────────────────────────────────────────────────────
  await db.collection("contratos").doc("c-sust").set({ cliente_id: "cli-1", estado: "aprobado", contrato_id: "ALQ-NUEVO" });
  r = await traspasar("c-sust");
  assert.equal(r.ok, true);
  assert.equal(r.copiados, 2);

  const s = (await db.collection("contratos").doc("c-sust").get()).data();
  // Hereda la entrega: el cliente ya tiene los radios en la mano. Sin esto
  // onSerialWrite los degradaría a `asignado_contrato` (apartados en bodega).
  assert.equal(s.entrega_confirmada, true);
  assert.ok(s.fecha_entrega_ultima, "hereda la fecha de la entrega real");
  // Candado contra onEntregaTransicion: sin él, confirmar la entrega haría que
  // el sustituto reclamara como devolución el equipo del origen — el mismo
  // tiquete falso que la sustitución existe para evitar.
  assert.ok(s.transicion_auto_at);
  assert.equal(s.transicion_auto_motivo, "sustitucion_de_contrato");
  assert.equal(s.seriales_estado, "asignados");
  assert.equal(s.sustituye_a_id, "c-origen");

  const filas = await db.collection("contratos").doc("c-sust").collection("seriales").get();
  assert.equal(filas.size, 2);
  const f0 = filas.docs[0].data();
  assert.equal(f0.contrato_doc_id, "c-sust");
  assert.equal(f0.migrado_de_contrato, "c-origen", "la fila recuerda de dónde vino");
  assert.equal(f0.cliente_id, "cli-1");

  // El PDF al cliente lo dispara la subcolección seriales_estado, NO el campo
  // del padre. Una corrección de papeleo no le reenvía nada al cliente.
  assert.ok((await db.collection("contratos").doc("c-sust").collection("seriales_estado").get()).empty,
    "no debe escribirse seriales_estado/current");

  // ── Idempotencia: el reintento del trigger no duplica filas ─────────────
  r = await traspasar("c-sust");
  assert.equal(r.ok, false); assert.match(r.motivo, /ya tiene seriales/);
  assert.equal((await db.collection("contratos").doc("c-sust").collection("seriales").get()).size, 2);

  // ── Origen que nunca se entregó: el sustituto no hereda entrega ─────────
  await limpiar();
  await db.collection("contratos").doc("c-sust").set({ cliente_id: "cli-1", estado: "aprobado", contrato_id: "ALQ-NUEVO" });
  r = await traspasar("c-sust", { entrega_confirmada: false });
  assert.equal(r.ok, true);
  const s2 = (await db.collection("contratos").doc("c-sust").get()).data();
  assert.equal(s2.entrega_confirmada, undefined, "no inventa una entrega que no ocurrió");
  assert.equal(s2.transicion_auto_at, undefined, "sin entrega no hace falta el candado");

  await limpiar();
  console.log("OK — sustitucion-contrato: candados, traspaso, idempotencia y herencia de entrega");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
