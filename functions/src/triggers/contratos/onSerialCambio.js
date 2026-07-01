// Flujo "Solicitud de cambio de serial" (corrección por error humano o equipo
// defectuoso), disponible SOLO mientras el contrato está `aprobado` (antes de
// activarse al subir el firmado). Recepción/admin crean la solicitud desde el
// módulo de contratos seleccionando los seriales a reemplazar; inventario los
// reemplaza en la página de seriales (modo reemplazo) y resuelve la solicitud.
//
// Este trigger maneja los DOS correos del flujo, sobre el doc de solicitud
// `contratos/{cid}/seriales_cambios/{reqId}`:
//   · alta (estado 'pendiente')      → correo a INVENTARIO (qué seriales cambiar)
//   · resuelto (estado 'resuelto')   → correo a ACTIVACIONES (corrección viejo→nuevo)
//
// Los destinatarios de inventario se resuelven server-side (empresa/config,
// mismo helper que "Solicitud de seriales"). No requiere secrets: encola en
// mail_queue y onMailQueued se encarga del SMTP.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { db } = require("../../lib/admin");
const { APP_BASE_URL, inventarioEmailTo } = require("../../lib/inventario");

// Mismos destinatarios que el correo de "seriales asignados" a activaciones.
const ACTIVACIONES_TO = "alberto.yohros@cecomunica.com, activaciones@cecomunica.com";

function escapeHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, s => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
  ));
}

async function vendedorEmail(uid) {
  if (!uid) return undefined;
  try {
    const snap = await db.collection("usuarios").doc(uid).get();
    const email = snap.exists ? snap.data().email : null;
    return email || undefined;
  } catch (e) {
    return undefined;
  }
}

// Espeja en el contrato si tiene alguna solicitud de cambio de serial PENDIENTE,
// para el chip de la lista (evita consultar la subcolección por cada fila).
async function actualizarFlagPendiente(contratoRef) {
  try {
    const qs = await contratoRef.collection("seriales_cambios")
      .where("estado", "==", "pendiente").limit(1).get();
    await contratoRef.set({ seriales_cambio_pendiente: !qs.empty }, { merge: true });
  } catch (e) {
    logger.warn("[onSerialCambio] No se pudo actualizar el flag de pendiente", { message: e.message });
  }
}

module.exports = onDocumentWritten(
  { document: "contratos/{cid}/seriales_cambios/{reqId}", region: "us-central1" },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();

    const cid   = event.params.cid;
    const reqId = event.params.reqId;
    const contratoRef = db.collection("contratos").doc(cid);

    // Mantén el flag "seriales_cambio_pendiente" en el contrato (chip de la lista)
    // en TODOS los casos: alta, resuelto, cancelado o borrado de la solicitud.
    await actualizarFlagPendiente(contratoRef);

    if (!after) return null; // borrado — flag actualizado, sin correo

    // Datos autoritativos del contrato (para el correo y CC al vendedor).
    let contrato = {};
    try {
      const snap = await contratoRef.get();
      contrato = snap.exists ? snap.data() : {};
    } catch (e) {
      logger.warn("[onSerialCambio] No se pudo leer el contrato", { cid, message: e.message });
    }
    const contratoIdVis = contrato.contrato_id || after.contrato_id || cid;
    const clienteNombre = contrato.cliente_nombre || after.cliente_nombre || "—";

    // ── Alta de solicitud → correo a INVENTARIO ──────────────────────────
    const esAlta = !before && after.estado === "pendiente";
    if (esAlta) {
      const items = Array.isArray(after.items) ? after.items : [];
      if (!items.length) {
        logger.info("[onSerialCambio] Solicitud sin items — no se envía correo", { cid, reqId });
        return null;
      }
      const rows = items.map(it => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(it.modelo || "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${escapeHtml(it.serial || "—")}</td>
        </tr>`).join("");

      const motivoHtml = after.motivo || after.motivo_tipo
        ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;"><b>Motivo:</b> ${escapeHtml([after.motivo_tipo, after.motivo].filter(Boolean).join(" — "))}</p>`
        : "";

      const bodyContent = `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Solicitud de cambio de serial</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
          Recepción solicitó reemplazar los siguientes seriales del contrato
          <b>${escapeHtml(contratoIdVis)}</b> de <b>${escapeHtml(clienteNombre)}</b>.
          Abre la página de seriales para introducir los seriales de reemplazo.
        </p>
        ${motivoHtml}
        <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
          <thead><tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial a reemplazar</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;

      const to = await inventarioEmailTo();
      const cc = await vendedorEmail(contrato.creado_por_uid);
      await db.collection("mail_queue").add({
        to,
        ...(cc ? { cc } : {}),
        subject:   `Cambio de serial solicitado: ${contratoIdVis} – ${clienteNombre}`,
        preheader: `Reemplaza ${items.length} serial(es) del contrato ${contratoIdVis}`,
        bodyContent,
        ctaUrl:    `${APP_BASE_URL}/contratos/seriales.html?id=${encodeURIComponent(cid)}`,
        ctaLabel:  "Reemplazar seriales",
        meta:      { source: "onSerialCambio.alta", contrato_id: contratoIdVis, req_id: reqId },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info("[onSerialCambio] Correo a inventario encolado", { cid, reqId, items: items.length });
      return null;
    }

    // ── Solicitud resuelta → correo a ACTIVACIONES (corrección) ──────────
    const seResolvio = after.estado === "resuelto" && before?.estado !== "resuelto";
    if (seResolvio) {
      const reemplazos = Array.isArray(after.reemplazos) ? after.reemplazos : [];
      if (!reemplazos.length) {
        logger.info("[onSerialCambio] Resuelto sin reemplazos — no se notifica a activaciones", { cid, reqId });
        return null;
      }
      const rows = reemplazos.map(r => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(r.modelo || "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;color:#991b1b;text-decoration:line-through;">${escapeHtml(r.anterior || "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;color:#065f46;font-weight:700;">${escapeHtml(r.nuevo || "—")}</td>
        </tr>`).join("");

      const bodyContent = `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Corrección de seriales</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
          Se corrigieron seriales del contrato <b>${escapeHtml(contratoIdVis)}</b> de
          <b>${escapeHtml(clienteNombre)}</b> (posterior al envío original). Actualiza tus registros:
        </p>
        <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
          <thead><tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial anterior</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial nuevo</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;

      const cc = await vendedorEmail(contrato.creado_por_uid);
      await db.collection("mail_queue").add({
        to: ACTIVACIONES_TO,
        ...(cc ? { cc } : {}),
        subject:   `Corrección de seriales: ${contratoIdVis} – ${clienteNombre}`,
        preheader: `Se corrigieron ${reemplazos.length} serial(es) del contrato ${contratoIdVis}`,
        bodyContent,
        ctaUrl:    `${APP_BASE_URL}/contratos/imprimir-contrato.html?id=${encodeURIComponent(contratoIdVis)}`,
        ctaLabel:  "Ver contrato",
        meta:      { source: "onSerialCambio.resuelto", contrato_id: contratoIdVis, req_id: reqId },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info("[onSerialCambio] Corrección a activaciones encolada", { cid, reqId, reemplazos: reemplazos.length });
      return null;
    }

    return null;
  }
);
