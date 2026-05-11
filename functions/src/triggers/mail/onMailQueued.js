const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { admin, db }        = require("../../lib/admin");
const { sendEmail }        = require("../../lib/mail");
const { buildEmailFromBase } = require("../../domain/emailRenderer");

module.exports = onDocumentCreated(
  {
    document: "mail_queue/{mailId}",
    region: "us-central1",
    secrets: [
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const snap   = event.data;
    const mailId = event.params.mailId;
    const data   = snap.data();

    try {
      if (!data?.to || !data?.subject) {
        throw new Error("Faltan campos obligatorios: to/subject");
      }

      let html = data.html;
      if (!html && (data.bodyContent || data.preheader)) {
        html = buildEmailFromBase({
          preheader: data.preheader  || "",
          bodyHtml:  data.bodyContent || "<p>Sin contenido.</p>",
          ctaUrl:    data.ctaUrl   || "#",
          ctaLabel:  data.ctaLabel || "Abrir",
        });
      }
      if (!html) throw new Error("Falta 'html' o 'bodyContent'");

      await sendEmail({
        to:          data.to,
        cc:          data.cc          || undefined,
        subject:     data.subject,
        html,
        text:        data.text        || undefined,
        attachments: data.attachments || undefined
      });

      await db.collection("mail_queue").doc(mailId).update({
        status:   "sent",
        sent_at:  admin.firestore.FieldValue.serverTimestamp(),
        error:    admin.firestore.FieldValue.delete(),
      });
    } catch (err) {
      console.error("Error enviando correo encolado:", err);
      await db.collection("mail_queue").doc(mailId).update({
        status:     "error",
        error:      String(err?.message || err),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);
