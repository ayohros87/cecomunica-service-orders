// El bloque `comision` de un aviso — F2 de PLAN_COMISIONES.md — contra el
// emulador de FIRESTORE a secas (el de Functions pierde FieldValue).
//
// Congela las decisiones de Alberto del 2026-09-10 y las trampas que las
// rompen si nadie las mira:
//   1) contrato Nuevo con equipo: nace 'esperando' (falta entrega y pago) y la
//      base es el mensual;
//   2) RENOVACIÓN: la entrega NO aplica y lo dice — sin eso la comisión de
//      R. Smith Coronado se traba para siempre;
//   3) ajuste de tarifa y regularización: no_aplica con el motivo escrito;
//   4) `firmado_pendiente_validacion`: la firma NO cuenta hasta que
//      administración acepta al firmante, y al aceptarlo el trigger la mueve;
//   5) entrega confirmada → el trigger deja la comisión en 'listo' cuando solo
//      faltaba eso;
//   6) una comisión ya 'pagada' NO se reabre porque un dato cambió después;
//   7) el vendedor de un aumento es quien HIZO la gestión (responsable_email),
//      no el vendedor asignado del cliente.
//
// Corre con:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-comision \
//     node functions/test-emulator/comision-requisitos.js
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-comision";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const FA = require("../src/lib/facturacionAvisos");
const { onComisionRequisitosContrato, onComisionRequisitosGestion } = require("../src/triggers/comisiones/onRequisitos");

let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const contrato = (extra = {}) => ({
  contrato_id: "ALQ20260910-01", cliente_id: "cli-1", cliente_nombre: "CLIENTE",
  accion: "Nuevo", estado: "activo", firmado: true, deleted: false,
  firmado_fecha: admin.firestore.Timestamp.fromDate(new Date("2026-09-08T12:00:00Z")),
  creado_por_uid: "u-karla",
  equipos: [{ modelo: "PD606-R", cantidad: 3, precio: 25 }], cargos: [], ...extra,
});

const crear = (tipo, cid, extra = {}) => FA.crearAviso({
  tipo, origen_col: "contratos", origen_id: cid,
  cliente_id: "cli-1", cliente_nombre: "CLIENTE",
  contrato_id: "ALQ20260910-01", contrato_doc_id: cid,
  fecha_efectiva: new Date(), esperando: false,
  contexto: {}, resumen: { mensual: 75, delta_mensual: 75, con_itbms: 80.25, exento: false, unico: 0 },
  detalle: {}, ...extra,
});

const com = async (id) => ((await db.doc(`facturacion_avisos/${id}`).get()).data() || {}).comision;

// Dispara el trigger de contrato con el update real.
async function tocarContrato(cid, patch) {
  const ref = db.doc(`contratos/${cid}`);
  const before = await ref.get();
  await ref.set(patch, { merge: true });
  const after = await ref.get();
  await onComisionRequisitosContrato.run({ data: { before, after }, params: { cid } });
}

(async () => {
  await db.collection("usuarios").doc("u-karla").set({ email: "karla.ferrer@cecomunica.com", rol: "vendedor" });
  await db.collection("usuarios").doc("u-elvia").set({ email: "elvia.onodera@cecomunica.com", rol: "vendedor" });

  // ── 1. Contrato Nuevo con equipo: esperando, base = mensual ───────────────
  const C1 = "c-nuevo";
  await db.doc(`contratos/${C1}`).set(contrato());
  const r1 = await crear("contrato_activo", C1);
  const k1 = await com(r1.id);
  assert.equal(k1.aplica, true);
  assert.equal(k1.estado, "esperando");
  assert.equal(k1.base, 75, "la base es el mensual del contrato");
  assert.equal(k1.base_de, "mensual");
  assert.equal(k1.vendedor_email, "karla.ferrer@cecomunica.com", "el vendedor sale de creado_por_uid");
  assert.equal(k1.requisitos.firma.hecho, true, "el contrato ya está firmado");
  assert.equal(k1.requisitos.entrega.aplica, true);
  assert.equal(k1.requisitos.entrega.hecho, false);
  assert.equal(k1.requisitos.pago.hecho, false);
  assert.equal(k1.porcentaje, null, "el cálculo queda reservado, no calculado");
  assert.equal(k1.monto, null);
  ok("contrato Nuevo: comisión en 'esperando', base = mensual, firma ya hecha");

  // ── 2. RENOVACIÓN: la entrega no aplica, y lo dice ────────────────────────
  const C2 = "c-renov";
  await db.doc(`contratos/${C2}`).set(contrato({ accion: "Renovación" }));
  const r2 = await crear("renovacion_activa", C2);
  const k2 = await com(r2.id);
  assert.equal(k2.base, 75, "renovación: se comisiona el mensual COMPLETO");
  assert.equal(k2.requisitos.entrega.aplica, false);
  assert.match(k2.requisitos.entrega.motivo, /ya están en el cliente/);
  assert.equal(k2.estado, "esperando", "solo falta el pago");
  ok("renovación: la entrega NO aplica con el motivo escrito (caso R. Smith Coronado)");

  // ── 3. Tipos que no pagan comisión: motivo escrito, no fila escondida ─────
  for (const [tipo, rx] of [["ajuste_tarifa", /se comisiona en la renovación/], ["regularizacion", /no es dinero nuevo/]]) {
    const cid = `c-${tipo}`;
    await db.doc(`contratos/${cid}`).set(contrato());
    const r = await crear(tipo, cid);
    const k = await com(r.id);
    assert.equal(k.aplica, false);
    assert.equal(k.estado, "no_aplica");
    assert.match(k.motivo, rx);
  }
  ok("ajuste de tarifa y regularización: no_aplica con el porqué escrito");

  // ── 4. Firmante sin validar: la firma NO cuenta hasta que se acepte ───────
  const C4 = "c-firmante";
  await db.doc(`contratos/${C4}`).set(contrato({ firmado_pendiente_validacion: true, entrega_confirmada: true }));
  const r4 = await crear("contrato_activo", C4);
  let k4 = await com(r4.id);
  assert.equal(k4.requisitos.firma.hecho, false, "firmó otro: la firma no cuenta todavía");
  assert.match(k4.requisitos.firma.motivo, /distinto al representante/);
  assert.equal(k4.estado, "esperando");

  // administración acepta al firmante → el trigger mueve la firma
  await tocarContrato(C4, { firmado_pendiente_validacion: admin.firestore.FieldValue.delete() });
  k4 = await com(r4.id);
  assert.equal(k4.requisitos.firma.hecho, true, "aceptado el firmante, la firma cuenta");
  assert.equal(k4.estado, "esperando", "sigue esperando: falta el pago");
  ok("firmante sin validar: la firma no cuenta, y al aceptarlo el trigger la mueve");

  // ── 5. La entrega confirmada deja la comisión lista (si solo faltaba eso) ─
  const C5 = "c-entrega";
  await db.doc(`contratos/${C5}`).set(contrato());
  const r5 = await crear("contrato_activo", C5);
  assert.equal((await com(r5.id)).requisitos.entrega.hecho, false);
  await tocarContrato(C5, {
    entrega_confirmada: true,
    fecha_entrega_ultima: admin.firestore.Timestamp.fromDate(new Date("2026-09-10T15:00:00Z")),
  });
  const k5 = await com(r5.id);
  assert.equal(k5.requisitos.entrega.hecho, true);
  assert.ok(k5.requisitos.entrega.at, "queda la fecha de entrega");
  assert.equal(k5.estado, "esperando", "firma y entrega hechas; el pago es lo único que falta");
  assert.equal(k5.requisitos.pago.hecho, false, "el pago NO se deriva: lo marca una persona o QBO");
  ok("entrega confirmada: el trigger la estampa y el pago queda como único pendiente");

  // ── 6. Una comisión PAGADA no se reabre ──────────────────────────────────
  await db.doc(`facturacion_avisos/${r5.id}`).set({
    comision: { estado: "pagada", periodo: "2026-09", liberada_at: admin.firestore.Timestamp.now() },
  }, { merge: true });
  await tocarContrato(C5, { entrega_confirmada: false });
  const k6 = await com(r5.id);
  assert.equal(k6.estado, "pagada", "cerrada es cerrada: un dato que se mueve después no la reabre");
  assert.equal(k6.requisitos.entrega.hecho, true, "ni le cambia los requisitos");
  ok("comisión pagada: no se reabre porque el contrato cambió después");

  // ── 7. Aumento: el vendedor es quien HIZO la gestión ─────────────────────
  const GID = "GA20260910-01";
  const C7 = "c-aumento";
  await db.doc(`contratos/${C7}`).set(contrato({ creado_por_uid: "u-karla" }));
  await db.doc(`gestiones/${GID}`).set({
    tipo: "aumento", estado: "pendiente_bodega", cliente_id: "cli-1", cliente_nombre: "CLIENTE",
    deleted: false, cierre: { firma: true }, responsable_uid: "u-elvia",
    responsable_email: "elvia.onodera@cecomunica.com",
    anexo_firmado_path: "anexos/x.pdf",
    aumento: { contrato_doc_id: C7, contrato_id: "ALQ20260910-01", lineas: [{ cantidad: 2, precio: 20 }] },
  });
  const r7 = await FA.crearAviso({
    tipo: "aumento_entregado", origen_col: "gestiones", origen_id: GID, gestion_id: GID,
    cliente_id: "cli-1", cliente_nombre: "CLIENTE",
    contrato_id: "ALQ20260910-01", contrato_doc_id: C7,
    fecha_efectiva: new Date(), contexto: {},
    resumen: { mensual: 40, delta_mensual: 40 }, detalle: {},
  });
  let k7 = await com(r7.id);
  assert.equal(k7.vendedor_email, "elvia.onodera@cecomunica.com",
    "el aumento se le comisiona a quien lo hizo, no al vendedor asignado del cliente");
  assert.equal(k7.base, 40, "la base de un aumento es el DELTA mensual");
  assert.equal(k7.base_de, "delta_mensual");
  assert.equal(k7.requisitos.firma.hecho, true, "el anexo está firmado");
  assert.equal(k7.requisitos.entrega.hecho, false,
    "el aviso nació antes de que se escribiera cierre.entrega — por eso hace falta el trigger");
  ok("aumento: base = delta, vendedor = quien hizo la gestión, entrega aún sin estampar");

  // El cierre de la gestión lo arregla.
  const gRef = db.doc(`gestiones/${GID}`);
  const gBefore = await gRef.get();
  await gRef.set({ cierre: { firma: true, entrega: true } }, { merge: true });
  const gAfter = await gRef.get();
  await onComisionRequisitosGestion.run({ data: { before: gBefore, after: gAfter }, params: { gid: GID } });
  k7 = await com(r7.id);
  assert.equal(k7.requisitos.entrega.hecho, true, "el trigger de gestiones cierra el hueco");
  ok("el trigger de gestiones estampa la entrega que el aviso no alcanzó a ver");

  console.log(`\nOK — ${n} comprobaciones del bloque de comisión`);
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
