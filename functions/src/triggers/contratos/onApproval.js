const { onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger     = require("firebase-functions/logger");
const crypto     = require("crypto");
const puppeteer  = require("puppeteer-core");
const { admin, db }                                         = require("../../lib/admin");
const { sendEmail, recordSendFailure }                      = require("../../lib/mail");
const { buildEmailFromBase, escapeHtml }                    = require("../../domain/emailRenderer");
const { attachVerificationFromMirror, buildContractHtmlForPdf } = require("../../domain/pdfRenderer");
const { APP_BASE_URL, inventarioEmailTo } = require("../../lib/inventario");
const { activacionesEmailTo, ccContratoAprobado } = require("../../lib/mailRecipients");

const HMAC_SECRET = process.env.FIRMA_SECRET || "MISSING_SECRET";

// Resuelve el email del vendedor (creador) del contrato para CC. Nunca lanza.
async function vendedorEmail(uid) {
  if (!uid) return null;
  try {
    const snap = await db.collection("usuarios").doc(uid).get();
    return snap.exists ? (snap.data().email || null) : null;
  } catch (e) {
    logger.warn("[seriales] No se pudo leer email del vendedor.", { uid, message: e.message });
    return null;
  }
}

// Unidades del contrato que requieren serial (descontando bajas/cancelaciones).
// Misma fórmula que el botón de seriales en la lista (contratos-list.js:24-26).
function unidadesSerializables(contrato) {
  const total = (contrato.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
  return Math.max(0, total - Number(contrato.baja_cancelado_total || 0));
}

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

// Al aprobar un contrato, en vez de mandar el correo a activaciones de una vez,
// se pide a INVENTARIO que asigne los seriales primero. Si el contrato no tiene
// unidades serializables (p.ej. renovación sin equipo), se auto-completa la
// señal de seriales para que el correo a activaciones salga igual (sin seriales).
const onContratoAprobadoSolicitaSeriales = onDocumentUpdated(
  { document: "contratos/{docId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!before || !after) return null;

    const pasoAAprobado = (before.estado !== "aprobado" && after.estado === "aprobado");
    if (!pasoAAprobado) return null;
    // Idempotencia: si el flujo de seriales ya arrancó, no repetir.
    if (after.seriales_estado) return null;

    const docId       = event.params.docId;
    const contratoRef = event.data.after.ref;
    const unidades    = unidadesSerializables(after);

    // Renovación sin equipo: las líneas de equipos son renglones de alquiler
    // (cantidad > 0) pero NO se entrega equipo físico — no hay seriales que
    // asignar. Pedirlos a inventario solo confunde a bodega y deja el contrato
    // trabado sin llegar nunca a activaciones (caso Silverking ALQ20260713-04).
    const esRenovSinEquipo = after.accion === "Renovación" && !!after.renovacion_sin_equipo;

    // Sin equipos que serializar → completa la señal y deja que el trigger de
    // activaciones envíe el correo (sin seriales, con la modalidad de renovación).
    if (unidades <= 0 || esRenovSinEquipo) {
      await contratoRef.collection("seriales_estado").doc("current").set({
        estado: "asignados",
        omisiones: [],
        por: "system",
        at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info("[onContratoAprobadoSolicitaSeriales] Sin seriales que pedir — directo a activaciones", {
        contratoId: after.contrato_id || docId, unidades, esRenovSinEquipo
      });
      return null;
    }

    // Marca pendiente (para el botón de la lista) y solicita seriales a inventario.
    await contratoRef.set({ seriales_estado: "pendiente" }, { merge: true });

    const equiposRows = (after.equipos || [])
      .filter(e => Number(e.cantidad || 0) > 0)
      .map(e => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(e.modelo || "—")}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${Number(e.cantidad || 0)}</td></tr>`)
      .join("");

    const bodyContent = `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Solicitud de seriales</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        El contrato <b>${escapeHtml(after.contrato_id || docId)}</b> de
        <b>${escapeHtml(after.cliente_nombre || "—")}</b> fue aprobado. Asigna los
        seriales de los siguientes equipos para continuar el proceso.
      </p>
      <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
          <th style="text-align:center;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Cantidad</th>
        </tr></thead>
        <tbody>${equiposRows}</tbody>
      </table>`;

    const to = await inventarioEmailTo();
    const cc = await vendedorEmail(after.creado_por_uid); // visibilidad al vendedor
    await db.collection("mail_queue").add({
      to,
      ...(cc ? { cc } : {}), // Firestore no admite undefined; se omite si no hay vendedor
      subject:     `Solicitud de seriales: ${after.contrato_id || docId} – ${after.cliente_nombre || ""}`,
      preheader:   `Asigna los seriales del contrato ${after.contrato_id || docId}`,
      bodyContent,
      ctaUrl:      `${APP_BASE_URL}/contratos/seriales.html?id=${encodeURIComponent(docId)}`,
      ctaLabel:    "Agregar seriales",
      meta:        { source: "onContratoAprobadoSolicitaSeriales", contrato_id: after.contrato_id || docId },
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("[onContratoAprobadoSolicitaSeriales] Solicitud de seriales encolada", {
      contratoId: after.contrato_id || docId, unidades
    });
    return null;
  }
);

const onSerialesAsignadasSendPdf = onDocumentWritten(
  {
    document: "contratos/{cid}/seriales_estado/{sid}",
    // Puppeteer + @sparticuz/chromium requieren memoria generosa para
    // que el bootstrap del binario de Chrome quepa sin caer en el
    // timeout interno de 30s para el WebSocket endpoint. Con 1 GiB
    // estaba fallando en cold starts (PROP20260604-01 — 2026-06-04).
    memory: "2GiB",
    timeoutSeconds: 180,
    secrets: [
      "FIRMA_SECRET",
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after) return null; // borrado de la señal — nada que hacer

    // Solo en la transición de la señal de seriales a "asignados".
    const justAsignado = after.estado === "asignados" && before?.estado !== "asignados";
    if (!justAsignado) return null;

    const cid = event.params.cid;
    const contratoRef = db.collection("contratos").doc(cid);

    // Backstop del corte legacy: si el contrato es histórico, no participa del
    // nuevo flujo — no espejar ni reenviar a activaciones (por si alguien llega
    // por link directo a seriales.html de un contrato viejo). Ver backfill
    // `marcarSerialesLegacy` y el guard en contrato-seriales-page.js.
    try {
      const cSnap = await contratoRef.get();
      const cData = cSnap.exists ? (cSnap.data() || {}) : {};
      if (cData.seriales_estado === "legacy") {
        logger.info("[onSerialesAsignadasSendPdf] Contrato legacy — omitido (sin correo a activaciones)", { cid });
        return null;
      }
      // Idempotencia: los triggers de Firestore son at-least-once. Si ya se envió
      // el PDF a activaciones para este contrato, no reenviar en una re-entrega
      // del evento (ni al re-editar seriales, que es admin-only y no debe reenviar).
      if (cData.seriales_pdf_enviado_at) {
        logger.info("[onSerialesAsignadasSendPdf] PDF ya enviado antes — se omite reenvío", { cid });
        return null;
      }
    } catch (e) {
      logger.warn("[onSerialesAsignadasSendPdf] No se pudo verificar estado legacy/idempotencia", { cid, message: e.message });
    }

    const omisiones = Array.isArray(after.omisiones) ? after.omisiones : [];

    logger.info("[onSerialesAsignadasSendPdf] Seriales asignados", { cid, omisiones: omisiones.length });

    // Espeja el estado al documento del contrato (para el botón de la lista).
    try {
      await contratoRef.set({
        seriales_estado:         "asignados",
        seriales_omitidos_count: omisiones.length,
        seriales_asignados_at:   admin.firestore.FieldValue.serverTimestamp(),
        seriales_asignados_por:  after.por || null,
      }, { merge: true });
    } catch (e) {
      logger.warn("[onSerialesAsignadasSendPdf] No se pudo espejar seriales_estado", { cid, message: e.message });
    }

    // Captura el contexto del envío para que el catch externo pueda
    // registrarlo en mail_queue (visibilidad en admin/salud) si algo
    // falla — antes solo quedaba en CF logs.
    let mailContext = { source: "onSerialesAsignadasSendPdf" };

    try {
      const contratoSnap = await contratoRef.get();
      if (!contratoSnap.exists) {
        logger.warn("[onSerialesAsignadasSendPdf] Contrato no existe", { cid });
        return null;
      }
      const contrato = contratoSnap.data();

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
        aprobadorInfo = await attachVerificationFromMirror(contrato, cid);
      } catch (e) {
        if (e.code === "VERIF_NOT_FOUND") {
          logger.warn("[onSerialesAsignadasSendPdf] Verificación no disponible; generando PDF sin firma interna.", {
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
      let pdfBuffer;
      try {
        const page = await browser.newPage();
        await page.setContent(htmlForPdf, { waitUntil: "networkidle0" });
        pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "10mm", bottom: "12mm", left: "10mm", right: "10mm" }
        });
      } finally {
        // Cierra Chromium aunque falle setContent/pdf; si no, la instancia
        // caliente acumula procesos de 1-2 GiB y termina en OOM.
        await browser.close();
      }

      const equiposHtml = (contrato.equipos || []).map(e =>
        `<li>${e.modelo || "—"} – ${Number(e.cantidad||0)} × $${Number(e.precio || 0).toFixed(2)}</li>`
      ).join("");

      // Seriales asignados (subcolección) agrupados por modelo.
      const serialesSnap = await contratoRef.collection("seriales").get();
      const serialesPorModelo = {};
      serialesSnap.forEach(d => {
        const s = d.data() || {};
        const serial = String(s.serial || "").trim();
        if (!serial) return;
        const m = s.modelo || "—";
        (serialesPorModelo[m] = serialesPorModelo[m] || []).push(serial);
      });
      const serialesRows = Object.keys(serialesPorModelo).sort().map(m =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(m)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">${serialesPorModelo[m].map(escapeHtml).join("<br>")}</td></tr>`
      ).join("");
      const serialesTable = serialesRows
        ? `<h4 style="margin:16px 0 8px;font:600 16px Arial,sans-serif;">Seriales asignados</h4>
           <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:0 0 16px;">
             <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial</th></tr></thead>
             <tbody>${serialesRows}</tbody></table>`
        : "";

      // Equipos que inventario marcó SIN serial (override manual) + motivo.
      const omisionesRows = omisiones.map(o =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(o.modelo || "—")}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(o.motivo || "—")}</td></tr>`
      ).join("");
      const omisionesTable = omisionesRows
        ? `<h4 style="margin:16px 0 8px;font:600 16px Arial,sans-serif;color:#92400e;">Equipos sin serial</h4>
           <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:0 0 16px;">
             <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Motivo</th></tr></thead>
             <tbody>${omisionesRows}</tbody></table>`
        : "";

      const total    = Number((contrato.total_con_itbms ?? contrato.total) || 0);
      const preheader = `Contrato ${contrato.contrato_id} – seriales asignados (${contrato.cliente_nombre})`;
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
        ${serialesTable}
        ${omisionesTable}
      `;

      const contratoUrl = `https://app.cecomunica.net/contratos/imprimir-contrato.html?id=${encodeURIComponent(contrato.contrato_id)}`;
      const htmlEmail   = buildEmailFromBase({
        preheader,
        bodyHtml,
        ctaUrl:   contratoUrl,
        ctaLabel: "Ver contrato"
      });

      mailContext = {
        ...mailContext,
        to:      await activacionesEmailTo(),
        // CC: vendedor + copias del panel (empresa/config.mail_cc_contrato_aprobado)
        cc:      [vendedorInfo?.email, ...(await ccContratoAprobado())].filter(Boolean).join(",") || undefined,
        subject: `Contrato APROBADO: ${contrato.contrato_id} – ${contrato.cliente_nombre}`,
      };

      await sendEmail({
        to:      mailContext.to,
        cc:      mailContext.cc,
        subject: mailContext.subject,
        html: htmlEmail,
        attachments: [{
          filename:    `${contrato.contrato_id || "contrato"}.pdf`,
          content:     pdfBuffer,
          contentType: "application/pdf"
        }]
      });

      logger.info("[onSerialesAsignadasSendPdf] Correo enviado con PDF", {
        contratoId: contrato.contrato_id,
        cliente:    contrato.cliente_nombre
      });

      // Marca de idempotencia: bloquea reenvíos ante re-entregas del trigger.
      // Best-effort — si esta escritura falla, una re-entrega podría reenviar
      // (ventana estrecha aceptada), pero el correo ya salió correctamente.
      await contratoRef.set({
        seriales_pdf_enviado_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      logger.error("[onSerialesAsignadasSendPdf] Error en proceso", { message: err.message, stack: err.stack });
      // Registra el fallo en mail_queue para que aparezca en admin/salud.
      // Best-effort: si Firestore también está caído, el log de CF ya queda.
      await recordSendFailure(mailContext, err);
    }

    return null;
  }
);


// onContratoActivadoSendPdf (envío al APROBAR) fue retirada 2026-07-17: llevaba
// deshabilitada desde que onSerialesAsignadasSendPdf asumió el envío post-seriales.
// Al desplegar functions, aceptar el borrado del CF huérfano cuando el deploy lo pregunte.
module.exports = {
  onContratoActivado,
  onContratoAprobadoSolicitaSeriales,
  onSerialesAsignadasSendPdf,
};
