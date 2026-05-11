const nodemailer = require("nodemailer");
const { htmlToText } = require("html-to-text");

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

module.exports = { sendEmail };
