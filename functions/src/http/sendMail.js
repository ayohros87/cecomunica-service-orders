const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const cors   = require("cors")({
  origin: [
    "https://cecomunica-service-orders.web.app",
    "https://app.cecomunica.net",
    "http://127.0.0.1:5500"
  ]
});
const { sendEmail }         = require("../lib/mail");
const { buildEmailFromBase } = require("../domain/emailRenderer");

module.exports = onRequest(
  {
    secrets: [
      "SENDMAIL_KEY",
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  (req, res) => {
    cors(req, res, async () => {
      try {
        if (req.headers["x-api-key"] !== process.env.SENDMAIL_KEY) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const { to, subject, text, html, cc, bodyContent, preheader, ctaUrl, ctaLabel } = req.body || {};
        if (!to || !subject) {
          return res.status(400).json({ error: "Missing 'to' or 'subject'" });
        }

        const htmlEmail = html || buildEmailFromBase({
          preheader: preheader || "",
          bodyHtml:  bodyContent || "<p>Sin contenido.</p>",
          ctaUrl:    ctaUrl || "#",
          ctaLabel:  ctaLabel || "Abrir"
        });

        const info = await sendEmail({ to, subject, html: htmlEmail, text, cc });
        logger.info("Email sent", { messageId: info.messageId });
        res.json({ success: true, messageId: info.messageId });
      } catch (err) {
        logger.error("sendMail error", err);
        res.status(500).json({ error: err.message });
      }
    });
  }
);
