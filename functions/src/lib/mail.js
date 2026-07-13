const nodemailer = require("nodemailer");
const { htmlToText } = require("html-to-text");
const admin = require("firebase-admin");

// Hosts de Firebase Storage permitidos como origen de un adjunto por `path`.
const STORAGE_HOST_RE =
  /(^|\.)(firebasestorage\.googleapis\.com|storage\.googleapis\.com|firebasestorage\.app)$/i;

// Sanea los adjuntos antes de entregarlos a nodemailer. Un doc de `mail_queue`
// lo puede crear cualquier usuario autenticado, así que un `path` arbitrario
// haría que nodemailer leyera archivos locales del contenedor (LFI) o disparara
// requests salientes (SSRF). Solo permitimos:
//   - `content` (Buffer/string en línea) — lo usan las CF internas (PDFs).
//   - `path` que sea una URL https a un host de Firebase Storage — cotizaciones.
// Cualquier otro adjunto se descarta silenciosamente.
function sanitizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return undefined;
  const safe = [];
  for (const a of attachments) {
    if (!a || typeof a !== "object") continue;
    if (a.content !== undefined) {
      safe.push(a);
      continue;
    }
    if (typeof a.path === "string") {
      let url;
      try { url = new URL(a.path); } catch { continue; }
      if (url.protocol === "https:" && STORAGE_HOST_RE.test(url.host)) {
        safe.push(a);
      }
    }
    // Sin `content` ni `path` https-Storage válido → se descarta.
  }
  return safe.length ? safe : undefined;
}

// Transporter singleton por instancia caliente: se crea perezosamente en el
// primer envío (los secrets SMTP_* solo están disponibles en runtime, no al
// cargar el módulo) y se reutiliza en envíos siguientes de la misma instancia,
// evitando recrear la conexión en cada correo.
let _transporter = null;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true,
      // Office 365 rechaza con "432 4.3.2 Concurrent connections limit
      // exceeded" cuando el buzón tiene >~3 conexiones SMTP simultáneas.
      // Una sola conexión por instancia, reutilizada entre envíos.
      maxConnections: 1,
      maxMessages: 100
    });
  }
  return _transporter;
}

async function sendEmail({ to, subject, html, text, cc, bcc, attachments, replyTo }) {
  const transporter = getTransporter();

  const plain = text || (html ? htmlToText(html, { wordwrap: 120 }) : undefined);

  return transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, cc, bcc, subject,
    html,
    text: plain,
    attachments: sanitizeAttachments(attachments),
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
