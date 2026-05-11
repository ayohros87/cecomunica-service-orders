const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger     = require("firebase-functions/logger");
const crypto     = require("crypto");
const puppeteer  = require("puppeteer-core");
const { admin, db }                                         = require("../../lib/admin");
const { sendEmail }                                         = require("../../lib/mail");
const { buildEmailFromBase }                                = require("../../domain/emailRenderer");
const { attachVerificationFromMirror, buildContractHtmlForPdf } = require("../../domain/pdfRenderer");

const HMAC_SECRET = process.env.FIRMA_SECRET || "MISSING_SECRET";

const onContratoActivado = onDocumentUpdated(
  {
    document: "contratos/{docId}",
    secrets: ["FIRMA_SECRET"]
  },
  async (event) => {
    const beforeSnap = event.data.before;
    const afterSnap  = event.data.after;
    if (!beforeSnap || !afterSnap) return null;

    const before = beforeSnap.data();
    const after  = afterSnap.data();
    if (!before || !after) return null;

    const estadoBefore = before.estado || null;
    const estadoAfter  = after.estado  || null;

    if (!["activo", "aprobado"].includes(estadoAfter)) return null;

    const contratoId = event.params.docId;
    const verificRef = admin.firestore().collection("verificaciones").doc(contratoId);
    const verificSnap = await verificRef.get();

    const transitionedToActivo   = (estadoBefore !== "activo"   && estadoAfter === "activo");
    const transitionedToAprobado = (estadoBefore !== "aprobado" && estadoAfter === "aprobado");

    const needsRepair =
      !verificSnap.exists ||
      !after.firma_codigo ||
      !after.firma_hash   ||
      !after.firma_url;

    if (!transitionedToActivo && !transitionedToAprobado && !needsRepair) {
      return null;
    }

    const aprobadoPor  = after.aprobado_por_uid || "desconocido";
    const codigoCorto  = after.firma_codigo || crypto.randomBytes(5).toString("hex").toUpperCase();
    const payload      = `${contratoId}|${aprobadoPor}`;
    const hmac         = after.firma_hash || crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
    const firmaUrl     = after.firma_url || `https://verify.cecomunica.net/c/${encodeURIComponent(contratoId)}?v=${codigoCorto}`;

    await afterSnap.ref.set({
      firma_codigo: codigoCorto,
      firma_hash: hmac,
      firma_url: firmaUrl,
      ...(transitionedToActivo || transitionedToAprobado || !after.fecha_aprobacion ? {
        fecha_aprobacion: admin.firestore.FieldValue.serverTimestamp(),
      } : {}),
    }, { merge: true });

    let aprobNombre = "—";
    let aprobEmail  = "—";
    let aprobRol    = "—";

    if (aprobadoPor && aprobadoPor !== "desconocido") {
      try {
        const aprSnap = await admin.firestore().collection("usuarios").doc(aprobadoPor).get();
        if (aprSnap.exists) {
          const u = aprSnap.data() || {};
          aprobNombre = u.nombre || (u.email ? u.email.split("@")[0] : "—");
          aprobEmail  = u.email  || "—";
          aprobRol    = u.cargo  || u.rol || "Administrador";
        }
      } catch (e) {
        console.warn("[onContratoActivado] No se pudo leer usuarios/", aprobadoPor, e.message);
      }
    }

    await verificRef.set({
      contrato_id: contratoId,
      cliente_nombre: after.cliente_nombre || null,
      total_con_itbms: (typeof after.total_con_itbms === "number" ? after.total_con_itbms : (after.total ?? null)),
      aprobado_por_uid: aprobadoPor,
      fecha_aprobacion: after.fecha_aprobacion || admin.firestore.FieldValue.serverTimestamp(),
      firma_codigo: codigoCorto,
      firma_hash: hmac,
      firma_url: firmaUrl,
      estado: estadoAfter,
      aprobado_por_nombre: aprobNombre,
      aprobado_por_email:  aprobEmail,
      aprobado_por_rol:    aprobRol,
      creado_en: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return null;
  }
);

const onContratoActivadoSendPdf = onDocumentUpdated(
  {
    document: "contratos/{docId}",
    memory: "1GiB",
    timeoutSeconds: 120,
    secrets: [
      "FIRMA_SECRET",
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const before = event.data.before?.data();
    const after  = event.data.after?.data();

    if (!before || !after) {
      logger.warn("[onContratoActivadoSendPdf] No before/after data", { before, after });
      return null;
    }

    logger.info("[onContratoActivadoSendPdf] Triggered", {
      contratoId: after.contrato_id,
      estadoBefore: before.estado,
      estadoAfter: after.estado
    });

    const pasoAAprobado = (before.estado !== "aprobado" && after.estado === "aprobado");
    if (!pasoAAprobado) {
      logger.info("[onContratoActivadoSendPdf] No es transición a APROBADO, se ignora.");
      return null;
    }

    try {
      const contrato = after;

      let vendedorInfo = { nombre: "Vendedor", cargo: "Vendedor", email: "" };
      if (contrato.creado_por_uid) {
        const vendSnap = await db.collection("usuarios").doc(contrato.creado_por_uid).get();
        if (vendSnap.exists) {
          const u = vendSnap.data();
          vendedorInfo = {
            nombre: u.nombre || vendedorInfo.nombre,
            cargo:  u.cargo  || (u.rol || vendedorInfo.cargo),
            email:  u.email  || ""
          };
        }
      }

      let aprobadorInfo = {};
      try {
        aprobadorInfo = await attachVerificationFromMirror(contrato, event.params.docId);
      } catch (e) {
        if (e.code === "VERIF_NOT_FOUND") {
          logger.warn("[onContratoActivadoSendPdf] Verificación no disponible; generando PDF sin firma interna.", {
            contratoId: contrato.contrato_id
          });
          aprobadorInfo = { nombre: "", cargo: "", email: "" };
        } else {
          throw e;
        }
      }

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
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "10mm", bottom: "12mm", left: "10mm", right: "10mm" }
      });
      await browser.close();

      const equiposHtml = (contrato.equipos || []).map(e =>
        `<li>${e.modelo || "—"} – ${Number(e.cantidad||0)} × $${Number(e.precio || 0).toFixed(2)}</li>`
      ).join("");

      const total    = Number((contrato.total_con_itbms ?? contrato.total) || 0);
      const preheader = `Contrato ${contrato.contrato_id} aprobado para ${contrato.cliente_nombre} por $${total.toFixed(2)}`;
      const renovacionHighlightHtml = contrato.accion === "Renovación"
        ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #2563eb;border-radius:10px;background:#eff6ff;font:700 15px Arial,sans-serif;color:#1e3a8a;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? "RENOVACIÓN SIN EQUIPO" : "RENOVACIÓN CON EQUIPO"}</div>`
        : "";
      const aplicaRefurbished  = (contrato.accion === "Renovación")
        && (contrato.renovacion_sin_equipo || contrato.renovacion_refurbished_componentes);
      const refurbishedIncluido = !!contrato.renovacion_refurbished_componentes;
      const refurbishedHighlightHtml = aplicaRefurbished
        ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid ${refurbishedIncluido ? "#0f766e" : "#b91c1c"};border-radius:10px;background:${refurbishedIncluido ? "#f0fdfa" : "#fef2f2"};font:700 15px Arial,sans-serif;color:${refurbishedIncluido ? "#115e59" : "#991b1b"};">Refurbished batería, antena, clip y piezas: ${refurbishedIncluido ? "INCLUIDO" : "NO INCLUIDO"}</div>`
        : "";

      const bodyHtml = `
        <h2 style="margin:0 0 12px; font:700 22px Arial, sans-serif; color:#111827;">Contrato aprobado</h2>
        <p style="margin:0 0 12px; font:14px/1.5 Arial, sans-serif;">
          El contrato <b>${contrato.contrato_id}</b> ha sido aprobado.
        </p>
        ${renovacionHighlightHtml}
        ${refurbishedHighlightHtml}
        <table role="presentation" width="100%" style="font:14px Arial, sans-serif; margin:12px 0 16px;">
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.cliente_nombre || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Elaborador del contrato</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${vendedorInfo?.nombre || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.tipo_contrato || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.accion || "—"}</td></tr>
          ${contrato.accion === "Renovación" ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Modalidad renovación</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.renovacion_sin_equipo ? "Sin equipo" : "Con equipo"}</td></tr>` : ""}
          ${aplicaRefurbished ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Refurbished batería/antena/clip/piezas</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;color:${refurbishedIncluido ? "#115e59" : "#991b1b"};font-weight:700;">${refurbishedIncluido ? "Sí" : "No"}</td></tr>` : ""}
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Observaciones</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${(contrato.observaciones || "—").replace(/[<>&]/g, s => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[s]))}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">$${total.toFixed(2)}</td></tr>
        </table>
        ${equiposHtml ? `<h4 style="margin:0 0 8px; font:600 16px Arial, sans-serif;">Equipos</h4><ul style="margin:0 0 16px; padding-left:18px; font:14px/1.5 Arial, sans-serif;">${equiposHtml}</ul>` : ""}
      `;

      const contratoUrl = `https://app.cecomunica.net/contratos/imprimir-contrato.html?id=${encodeURIComponent(contrato.contrato_id)}`;
      const htmlEmail   = buildEmailFromBase({
        preheader,
        bodyHtml,
        ctaUrl:   contratoUrl,
        ctaLabel: "Ver contrato"
      });

      await sendEmail({
        to: "alberto.yohros@cecomunica.com, activaciones@cecomunica.com",
        cc: vendedorInfo?.email || undefined,
        subject: `Contrato APROBADO: ${contrato.contrato_id} – ${contrato.cliente_nombre}`,
        html: htmlEmail,
        attachments: [{
          filename:    `${contrato.contrato_id || "contrato"}.pdf`,
          content:     pdfBuffer,
          contentType: "application/pdf"
        }]
      });

      logger.info("[onContratoActivadoSendPdf] Correo enviado con PDF", {
        contratoId: contrato.contrato_id,
        cliente:    contrato.cliente_nombre
      });
    } catch (err) {
      logger.error("[onContratoActivadoSendPdf] Error en proceso", { message: err.message, stack: err.stack });
    }

    return null;
  }
);

module.exports = { onContratoActivado, onContratoActivadoSendPdf };
