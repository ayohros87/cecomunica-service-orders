// Recordatorio a INVENTARIO de los contratos cuyos seriales siguen pendientes.
// Cierra el "queda en el aire": si nadie asigna los seriales, el contrato nunca
// llega a activaciones. Corre diario; re-notifica cada N días (config) hasta un
// máximo de intentos. El badge "Seriales pendientes" en la lista sigue siendo el
// recordatorio pasivo permanente.
//
// Dispara solo correos (mail_queue → onMailQueued). Escribir el contador en el
// contrato NO re-arranca el flujo de aprobación (los triggers de contrato exigen
// transición de `estado`, que aquí no cambia).

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL, inventarioEmailTo } = require("../../lib/inventario");

const DEFAULT_DIAS = 3;       // re-notifica cada N días (override: empresa/config.seriales_recordatorio_dias)
const MAX_RECORDATORIOS = 4;  // tope de correos antes de dejar solo el badge de la lista

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = onSchedule(
  {
    schedule: "every day 07:00",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
  },
  async () => {
    // Intervalo configurable (fallback al default).
    let dias = DEFAULT_DIAS;
    try {
      const cfg = await db.collection("empresa").doc("config").get();
      const n = cfg.exists ? Number(cfg.data().seriales_recordatorio_dias) : NaN;
      if (Number.isFinite(n) && n >= 1) dias = n;
    } catch (e) { /* usa default */ }

    const now = new Date();
    const snap = await db.collection("contratos")
      .where("seriales_estado", "==", "pendiente")
      .limit(500)
      .get();

    if (snap.empty) {
      logger.info("[recordatorioSeriales] sin contratos con seriales pendientes");
      return null;
    }

    const to = await inventarioEmailTo();
    let enviados = 0;

    for (const doc of snap.docs) {
      const c = doc.data() || {};
      if (c.deleted) continue;

      const count = Number(c.seriales_recordatorio_count || 0);
      if (count >= MAX_RECORDATORIOS) continue;

      // Base de cálculo: último recordatorio o, si no hay, la aprobación.
      const baseTs = c.seriales_recordatorio_at || c.fecha_aprobacion;
      const base = baseTs?.toDate ? baseTs.toDate() : (baseTs ? new Date(baseTs) : null);
      if (!base) continue;
      const diffDias = (now - base) / (1000 * 60 * 60 * 24);
      if (diffDias < dias) continue;

      const equiposRows = (c.equipos || [])
        .filter(e => Number(e.cantidad || 0) > 0)
        .map(e => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(e.modelo || "—")}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${Number(e.cantidad || 0)}</td></tr>`)
        .join("");

      const intento = count + 1;
      const bodyContent = `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Recordatorio: seriales pendientes</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
          El contrato <b>${esc(c.contrato_id || doc.id)}</b> de
          <b>${esc(c.cliente_nombre || "—")}</b> sigue esperando que asignes los seriales.
          Hasta entonces no continúa el proceso hacia activaciones.
        </p>
        <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
          <thead><tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
            <th style="text-align:center;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Cantidad</th>
          </tr></thead>
          <tbody>${equiposRows}</tbody>
        </table>`;

      try {
        await db.collection("mail_queue").add({
          to,
          subject:   `Recordatorio ${intento}: seriales pendientes — ${c.contrato_id || doc.id}`,
          preheader: `El contrato ${c.contrato_id || doc.id} sigue esperando seriales`,
          bodyContent,
          ctaUrl:    `${APP_BASE_URL}/contratos/seriales.html?id=${encodeURIComponent(doc.id)}`,
          ctaLabel:  "Agregar seriales",
          meta:      { source: "recordatorioSeriales", contrato_id: c.contrato_id || doc.id, intento },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await doc.ref.set({
          seriales_recordatorio_at: admin.firestore.FieldValue.serverTimestamp(),
          seriales_recordatorio_count: intento,
        }, { merge: true });
        enviados++;
      } catch (e) {
        logger.error("[recordatorioSeriales] error encolando recordatorio", { docId: doc.id, err: e.message });
      }
    }

    logger.info("[recordatorioSeriales] fin", { revisados: snap.size, enviados });
    return null;
  }
);
