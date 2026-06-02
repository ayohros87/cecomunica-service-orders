// Notifica al vendedor cuando el cliente abre el link público de la cotización.
// Trigger: nuevo doc en cotizacion_opens/{logId}.
// Lee cotizacion_verificaciones/{verificacion_id} para obtener creado_por_email
// y datos básicos, luego encola un mail en mail_queue (deja a onMailQueued enviarlo).

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

module.exports = onDocumentCreated(
  {
    document: "cotizacion_opens/{logId}",
    region: "us-central1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return null;
    const open = snap.data() || {};
    const verifId = open.verificacion_id;
    if (!verifId) { logger.warn("[onCotizacionOpened] sin verificacion_id"); return null; }

    try {
      // 1) Recupera la verificación pública (snapshot con datos del vendedor)
      const verifSnap = await db.collection("cotizacion_verificaciones").doc(verifId).get();
      if (!verifSnap.exists) {
        logger.warn("[onCotizacionOpened] verificación no encontrada", { verifId });
        return null;
      }
      const v = verifSnap.data() || {};

      // 2) Throttling: si ya hubo notificación en las últimas 6 horas, no spamear.
      const lastNotifiedAt = v.last_opened_notified_at;
      if (lastNotifiedAt && lastNotifiedAt.toDate) {
        const horas = (Date.now() - lastNotifiedAt.toDate().getTime()) / (1000 * 60 * 60);
        if (horas < 6) {
          logger.info("[onCotizacionOpened] notificación reciente, se omite", { verifId, horas });
          return null;
        }
      }

      // 3) Resolver email del vendedor: prioridad creado_por_email del mirror;
      //    fallback: usuarios/{creado_por_uid}.email
      let vendedorEmail = v.creado_por_email || null;
      let vendedorNombre = v.ejecutivo_nombre || null;
      if (!vendedorEmail && v.creado_por_uid) {
        try {
          const u = await db.collection("usuarios").doc(v.creado_por_uid).get();
          if (u.exists) {
            const ud = u.data() || {};
            vendedorEmail = ud.email || null;
            vendedorNombre = ud.nombre || vendedorNombre;
          }
        } catch (e) { /* no-op */ }
      }
      if (!vendedorEmail) {
        logger.warn("[onCotizacionOpened] no se pudo resolver email del vendedor", { verifId });
        return null;
      }

      // 4) Composición del correo
      const cotId = v.cotizacion_id || verifId;
      const cliente = v.cliente_nombre || "—";
      const dirigidoA = v.dirigido_a || "—";
      const total = typeof v.total === "number" ? v.total : 0;
      const fechaApertura = (open.opened_at && open.opened_at.toDate)
        ? open.opened_at.toDate().toLocaleString("es-PA")
        : new Date().toLocaleString("es-PA");

      const subject = `📬 Cotización ${cotId} abierta por ${cliente}`;
      const html = `
        <div style="font-family:Arial,sans-serif;color:#111;max-width:540px;">
          <h2 style="font:700 22px Arial,sans-serif;color:#0B2A47;margin:0 0 12px;">Tu cotización fue abierta</h2>
          <p style="margin:0 0 12px;">${vendedorNombre ? "Hola " + vendedorNombre + "," : "Hola,"}</p>
          <p style="margin:0 0 12px;">El cliente acaba de abrir la cotización que le enviaste:</p>
          <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cotización</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${cotId}</td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${cliente}</td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Dirigido a</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${dirigidoA}</td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Total</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">$${Number(total).toFixed(2)}</td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Hora de apertura</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${fechaApertura}</td></tr>
          </table>
          <p style="font-size:12px;color:#6B7884;margin-top:24px;">
            Te recomendamos hacer seguimiento en las próximas 24 horas mientras la propuesta está fresca.
          </p>
        </div>
      `;

      await db.collection("mail_queue").add({
        to: vendedorEmail,
        subject,
        html,
        meta: {
          tipo: "cotizacion_apertura",
          cotizacion_id: cotId,
          verificacion_id: verifId,
          log_id: event.params.logId,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 5) Marca el mirror para throttling
      await verifSnap.ref.set({
        last_opened_at: open.opened_at || admin.firestore.FieldValue.serverTimestamp(),
        last_opened_notified_at: admin.firestore.FieldValue.serverTimestamp(),
        opens_count: admin.firestore.FieldValue.increment(1),
      }, { merge: true });

      logger.info("[onCotizacionOpened] notificación encolada", { vendedorEmail, cotId });
    } catch (e) {
      logger.error("[onCotizacionOpened] error", { message: e.message, stack: e.stack });
    }
    return null;
  }
);
