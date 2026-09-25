// Cotización de taller "el cliente aceptó → a facturar" y REEMPLAZO POR DAÑO,
// de punta a punta contra el emulador de FIRESTORE (2026-09-25). Mismo patrón
// que cotizacion-facturada.js: los triggers v2 se invocan por su `.run(event)`
// con snapshots REALES (el emulador de Functions pierde FieldValue).
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-taller-reposicion \
//     "node functions/test-emulator/taller-reposicion.js"
//
// Recorridos:
//   A) Cotización de taller ACEPTADA con el equipo aún en el taller → nace la
//      fila de facturación diciendo "equipo en el taller"; la entrega
//      posterior de la orden NO abre otra fila ni manda otro correo.
//   B) Reemplazo por DAÑO: al crearse el servidor pone el valor de reposición
//      del catálogo y avisa a administración "CON CARGO"; al aprobar con cargo
//      se arma la cotización de TALLER (borrador, firmada por la jefa de
//      taller, con su cargo) y Bodega NO recibe aviso; al aceptarla el
//      cliente → fila de facturación + la gestión pasa a Bodega (y ahí sí el
//      correo); la cotización de reposición no bloquea los materiales.
//   C) El cliente NO acepta → gestión cerrada sin reemplazo + renglón en
//      cobranza por el monto aprobado + aviso a administración. Una sola deuda.
//   D) Se anula la gestión con la cotización viva → la cotización se descarta.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-taller-reposicion";

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onEstado = require("../src/triggers/cotizaciones/onEstadoChange");
const onEntregada = require("../src/triggers/ordenes/onOrdenEntregada");
const onGestion = require("../src/triggers/gestiones/onGestionWrite");

const CLIENTE = "cliGamboa";
const JEFA = "solangel.hosang@cecomunica.com";
const TECNICO = "tecnico1@cecomunica.com";
const BODEGA = "inventario@cecomunica.com";

async function borrar(col) {
  const s = await db.collection(col).get();
  await Promise.all(s.docs.map(d => d.ref.delete()));
}
const correos = async () => (await db.collection("mail_queue").get()).docs.map(d => d.data());
const pasos = async (p) => (await correos()).filter(m => m.meta?.paso === p);

async function seed() {
  for (const c of ["mail_queue", "facturacion_avisos", "cotizaciones", "gestiones", "cobros_equipos", "contadores", "ordenes_de_servicio"]) await borrar(c);
  await db.doc("empresa/config").set({
    email_activaciones: "activaciones@cecomunica.com", email_bodega: BODEGA,
    email_aprobaciones: "ventas@cecomunica.com", cotizacion_validez_dias: 15,
  });
  await db.doc("usuarios/uJefa").set({ email: JEFA, rol: "jefe_taller", nombre: "Solangel Hosang", cargo: "Jefa de Taller" });
  await db.doc("usuarios/uVend").set({ email: "zuleika.diaz@cecomunica.com", rol: "vendedor" });
  await db.doc(`clientes/${CLIENTE}`).set({ nombre: "GAMBOA, S.A.", vendedor_asignado: "uVend", email: "compras@gamboa.com", representante: "Ana Pérez" });
  await db.doc("modelos/nx420").set({ modelo: "NX-420", marca: "Kenwood", precio_venta: 285, estado: "N" });
  await db.doc("ordenes_de_servicio/2026092501").set({
    tipo_de_servicio: "REPARACION", estado_reparacion: "COMPLETADO", cliente_nombre: "GAMBOA, S.A.", cliente_id: CLIENTE,
  });
  await db.doc("ordenes_de_servicio/2026092502").set({
    tipo_de_servicio: "REPARACION", estado_reparacion: "ASIGNADO", cliente_nombre: "GAMBOA, S.A.", cliente_id: CLIENTE,
  });
}

// Escribe y dispara el trigger con before/after reales.
async function escribirCot(id, patch) {
  const ref = db.doc(`cotizaciones/${id}`);
  const before = await ref.get();
  await ref.update(patch);
  const after = await ref.get();
  await onEstado.run({ data: { before, after }, params: { docId: id } });
}
async function escribirGestion(gid, dataOrPatch, { crear = false } = {}) {
  const ref = db.doc(`gestiones/${gid}`);
  const before = await ref.get();
  if (crear) await ref.set(dataOrPatch); else await ref.update(dataOrPatch);
  const after = await ref.get();
  await onGestion.run({ data: { before, after }, params: { gid } });
}
// Re-dispara el trigger sobre el estado actual (el eco de una escritura del
// servidor): la máquina no debe hacer nada dos veces.
async function eco(gid, beforeSnap) {
  const after = await db.doc(`gestiones/${gid}`).get();
  await onGestion.run({ data: { before: beforeSnap, after }, params: { gid } });
}

const gestionDano = (gid) => ({
  tipo: "reemplazo", estado: "pendiente_aprobacion", cliente_id: CLIENTE, cliente_nombre: "GAMBOA, S.A.",
  causa: "dano_cliente",
  dano: { tipo: "liquido", tipo_label: "Líquido o humedad", fotos: [`gestiones_anexos/${gid}/dano-1.jpg`] },
  cobro: { requiere: true, fuente: "valor_reposicion", estado: "por_aprobar" },
  origen: { tipo: "taller", orden_id: "2026092502", equipo_id: "e1", serial: "B6810431",
    diagnostico: "Entró con agua, placa sulfatada", tecnico_email: TECNICO, tecnico_uid: "uTec" },
  aprobacion: { requiere: true, motivo: "dano_cliente" },
  items: [{ serial_saliente: "B6810431", modelo: "NX-420", modelo_id: "nx420", elegibilidad: "alquiler",
    motivo_codigo: "dano_cliente", saliente_en_casa: true, serial_nuevo: null }],
  ordenes: {}, cierre: {}, responsable_uid: "uTec", responsable_email: TECNICO, deleted: false,
});

async function aprobarConCargo(gid, monto) {
  const snap = await db.doc(`gestiones/${gid}`).get();
  await escribirGestion(gid, {
    estado: "pendiente_cliente", "cierre.aprobacion": true,
    aprobacion: { requiere: true, motivo: "dano_cliente", decision: "con_cargo", aprobado_por_email: "alberto@cecomunica.com" },
    cobro: { ...(snap.data().cobro || {}), requiere: true, monto, estado: "por_cotizar" },
  });
}

async function main() {
  await seed();

  // ── A ───────────────────────────────────────────────────────────────────
  await db.doc("cotizaciones/cotA").set({
    cotizacion_id: "COT-2026-0200", origen: "orden", orden_id: "2026092501", estado: "enviada", deleted: false,
    cliente_nombre: "GAMBOA, S.A.", clienteId: CLIENTE, creado_por_email: JEFA, creado_por_uid: "uJefa",
    itbms_aplica: true, subtotal: 100, itbms_monto: 7, total: 107, total_con_itbms: 107,
    items: [{ nombre: "Antena", modelo: "KRA-22", cant: 1, precio: 100, desc: 0, equipo: { serial: "X1", modelo: "NX-420" } }],
  });
  await escribirCot("cotA", {
    estado: "convertida", fecha_conversion: admin.firestore.Timestamp.now(),
    aceptacion: { medio: "correo", nota: "respondió el correo", por_email: JEFA, at: admin.firestore.Timestamp.now() },
  });
  const avA = await db.doc("facturacion_avisos/cotizacion_servicio__cotA").get();
  assert.ok(avA.exists, "A: el clic de 'aceptó' abre la fila de facturación");
  assert.equal(avA.data().contexto.equipo_en_taller, true, "A: la fila dice que el equipo sigue en el taller");
  assert.equal(avA.data().contexto.aceptacion_medio, "correo");
  assert.equal((await db.doc("cotizaciones/cotA").get()).data().facturacion.estado, "pendiente");
  const facturarA = (await correos()).filter(m => /FACTURAR: cotización de taller aceptada/.test(m.subject || ""));
  assert.equal(facturarA.length, 1, "A: un correo a Recepción");
  // La orden se entrega después: nada nuevo.
  const oRef = db.doc("ordenes_de_servicio/2026092501");
  const ob = await oRef.get();
  await oRef.update({ estado_reparacion: "ENTREGADO AL CLIENTE", fecha_entrega: admin.firestore.Timestamp.now() });
  await onEntregada.run({ data: { before: ob, after: await oRef.get() }, params: { ordenId: "2026092501" } });
  assert.equal((await db.collection("facturacion_avisos").get()).size, 1, "A: la entrega no abre otra fila");
  assert.equal((await correos()).filter(m => /^FACTURAR/.test(m.subject || "")).length, 1, "A: ni otro correo");
  console.log("  PASS A · aceptada en el taller → una fila, 'equipo en el taller'; la entrega no duplica");

  // ── B ───────────────────────────────────────────────────────────────────
  const GB = "GR20260925-01";
  await escribirGestion(GB, gestionDano(GB), { crear: true });
  let g = (await db.doc(`gestiones/${GB}`).get()).data();
  assert.equal(g.cobro.monto_referencia, 285, "B: el servidor puso el valor de reposición del catálogo");
  const aprob = await pasos("aprobacion");
  assert.equal(aprob.length, 1);
  assert.match(aprob[0].subject, /CON CARGO por daño — radio B6810431/);
  assert.match(aprob[0].bodyContent, /\$285\.00<\/b> \+ ITBMS/);
  // Eco de la escritura del monto: no vuelve a mandar el correo.
  await eco(GB, await db.doc(`gestiones/${GB}`).get());
  assert.equal((await pasos("aprobacion")).length, 1, "B: el eco no duplica el correo de aprobación");

  const antesAprob = await db.doc(`gestiones/${GB}`).get();
  await aprobarConCargo(GB, 250);
  g = (await db.doc(`gestiones/${GB}`).get()).data();
  assert.ok(g.cobro.cotizacion_doc_id, "B: al aprobar con cargo se arma la cotización");
  assert.equal(g.cobro.estado, "cotizada");
  assert.equal(g.cobro.cotizacion_en_curso, undefined, "B: el candado se suelta");
  assert.equal((await pasos("bodega")).length, 0, "B: Bodega NO recibe aviso antes de que el cliente acepte");
  // Un segundo disparo del mismo flanco no arma otra cotización.
  await onGestion.run({ data: { before: antesAprob, after: await db.doc(`gestiones/${GB}`).get() }, params: { gid: GB } });
  assert.equal((await db.collection("cotizaciones").where("gestion_id", "==", GB).get()).size, 1, "B: una sola cotización");
  const cotId = g.cobro.cotizacion_doc_id;
  let cot = (await db.doc(`cotizaciones/${cotId}`).get()).data();
  assert.equal(cot.estado, "borrador");
  assert.equal(cot.origen, "orden");
  assert.equal(cot.orden_id, "2026092502");
  assert.equal(cot.gestion_id, GB);
  assert.match(cot.cotizacion_id, /^COT-2026-\d{4}$/);
  assert.equal(cot.ejecutivo_nombre, "Solangel Hosang");
  assert.equal(cot.ejecutivo_cargo, "Jefa de Taller");
  assert.equal(cot.creado_por_email, JEFA);
  assert.equal(cot.items[0].precio, 250);
  assert.equal(cot.total_con_itbms, 267.5);
  assert.deepEqual(cot.condiciones, []);
  assert.equal(cot.dirigido_email, "compras@gamboa.com");
  const lista = await pasos("cotizacion_reposicion");
  assert.equal(lista.length, 1);
  assert.equal(lista[0].to, JEFA, "B: la jefa de taller recibe 'enviar al cliente'");
  const ordenB = (await db.doc("ordenes_de_servicio/2026092502").get()).data();
  assert.ok((ordenB.cotizaciones_ids || []).includes(cotId), "B: la orden enlaza la cotización");
  console.log("  PASS B1 · daño: valor del catálogo, aprobación con cargo arma la cotización de taller; bodega espera");

  await escribirCot(cotId, { estado: "enviada", enviada_en: admin.firestore.Timestamp.now() });
  assert.notEqual((await db.doc("ordenes_de_servicio/2026092502").get()).data().cotizacion_emitida, true,
    "B: la cotización de reposición no bloquea los materiales de la orden");
  const antesAcepta = await db.doc(`gestiones/${GB}`).get();
  await escribirCot(cotId, {
    estado: "convertida", fecha_conversion: admin.firestore.Timestamp.now(),
    aceptacion: { medio: "verbal", nota: "lo confirmó por teléfono", por_email: JEFA, at: admin.firestore.Timestamp.now() },
  });
  g = (await db.doc(`gestiones/${GB}`).get()).data();
  assert.equal(g.estado, "pendiente_bodega", "B: aceptar libera la gestión a Bodega");
  assert.equal(g.cobro.estado, "aceptada");
  assert.equal(g.cierre.cotizacion, true);
  const avB = await db.doc(`facturacion_avisos/cotizacion_servicio__${cotId}`).get();
  assert.ok(avB.exists, "B: y abre la fila de facturación");
  assert.equal(avB.data().contexto.reposicion_dano, true);
  // El flanco pendiente_cliente → pendiente_bodega manda el correo a Bodega.
  await onGestion.run({ data: { before: antesAcepta, after: await db.doc(`gestiones/${GB}`).get() }, params: { gid: GB } });
  const bod = await pasos("bodega");
  assert.equal(bod.length, 1, "B: ahora sí, el aviso a Bodega");
  assert.equal(bod[0].to, BODEGA);
  assert.match(bod[0].bodyContent, /Reposición por daño — el cliente aceptó el cobro/);
  console.log("  PASS B2 · el cliente aceptó → facturación + Bodega; los materiales de la orden siguen libres");

  // ── C ───────────────────────────────────────────────────────────────────
  const GC = "GR20260925-02";
  await escribirGestion(GC, gestionDano(GC), { crear: true });
  await aprobarConCargo(GC, 240);
  const cotC = (await db.doc(`gestiones/${GC}`).get()).data().cobro.cotizacion_doc_id;
  await escribirCot(cotC, { estado: "enviada", enviada_en: admin.firestore.Timestamp.now() });
  await escribirCot(cotC, { estado: "rechazada", fecha_rechazo: admin.firestore.Timestamp.now(), cierre_motivo: "No va a pagar" });
  const gC = (await db.doc(`gestiones/${GC}`).get()).data();
  assert.equal(gC.estado, "cerrada");
  assert.equal(gC.resultado, "sin_reemplazo_cobranza");
  assert.equal(gC.cobro.estado, "cobranza");
  const deudas = await db.collection("cobros_equipos").where("gestion_id", "==", GC).get();
  assert.equal(deudas.size, 1, "C: una deuda en cobranza");
  const d = deudas.docs[0].data();
  assert.equal(d.monto_unit, 240, "C: por el monto que aprobó administración");
  assert.equal(d.motivo_codigo, "dano_cliente");
  assert.equal(d.etapa, "pendiente");
  assert.equal(gC.cobro.cobro_equipo_id, deudas.docs[0].id);
  assert.equal((await pasos("reposicion_rechazada")).length, 1, "C: aviso a administración");
  assert.equal((await pasos("bodega")).length, 1, "C: Bodega nunca se enteró de esta");
  // Re-disparar el rechazo no abre otra deuda.
  const ref = db.doc(`cotizaciones/${cotC}`);
  const s1 = await ref.get();
  await onEstado.run({ data: { before: { data: () => ({ ...s1.data(), estado: "enviada" }) }, after: s1 }, params: { docId: cotC } });
  assert.equal((await db.collection("cobros_equipos").where("gestion_id", "==", GC).get()).size, 1, "C: una gestión = una deuda");
  console.log("  PASS C · el cliente no aceptó → cerrada sin reemplazo, deuda en cobranza por el monto aprobado");

  // ── D ───────────────────────────────────────────────────────────────────
  const GD = "GR20260925-03";
  await escribirGestion(GD, gestionDano(GD), { crear: true });
  await aprobarConCargo(GD, 200);
  const cotD = (await db.doc(`gestiones/${GD}`).get()).data().cobro.cotizacion_doc_id;
  await escribirGestion(GD, { estado: "anulada", anulada_motivo: "el técnico se equivocó de radio", anulada_por_uid: "uAdmin" });
  const cD = (await db.doc(`cotizaciones/${cotD}`).get()).data();
  assert.equal(cD.estado, "descartada", "D: la cotización se descarta con la gestión");
  assert.match(cD.cierre_motivo, /Se anuló la gestión GR20260925-03/);
  console.log("  PASS D · anular la gestión descarta su cotización viva");

  console.log("\nTALLER + REPOSICIÓN POR DAÑO: TODOS LOS RECORRIDOS PASARON");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e && e.stack ? e.stack : e); process.exit(1); });
