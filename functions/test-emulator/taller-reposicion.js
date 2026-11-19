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
//   E) Varias reposiciones de la MISMA orden (2026-11-19) → una cotización con
//      un renglón por radio; anular una le quita su renglón; aceptarla libera
//      todas a bodega y abre UNA fila de facturación.
//   F) La reposición ya estaba cotizada a mano → unirACotizacion: la automática
//      se descarta sin cerrar las gestiones y se factura la del taller.
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

  // ── E · varias reposiciones de la MISMA orden → UNA cotización ──────────
  // (2026-11-19, WESTIN 2026111702: cuatro radios dañados eran cuatro
  // cotizaciones de un renglón.)
  const OE = "2026111702";
  await db.doc(`ordenes_de_servicio/${OE}`).set({
    tipo_de_servicio: "REPARACION", estado_reparacion: "COMPLETADO (EN OFICINA)", cliente_nombre: "GAMBOA, S.A.", cliente_id: CLIENTE,
  });
  const danoDe = (gid, ordenId, serial) => {
    const g = gestionDano(gid);
    g.origen = { ...g.origen, orden_id: ordenId, serial, equipo_id: `eq-${serial}` };
    g.items = [{ ...g.items[0], serial_saliente: serial }];
    return g;
  };
  const GE = ["GR20261119-01", "GR20261119-02", "GR20261119-03", "GR20261119-04"];
  const SE = ["23418A0382", "23418A0384", "23418A0383", "24220A2258"];
  for (let i = 0; i < 4; i++) await escribirGestion(GE[i], danoDe(GE[i], OE, SE[i]), { crear: true });
  // Las cuatro aprobaciones casi a la vez (en producción cayeron en 24 s).
  await Promise.all(GE.map((gid) => aprobarConCargo(gid, 180)));
  const gsE = await Promise.all(GE.map(async (gid) => (await db.doc(`gestiones/${gid}`).get()).data()));
  const cotE = gsE[0].cobro.cotizacion_doc_id;
  assert.ok(cotE, "E: la reposición quedó cotizada");
  assert.ok(gsE.every((g) => g.cobro.cotizacion_doc_id === cotE && g.cobro.estado === "cotizada" && g.cobro.cotizacion_en_curso === undefined),
    "E: las cuatro gestiones apuntan a la MISMA cotización");
  const delaOrden = (await db.collection("cotizaciones").where("orden_id", "==", OE).get()).docs;
  assert.equal(delaOrden.length, 1, "E: una sola cotización para la orden");
  let cE = delaOrden[0].data();
  assert.equal(cE.estado, "borrador");
  assert.equal(cE.items.length, 4, "E: un renglón por radio");
  assert.deepEqual([...cE.gestion_ids].sort(), [...GE].sort(), "E: gestion_ids trae las cuatro");
  assert.ok(GE.includes(cE.gestion_id), "E: gestion_id conserva la primera (compatibilidad)");
  assert.deepEqual(cE.items.map((x) => x.equipo.serial).sort(), [...SE].sort());
  assert.equal(cE.subtotal, 720, "E: 4 × $180");
  assert.equal(cE.total_con_itbms, 770.4, "E: + 7% de ITBMS");
  assert.equal(cE.total, 770.4);
  assert.match(cE.intro, /reposición de 4 radios/, "E: la introducción habla de los cuatro");
  const listasE = (await pasos("cotizacion_reposicion")).filter((m) => GE.includes(m.meta.gestion_id));
  assert.equal(listasE.length, 4, "E: la jefa se entera de cada aprobación");
  assert.equal(listasE.filter((m) => /^Enviar al cliente/.test(m.subject)).length, 1, "E: un 'enviar al cliente'");
  assert.equal(listasE.filter((m) => /^Se sumó a COT-/.test(m.subject)).length, 3, "E: y tres 'se sumó'");
  assert.equal(((await db.doc(`ordenes_de_servicio/${OE}`).get()).data().cotizaciones_ids || []).length, 1, "E: la orden la enlaza una vez");
  console.log("  PASS E1 · cuatro reposiciones aprobadas a la vez → una cotización de cuatro renglones");

  // Anular una con la cotización en borrador: se le quita su renglón.
  await escribirGestion(GE[3], { estado: "anulada", anulada_motivo: "ese radio sí tenía garantía", anulada_por_uid: "uAdmin" });
  cE = (await db.doc(`cotizaciones/${cotE}`).get()).data();
  assert.equal(cE.estado, "borrador", "E: la cotización sigue viva para las otras tres");
  assert.equal(cE.items.length, 3);
  assert.ok(!cE.items.some((x) => x.equipo.serial === SE[3]), "E: sin el renglón del radio anulado");
  assert.deepEqual([...cE.gestion_ids].sort(), GE.slice(0, 3).sort());
  assert.equal(cE.subtotal, 540);
  assert.match(cE.intro, /reposición de 3 radios/);
  console.log("  PASS E2 · anular una en borrador le quita su renglón y recalcula");

  // Ya enviada: la siguiente reposición de la orden NO se le suma.
  await escribirCot(cotE, { estado: "enviada", enviada_en: admin.firestore.Timestamp.now() });
  const G5 = "GR20261119-05";
  await escribirGestion(G5, danoDe(G5, OE, "23418A0390"), { crear: true });
  await aprobarConCargo(G5, 180);
  const cot5 = (await db.doc(`gestiones/${G5}`).get()).data().cobro.cotizacion_doc_id;
  assert.notEqual(cot5, cotE, "E: a una cotización que ya salió al cliente no se le suma nada");
  assert.equal((await db.doc(`cotizaciones/${cotE}`).get()).data().items.length, 3);

  // La orden se entrega antes de que el cliente conteste: no se factura.
  const avisosAntes = (await db.collection("facturacion_avisos").get()).size;
  const oeRef = db.doc(`ordenes_de_servicio/${OE}`);
  const oeB = await oeRef.get();
  await oeRef.update({ estado_reparacion: "ENTREGADO AL CLIENTE", fecha_entrega: admin.firestore.Timestamp.now() });
  await onEntregada.run({ data: { before: oeB, after: await oeRef.get() }, params: { ordenId: OE } });
  assert.equal((await db.collection("facturacion_avisos").get()).size, avisosAntes, "E: la entrega no factura una reposición sin aceptar");

  // El cliente acepta: las tres siguen a bodega y hay UNA fila de facturación.
  const antesAcepta3 = await Promise.all(GE.slice(0, 3).map((gid) => db.doc(`gestiones/${gid}`).get()));
  await escribirCot(cotE, {
    estado: "convertida", fecha_conversion: admin.firestore.Timestamp.now(),
    aceptacion: { medio: "correo", nota: "", por_email: JEFA, at: admin.firestore.Timestamp.now() },
  });
  for (const gid of GE.slice(0, 3)) {
    const g = (await db.doc(`gestiones/${gid}`).get()).data();
    assert.equal(g.estado, "pendiente_bodega", `E: ${gid} sigue a bodega`);
    assert.equal(g.cobro.estado, "aceptada");
  }
  assert.equal((await db.doc(`gestiones/${GE[3]}`).get()).data().estado, "anulada", "E: la anulada no revive");
  assert.equal((await db.doc(`gestiones/${G5}`).get()).data().estado, "pendiente_cliente", "E: la de la otra cotización sigue esperando");
  const avE = await db.doc(`facturacion_avisos/cotizacion_servicio__${cotE}`).get();
  assert.ok(avE.exists, "E: una fila de facturación");
  assert.equal((await db.collection("facturacion_avisos").get()).size, avisosAntes + 1, "E: una sola");
  assert.equal(avE.data().contexto.reposicion_dano, true);
  assert.equal(avE.data().contexto.gestion_ids.length, 3);
  assert.equal(avE.data().detalle.renglones.length, 3);
  const bodegaAntes = (await pasos("bodega")).length;
  for (let i = 0; i < 3; i++) {
    await onGestion.run({ data: { before: antesAcepta3[i], after: await db.doc(`gestiones/${GE[i]}`).get() }, params: { gid: GE[i] } });
  }
  assert.equal((await pasos("bodega")).length, bodegaAntes + 3, "E: bodega recibe el aviso de cada radio");
  console.log("  PASS E3 · enviada no admite más; la entrega no la factura; aceptarla libera las tres y abre una fila");

  // ── F · ya estaba cotizada A MANO: se une, no se duplica ────────────────
  const OF = "2026111703";
  await db.doc(`ordenes_de_servicio/${OF}`).set({
    tipo_de_servicio: "REPARACION", estado_reparacion: "COMPLETADO (EN OFICINA)", cliente_nombre: "GAMBOA, S.A.", cliente_id: CLIENTE,
  });
  await db.doc("cotizaciones/cotMano").set({
    cotizacion_id: "COT-2026-0253", estado: "enviada", origen: "orden", orden_id: OF, clienteId: CLIENTE, cliente_nombre: "GAMBOA, S.A.",
    itbmsPct: 7, itbms_aplica: true, itbms_monto: 21, subtotal: 300, total: 321, total_con_itbms: 321,
    creado_por_email: JEFA, creado_por_uid: "uJefa", deleted: false,
    items: [
      { id: "m1", nombre: "RADIO HYTERA PNC 360", modelo: "", cant: 1, precio: 150, desc: 0, equipo: { serial: "F0001", modelo: "PNC360S-R" } },
      { id: "m2", nombre: "RADIO HYTERA PNC 360", modelo: "", cant: 1, precio: 150, desc: 0, equipo: { serial: "F0002", modelo: "PNC360S-R" } },
    ],
  });
  const GF = ["GR20261119-11", "GR20261119-12"];
  for (const [i, gid] of GF.entries()) {
    await escribirGestion(gid, danoDe(gid, OF, `F000${i + 1}`), { crear: true });
    await aprobarConCargo(gid, 180);
  }
  const cotAuto = (await db.doc(`gestiones/${GF[0]}`).get()).data().cobro.cotizacion_doc_id;
  assert.equal((await db.doc(`gestiones/${GF[1]}`).get()).data().cobro.cotizacion_doc_id, cotAuto);
  const RDm = require("../src/lib/reposicionDano");
  const ensayo = await RDm.unirACotizacion({ origenDocIds: [cotAuto], destinoDocId: "cotMano", execute: false });
  assert.deepEqual(ensayo.gestiones.sort(), [...GF].sort(), "F: el ensayo dice qué movería");
  assert.equal((await db.doc(`cotizaciones/${cotAuto}`).get()).data().estado, "borrador", "F: el ensayo no escribe");
  const deudasAntes = (await db.collection("cobros_equipos").get()).size;
  const cotAutoBefore = await db.doc(`cotizaciones/${cotAuto}`).get();
  await RDm.unirACotizacion({ origenDocIds: [cotAuto], destinoDocId: "cotMano", porEmail: "alberto@cecomunica.com" });
  const cAuto = await db.doc(`cotizaciones/${cotAuto}`).get();
  await onEstado.run({ data: { before: cotAutoBefore, after: cAuto }, params: { docId: cotAuto } });
  assert.equal(cAuto.data().estado, "descartada", "F: la automática se descarta");
  assert.match(cAuto.data().cierre_motivo, /Duplicada: la reposición ya estaba cotizada en COT-2026-0253/);
  for (const gid of GF) {
    const g = (await db.doc(`gestiones/${gid}`).get()).data();
    assert.equal(g.estado, "pendiente_cliente", "F: descartar la duplicada NO cierra la gestión");
    assert.equal(g.cobro.cotizacion_doc_id, "cotMano", "F: ahora se cobra en la que hizo el taller");
    assert.equal(g.cobro.cotizacion_id, "COT-2026-0253");
  }
  assert.equal((await db.collection("cobros_equipos").get()).size, deudasAntes, "F: ni manda nada a cobranza");
  assert.deepEqual([...(await db.doc("cotizaciones/cotMano").get()).data().gestion_ids].sort(), [...GF].sort());
  await assert.rejects(() => RDm.unirACotizacion({ origenDocIds: [cotE], destinoDocId: "cotMano" }), /otra orden/, "F: no une cotizaciones de otra orden");
  await escribirCot("cotMano", {
    estado: "convertida", fecha_conversion: admin.firestore.Timestamp.now(),
    aceptacion: { medio: "verbal", nota: "", por_email: JEFA, at: admin.firestore.Timestamp.now() },
  });
  for (const gid of GF) assert.equal((await db.doc(`gestiones/${gid}`).get()).data().estado, "pendiente_bodega", "F: aceptar la del taller libera las dos");
  const avF = await db.doc("facturacion_avisos/cotizacion_servicio__cotMano").get();
  assert.ok(avF.exists, "F: se factura la del taller");
  assert.equal(avF.data().resumen.total, 321, "F: por lo que el taller le cotizó al cliente");
  assert.ok(!(await db.doc(`facturacion_avisos/cotizacion_servicio__${cotAuto}`).get()).exists, "F: la duplicada no se factura");
  console.log("  PASS F · reposición ya cotizada a mano → se une a esa, la automática se descarta, una sola factura");

  console.log("\nTALLER + REPOSICIÓN POR DAÑO: TODOS LOS RECORRIDOS PASARON");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e && e.stack ? e.stack : e); process.exit(1); });
