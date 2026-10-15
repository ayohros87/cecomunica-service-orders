// Equipo NO DEVUELTO que se cotiza antes de cobrarse, de punta a punta contra
// el emulador de FIRESTORE (2026-10-15). Mismo patrón que taller-reposicion.js:
// los triggers v2 se invocan por su `.run(event)` con snapshots REALES.
//
// Corre con (desde la raíz del repo), contra un emulador de Firestore vivo:
//   cd functions && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-no-devuelto \
//     NODE_PATH=./node_modules node test-emulator/no-devuelto-cotizacion.js
// (o `firebase emulators:exec --only firestore --project demo-no-devuelto "node functions/test-emulator/no-devuelto-cotizacion.js"`)
//
// Recorridos:
//   A) "Cotizar la reposición" (cotizacion_pedida) → onCobroEquipoWrite arma
//      UNA cotización de taller en borrador, enlazada al renglón; el eco del
//      trigger no arma otra.
//   B) El cliente acepta → fila de Facturación pendiente que dice "no
//      devuelto" + renglón "aceptada"; Recepción marca QBO con número →
//      renglón facturado con la factura y la ficha del pool en "vendido".
//   C) El cliente rechaza → el renglón sigue abierto y pasa a cobranza.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-no-devuelto";

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onEstado = require("../src/triggers/cotizaciones/onEstadoChange");
const onCobro = require("../src/triggers/cobros/onCobroEquipoWrite");
const onFacturada = require("../src/triggers/facturacion/onCotizacionFacturada");

const CLIENTE = "cliGamboa";
const JEFA = "solangel.hosang@cecomunica.com";

async function borrar(col) {
  const s = await db.collection(col).get();
  await Promise.all(s.docs.map(d => d.ref.delete()));
}

async function seed() {
  for (const c of ["mail_queue", "facturacion_avisos", "cotizaciones", "cobros_equipos", "contadores", "equipos_pool"]) await borrar(c);
  await db.doc("empresa/config").set({
    email_activaciones: "activaciones@cecomunica.com", email_bodega: "inventario@cecomunica.com",
    email_aprobaciones: "ventas@cecomunica.com", email_taller: JEFA, cotizacion_validez_dias: 15,
  });
  await db.doc("usuarios/uJefa").set({ email: JEFA, rol: "jefe_taller", nombre: "Solangel Hosang", cargo: "Jefa de Taller" });
  await db.doc(`clientes/${CLIENTE}`).set({ nombre: "GAMBOA, S.A.", email: "compras@gamboa.com", representante: "Ana Pérez" });
  await db.doc("equipos_pool/B6810431").set({ serial: "B6810431", serial_norm: "B6810431", estado: "en_cliente", propiedad: "cecomunica", modelo_id: "nx420" });
  await db.doc("equipos_pool/B6810432").set({ serial: "B6810432", serial_norm: "B6810432", estado: "en_cliente", propiedad: "cecomunica", modelo_id: "nx420" });
}

const renglon = (serial) => ({
  cliente_id: CLIENTE, cliente_nombre: "GAMBOA, S.A.", orden_devolucion_id: "2026101501",
  serial, serial_norm: serial, pool_doc_id: serial, modelo_id: "nx420", modelo_label: "NX-420", cantidad: 1,
  motivo_codigo: "perdido", motivo_detalle: "No apareció al cierre",
  monto_catalogo_unit: 285, monto_unit: 285, descuento_pct: 0, monto_total: 285, sin_referencia: false,
  etapa: "pendiente", requiere_aprobacion: false, factura_ref: "", historial: [],
  desde: admin.firestore.FieldValue.serverTimestamp(),
});

// Escribe y dispara el trigger con before/after reales.
async function escribirRow(id, patch, { crear = false } = {}) {
  const ref = db.doc(`cobros_equipos/${id}`);
  const before = await ref.get();
  if (crear) await ref.set(patch); else await ref.update(patch);
  const after = await ref.get();
  await onCobro.run({ data: { before, after }, params: { rowId: id } });
}
async function escribirCot(id, patch) {
  const ref = db.doc(`cotizaciones/${id}`);
  const before = await ref.get();
  await ref.update(patch);
  const after = await ref.get();
  await onEstado.run({ data: { before, after }, params: { docId: id } });
}
async function escribirAviso(id, patch) {
  const ref = db.doc(`facturacion_avisos/${id}`);
  const before = await ref.get();
  await ref.update(patch);
  const after = await ref.get();
  await onFacturada.run({ data: { before, after }, params: { avisoId: id } });
}
const row = async (id) => (await db.doc(`cobros_equipos/${id}`).get()).data();
const cots = async () => (await db.collection("cotizaciones").get()).docs.map(d => ({ id: d.id, ...d.data() }));

async function main() {
  await seed();

  // ── A ──
  await escribirRow("r1", renglon("B6810431"), { crear: true });
  assert.equal((await cots()).length, 0, "sin pedido no se arma nada");
  await escribirRow("r1", { cotizacion_pedida: { por_uid: "uJefa", por_email: JEFA, at: admin.firestore.FieldValue.serverTimestamp() } });
  let r1 = await row("r1");
  let lista = await cots();
  assert.equal(lista.length, 1, "una cotización");
  const cot = lista[0];
  assert.equal(r1.cotizacion_doc_id, cot.id);
  assert.equal(r1.cotizacion_id, cot.cotizacion_id);
  assert.equal(r1.cotizacion_estado, "borrador");
  assert.equal(r1.cotizacion_en_curso, undefined, "el candado se soltó");
  assert.equal(cot.origen, "orden");
  assert.equal(cot.cobro_equipo_id, "r1");
  assert.equal(cot.gestion_id, "");
  assert.equal(cot.estado, "borrador");
  assert.equal(cot.creado_por_uid, "uJefa");
  assert.equal(cot.total, 304.95);
  assert.match(cot.intro, /no devuelto/);
  // Eco: el trigger vuelve a correr sobre el renglón ya enlazado → nada.
  const b = await db.doc("cobros_equipos/r1").get();
  await onCobro.run({ data: { before: b, after: b }, params: { rowId: "r1" } });
  assert.equal((await cots()).length, 1, "el eco no arma otra");
  console.log("A ok — cotización", cot.cotizacion_id, "enlazada al renglón");

  // ── B ──
  await escribirCot(cot.id, { estado: "enviada" });
  await escribirCot(cot.id, {
    estado: "convertida",
    aceptacion: { medio: "correo", nota: "Aceptó por correo", por_email: JEFA, at: admin.firestore.FieldValue.serverTimestamp() },
  });
  r1 = await row("r1");
  assert.equal(r1.cotizacion_estado, "aceptada");
  assert.equal(r1.etapa, "pendiente", "sigue abierto hasta la factura");
  const avisos = (await db.collection("facturacion_avisos").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  assert.equal(avisos.length, 1, "una fila de facturación");
  const aviso = avisos[0];
  assert.equal(aviso.tipo, "cotizacion_servicio");
  assert.equal(aviso.contexto.cobro_equipo_id, "r1");
  assert.equal(aviso.contexto.no_devuelto, true);
  assert.equal(aviso.contexto.equipo_en_taller, false, "no hay radio en el taller");
  assert.match(aviso.contexto.origen_texto || "", /no devuelto/i, "la fila dice de dónde viene");
  // Recepción marca QBO con el número.
  await escribirAviso(aviso.id, { "pasos.qbo": { hecho: true, factura: "F-7788", por_email: "cecrecep@cecomunica.com", at: admin.firestore.FieldValue.serverTimestamp() } });
  r1 = await row("r1");
  assert.equal(r1.etapa, "facturado");
  assert.equal(r1.factura_ref, "F-7788");
  assert.equal(r1.cotizacion_estado, "facturada");
  assert.ok(r1.historial.some(h => h.accion === "facturado" && /F-7788/.test(h.detalle)));
  const pool = (await db.doc("equipos_pool/B6810431").get()).data();
  assert.equal(pool.estado, "vendido");
  assert.equal(pool.propiedad, "cliente");
  assert.equal(pool.venta.factura, "F-7788");
  assert.equal(pool.venta.motivo, "no_devuelto");
  const movs = await db.doc("equipos_pool/B6810431").collection("movimientos").get();
  assert.equal(movs.size, 1, "un movimiento en el kardex");
  const cotF = (await db.doc(`cotizaciones/${cot.id}`).get()).data();
  assert.equal(cotF.facturacion.estado, "facturada");
  // Eco del trigger de factura: no vuelve a tocar el renglón.
  const a2 = await db.doc(`facturacion_avisos/${aviso.id}`).get();
  await onFacturada.run({ data: { before: a2, after: a2 }, params: { avisoId: aviso.id } });
  assert.equal((await row("r1")).historial.filter(h => h.accion === "facturado").length, 1);
  console.log("B ok — aceptada → facturación → renglón facturado F-7788 y ficha vendida");

  // ── C ──
  await escribirRow("r2", renglon("B6810432"), { crear: true });
  await escribirRow("r2", { cotizacion_pedida: { por_uid: "uJefa", por_email: JEFA, at: admin.firestore.FieldValue.serverTimestamp() } });
  const cot2 = (await cots()).find(c => c.cobro_equipo_id === "r2");
  assert.ok(cot2, "segunda cotización");
  assert.notEqual(cot2.cotizacion_id, cot.cotizacion_id, "correlativo distinto");
  await escribirCot(cot2.id, { estado: "enviada" });
  await escribirCot(cot2.id, { estado: "rechazada", rechazado_por_email: JEFA, rechazo_origen: "cliente" });
  const r2 = await row("r2");
  assert.equal(r2.cotizacion_estado, "rechazada");
  assert.equal(r2.etapa, "en_cobranza", "rechazada → cobranza");
  assert.ok(r2.escalado_at, "con fecha de escalado");
  assert.equal((await db.doc("equipos_pool/B6810432").get()).data().estado, "en_cliente", "la ficha no se mueve");
  assert.equal((await db.collection("facturacion_avisos").get()).size, 1, "sin fila de facturación para la rechazada");
  console.log("C ok — rechazada → renglón en cobranza");

  console.log("\nTODO OK");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
