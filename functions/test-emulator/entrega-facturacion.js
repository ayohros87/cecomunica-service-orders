// La ENTREGA le avisa a facturación (onEntregaFacturacion) contra el emulador
// de FIRESTORE a secas — mismo patrón que regularizacion-anexo.js (el emulador
// de Functions pierde admin.firestore.FieldValue, así que el trigger v2 se
// invoca con `.run(event)` y snapshots reales).
//
// Congela el hueco que la F1 de PLAN_COMISIONES.md cierra y, sobre todo, que
// cerrarlo NO introduzca el doble conteo:
//   1) contrato que quedó "esperando la entrega" → el aviso QUE YA EXISTE se
//      promueve (no nace otro) y sale el correo que el de activación prometió;
//   2) el mismo evento entregado dos veces (Cloud Functions reintenta) no crea
//      un segundo aviso ni un segundo correo;
//   3) contrato SIN aviso (anterior a la colección) → nace contrato_entregado;
//   4) una RENOVACIÓN sin aviso no inventa nada: nunca esperó entrega.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-entrega \
//     "node functions/test-emulator/entrega-facturacion.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-entrega";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const FA = require("../src/lib/facturacionAvisos");
const trigger = require("../src/triggers/contratos/onEntregaFacturacion");
assert.equal(typeof trigger.run, "function", "el trigger v2 debe exponer .run(event)");

let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const contrato = (extra = {}) => ({
  contrato_id: "ALQ20260910-01", cliente_id: "cli-1", cliente_nombre: "CLIENTE DE PRUEBA",
  accion: "Nuevo", tipo_contrato: "Alquiler", duracion: "12 meses", estado: "activo",
  firmado: true, deleted: false, creado_por_uid: "u-vendedor",
  equipos: [{ modelo: "HYTERA PD606-R", cantidad: 3, precio: 25 }],
  cargos: [], ...extra,
});

// Dispara el trigger con el update REAL (before = sin entrega, after = con).
async function entregar(cid, extraAfter = {}) {
  const ref = db.doc(`contratos/${cid}`);
  const before = await ref.get();
  await ref.set({
    entrega_confirmada: true,
    fecha_entrega_ultima: admin.firestore.Timestamp.fromDate(new Date("2026-09-10T15:00:00Z")),
    ...extraAfter,
  }, { merge: true });
  const after = await ref.get();
  await trigger.run({ data: { before, after }, params: { cid } });
  return { before, after };
}

const correosDe = async (cid) => (await db.collection("mail_queue").get()).docs
  .filter((d) => (d.data().meta || {}).source === "onEntregaFacturacion"
    && String((d.data().meta || {}).contrato_id || "").includes(cid));

(async () => {
  // ── 1. El aviso que esperaba se PROMUEVE, no nace otro ────────────────────
  const CID = "c-espera";
  await db.doc(`contratos/${CID}`).set(contrato({ contrato_id: "ALQ20260910-01" }));
  await FA.crearAviso({
    tipo: "contrato_activo", origen_col: "contratos", origen_id: CID,
    cliente_id: "cli-1", cliente_nombre: "CLIENTE DE PRUEBA",
    contrato_id: "ALQ20260910-01", contrato_doc_id: CID,
    fecha_efectiva: null, esperando: true,
    contexto: { entrega_pendiente: true, origen_texto: "Contrato activo" },
    resumen: { mensual: 75, con_itbms: 80.25, exento: false, unico: 0, equipos_n: 3 },
    detalle: {},
  });
  const antes = await db.collection("facturacion_avisos").get();
  assert.equal(antes.size, 1);
  assert.equal(antes.docs[0].data().estado, "esperando");

  const evento1 = await entregar(CID);

  const despues = await db.collection("facturacion_avisos").get();
  assert.equal(despues.size, 1, "NO nace un aviso nuevo: se mueve el que ya estaba");
  const av = despues.docs[0].data();
  assert.equal(av.estado, "pendiente", "sale de 'esperando' y entra a la cola de Recepción");
  assert.ok(av.fecha_efectiva, "queda la fecha desde la que se factura");
  assert.equal(av.fecha_efectiva.toDate().toISOString().slice(0, 10), "2026-09-10");
  assert.equal(av.contexto.entrega_pendiente, false);
  assert.ok((av.historial || []).some((h) => h.accion === "entrega_confirmada"),
    "el expediente dice que la entrega fue lo que lo movió");
  ok("contrato que esperaba entrega: el aviso se promueve y no se duplica");

  const correos = await correosDe("ALQ20260910-01");
  assert.equal(correos.length, 1, "sale UN correo");
  const c1 = correos[0].data();
  assert.match(c1.subject, /equipos ENTREGADOS/);
  assert.match(c1.bodyContent, /ya se puede facturar/i);
  assert.match(c1.bodyContent, /10 de septiembre de 2026/, "el correo dice la fecha de entrega");
  assert.match(c1.ctaUrl, /facturacion\/bandeja\.html\?aviso=/, "el CTA aterriza en la fila de la bandeja");
  assert.equal(c1.meta.aviso_id, despues.docs[0].id);
  ok("sale el correo que el de activación había prometido, apuntando a la fila");

  // ── 2. Reintento del MISMO evento: ni aviso nuevo ni correo nuevo ─────────
  // Un reintento de Cloud Functions reentrega el evento TAL CUAL: el `before`
  // sigue siendo el de antes de la entrega, así que el guard de transición NO
  // lo frena — el cuerpo corre otra vez. Sin la distinción "no hay aviso" vs.
  // "ya lo promoví", esta segunda pasada creaba un contrato_entregado encima
  // del aviso ya promovido: dos documentos para un solo hecho.
  await trigger.run({ data: { before: evento1.before, after: evento1.after }, params: { cid: CID } });
  assert.equal((await db.collection("facturacion_avisos").get()).size, 1,
    "el reintento NO crea un contrato_entregado encima del ya promovido");
  assert.equal((await correosDe("ALQ20260910-01")).length, 1, "ni un segundo correo");
  ok("evento entregado dos veces: cero duplicados (la comisión no se paga dos veces)");

  // ── 3. Contrato SIN aviso (anterior a la colección) → nace el entregado ───
  const CID2 = "c-viejo";
  await db.doc(`contratos/${CID2}`).set(contrato({ contrato_id: "ALQ20260601-09" }));
  await entregar(CID2);

  const todos = await db.collection("facturacion_avisos").get();
  assert.equal(todos.size, 2, "el contrato viejo sí estrena aviso");
  const nuevo = todos.docs.find((d) => d.data().contrato_doc_id === CID2).data();
  assert.equal(nuevo.tipo, "contrato_entregado");
  assert.equal(nuevo.estado, "pendiente");
  assert.equal(nuevo.resumen.mensual, 75, "el mensual sale de las LÍNEAS, no de total_mensual");
  assert.ok(nuevo.pasos.qbo.aplica && nuevo.pasos.poc.aplica);
  ok("contrato anterior a la colección: nace contrato_entregado con id determinista");

  // ── 4. Una RENOVACIÓN no inventa aviso: nunca esperó entrega ──────────────
  const CID3 = "c-renov";
  await db.doc(`contratos/${CID3}`).set(contrato({ contrato_id: "ALQ20260910-77", accion: "Renovación" }));
  await entregar(CID3);
  assert.equal((await db.collection("facturacion_avisos").get()).size, 2,
    "una renovación entregada no genera aviso: los radios ya estaban en el cliente");
  ok("renovación: no se inventa nada");

  // ── 5. El guard de la transición: sin false→true no corre ────────────────
  const CID4 = "c-yaentregado";
  await db.doc(`contratos/${CID4}`).set(contrato({ contrato_id: "ALQ20260910-88", entrega_confirmada: true }));
  const s4 = await db.doc(`contratos/${CID4}`).get();
  await trigger.run({ data: { before: s4, after: s4 }, params: { cid: CID4 } });
  assert.equal((await db.collection("facturacion_avisos").get()).size, 2,
    "un contrato que YA venía entregado no dispara nada");
  ok("guard de transición: solo corre en el salto falso→true");

  console.log(`\nOK — ${n} comprobaciones de la entrega hacia facturación`);
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
