const nodemailer = require("nodemailer");
const { htmlToText } = require("html-to-text");
const admin = require("firebase-admin");

async function sendEmail({ to, subject, html, text, cc, bcc, attachments, replyTo }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const plain = text || (html ? htmlToText(html, { wordwrap: 120 }) : undefined);

  return transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, cc, bcc, subject,
    html,
    text: plain,
    attachments,
    replyTo
  });
}

/**
 * Record a direct-send failure to mail_queue so it shows up in admin/salud.
 *
 * Use this from CF catch blocks that send via sendEmail() directly (i.e.
 * NOT via the mail_queue → onMailQueued path). Without this, failures
 * only land in CF logs and the admin has no way to spot them.
 *
 * The recorded doc is intentionally NOT retryable through the standard
 * "Reintentar" button — onMailQueued requires `to/subject` and the full
 * payload, which we'd have to mirror with attachments etc. The flag
 * `failed_direct_send: true` marks these so future UI can warn admins.
 *
 * meta is the minimal context the admin needs to identify and recreate
 * the email manually if necessary: { to, cc, subject, source }.
 */
async function recordSendFailure(meta, err) {
  try {
    await admin.firestore().collection("mail_queue").add({
      status:               "error",
      error:                String(err?.message || err),
      to:                   meta.to || null,
      cc:                   meta.cc || null,
      subject:              meta.subject || null,
      source:               meta.source || "direct-send",
      failed_direct_send:   true,
      createdAt:            admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (writeErr) {
    // Best-effort: if Firestore is down we already lost the email anyway.
    console.error("[recordSendFailure] could not record failure", writeErr?.message);
  }
}

module.exports = { sendEmail, recordSendFailure };
