const { onRequest } = require("firebase-functions/v2/https");
const logger     = require("firebase-functions/logger");
const cors       = require("cors")({
  origin: [
    "https://cecomunica-service-orders.web.app",
    "https://app.cecomunica.net",
    "http://127.0.0.1:5500"
  ]
});
const puppeteer  = require("puppeteer-core");
const { admin, db }                                         = require("../lib/admin");
const { sendEmail }                                         = require("../lib/mail");
const { buildEmailFromBase }                                = require("../domain/emailRenderer");
const { attachVerificationFromMirror, buildContractHtmlForPdf } = require("../domain/pdfRenderer");

module.exports = onRequest(
  {
    timeoutSeconds: 120,
    memory: "1GiB",
    secrets: [
      "SENDMAIL_KEY",
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
      "FIRMA_SECRET"
    ]
  },
  (req, res) => {
    cors(req, res, async () => {
      console.log(">>> sendContractPdf invoked", {
        headers: req.headers,
        bodyKeys: Object.keys(req.body || {})
      });

      try {
        if (req.headers["x-api-key"] !== process.env.SENDMAIL_KEY) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const { to, subject, html, text, contractDocId, pdfFileName } = req.body || {};
        if (!to || !subject || !contractDocId) {
          return res.status(400).json({ error: "Missing 'to', 'subject' or 'contractDocId'" });
        }

        const snap = await db.collection("contratos").doc(contractDocId).get();
        if (!snap.exists) {
          logger.warn("Contrato no encontrado", { contractDocId });
          return res.status(404).json({ error: "Contrato no encontrado" });
        }
        const contrato = snap.data();

        if (contrato.estado !== "activo") {
          return res.status(400).json({ error: "Solo se pueden generar PDFs de contratos activos" });
        }

        let aprobadorInfo = {};
        try {
          aprobadorInfo = await attachVerificationFromMirror(contrato, contractDocId);
        } catch (e) {
          if (e.code === "VERIF_NOT_FOUND") {
            logger.warn("[sendContractPdf] Verificación no encontrada, usando aprobador vacío.", {
              contratoId: contrato.contrato_id || contractDocId
            });
            aprobadorInfo = { nombre: "", cargo: "", email: "" };
          } else {
            throw e;
          }
        }

        let vendedorInfo = { nombre: "Vendedor", cargo: "Vendedor", email: "" };
        if (contrato.creado_por_uid) {
          const vendSnap = await db.collection("usuarios").doc(contrato.creado_por_uid).get();
          if (vendSnap.exists) {
            const u = vendSnap.data();
            vendedorInfo = {
              nombre: u.nombre || u.Nombre || vendedorInfo.nombre,
              cargo:  u.cargo  || (u.rol || vendedorInfo.cargo),
              email:  u.email  || ""
            };
          }
        }

        let pdfBuffer;
        try {
          const htmlForPdf = buildContractHtmlForPdf(contrato, vendedorInfo, aprobadorInfo);
          const chromium   = require("@sparticuz/chromium");
          const browser    = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
          });
          const page = await browser.newPage();
          await page.setContent(htmlForPdf, { waitUntil: "networkidle0" });
          pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "10mm", bottom: "12mm", left: "10mm", right: "10mm" }
          });
          await browser.close();
        } catch (pdfErr) {
          logger.error("Puppeteer/PDF error", { message: pdfErr.message, stack: pdfErr.stack });
          return res.status(500).json({ error: "PDF generation failed" });
        }

        const equiposHtml2 = (contrato.equipos || []).map(e =>
          `<li>${e.modelo || "—"} – ${Number(e.cantidad||0)} × $${Number(e.precio || 0).toFixed(2)}</li>`
        ).join("");

        const total2     = Number((contrato.total_con_itbms ?? contrato.total) || 0);
        const preheader2 = `Contrato ${contrato.contrato_id} listo · ${contrato.cliente_nombre} · $${total2.toFixed(2)}`;
        const renovacionHighlight2 = contrato.accion === "Renovación"
          ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #2563eb;border-radius:10px;background:#eff6ff;font:700 15px Arial,sans-serif;color:#1e3a8a;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? "RENOVACIÓN SIN EQUIPO" : "RENOVACIÓN CON EQUIPO"}</div>`
          : "";
        const aplicaRefurbished2   = (contrato.accion === "Renovación")
          && (contrato.renovacion_sin_equipo || contrato.renovacion_refurbished_componentes);
        const refurbishedIncluido2 = !!contrato.renovacion_refurbished_componentes;
        const refurbishedHighlight2 = aplicaRefurbished2
          ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid ${refurbishedIncluido2 ? "#0f766e" : "#b91c1c"};border-radius:10px;background:${refurbishedIncluido2 ? "#f0fdfa" : "#fef2f2"};font:700 15px Arial,sans-serif;color:${refurbishedIncluido2 ? "#115e59" : "#991b1b"};">Refurbished batería, antena, clip y piezas: ${refurbishedIncluido2 ? "INCLUIDO" : "NO INCLUIDO"}</div>`
          : "";

        const bodyHtml2 = `
          <h2 style="margin:0 0 12px; font:700 22px Arial, sans-serif; color:#111827;">Contrato</h2>
          <p style="margin:0 0 12px; font:14px/1.5 Arial, sans-serif;">
            Compartimos el contrato <b>${contrato.contrato_id}</b>.
          </p>
          ${renovacionHighlight2}
          ${refurbishedHighlight2}
          <table role="presentation" width="100%" style="font:14px Arial, sans-serif; margin:12px 0 16px;">
            <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.cliente_nombre || "—"}</td></tr>
            <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.tipo_contrato || "—"}</td></tr>
            <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.accion || "—"}</td></tr>
            ${contrato.accion === "Renovación" ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Modalidad renovación</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.renovacion_sin_equipo ? "Sin equipo" : "Con equipo"}</td></tr>` : ""}
            ${aplicaRefurbished2 ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Refurbished batería/antena/clip/piezas</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;color:${refurbishedIncluido2 ? "#115e59" : "#991b1b"};font-weight:700;">${refurbishedIncluido2 ? "Sí" : "No"}</td></tr>` : ""}
            <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">$${total2.toFixed(2)}</td></tr>
          </table>
          ${equiposHtml2 ? `<h4 style="margin:0 0 8px; font:600 16px Arial, sans-serif;">Equipos</h4><ul style="margin:0 0 16px; padding-left:18px; font:14px/1.5 Arial, sans-serif;">${equiposHtml2}</ul>` : ""}
        `;

        const contratoUrl2 = `https://app.cecomunica.net/contratos/imprimir-contrato.html?id=${encodeURIComponent(contrato.contrato_id)}`;
        const htmlEmail2   = buildEmailFromBase({
          preheader: preheader2,
          bodyHtml:  bodyHtml2,
          ctaUrl:    contratoUrl2,
          ctaLabel:  "Ver contrato"
        });

        let info;
        try {
          info = await sendEmail({
            to,
            cc: vendedorInfo?.email || undefined,
            subject,
            html: htmlEmail2,
            text,
            attachments: [{
              filename:    pdfFileName || `${contrato.contrato_id || "contrato"}.pdf`,
              content:     pdfBuffer,
              contentType: "application/pdf"
            }]
          });
        } catch (smtpErr) {
          logger.error("SMTP send error", { message: smtpErr.message, stack: smtpErr.stack });
          return res.status(500).json({ error: "SMTP send failed" });
        }

        logger.info("sendContractPdf OK", { messageId: info.messageId, to, subject });
        res.json({ success: true, messageId: info.messageId });
      } catch (err) {
        logger.error("sendContractPdf exception", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
      }
    });
  }
);
