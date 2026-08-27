// Derivados de baja del contrato — fuente ÚNICA (Ola 3, gestiones por cliente).
//
// Hasta hoy `baja_cancelado{modelo→qty}` / `baja_cancelado_total` /
// `baja_fecha_fin` los recalculaba onCancelacionWrite leyendo SOLO
// solicitudes_cancelacion (enmiendas por modelo+cantidad). Con la baja por
// serial (gestiones tipo 'baja', que puede cruzar contratos) hay DOS fuentes,
// y dos escritores que no se leyeran entre sí se pisarían el campo. Esta
// función recalcula el derivado combinando ambas — la llaman los dos triggers.
//
// El shape del resultado es EXACTAMENTE el que la facturación y la UI ya
// consumen (onApproval.unidadesSerializables, contratos-list, facturacionDiaria):
// nada aguas abajo nota la diferencia.
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");

/**
 * Recalcula y estampa los derivados de baja de UN contrato desde las dos
 * fuentes. Idempotente; nunca lanza (best-effort con log).
 * @returns {{total:number}|null}
 */
async function derivarBajaContrato(contratoDocId) {
  if (!contratoDocId) return null;
  try {
    const map = {};
    let terminacionTotal = false;
    let terminacionFin = null;
    let fechaFin = null; // la más TARDÍA de las fuentes (hasta ahí se factura)
    const masTardia = (ts) => {
      if (!ts) return;
      const ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
      if (!Number.isFinite(ms)) return;
      const cur = fechaFin ? (fechaFin.toMillis ? fechaFin.toMillis() : new Date(fechaFin).getTime()) : -Infinity;
      if (ms > cur) fechaFin = ts;
    };

    // Fuente 1: enmiendas clásicas (por modelo+cantidad, del contrato).
    const sols = await db.collection("solicitudes_cancelacion")
      .where("contrato_doc_id", "==", contratoDocId).get();
    sols.forEach((s) => {
      const sd = s.data();
      if (sd.estado !== "aprobada" && sd.estado !== "cerrada") return;
      (sd.items || []).forEach((it) => {
        const key = String(it.modelo_id || it.modelo || "").trim();
        const q = Number(it.cantidad || 0);
        if (!key || q <= 0) return;
        map[key] = Number(map[key] || 0) + q;
      });
      masTardia(sd.fecha_fin_facturacion);
      if (sd.tipo === "terminacion_total") {
        terminacionTotal = true;
        terminacionFin = sd.fecha_fin_facturacion || terminacionFin;
      }
    });

    // Fuente 2: gestiones de baja POR SERIAL (pueden cruzar contratos: solo
    // cuentan los ítems cuyo contrato_doc_id es ESTE). Aprobada = en_proceso+.
    const gests = await db.collection("gestiones")
      .where("contratos_afectados", "array-contains", contratoDocId).get();
    gests.forEach((g) => {
      const gd = g.data();
      if (gd.tipo !== "baja") return;
      if (!["en_proceso", "cerrada"].includes(gd.estado)) return;
      (gd.items || []).forEach((it) => {
        if (it.contrato_doc_id !== contratoDocId) return;
        const key = String(it.modelo_id || it.modelo || "").trim();
        if (!key) return;
        map[key] = Number(map[key] || 0) + 1; // 1 ítem = 1 serial
        masTardia(it.fecha_fin_facturacion || gd.fecha_fin_facturacion);
      });
      // Terminación total vía gestión (2026-08-27): reemplaza el flujo viejo
      // de enmiendas para terminar el contrato completo.
      if (Array.isArray(gd.terminacion_total_de) && gd.terminacion_total_de.includes(contratoDocId)) {
        terminacionTotal = true;
        terminacionFin = gd.fecha_fin_facturacion || terminacionFin;
      }
    });

    const total = Object.values(map).reduce((s, v) => s + Number(v || 0), 0);
    const payload = {
      baja_cancelado: map,
      baja_cancelado_total: total,
      baja_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
      ...(fechaFin ? { baja_fecha_fin: fechaFin } : {}),
      ...(total > 0 ? { baja_estado: "aprobada" } : {}),
    };
    if (terminacionTotal) {
      payload.terminacion_total = true;
      payload.terminacion_fin = terminacionFin;
    }
    await db.collection("contratos").doc(contratoDocId).set(payload, { merge: true });
    logger.info("[bajas] derivado recalculado", { contratoDocId, total });
    return { total };
  } catch (e) {
    logger.error("[bajas] derivarBajaContrato falló", { contratoDocId, message: e.message });
    return null;
  }
}

module.exports = { derivarBajaContrato };
