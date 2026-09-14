// El circuito completo "cotización de taller → factura" contra el emulador de
// FIRESTORE a secas (2026-09-14, pedido de Solangel). Sin el emulador de
// Functions, cuyo runtime sustituye admin.firestore por un stub que pierde
// FieldValue (memoria reference_emulador_functions_stub_fieldvalue): los
// triggers v2 se invocan por su `.run(event)` con snapshots REALES.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-cot-facturada \
//     "node functions/test-emulator/cotizacion-facturada.js"
//
// Congela el recorrido entero:
//   1) la orden pasa a ENTREGADO AL CLIENTE → nace la fila en la bandeja
//      (tipo cotizacion_servicio, POC fuera, QBO sin período) y sale el correo
//      a activaciones con copia al vendedor del cliente;
//   2) la cotización queda marcada "por facturar" (chip del listado);
//   3) re-entregar NO duplica la fila ni el correo;
//   4) Recepción marca QBO con el número → el correo de vuelta va a QUIEN
//      elaboró la cotización y la cotización queda "facturada";
//   5) marcar dos veces no manda dos correos (candado correo_facturada_at);
//   6) deshacer el paso devuelve la cotización a "por facturar" y suelta el
//      candado.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-cot-facturada";

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onEntregada = require("../src/triggers/ordenes/onOrdenEntregada");
const onFacturada = require("../src/triggers/facturacion/onCotizacionFacturada");
assert.equal(typeof onEntregada.run, "function", "onOrdenEntregada debe exponer .run(event)");
assert.equal(typeof onFacturada.run, "function", "onCotizacionFacturada debe exponer .run(event)");

const ORDEN = "2026090701";
const COT = "cotDeTaller1";
const CLIENTE = "cliSkyChefs";
const AVISO = `cotizacion_servicio__${COT}`;
const TALLER = "solangel.hosang@cecomunica.com";
const VENDEDOR = "zuleika.diaz@cecomunica.com";

async function borrar(col) {
  const s = await db.collection(col).get();
  await Promise.all(s.docs.map(d => d.ref.delete()));
}

async function seed() {
  await Promise.all([borrar("mail_queue"), borrar("facturacion_avisos"), borrar("cotizaciones")]);
  await db.doc("empresa/config").set({ email_activaciones: "activaciones@cecomunica.com" });
  await db.doc("usuarios/uVend").set({ email: VENDEDOR, rol: "vendedor" });
  await db.doc(`clientes/${CLIENTE}`).set({ nombre: "SKY CHEFS DE PANAMA, S.A.", vendedor_asignado: "uVend" });
  await db.doc(`cotizaciones/${COT}`).set({
    cotizacion_id: "COT-2026-0091", origen: "orden", orden_id: ORDEN, estado: "enviada", deleted: false,
    cliente_nombre: "SKY CHEFS DE PANAMA, S.A.", clienteId: CLIENTE,
    creado_por_email: TALLER, creado_por_uid: "uTaller",
    itbms_aplica: true, subtotal: 97.4, itbms_monto: 6.82, total: 104.22, total_con_itbms: 104.22,
    items: [
      { nombre: "Flex Vol/Sel NX-420", modelo: "J87-0040-05", cant: 1, precio: 8.95, desc: 0,
        equipo: { serial: "B6810431", modelo: "NX-420-R" } },
      { nombre: "Front Cover 4 Teclas", modelo: "A02-4131-13", cant: 1, precio: 40, desc: 0,
        equipo: { serial: "B6810431", modelo: "NX-420-R" } },
    ],
  });
  await db.doc(`ordenes_de_servicio/${ORDEN}`).set({
    tipo_de_servicio: "REPARACION", estado_reparacion: "COMPLETADO",
    cliente_nombre: "SKY CHEFS DE PANAMA, S.A.", cliente_id: CLIENTE,
  });
}

// Corre onOrdenEntregada como lo haría el trigger: before/after reales.
async function entregar() {
  const ref = db.doc(`ordenes_de_servicio/${ORDEN}`);
  const before = await ref.get();
  await ref.update({ estado_reparacion: "ENTREGADO AL CLIENTE", fecha_entrega: admin.firestore.Timestamp.now() });
  const after = await ref.get();
  await onEntregada.run({ data: { before, after }, params: { ordenId: ORDEN } });
}

// Escribe sobre el aviso lo mismo que escribe el navegador (marcarPaso) y
// dispara onCotizacionFacturada con los snapshots de antes y después.
async function escribirAviso(patch) {
  const ref = db.doc(`facturacion_avisos/${AVISO}`);
  const before = await ref.get();
  await ref.set(patch, { merge: true });
  const after = await ref.get();
  await onFacturada.run({ data: { before, after }, params: { avisoId: AVISO } });
  return ref;
}

const correos = async () => (await db.collection("mail_queue").get()).docs.map(d => d.data());
const porFuente = (ms, src) => ms.filter(m => m.meta?.source === src);

(async () => {
  await seed();

  // ── 1) La entrega abre la fila ──────────────────────────────────────────
  await entregar();

  const aviso = (await db.doc(`facturacion_avisos/${AVISO}`).get()).data();
  assert.ok(aviso, "la entrega debe abrir la fila en Facturación pendiente");
  assert.equal(aviso.tipo, "cotizacion_servicio");
  assert.equal(aviso.estado, "pendiente");
  assert.equal(aviso.cliente_nombre, "SKY CHEFS DE PANAMA, S.A.");
  assert.equal(aviso.orden_id, ORDEN);
  assert.equal(aviso.contexto.cotizacion_id, "COT-2026-0091");
  assert.equal(aviso.contexto.cotizacion_doc_id, COT);
  assert.equal(aviso.contexto.cotizado_por, TALLER);
  assert.equal(aviso.pasos.qbo.aplica, true);
  assert.equal(aviso.pasos.qbo.periodo, false, "una reparación no pide 'facturar desde'");
  assert.equal(aviso.pasos.poc.aplica, false, "el radio es del cliente: POC no aplica");
  assert.equal(aviso.resumen.total, 104.22);
  assert.equal(aviso.resumen.mensual, null, "el cobro es único, no mensual");
  assert.equal(aviso.detalle.renglones.length, 2);
  assert.equal(aviso.comision.aplica, false, "una reparación no paga comisión");
  assert.equal(aviso.vendedor_email, VENDEDOR, "el CC sale del vendedor del cliente");
  console.log("  PASS la entrega abre la fila en Facturación pendiente");

  let ms = await correos();
  const aperturas = porFuente(ms, "onOrdenEntregada");
  assert.equal(aperturas.length, 1, "un solo correo de apertura");
  assert.match(aperturas[0].subject, /FACTURAR: reparación entregada/);
  assert.match(aperturas[0].subject, /COT-2026-0091/);
  assert.equal(aperturas[0].cc, VENDEDOR);
  assert.match(aperturas[0].bodyContent, /104\.22/);
  assert.match(aperturas[0].bodyContent, /Front Cover 4 Teclas/);
  console.log("  PASS el correo de apertura lleva el detalle y el total");

  // ── 2) La cotización queda "por facturar" ───────────────────────────────
  let cot = (await db.doc(`cotizaciones/${COT}`).get()).data();
  assert.equal(cot.facturacion.estado, "pendiente");
  assert.equal(cot.facturacion.aviso_id, AVISO);
  assert.equal(cot.facturacion.factura, null);
  console.log("  PASS la cotización queda marcada 'por facturar'");

  // ── 3) Re-entregar no duplica ───────────────────────────────────────────
  await entregar();
  ms = await correos();
  assert.equal(porFuente(ms, "onOrdenEntregada").length, 1, "re-entregar no manda un segundo correo");
  console.log("  PASS re-entregar no duplica la fila ni el correo");

  // ── 4) Recepción factura ────────────────────────────────────────────────
  await escribirAviso({
    estado: "hecho",
    pasos: { qbo: { aplica: true, periodo: false, hecho: true, at: admin.firestore.Timestamp.now(),
                    por_email: "cecrecep@cecomunica.com", factura: "10812", ref: null },
             poc: { aplica: false, hecho: false, at: null, por_email: null } },
  });

  ms = await correos();
  const avisos = porFuente(ms, "onCotizacionFacturada");
  assert.equal(avisos.length, 1, "un correo de vuelta al taller");
  assert.equal(avisos[0].to, TALLER, "el aviso va a QUIEN elaboró la cotización");
  assert.equal(avisos[0].cc, VENDEDOR);
  assert.match(avisos[0].subject, /FACTURADA: COT-2026-0091/);
  assert.match(avisos[0].subject, /Factura 10812/);
  assert.match(avisos[0].bodyContent, /10812/);
  console.log("  PASS al marcar QBO, el número de factura le vuelve al taller");

  cot = (await db.doc(`cotizaciones/${COT}`).get()).data();
  assert.equal(cot.facturacion.estado, "facturada");
  assert.equal(cot.facturacion.factura, "10812");
  assert.equal(cot.facturacion.facturada_por, "cecrecep@cecomunica.com");
  console.log("  PASS la cotización queda 'Facturada 10812' en el listado");

  // ── 5) El candado ───────────────────────────────────────────────────────
  // Re-correr el MISMO evento (reintento del trigger) no manda otro correo.
  const ref = db.doc(`facturacion_avisos/${AVISO}`);
  const snap = await ref.get();
  await onFacturada.run({ data: { before: (await db.doc(`ordenes_de_servicio/${ORDEN}`).get()), after: snap },
    params: { avisoId: AVISO } });
  ms = await correos();
  assert.equal(porFuente(ms, "onCotizacionFacturada").length, 1, "el candado corta el correo repetido");
  console.log("  PASS el candado evita el correo repetido");

  // ── 6) Deshacer devuelve todo atrás ─────────────────────────────────────
  await escribirAviso({
    estado: "pendiente",
    pasos: { qbo: { aplica: true, periodo: false, hecho: false, at: null, por_email: null, factura: "10812" },
             poc: { aplica: false, hecho: false, at: null, por_email: null } },
  });
  cot = (await db.doc(`cotizaciones/${COT}`).get()).data();
  assert.equal(cot.facturacion.estado, "pendiente", "deshacer devuelve la cotización a por facturar");
  const tras = (await ref.get()).data();
  assert.equal(tras.correo_facturada_at, undefined, "el candado se suelta para el próximo marcado");
  console.log("  PASS deshacer el paso revierte el chip y suelta el candado");

  // ── 7) La VISITA TÉCNICA cierra en sitio, no se "entrega" ───────────────
  // 3 de las 5 órdenes con cotización de taller que existen hoy son visitas, y
  // una visita nunca pasa por ENTREGADO AL CLIENTE. Sin esta puerta, esas
  // cotizaciones no llegarían nunca a facturarse.
  const ORDEN_V = "2026090401";
  const COT_V = "cotDeVisita1";
  await db.doc(`cotizaciones/${COT_V}`).set({
    cotizacion_id: "COT-2026-0083", origen: "orden", orden_id: ORDEN_V, estado: "enviada", deleted: false,
    cliente_nombre: "SKY CHEFS DE PANAMA, S.A.", clienteId: CLIENTE,
    creado_por_email: TALLER, creado_por_uid: "uTaller",
    itbms_aplica: true, subtotal: 70.4, itbms_monto: 4.93, total: 75.33, total_con_itbms: 75.33,
    items: [{ nombre: "Revisión en sitio", cant: 1, precio: 70.4, desc: 0 }],
  });
  await db.doc(`ordenes_de_servicio/${ORDEN_V}`).set({
    tipo_de_servicio: "VISITA TECNICA", estado_reparacion: "ASIGNADO",
    cliente_nombre: "SKY CHEFS DE PANAMA, S.A.", cliente_id: CLIENTE,
  });
  const refV = db.doc(`ordenes_de_servicio/${ORDEN_V}`);
  const beforeV = await refV.get();
  await refV.update({
    estado_reparacion: "CERRADA (VISITA)",
    fecha_cierre_visita: admin.firestore.Timestamp.now(),
  });
  await onEntregada.run({ data: { before: beforeV, after: await refV.get() }, params: { ordenId: ORDEN_V } });

  const avisoV = (await db.doc(`facturacion_avisos/cotizacion_servicio__${COT_V}`).get()).data();
  assert.ok(avisoV, "cerrar la visita en sitio también abre la fila");
  assert.equal(avisoV.contexto.es_visita, true);
  assert.equal(avisoV.resumen.total, 75.33);
  const cotV = (await db.doc(`cotizaciones/${COT_V}`).get()).data();
  assert.equal(cotV.facturacion.estado, "pendiente");
  ms = await correos();
  const mv = porFuente(ms, "onOrdenEntregada").find(m => /COT-2026-0083/.test(m.subject));
  assert.ok(mv, "sale su correo de apertura");
  assert.match(mv.subject, /visita cerrada/, "el correo lo dice como ocurrió: la visita cerró");
  assert.match(mv.bodyContent, /la visita ya se cerró en sitio/);
  console.log("  PASS la visita técnica cerrada en sitio también entra a facturarse");

  // Una ENTRADA no es trabajo facturable: recibir equipo no abre fila.
  const ORDEN_E = "2026090999";
  await db.doc(`cotizaciones/cotDeEntrada1`).set({
    cotizacion_id: "COT-2026-9999", origen: "orden", orden_id: ORDEN_E, estado: "enviada", deleted: false,
    cliente_nombre: "X", clienteId: CLIENTE, total: 10, total_con_itbms: 10, items: [],
  });
  const refE = db.doc(`ordenes_de_servicio/${ORDEN_E}`);
  await refE.set({ tipo_de_servicio: "ENTRADA", estado_reparacion: "ASIGNADO", cliente_id: CLIENTE });
  const beforeE = await refE.get();
  await refE.update({ estado_reparacion: "CERRADA (ENTRADA)" });
  await onEntregada.run({ data: { before: beforeE, after: await refE.get() }, params: { ordenId: ORDEN_E } });
  assert.equal((await db.doc("facturacion_avisos/cotizacion_servicio__cotDeEntrada1").get()).exists, false,
    "cerrar una ENTRADA no abre fila de facturación");
  console.log("  PASS cerrar una ENTRADA no abre fila (recibir equipo no se factura)");

  console.log("\nTODO OK — circuito cotización de taller → factura");
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e.message); process.exit(1); });
