const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db }         = require("../../lib/admin");
const { sendEmail }         = require("../../lib/mail");
const { buildEmailFromBase, renderByTemplate } = require("../../domain/emailRenderer");

/**
 * onMailQueued — sends queued emails, idempotently retryable.
 *
 * Trigger: onDocumentWritten (was onDocumentCreated). The retry workflow
 * from admin/salud.html clears `error` + `sent_at` to re-arm a failed
 * email; that update re-triggers this function and the send is re-attempted.
 *
 * Process condition (after the write):
 *   - after.sent_at is null  (otherwise the email already went through)
 *   - after.error   is null  (otherwise it's a known failure waiting to be retried)
 *
 * Our own terminal writes set either sent_at (success) or error (failure),
 * which makes them skip on re-trigger — no infinite loop.
 *
 * Espejo del acuse de devolución (2026-09-01): los correos con meta.source
 * 'acuse-devolucion' reflejan su resultado terminal (enviado/fallo) en
 * devolucion.acuses[].envio de la orden — la tarjeta del acuse en la UI
 * muestra el estado REAL del SMTP y ofrece reenviar cuando falló. Best-effort:
 * un fallo del espejo nunca rompe el envío ni el reintento.
 */

// Refleja el resultado del envío en el acuse de la orden de DEVOLUCIÓN.
// Espejo en la bandeja "Facturación pendiente" (2026-09-04): el aviso de
// facturación muestra si su correo salió y ofrece reenviarlo si falló. Solo
// el resultado TERMINAL (enviado / error), igual que el acuse. Best-effort.
async function mirrorAvisoFacturacion(after, ok, errorMsg) {
  const avisoId = after?.meta?.aviso_id;
  if (!avisoId) return;
  try {
    await db.collection("facturacion_avisos").doc(avisoId).set({
      correo: ok
        ? { status: "sent", sent_at: admin.firestore.Timestamp.now(), error: null }
        : { status: "error", error: String(errorMsg || "Fallo de envío") },
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error("[onMailQueued] no se pudo espejar el aviso de facturación:", e);
  }
}

async function mirrorAcuseDevolucion(after, ok, errorMsg) {
  const meta = after?.meta || {};
  if (meta.source !== "acuse-devolucion" || !meta.orden_id || !meta.acuse_id) return;
  try {
    const ref = db.collection("ordenes_de_servicio").doc(meta.orden_id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const arr = ((snap.data().devolucion || {}).acuses || []).map(x => ({ ...x }));
      const i = arr.findIndex(x => x && x.id === meta.acuse_id);
      if (i < 0) return;
      // Un reenvío posterior ya pudo re-solicitar este acuse: no pisarlo con
      // el resultado de un correo viejo.
      const st = (arr[i].envio || {}).status;
      if (st !== "encolado") return;
      arr[i].envio = ok
        ? { ...(arr[i].envio || {}), status: "enviado",
            at: admin.firestore.Timestamp.now(), error: null }
        : { ...(arr[i].envio || {}), status: "fallo",
            at: admin.firestore.Timestamp.now(), error: String(errorMsg || "Fallo de envío") };
      tx.update(ref, { "devolucion.acuses": arr });
    });
  } catch (e) {
    console.error("[onMailQueued] no se pudo espejar el acuse de devolución:", e);
  }
}
module.exports = onDocumentWritten(
  {
    document: "mail_queue/{mailId}",
    region: "us-central1",
    // Serializa TODOS los envíos de la cola en una sola conexión SMTP:
    // Office 365 limita a ~3 conexiones simultáneas por buzón y responde
    // "432 4.3.2 Concurrent connections limit exceeded" al excederlas
    // (una entrega encola 3-5 correos a la vez desde ordenes-flujo.js).
    // El volumen es bajo, así que la cola secuencial no agrega latencia
    // perceptible.
    maxInstances: 1,
    concurrency: 1,
    secrets: [
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return; // deletion — nothing to do
    if (after.sent_at) return;
    if (after.error)   return;

    const mailId = event.params.mailId;

    // Backoff para reintentos automáticos de errores SMTP transitorios:
    // el catch de abajo incrementa `intentos` y deja el doc "armado"
    // (sin sent_at/error), lo que re-dispara esta función de inmediato.
    // Esperamos intentos*10s (tope 30s) antes de reenviar para darle
    // aire al servidor. Con concurrency:1 esto bloquea la cola entera,
    // pero el volumen es bajo y el timeout por defecto (60s) alcanza.
    const intentosPrevios = after.intentos || 0;
    if (intentosPrevios > 0) {
      const espera = Math.min(intentosPrevios * 10_000, 30_000);
      await new Promise((r) => setTimeout(r, espera));
    }

    try {
      if (!after.to || !after.subject) {
        throw new Error("Faltan campos obligatorios: to/subject");
      }

      // Render precedence:
      //   1. after.template → server-side renderer (single source of truth
      //      for branding; see ORDENES_INDEX_IMPROVEMENTS.md §3a.12).
      //   2. after.html → caller-supplied HTML (legacy callers).
      //   3. after.bodyContent + email-base wrapper (older pattern).
      let html = renderByTemplate(after);
      if (!html) html = after.html;
      if (!html && (after.bodyContent || after.preheader)) {
        html = buildEmailFromBase({
          preheader: after.preheader   || "",
          bodyHtml:  after.bodyContent || "<p>Sin contenido.</p>",
          ctaUrl:    after.ctaUrl   || "#",
          ctaLabel:  after.ctaLabel || "Abrir",
        });
      }
      if (!html) throw new Error("Falta 'template', 'html' o 'bodyContent'");

      await sendEmail({
        to:          after.to,
        cc:          after.cc          || undefined,
        bcc:         after.bcc         || undefined,
        subject:     after.subject,
        html,
        text:        after.text        || undefined,
        attachments: after.attachments || undefined
      });

      await db.collection("mail_queue").doc(mailId).update({
        status:   "sent",
        sent_at:  admin.firestore.FieldValue.serverTimestamp(),
        error:    admin.firestore.FieldValue.delete(),
      });
      await mirrorAcuseDevolucion(after, true, null);
      await mirrorAvisoFacturacion(after, true, null);
    } catch (err) {
      console.error("Error enviando correo encolado:", err);

      // Errores SMTP 4xx son transitorios por definición (throttling,
      // buzón ocupado, greylisting). Reintentamos hasta 5 veces re-armando
      // el doc: la escritura de `intentos` (sin sent_at/error) re-dispara
      // esta función, que aplica el backoff de arriba antes de reenviar.
      const smtpCode  = Number(err?.responseCode) || 0;
      const transient = smtpCode >= 400 && smtpCode < 500;
      const intentos  = intentosPrevios + 1;

      if (transient && intentos < 5) {
        await db.collection("mail_queue").doc(mailId).update({
          status:              "retrying",
          intentos,
          last_transient_error: String(err?.message || err),
          updated_at:          admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      await db.collection("mail_queue").doc(mailId).update({
        status:     "error",
        error:      String(err?.message || err),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      // Solo el fallo TERMINAL se espeja: un transitorio en reintento aún
      // puede terminar en 'enviado'.
      await mirrorAcuseDevolucion(after, false, err?.message || err);
      await mirrorAvisoFacturacion(after, false, err?.message || err);
    }
  }
);
