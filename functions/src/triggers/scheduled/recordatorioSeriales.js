// Recordatorio a INVENTARIO de los contratos cuyos seriales siguen pendientes.
// Cierra el "queda en el aire": si nadie asigna los seriales, el contrato nunca
// llega a activaciones. Corre diario; re-notifica cada N días (config) hasta un
// máximo de intentos. El badge "Seriales pendientes" en la lista sigue siendo el
// recordatorio pasivo permanente.
//
// Dispara solo correos (mail_queue → onMailQueued). Escribir el contador en el
// contrato NO re-arranca el flujo de aprobación (los triggers de contrato exigen
// transición de `estado`, que aquí no cambia).
//
// ESCALAMIENTO (2026-09-17, caso CONCORD ALQ20260810-01): al cuarto recordatorio
// el cron se callaba y el contrato quedaba en un silencio que nadie auditaba —
// ese contrato pasó 38 días aprobado sin seriales y sin que activaciones ni el
// vendedor se enteraran. Pasado el tope, el aviso deja de ser un recordatorio a
// bodega y se convierte en una escalación semanal a activaciones, con copia al
// vendedor y a bodega. No tiene tope: un contrato aprobado sin seriales no se
// resuelve solo, y el correo semanal es justamente la señal de que hay que
// asignarlos o anular el contrato.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL, inventarioEmailTo } = require("../../lib/inventario");
const { activacionesEmailTo } = require("../../lib/mailRecipients");
const { decideAviso, MAX_RECORDATORIOS, DEFAULT_DIAS, DEFAULT_DIAS_ESC } = require("../../domain/avisoSeriales");

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Correo del vendedor que elaboró el contrato (para la copia de la escalación).
// Nunca lanza: un uid borrado o una lectura fallida solo quitan la copia.
async function emailDeUid(uid, cache) {
  if (!uid) return "";
  if (cache.has(uid)) return cache.get(uid);
  let email = "";
  try {
    const u = await db.collection("usuarios").doc(uid).get();
    email = String(u.exists ? (u.data().email || "") : "").trim();
  } catch (e) {
    logger.warn("[recordatorioSeriales] usuario no leído para la copia", { uid, err: e.message });
  }
  cache.set(uid, email);
  return email;
}

// Cuerpo de la escalación. Distinto del recordatorio a bodega: aquí el que lee
// no es quien asigna, así que lo primero es el daño (una cuenta que quizá ya
// está activa y facturando sin equipos declarados), no la tarea.
function buildEscalacionBody(c, docId, diasAprobado, intento) {
  const equiposRows = (c.equipos || [])
    .filter(e => Number(e.cantidad || 0) > 0)
    .map(e => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(e.modelo || "—")}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${Number(e.cantidad || 0)}</td></tr>`)
    .join("");
  const activo = c.estado === "activo";
  return `
    <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#991B1B;">Contrato aprobado sin seriales</h2>
    <div style="margin:0 0 14px;padding:12px 14px;border:2px solid #b45309;border-radius:10px;background:#fffbeb;font:14px/1.6 Arial,sans-serif;color:#7c2d12;">
      El contrato <b>${esc(c.contrato_id || docId)}</b> de <b>${esc(c.cliente_nombre || "—")}</b>
      lleva <b>${diasAprobado != null ? `${diasAprobado} días` : "semanas"}</b> aprobado y bodega
      todavía no le asigna seriales, después de ${MAX_RECORDATORIOS} recordatorios.
      ${activo ? "<b>La cuenta ya está activa</b>, así que se está facturando un contrato cuyos equipos nadie ha declarado." : "Mientras tanto el contrato no llega a activaciones."}
    </div>
    <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
      Hay que resolverlo de una de dos formas: <b>asignar los seriales</b> (botón de abajo) o
      <b>anular el contrato</b> si ya no va. Dejarlo así deja los equipos sin dueño en el inventario.
    </p>
    <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
        <th style="text-align:center;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Cantidad</th>
      </tr></thead>
      <tbody>${equiposRows}</tbody>
    </table>
    <p style="margin:12px 0 0;font:12px/1.5 Arial,sans-serif;color:#6b7280;">
      Aviso ${intento} de escalamiento — se repite cada semana hasta que el contrato tenga seriales o se anule.
    </p>`;
}

module.exports = onSchedule(
  {
    schedule: "every day 07:00",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
  },
  async () => {
    // Intervalos configurables (fallback al default), en una sola lectura.
    let dias    = DEFAULT_DIAS;
    let diasEsc = DEFAULT_DIAS_ESC;
    try {
      const cfg = await db.collection("empresa").doc("config").get();
      const d = cfg.exists ? cfg.data() : {};
      const n  = Number(d.seriales_recordatorio_dias);
      const ne = Number(d.seriales_escalamiento_dias);
      if (Number.isFinite(n)  && n  >= 1) dias    = n;
      if (Number.isFinite(ne) && ne >= 1) diasEsc = ne;
    } catch (e) { /* usa defaults */ }

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
    const toEscalacion = await activacionesEmailTo();
    const emailPorUid = new Map();   // cachea el correo del vendedor entre contratos
    let enviados = 0;
    let escalados = 0;

    for (const doc of snap.docs) {
      const c = doc.data() || {};

      // Qué toca hoy para este contrato: nada, insistirle a bodega o escalar.
      // La decisión (contadores y fechas base) vive en domain/avisoSeriales.
      const decision = decideAviso(c, { ahora: now, dias, diasEsc, max: MAX_RECORDATORIOS });
      if (decision.accion === "nada") continue;

      // Pasado el tope de recordatorios: escala fuera de bodega en vez de callarse.
      if (decision.accion === "escalacion") {
        const { intento, diasAprobado } = decision;
        try {
          const cc = [await emailDeUid(c.creado_por_uid, emailPorUid), to].filter(Boolean).join(", ");
          await db.collection("mail_queue").add({
            to: toEscalacion,
            cc: cc || undefined,
            subject:   `Seriales sin asignar hace ${diasAprobado != null ? diasAprobado + " días" : "semanas"} — ${c.contrato_id || doc.id} (${c.cliente_nombre || "—"})`,
            preheader: `El contrato ${c.contrato_id || doc.id} sigue sin seriales después de ${MAX_RECORDATORIOS} recordatorios a bodega`,
            bodyContent: buildEscalacionBody(c, doc.id, diasAprobado, intento),
            ctaUrl:    `${APP_BASE_URL}/almacen/index.html?tab=asignar&contrato=${encodeURIComponent(doc.id)}`,
            ctaLabel:  "Asignar seriales",
            meta:      { source: "recordatorioSeriales", tipo: "escalacion", contrato_id: c.contrato_id || doc.id, intento },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await doc.ref.set({
            seriales_escalado_at: admin.firestore.FieldValue.serverTimestamp(),
            seriales_escalado_count: intento,
          }, { merge: true });
          escalados++;
        } catch (e) {
          logger.error("[recordatorioSeriales] error encolando escalación", { docId: doc.id, err: e.message });
        }
        continue;
      }

      const equiposRows = (c.equipos || [])
        .filter(e => Number(e.cantidad || 0) > 0)
        .map(e => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(e.modelo || "—")}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${Number(e.cantidad || 0)}</td></tr>`)
        .join("");

      const intento = decision.intento;
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
          ctaUrl:    `${APP_BASE_URL}/almacen/index.html?tab=asignar&contrato=${encodeURIComponent(doc.id)}`,
          ctaLabel:  "Asignar seriales",
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

    logger.info("[recordatorioSeriales] fin", { revisados: snap.size, enviados, escalados });
    return null;
  }
);
