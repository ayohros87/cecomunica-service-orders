// Conciliación semanal pool ↔ fuentes (L5 de la auditoría 2026-07-24).
//
// Todos los triggers que mantienen equipos_pool son best-effort (try/catch →
// "no crítico"): un fallo transitorio deja la ficha desincronizada PARA
// SIEMPRE, sin que nadie lo note. Este cron compara el pool contra sus tres
// fuentes y deja el reporte en admin_reportes/conciliacion_pool, que se
// muestra en Admin · Salud. No corrige nada — solo hace visible el drift.
//
// Chequeos:
//   A) serial de contrato vigente (aprobado/activo, no legacy) sin ficha, o
//      con ficha asignada a OTRO contrato.
//   B) ficha en_taller cuya orden actual ya cerró (ENTREGADO/CERRADA/eliminada).
//   C) device POC activo cuyo serial no tiene ficha, o ficha sin poc_device_id.
//   D) ficha asignada a un contrato ANULADO sin pendiente_devolucion (residuo).
//   E) ficha vendido con orden_actual_id de una orden ya cerrada (enlace colgante).
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");

const CERRADAS = new Set(["ENTREGADO AL CLIENTE", "CERRADA (ENTRADA)",
  "CERRADA (DEVOLUCION)", "CERRADA (VISITA)", "ANULADA"]);
const MAX_MUESTRAS = 20;

module.exports = onSchedule(
  {
    schedule: "every monday 06:40",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
    memory: "512MiB",
  },
  async () => {
    // ── Cargas base ──
    const poolSnap = await db.collection("equipos_pool").get();
    const fichas = poolSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const porNorm = new Map();
    for (const f of fichas) {
      const k = f.serial_norm || f.id.split("__")[0];
      if (!porNorm.has(k)) porNorm.set(k, []);
      porNorm.get(k).push(f);
    }

    const contSnap = await db.collection("contratos").get();
    const contratos = new Map(contSnap.docs.map((d) => [d.id, d.data()]));

    const ordenCache = new Map(); // id → estado_reparacion|null (null = no existe/eliminada)
    async function estadoOrden(id) {
      if (!id) return null;
      if (ordenCache.has(id)) return ordenCache.get(id);
      try {
        const s = await db.collection("ordenes_de_servicio").doc(id).get();
        const v = s.exists && s.data().eliminado !== true
          ? String(s.data().estado_reparacion || "").trim().toUpperCase() : null;
        ordenCache.set(id, v);
        return v;
      } catch (e) { return null; }
    }

    const R = {
      at: admin.firestore.FieldValue.serverTimestamp(),
      fichas_total: fichas.length,
      A_contrato_sin_ficha: 0, A_muestras: [],
      B_taller_orden_cerrada: 0, B_muestras: [],
      C_poc_sin_enlace: 0, C_muestras: [],
      D_asignada_a_anulado: 0, D_muestras: [],
      E_vendido_orden_cerrada: 0, E_muestras: [],
    };

    // ── A: seriales de contratos vigentes ──
    const serSnap = await db.collectionGroup("seriales").get();
    for (const d of serSnap.docs) {
      const cid = d.ref.parent.parent.id;
      const c = contratos.get(cid);
      if (!c) continue;
      if (!["aprobado", "activo"].includes(String(c.estado || "").toLowerCase())) continue;
      if (c.seriales_estado === "legacy") continue;
      const s = d.data();
      if (s.omitido) continue;
      const norm = pool.normSerial(s.serial || d.id);
      if (!norm) continue;
      const docs = porNorm.get(norm) || [];
      const propia = docs.find((f) => f.asignacion?.contrato_doc_id === cid);
      if (!docs.length || !propia) {
        R.A_contrato_sin_ficha++;
        if (R.A_muestras.length < MAX_MUESTRAS) R.A_muestras.push({
          serial: s.serial || d.id, contrato: c.contrato_id || cid,
          detalle: docs.length ? `ficha asignada a ${docs[0].asignacion?.contrato_id || docs[0].asignacion?.cliente_nombre || "nadie"}` : "sin ficha en el pool",
        });
      }
    }

    // ── B y E: fichas cuyo enlace de orden ya venció ──
    for (const f of fichas) {
      if (f.estado === "en_taller" && f.orden_actual_id) {
        const eo = await estadoOrden(f.orden_actual_id);
        if (eo === null || CERRADAS.has(eo)) {
          R.B_taller_orden_cerrada++;
          if (R.B_muestras.length < MAX_MUESTRAS) R.B_muestras.push({
            serial: f.serial, orden: f.orden_actual_id, estado_orden: eo || "(no existe)",
          });
        }
      }
      if (f.estado === "vendido" && f.orden_actual_id) {
        const eo = await estadoOrden(f.orden_actual_id);
        if (eo === null || CERRADAS.has(eo)) {
          R.E_vendido_orden_cerrada++;
          if (R.E_muestras.length < MAX_MUESTRAS) R.E_muestras.push({
            serial: f.serial, orden: f.orden_actual_id, estado_orden: eo || "(no existe)",
          });
        }
      }
      // ── D ──
      if (["asignado_contrato", "en_cliente"].includes(f.estado)
          && f.asignacion?.contrato_doc_id && !f.pendiente_devolucion) {
        const c = contratos.get(f.asignacion.contrato_doc_id);
        if (c && String(c.estado || "").toLowerCase() === "anulado" && !c.orden_devolucion_id) {
          R.D_asignada_a_anulado++;
          if (R.D_muestras.length < MAX_MUESTRAS) R.D_muestras.push({
            serial: f.serial, contrato: c.contrato_id || f.asignacion.contrato_doc_id,
          });
        }
      }
    }

    // ── C: devices POC activos ──
    const pocSnap = await db.collection("poc_devices").get();
    for (const d of pocSnap.docs) {
      const p = d.data();
      if (p.deleted === true) continue;
      const norm = pool.normSerial(p.serial || "");
      if (!pool.esSerialValido(norm)) continue;
      const docs = porNorm.get(norm) || [];
      const enlazada = docs.find((f) => f.poc_device_id === d.id);
      if (!docs.length || !enlazada) {
        R.C_poc_sin_enlace++;
        if (R.C_muestras.length < MAX_MUESTRAS) R.C_muestras.push({
          serial: p.serial, device: d.id,
          detalle: docs.length ? "ficha sin poc_device_id" : "sin ficha en el pool",
        });
      }
    }

    const totalDrift = R.A_contrato_sin_ficha + R.B_taller_orden_cerrada
      + R.C_poc_sin_enlace + R.D_asignada_a_anulado + R.E_vendido_orden_cerrada;
    await db.collection("admin_reportes").doc("conciliacion_pool").set({ ...R, total: totalDrift });
    logger.info("[conciliacionPool] reporte semanal", {
      total: totalDrift, A: R.A_contrato_sin_ficha, B: R.B_taller_orden_cerrada,
      C: R.C_poc_sin_enlace, D: R.D_asignada_a_anulado, E: R.E_vendido_orden_cerrada,
    });
    return null;
  }
);
