// Regularización de cuentas — los dos barridos programados
// (docs/plans/PLAN_REGULARIZACION_CUENTAS.md §3):
//
//   · regularizacionDiaria   06:50 (antes del recordatorio operativo de 07:15):
//     recalcula TODAS las cuentas con tres lecturas grandes y escribe
//     `clientes/{id}.regularizacion` solo donde cambió. Si alguna cuenta PASA
//     a exceder el margen de gestiones puntuales, manda un digest a gerencia
//     (escalera, no candado — §6).
//   · regularizacionMarcadas cada 10 minutos: recalcula solo las cuentas que
//     los triggers marcaron con `regularizacion_dirty_at` (cambios en pool,
//     contratos o gestiones), para que la ficha no espere hasta mañana.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");
const RC = require("../../domain/regularizacionCuentas");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

// Gerencia: empresa/config.regularizacion_email_gerencia, si no los usuarios
// con rol gerente (y admin como red de seguridad). Sin buzones → sin correo.
async function gerenciaEmails(cfg) {
  if (cfg.email_gerencia) return cfg.email_gerencia.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const out = new Set();
  for (const rol of ["gerente", "administrador"]) {
    try {
      const s = await db.collection("usuarios").where("rol", "==", rol).get();
      s.forEach(d => { const e = String(d.get("email") || "").trim(); if (e && !/@sin\.email$/i.test(e) && d.get("activo") !== false) out.add(e); });
    } catch (e) { /* sigue */ }
    if (out.size) break;
  }
  return [...out];
}

const regularizacionDiaria = onSchedule(
  { schedule: "every day 06:50", timeZone: "America/Panama", region: "us-central1", retryCount: 1, memory: "512MiB", timeoutSeconds: 540 },
  async () => {
    const t0 = Date.now();
    const R = await RC.barridoCompleto();
    logger.info("[regularizacionDiaria] barrido", { ...R, nuevas_exceden: R.nuevas_exceden.length, ms: Date.now() - t0 });

    if (R.nuevas_exceden.length) {
      const cfg = await RC.config();
      const to = await gerenciaEmails(cfg);
      if (!to.length) { logger.warn("[regularizacionDiaria] cuentas exceden el margen pero no hay buzón de gerencia"); return null; }
      const filas = R.nuevas_exceden.slice(0, 40).map(c => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;"><a href="${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(c.id)}">${esc(c.nombre)}</a></td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${esc(c.vendedor || "sin vendedor")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${c.puntos}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${c.puntuales}</td></tr>`).join("");
      await db.collection("mail_queue").add({
        to,
        subject: `Regularización: ${R.nuevas_exceden.length} cuenta(s) exceden el margen de gestiones puntuales`,
        preheader: `Siguen operando, pero ya deberían regularizarse`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Cuentas que exceden el margen sin regularizar</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Estas cuentas superaron el margen de <b>${cfg.max_puntuales} gestiones puntuales</b> o
            <b>${cfg.max_dias} días</b> desde la primera marca sin regularizar. Ninguna gestión se frena:
            el vendedor sigue atendiendo al cliente, pero la cuenta pide regularización.</p>
          <table style="border-collapse:collapse;width:100%;font:13px Arial,sans-serif;">
            <tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #d1d5db;">Cuenta</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #d1d5db;">Vendedor</th>
                <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #d1d5db;">Deuda</th>
                <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #d1d5db;">Puntuales</th></tr>
            ${filas}
          </table>
          ${R.nuevas_exceden.length > 40 ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${R.nuevas_exceden.length - 40} más en la bandeja.</p>` : ""}`,
        ctaUrl: `${APP_BASE_URL}/clientes/regularizacion.html`,
        ctaLabel: "Abrir la bandeja de regularización",
        meta: { source: "regularizacionDiaria", total: R.nuevas_exceden.length },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    return null;
  }
);

const regularizacionMarcadas = onSchedule(
  { schedule: "every 10 minutes", timeZone: "America/Panama", region: "us-central1", retryCount: 0, memory: "256MiB", timeoutSeconds: 300 },
  async () => {
    const R = await RC.barridoMarcados({ max: 60 });
    if (R.revisadas) logger.info("[regularizacionMarcadas] barrido", R);
    return null;
  }
);

module.exports = { regularizacionDiaria, regularizacionMarcadas };
