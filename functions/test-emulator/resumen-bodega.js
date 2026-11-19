// Aviso de PIEZAS USADAS a bodega (lib/piezasBodega) contra el emulador de
// FIRESTORE a secas — sin el emulador de Functions, cuyo runtime sustituye
// admin.firestore por un stub que pierde FieldValue (ver memoria
// reference_emulador_functions_stub_fieldvalue). Los triggers v2 se invocan
// por su `.run(event)` con snapshots REALES del emulador.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-resumen-bodega \
//     "node functions/test-emulator/resumen-bodega.js"
//
// Congela:
//   A) cotización borrador→enviada con consumos: UN correo a bodega (copia a
//      taller) con el encabezado "VISITA TÉCNICA: … – CON COSTO", las piezas
//      agregadas, con costo y sin costo separadas, y las fuera de catálogo;
//      la orden queda bloqueada y la cotización marcada. enviada→aprobada NO
//      repite. Completar la orden después con las mismas piezas TAMPOCO.
//   B) visita SIN cotización (renovación de contrato, todo sin costo): el
//      cierre manda el aviso "RENOVACIÓN DE CONTRATO – SIN COSTO" con técnico,
//      cliente y orden. Sin piezas no sale nada.
//   C) pieza agregada DESPUÉS de cerrar: sale UN aviso marcado "actualizado"
//      aunque sean varias escrituras seguidas (rebote); una orden que sigue en
//      el taller no avisa nada.
//   D) cotización escrita a mano (orden sin consumos): el detalle sale de los
//      renglones de la cotización y lo dice.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-resumen-bodega";
process.env.PIEZAS_BODEGA_ESPERA_MS = "0";

// lib/admin.js solo hace admin.firestore(): la app la inicializa index.js en
// producción, así que aquí toca inicializarla antes de requerirlo.
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onCot = require("../src/triggers/cotizaciones/onEstadoChange");
const onComplete = require("../src/triggers/ordenes/onComplete");
const onConsumo = require("../src/triggers/ordenes/onConsumoPiezasBodega");
const PB = require("../src/lib/piezasBodega");
for (const t of [onCot, onComplete, onConsumo]) assert.equal(typeof t.run, "function", "el trigger v2 debe exponer .run(event)");

const BODEGA = "bodega-test@cecomunica.com";
const TALLER = "taller-test@cecomunica.com";

async function borrar(ref) {
  const s = await ref.get();
  await Promise.all(s.docs.map((d) => d.ref.delete()));
}
const avisos = async (ordenId) => (await db.collection("mail_queue").get()).docs.map((d) => d.data())
  .filter((m) => m.meta?.seccion === "piezas_a_bodega" && (!ordenId || m.meta.ordenId === ordenId));

async function orden(id, data, consumos = []) {
  const ref = db.doc(`ordenes_de_servicio/${id}`);
  await borrar(ref.collection("consumos"));
  await borrar(ref.collection("sistema"));
  await ref.set(data);
  for (const c of consumos) await ref.collection("consumos").add(c);
  return ref;
}
async function cotizacion(id, estado) {
  const ref = db.doc(`cotizaciones/${id}`);
  const before = await ref.get();
  await ref.update({ estado });
  await onCot.run({ data: { before, after: await ref.get() }, params: { docId: id } });
}
async function completar(id, estado) {
  const ref = db.doc(`ordenes_de_servicio/${id}`);
  const before = await ref.get();
  await ref.update({ estado_reparacion: estado });
  await onComplete.run({ data: { before, after: await ref.get() }, params: { ordenId: id } });
}
let nEvento = 0;
const eventoConsumo = (ordenId) => onConsumo.run({ id: `ev-${++nEvento}`, data: {}, params: { ordenId, consumoId: `c${nEvento}` } });

(async () => {
  await borrar(db.collection("mail_queue"));
  await borrar(db.collection("cotizaciones"));
  await db.doc("empresa/config").set({ email_bodega: BODEGA, email_taller: TALLER });

  // ── A) cotización con consumos ───────────────────────────────────────────
  const A = "O-TEST-420";
  await orden(A, {
    tipo_de_servicio: "VISITA TECNICA", estado_reparacion: "ASIGNADO", cliente_nombre: "Cliente de prueba",
    tecnico_asignado: "Ovidio Adames", informe_visita: { motivo: "correctivo" },
  }, [
    // Dos del catálogo (misma pieza, dos equipos) + una sin costo + una fuera de catálogo.
    { equipoId: "eq1", pieza_id: "p1", pieza_nombre: "Teclado PNC360", sku: "5116000081649B", qty: 1, tipo: "cobro", precio_unit: 12 },
    { equipoId: "eq2", pieza_id: "p1", pieza_nombre: "Teclado PNC360", sku: "5116000081649B", qty: 1, tipo: "cobro", precio_unit: 12 },
    { equipoId: "eq1", pieza_id: "p2", pieza_nombre: "Antena PNC360", sku: "ANT-360", qty: 1, tipo: "garantia", precio_unit: 0 },
    { equipoId: "eq1", pieza_id: null, fuera_catalogo: true, pieza_nombre: "Batería KNB-45L", sku: "KNB-45L", qty: 2, tipo: "cobro", precio_unit: 35 },
  ]);
  await db.doc("cotizaciones/COT-A").set({ origen: "orden", orden_id: A, estado: "borrador", cotizacion_id: "COT-2026-TEST", cliente_nombre: "Cliente de prueba" });

  await cotizacion("COT-A", "enviada");
  let ms = await avisos(A);
  assert.equal(ms.length, 1, "A: exactamente un correo a bodega");
  const m = ms[0];
  assert.equal(m.to, BODEGA);
  assert.equal(m.cc, TALLER, "A: copia a la jefatura de taller");
  assert.match(m.subject, /^Piezas usadas — VISITA TÉCNICA: MANTENIMIENTO CORRECTIVO – CON COSTO — Orden O-TEST-420 · Cliente de prueba$/);
  assert.match(m.bodyContent, /VISITA TÉCNICA: MANTENIMIENTO CORRECTIVO – CON COSTO/, "A: el encabezado en grande");
  assert.match(m.bodyContent, /Técnico[\s\S]*?Ovidio Adames/);
  assert.match(m.bodyContent, /Cotización[\s\S]*?COT-2026-TEST/);
  assert.equal(m.meta.tipos, 3, "A: 3 tipos de pieza (teclado x2 agregados, antena, batería)");
  assert.equal(m.meta.unidades, 5);
  assert.equal(m.meta.fuera_catalogo, 1);
  assert.equal(m.meta.fuente, "consumos");
  assert.match(m.bodyContent, /Teclado PNC360[\s\S]*?<b>2<\/b>/, "A: el teclado agregado, total 2");
  assert.match(m.bodyContent, /Antena PNC360[\s\S]*?<b>1<\/b>[\s\S]*?—[\s\S]*?1/, "A: la antena va en 'sin costo'");
  assert.match(m.bodyContent, /Batería KNB-45L<span[^>]*>fuera de catálogo<\/span>/);
  assert.match(m.bodyContent, /1 pieza\(s\) fuera de catálogo\.[\s\S]*Batería KNB-45L[\s\S]*\(KNB-45L\)[\s\S]*2 unidad\(es\)/);
  assert.equal((await db.doc(`ordenes_de_servicio/${A}`).get()).data().cotizacion_emitida, true, "A: la orden queda bloqueada al emitir");
  assert.ok((await db.doc("cotizaciones/COT-A").get()).data().resumen_bodega_at, "A: la cotización queda marcada resumen_bodega_at");

  await cotizacion("COT-A", "aprobada");
  assert.equal((await avisos(A)).length, 1, "A: aprobar después de enviar NO repite");
  await completar(A, "CERRADA (VISITA)");
  assert.equal((await avisos(A)).length, 1, "A: cerrar la visita con las mismas piezas NO repite");
  console.log("  PASS A · cotización con consumos → un correo con encabezado, sin duplicar al aprobar ni al cerrar");

  // ── B) visita sin cotización, todo sin costo ─────────────────────────────
  const B = "O-TEST-421";
  await orden(B, {
    tipo_de_servicio: "VISITA TECNICA", estado_reparacion: "ASIGNADO", cliente_nombre: "EXOLUM PANAMA",
    tecnico_asignado: "Ovidio Adames", visita: { sitio: "AEROPUERTO ALBROOK" }, informe_visita: { motivo: "renovacion" },
  }, [
    { equipoId: "eq1", pieza_id: "p9", pieza_nombre: "Front cover completo PNC360", sku: "11535010000155", qty: 1, tipo: "garantia", precio_unit: 55 },
    { equipoId: "eq2", pieza_id: "p9", pieza_nombre: "Front cover completo PNC360", sku: "11535010000155", qty: 1, tipo: "garantia", precio_unit: 55 },
  ]);
  await completar(B, "CERRADA (VISITA)");
  ms = await avisos(B);
  assert.equal(ms.length, 1, "B: el cierre de la visita avisa a bodega sin cotización");
  assert.match(ms[0].subject, /VISITA TÉCNICA: RENOVACIÓN DE CONTRATO – SIN COSTO — Orden O-TEST-421 · EXOLUM PANAMA$/);
  assert.match(ms[0].bodyContent, /Sitio[\s\S]*?AEROPUERTO ALBROOK/);
  assert.equal(ms[0].meta.con_costo, false);
  assert.equal(ms[0].meta.momento, "cierre");
  assert.equal(ms[0].meta.unidades, 2);

  const SIN = "O-TEST-422";
  await orden(SIN, { tipo_de_servicio: "REPARACIÓN", estado_reparacion: "ASIGNADO", cliente_nombre: "Sin piezas" });
  await completar(SIN, "COMPLETADO (EN OFICINA)");
  assert.equal((await avisos(SIN)).length, 0, "B: una orden sin piezas no manda nada");
  console.log("  PASS B · visita sin costo y sin cotización → aviso al cerrar; sin piezas, nada");

  // ── C) pieza agregada después de cerrar ──────────────────────────────────
  const cons = db.collection(`ordenes_de_servicio/${B}/consumos`);
  await cons.add({ equipoId: "eq3", pieza_id: "p7", pieza_nombre: "Rin cubre polvo de carga", sku: "5116000001029A", qty: 1, tipo: "cobro", precio_unit: 1 });
  await cons.add({ equipoId: "eq3", pieza_id: "p8", pieza_nombre: "Perilla de volumen", sku: "PV-01", qty: 2, tipo: "garantia", precio_unit: 0 });
  // Dos escrituras seguidas = dos eventos casi a la vez: gana el último.
  const ref = PB.refEstado(B);
  await ref.set({ ultimo_cambio: "ev-posterior" }, { merge: true });
  const perdido = onConsumo.run({ id: "ev-viejo", data: {}, params: { ordenId: B, consumoId: "x" } });
  await perdido; // escribe su marca y, con espera 0, avisa: es el último que vio
  ms = await avisos(B);
  assert.equal(ms.length, 2, "C: la pieza tardía dispara un segundo aviso");
  assert.match(ms.find((x) => x.meta.actualizacion).subject, /– CON COSTO — Orden O-TEST-421 · EXOLUM PANAMA \(actualizado\)$/, "C: ahora hay una con costo, y va marcado");
  assert.match(ms.find((x) => x.meta.actualizacion).bodyContent, /Actualiza el aviso anterior/);
  assert.equal(ms.find((x) => x.meta.actualizacion).meta.unidades, 5);
  // El evento que llega con el MISMO conteo no repite (huella).
  await eventoConsumo(B);
  assert.equal((await avisos(B)).length, 2, "C: el mismo conteo no sale dos veces");
  // Rebote: un evento que al despertar ya no es el último no avisa.
  await cons.add({ equipoId: "eq4", pieza_id: "p7", pieza_nombre: "Rin cubre polvo de carga", sku: "5116000001029A", qty: 1, tipo: "cobro", precio_unit: 1 });
  process.env.PIEZAS_BODEGA_ESPERA_MS = "400";
  const lento = onConsumo.run({ id: "ev-lento", data: {}, params: { ordenId: B, consumoId: "y" } });
  await new Promise((r) => setTimeout(r, 150));
  await ref.set({ ultimo_cambio: "ev-mas-nuevo" }, { merge: true }); // otro evento llegó mientras dormía
  await lento;
  process.env.PIEZAS_BODEGA_ESPERA_MS = "0";
  assert.equal((await avisos(B)).length, 2, "C: el evento que ya no es el último se calla");
  await eventoConsumo(B);
  assert.equal((await avisos(B)).length, 3, "C: el último sí avisa, con el conteo final");

  const VIVA = "O-TEST-423";
  await orden(VIVA, { tipo_de_servicio: "REPARACIÓN", estado_reparacion: "ASIGNADO", cliente_nombre: "En el taller" },
    [{ equipoId: "eq1", pieza_id: "p1", pieza_nombre: "Teclado PNC360", sku: "5116000081649B", qty: 1, tipo: "cobro", precio_unit: 12 }]);
  await eventoConsumo(VIVA);
  assert.equal((await avisos(VIVA)).length, 0, "C: una orden que sigue en el taller no avisa por cada pieza");
  await completar(VIVA, "COMPLETADO (EN OFICINA)");
  ms = await avisos(VIVA);
  assert.equal(ms.length, 1, "C: avisa al completar");
  assert.match(ms[0].subject, /REPARACIÓN EN TALLER – CON COSTO — Orden O-TEST-423/);
  console.log("  PASS C · pieza tardía → un aviso 'actualizado' (rebote + huella); en el taller, silencio hasta completar");

  // ── D) cotización escrita a mano, orden sin consumos ─────────────────────
  const D = "O-TEST-424";
  await orden(D, { tipo_de_servicio: "REPARACIÓN", estado_reparacion: "COMPLETADO (EN OFICINA)", cliente_nombre: "Cotizada a mano", tecnico_asignado: "Jesus Santos" });
  await db.doc("cotizaciones/COT-D").set({
    origen: "orden", orden_id: D, estado: "borrador", cotizacion_id: "COT-2026-MANO", cliente_nombre: "Cotizada a mano",
    items: [
      { id: "i1", modelo: "PV", nombre: "CUBRE POLVO", cant: 1, precio: 10, desc: 0, equipo: { serial: "BZ1" } },
      { id: "i2", modelo: "PV", nombre: "CUBRE POLVO", cant: 1, precio: 10, desc: 0, equipo: { serial: "BZ2" } },
      { id: "i3", modelo: "", nombre: "BASE", cant: 3, precio: 22.5, desc: 0, equipo: null },
    ],
  });
  await cotizacion("COT-D", "enviada");
  ms = await avisos(D);
  assert.equal(ms.length, 1, "D: la cotización a mano también le llega a bodega");
  assert.equal(ms[0].meta.fuente, "cotizacion");
  assert.equal(ms[0].meta.unidades, 5);
  assert.match(ms[0].bodyContent, /CUBRE POLVO[\s\S]*?<b>2<\/b>/, "D: los renglones iguales se suman");
  assert.match(ms[0].bodyContent, /El técnico no registró piezas en la orden[\s\S]*COT-2026-MANO/);
  assert.ok((await db.doc("cotizaciones/COT-D").get()).data().resumen_bodega_at);
  console.log("  PASS D · cotización a mano → detalle de sus renglones, y lo dice");

  // Reposición por daño: su cotización NO es de piezas, no avisa.
  const R = "O-TEST-425";
  await orden(R, { tipo_de_servicio: "REPARACIÓN", estado_reparacion: "COMPLETADO (EN OFICINA)", cliente_nombre: "Reposición" });
  await db.doc("cotizaciones/COT-R").set({
    origen: "orden", orden_id: R, estado: "borrador", cotizacion_id: "COT-2026-REP", gestion_id: "GR-X",
    items: [{ id: "rep1", nombre: "Reposición de equipo", cant: 1, precio: 150 }],
  });
  await cotizacion("COT-R", "enviada");
  assert.equal((await avisos(R)).length, 0, "la cotización de una reposición no manda piezas a bodega");

  console.log("\nPIEZAS A BODEGA: TODOS LOS RECORRIDOS PASARON");
  console.log("--- asunto de ejemplo:", (await avisos(B))[0].subject);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
