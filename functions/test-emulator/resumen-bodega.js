// Resumen de piezas a bodega (onCotizacionEstadoChange) contra el emulador de
// FIRESTORE a secas — sin el emulador de Functions, cuyo runtime sustituye
// admin.firestore por un stub que pierde FieldValue (ver memoria
// reference_emulador_functions_stub_fieldvalue). Aquí el trigger v2 se invoca
// por su `.run(event)` con snapshots REALES del emulador: misma lógica, mismo
// firebase-admin, sin el stub.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-resumen-bodega \
//     "node functions/test-emulator/resumen-bodega.js"
//
// Congela:
//   1) al pasar borrador→enviada se encola UN correo a bodega con las piezas
//      agregadas por sku/nombre, cobro y garantía separados;
//   2) las piezas `fuera_catalogo` salen etiquetadas y en el bloque
//      "cargarlas al catálogo";
//   3) la orden queda con cotizacion_emitida=true y la cotización con
//      resumen_bodega_at;
//   4) enviada→aprobada NO manda un segundo correo (marca resumen_bodega_at).
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-resumen-bodega";

// lib/admin.js solo hace admin.firestore(): la app la inicializa index.js en
// producción, así que aquí toca inicializarla antes de requerirlo.
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const trigger = require("../src/triggers/cotizaciones/onEstadoChange");
assert.equal(typeof trigger.run, "function", "el trigger v2 debe exponer .run(event)");

const ORDEN = "O-TEST-420";
const COT = "COT-TEST-1";

async function seed() {
  await db.doc("empresa/config").set({ email_bodega: "bodega-test@cecomunica.com" });
  await db.doc(`ordenes_de_servicio/${ORDEN}`).set({
    tipo_de_servicio: "VISITA TECNICA",
    estado_reparacion: "CERRADA (VISITA)",
    cliente_nombre: "Cliente de prueba",
  });
  const cons = db.collection(`ordenes_de_servicio/${ORDEN}/consumos`);
  // Dos del catálogo (misma pieza, dos equipos) + una de garantía + una fuera de catálogo.
  await cons.add({ equipoId: "eq1", pieza_id: "p1", pieza_nombre: "Teclado PNC360", sku: "5116000081649B", qty: 1, tipo: "cobro", precio_unit: 12 });
  await cons.add({ equipoId: "eq2", pieza_id: "p1", pieza_nombre: "Teclado PNC360", sku: "5116000081649B", qty: 1, tipo: "cobro", precio_unit: 12 });
  await cons.add({ equipoId: "eq1", pieza_id: "p2", pieza_nombre: "Antena PNC360", sku: "ANT-360", qty: 1, tipo: "garantia", precio_unit: 0 });
  await cons.add({ equipoId: "eq1", pieza_id: null, fuera_catalogo: true, pieza_nombre: "Batería KNB-45L", sku: "KNB-45L", qty: 2, tipo: "cobro", precio_unit: 35 });
  await db.doc(`cotizaciones/${COT}`).set({
    origen: "orden", orden_id: ORDEN, estado: "borrador",
    cotizacion_id: "COT-2026-TEST", cliente_nombre: "Cliente de prueba",
  });
}

async function transicion(estado) {
  const ref = db.doc(`cotizaciones/${COT}`);
  const before = await ref.get();
  await ref.update({ estado });
  const after = await ref.get();
  await trigger.run({ data: { before, after }, params: { docId: COT } });
}

(async () => {
  await seed();

  // 1) borrador → enviada
  await transicion("enviada");
  let mails = await db.collection("mail_queue").get();
  assert.equal(mails.size, 1, "debe encolarse exactamente un correo a bodega");
  const m = mails.docs[0].data();
  assert.equal(m.to, "bodega-test@cecomunica.com");
  assert.match(m.subject, /Piezas usadas — Orden O-TEST-420 \(5 unidad\(es\)\)/);
  assert.equal(m.meta.tipos, 3, "3 tipos de pieza (teclado x2 agregados, antena, batería)");
  assert.equal(m.meta.fuera_catalogo, 1);
  // Fila del teclado agregada: total 2, cobradas 2
  assert.match(m.bodyContent, /Teclado PNC360[\s\S]*?<b>2<\/b>/);
  // Garantía separada
  assert.match(m.bodyContent, /Antena PNC360[\s\S]*?<b>1<\/b>[\s\S]*?—[\s\S]*?1/);
  // Fuera de catálogo: tag en la fila + bloque de aviso con la pieza
  assert.match(m.bodyContent, /Batería KNB-45L<span[^>]*>fuera de catálogo<\/span>/);
  assert.match(m.bodyContent, /1 pieza\(s\) fuera de catálogo\.[\s\S]*Batería KNB-45L[\s\S]*\(KNB-45L\)[\s\S]*2 unidad\(es\)/);

  const orden = (await db.doc(`ordenes_de_servicio/${ORDEN}`).get()).data();
  assert.equal(orden.cotizacion_emitida, true, "la orden queda bloqueada al emitir");
  const cot = (await db.doc(`cotizaciones/${COT}`).get()).data();
  assert.ok(cot.resumen_bodega_at, "la cotización queda marcada resumen_bodega_at");

  // 2) enviada → aprobada: sin segundo correo
  await transicion("aprobada");
  mails = await db.collection("mail_queue").get();
  assert.equal(mails.size, 1, "aprobar después de enviar NO repite el resumen");

  console.log("OK resumen-bodega: 1 correo, 3 tipos, 5 unidades, 1 fuera de catálogo, sin duplicado al aprobar");
  console.log("--- asunto:", m.subject);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
