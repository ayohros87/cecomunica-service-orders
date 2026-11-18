/**
 * regulariza-reemplazos-macello-2026-11-18.js — Registra los 3 reemplazos que
 * Jesús Santos hizo EN SITIO en MACELLO, S.A. durante la visita técnica
 * 2026111602 (16-nov-2026), sin gestión de reemplazo:
 *
 *   20919D0719 → 18607A0484
 *   18607A0500 → 20313C1254
 *   20919D0753 → 18607A0482
 *
 * Los salientes ya volvieron (DEVOLUCIÓN 2026111608 → ENTRADA 2026111609, en
 * revisión de Jesús). Los entrantes seguían "en bodega" estando con el cliente.
 * El 18-nov Elvia abrió GR20261118-01 pidiéndole a bodega 3 radios NUEVOS para
 * esos mismos salientes: habría sido una segunda entrega. Se anula.
 *
 *   1) GR20261118-01 → anulada (sin efectos: nunca salió de pendiente_aprobacion).
 *   2) Gestión GR nueva, cerrada, origen regularizacion, 3 ítems con
 *      saliente_en_casa, ordenes.programacion_id = la visita. Mismo molde que
 *      el callable regularizarReemplazoOrden (que no sirve aquí: exige saliente
 *      y entrante en la misma orden, y con una visita deja el entrante en bodega).
 *   3) Entrantes: en_bodega → en_cliente en el contrato REEMP20260903-01 (el
 *      único de la cuenta), con reemplaza_a + reemplazo_origen.
 *   4) Salientes: salen del contrato (asignacion null) y quedan en
 *      devuelto_revision con su orden de ENTRADA. 18607A0500 figuraba en_bodega.
 *
 * El cobro del deducible (20919D0753) NO se toca: sale del diagnóstico del
 * taller en la ENTRADA 2026111609.
 *
 * USAGE (desde functions/):
 *   node scripts/regulariza-reemplazos-macello-2026-11-18.js            # dry-run
 *   node scripts/regulariza-reemplazos-macello-2026-11-18.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const FV = admin.firestore.FieldValue;
const ORIGEN = "script:regulariza-reemplazos-macello-2026-11-18";
const CLIENTE_ID = "ErmpTyYE6rZc3fTkH0aJ";
const CLIENTE_NOMBRE = "MACELLO, S.A.";
const CONTRATO_DOC = "O014VrfQ2hYc0SylPXt5";
const CONTRATO_ID = "REEMP20260903-01";
const VISITA = "2026111602";
const ENTRADA = "2026111609";
const GR_VIEJA = "GR20261118-01";
const PARES = [
  ["20919D0719", "18607A0484"],
  ["18607A0500", "20313C1254"],
  ["20919D0753", "18607A0482"],
];
const MOTIVO = "Reemplazos hechos en sitio por Jesús Santos en la visita técnica 2026111602 (16-nov-2026); "
  + "salientes recibidos en la devolución 2026111608 y en revisión en la ENTRADA 2026111609.";

function fechaStrPanama(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Panama" }).replace(/-/g, "");
}
async function reservarNumero() {
  const fechaStr = fechaStrPanama();
  const ref = db.collection("contadores").doc(`gestiones_GR_${fechaStr}`);
  const seq = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const siguiente = (snap.exists ? Number(snap.data().seq || 0) : 0) + 1;
    t.set(ref, { seq: siguiente, prefijo: "GR", fecha: fechaStr, actualizado_en: FV.serverTimestamp() }, { merge: true });
    return siguiente;
  });
  return `GR${fechaStr}-${String(seq).padStart(2, "0")}`;
}

(async () => {
  console.log(`Modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);

  // ── Validaciones ──────────────────────────────────────────────────────────
  const gv = await db.collection("gestiones").doc(GR_VIEJA).get();
  if (!gv.exists) throw new Error(`${GR_VIEJA} no existe`);
  console.log(`${GR_VIEJA}: ${gv.data().estado}`);
  const visita = (await db.collection("ordenes_de_servicio").doc(VISITA).get()).data();
  if (!visita || visita.cliente_id !== CLIENTE_ID) throw new Error("La visita no es de MACELLO");
  const enVisita = new Set((visita.equipos || []).map((e) => pool.normSerial(e.numero_de_serie || e.serial || "")));

  const filas = [];
  for (const [sal, ent] of PARES) {
    const s = (await db.collection("equipos_pool").doc(sal).get()).data();
    const e = (await db.collection("equipos_pool").doc(ent).get()).data();
    if (!s || !e) throw new Error(`Falta ficha: ${sal}=${!!s} ${ent}=${!!e}`);
    const okEnt = e.estado === pool.ESTADOS.EN_BODEGA && !e.asignacion && !e.reemplaza_a;
    console.log(`${sal} (${s.estado}, contrato ${s.asignacion?.contrato_id || "—"}, en visita: ${enVisita.has(sal)})`
      + ` → ${ent} (${e.estado}, asig ${e.asignacion ? "sí" : "no"}, reemplaza_a ${e.reemplaza_a || "—"}) ${okEnt ? "OK" : "✋ entrante NO libre"}`);
    if (!okEnt) throw new Error(`${ent} ya no está libre en bodega: revisar a mano`);
    filas.push({ sal, ent, s, e });
  }
  if (!EXECUTE) { console.log("\n(dry-run: no se escribió nada)"); return; }

  // ── 1) Anular la gestión de Elvia ─────────────────────────────────────────
  if (gv.data().estado === "pendiente_aprobacion") {
    await gv.ref.set({ estado: "anulada", anulada_at: FV.serverTimestamp(), anulada_por_uid: null, anulada_por_email: ORIGEN,
      anulada_motivo: "El reemplazo ya se hizo en sitio en la visita 2026111602; se registra con la gestión de regularización." }, { merge: true });
    await gv.ref.collection("eventos").add({ accion: "anular", detalle: "Anulada: los 3 radios ya se reemplazaron en la visita técnica 2026111602 (16-nov). Se registró con una gestión de regularización.", at: FV.serverTimestamp(), por_uid: null, por_email: ORIGEN });
    console.log(`${GR_VIEJA} → anulada`);
  }

  // ── 2) Gestión de regularización ──────────────────────────────────────────
  const gid = await reservarNumero();
  const now = FV.serverTimestamp();
  const items = filas.map(({ sal, ent, s, e }) => ({
    serial_saliente: sal, pool_doc_id_saliente: sal, modelo: s.modelo_label || "", modelo_id: s.modelo_id || null,
    contrato_doc_id: CONTRATO_DOC, contrato_id: CONTRATO_ID,
    serial_nuevo: ent, pool_doc_id_nuevo: ent, modelo_id_nuevo: e.modelo_id || null, modelo_nuevo: e.modelo_label || "",
    saliente_en_casa: true, elegibilidad: "regularizacion", motivo_codigo: "regularizacion", motivo_detalle: MOTIVO.slice(0, 300),
  }));
  const gref = db.collection("gestiones").doc(gid);
  await gref.set({
    tipo: "reemplazo", numero: gid, estado: "cerrada", regularizada: true,
    cliente_id: CLIENTE_ID, cliente_nombre: CLIENTE_NOMBRE, causa: "regularizacion", notas: MOTIVO,
    origen: { tipo: "regularizacion", orden_id: VISITA, por_uid: null, por_email: ORIGEN, at: now, sustituye_a: GR_VIEJA },
    aprobacion: { requiere: false, aprobado_por_email: ORIGEN, at: now, motivo: "Regularización: el reemplazo ya se hizo en la visita técnica" },
    items, seriales_norm: filas.flatMap((f) => [f.sal, f.ent]), contratos_afectados: [CONTRATO_DOC],
    ordenes: { programacion_id: VISITA, programacion_ids: [VISITA], entrada_id: ENTRADA },
    cierre: { aprobacion: true, asignacion: true, programacion: true, entrega: true, entrada: true },
    cerrada_at: now, cerrada_por: ORIGEN, cerrada_motivo: "regularizacion",
    responsable_uid: null, creado_por_uid: null, creado_por_email: ORIGEN, fecha_creacion: now, updated_at: now, deleted: false,
  });
  for (const { sal, ent, e } of filas) {
    await gref.collection("mapeos").add({ saliente: sal, entrante: ent, modelo: e.modelo_label || "", modelo_id: e.modelo_id || null, contrato_doc_id: CONTRATO_DOC, contrato_id: CONTRATO_ID, auto: false, regularizado: true, at: now, por: ORIGEN });
  }
  await gref.collection("eventos").add({ accion: "regularizacion", detalle: `Reemplazos registrados a posteriori desde la visita ${VISITA}: ${PARES.map((p) => p.join(" → ")).join(", ")}. Sustituye a ${GR_VIEJA}.`, at: now, por_uid: null, por_email: ORIGEN });
  console.log(`Gestión ${gid} creada (cerrada)`);

  // ── 3) y 4) Pool ──────────────────────────────────────────────────────────
  const refMov = { tipo: "gestion", id: gid, label: gid };
  for (const { sal, ent } of filas) {
    const rEnt = await pool.transicionarPorId(ent, {
      aEstado: pool.ESTADOS.EN_CLIENTE, soloDesde: [pool.ESTADOS.EN_BODEGA], tipo: "reemplazo", refMov,
      notas: `Reemplaza a ${sal} (gestión ${gid}) — entregado en sitio en la visita ${VISITA} (16-nov-2026)`,
      extra: {
        asignacion: { contrato_doc_id: CONTRATO_DOC, contrato_id: CONTRATO_ID, cliente_id: CLIENTE_ID, cliente_nombre: CLIENTE_NOMBRE, gestion_doc_id: gid },
        orden_actual_id: null, verificado: true, reemplaza_a: sal,
        reemplazo_origen: { gestion_id: gid, saliente: sal, orden_entrega_id: VISITA, contrato_doc_id: CONTRATO_DOC, contrato_id: CONTRATO_ID, at: now, regularizado: true },
      },
    });
    const sRef = db.collection("equipos_pool").doc(sal);
    const sAct = (await sRef.get()).data();
    let rSal;
    if (sAct.estado === pool.ESTADOS.DEVUELTO) {
      await sRef.set({ asignacion: null, orden_actual_id: ENTRADA, updated_at: now }, { merge: true });
      await sRef.collection("movimientos").add({ at: now, por: ORIGEN, por_email: ORIGEN, tipo: "reemplazo", de_estado: null, a_estado: null, ref: refMov,
        notas: `Sustituido por ${ent} en la visita ${VISITA} (gestión ${gid}): sale del contrato ${CONTRATO_ID}; en revisión en la ENTRADA ${ENTRADA}` });
      rSal = "sale-del-contrato";
    } else {
      rSal = await pool.transicionarPorId(sal, { aEstado: pool.ESTADOS.DEVUELTO, soloDesde: [pool.ESTADOS.EN_BODEGA, pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.ASIGNADO],
        tipo: "reemplazo", refMov, notas: `Sustituido por ${ent} en la visita ${VISITA} (gestión ${gid}); en revisión en la ENTRADA ${ENTRADA}`,
        extra: { asignacion: null, orden_actual_id: ENTRADA } });
    }
    console.log(`  ${ent} → ${rEnt} · ${sal} → ${rSal}`);
  }
  console.log("\nListo.");
})().catch((e) => { console.error(e); process.exit(1); });
