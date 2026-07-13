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
 */
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
    }
  }
);
