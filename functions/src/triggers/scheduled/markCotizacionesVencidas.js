// Marca como "vencida" las cotizaciones en estado "enviada" cuya validez
// (fecha ISO + validezDias) ya pasó. Notifica al vendedor por mail_queue.
// Corre diariamente a las 06:00 hora Panamá.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

module.exports = onSchedule(
  {
    schedule: "every day 06:00",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
  },
  async () => {
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);

    logger.info("[markCotizacionesVencidas] inicio", { todayIso });

    // Trae cotizaciones en estado enviada (no más de 500 por corrida).
    // Filtramos validez en cliente: Firestore no soporta queries con
    // suma de un campo + otro de forma nativa.
    const snap = await db.collection("cotizaciones")
      .where("estado", "==", "enviada")
      .limit(500)
      .get();

    if (snap.empty) {
      logger.info("[markCotizacionesVencidas] sin cotizaciones en enviada");
      return null;
    }

    let vencidas = 0;
    const mailsToQueue = [];

    for (const doc of snap.docs) {
      const c = doc.data() || {};
      if (c.deleted) continue;
      const fecha = c.fecha;       // ISO YYYY-MM-DD
      const validezDias = Number(c.validezDias || c.validez_dias || 15);
      if (!fecha) continue;

      // Calcula fecha de vencimiento.
      const baseRef = c.enviada_en?.toDate ? c.enviada_en.toDate() : new Date(fecha + "T00:00:00");
      const venceAt = new Date(baseRef);
      venceAt.setDate(venceAt.getDate() + validezDias);

      if (venceAt > now) continue;  // aún vigente

      try {
        await doc.ref.update({
          estado: "vencida",
          fecha_vencimiento: admin.firestore.FieldValue.serverTimestamp(),
          vencida_auto: true,
        });
        vencidas++;

        if (c.creado_por_email) {
          mailsToQueue.push({
            to: c.creado_por_email,
            subject: `⏳ Cotización ${c.cotizacion_id} venció sin respuesta`,
            html: `
              <div style="font-family:Arial,sans-serif;color:#111;max-width:520px;">
                <h2 style="font:700 22px Arial,sans-serif;color:#9A3412;margin:0 0 12px;">Cotización vencida</h2>
                <p style="margin:0 0 12px;">La cotización <b>${c.cotizacion_id || doc.id}</b> dirigida a
                <b>${c.cliente_nombre || "—"}</b> alcanzó su período de validez de ${validezDias} días
                sin respuesta del cliente.</p>
                <p style="margin:0 0 12px;"><b>Total:</b> $${Number(c.total || 0).toFixed(2)}</p>
                <p style="font-size:13px;color:#6B7884;">Si la propuesta sigue vigente, puedes reenviarla
                o crear una nueva versión desde el panel de cotizaciones.</p>
              </div>
            `,
          });
        }
      } catch (e) {
        logger.error("[markCotizacionesVencidas] error update", { docId: doc.id, err: e.message });
      }
    }

    // Encola correos en una segunda pasada
    for (const m of mailsToQueue) {
      try {
        await db.collection("mail_queue").add({
          to: m.to,
          subject: m.subject,
          html: m.html,
          meta: { tipo: "cotizacion_vencida_auto" },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        logger.warn("[markCotizacionesVencidas] no se pudo encolar mail", { err: e.message });
      }
    }

    logger.info("[markCotizacionesVencidas] fin", { revisadas: snap.size, vencidas, mails: mailsToQueue.length });
    return null;
  }
);
