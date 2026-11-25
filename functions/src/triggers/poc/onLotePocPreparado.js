const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../../lib/admin");
const { escapeHtml } = require("../../domain/emailRenderer");
const { APP_BASE_URL } = require("../../lib/inventario");
const { recepcionEmails } = require("../../lib/mailRecipients");
const { tramitesDelCliente, lineaContrato } = require("../../domain/lotePocAviso");

// Aviso "Lote PoC por cargar" a recepción (2026-11-25, Brenda). Antes lo
// encolaba el navegador del vendedor hacia mail_orden_creada_to (vacío →
// tecnico@) y a recepción no le llegaba. Ver domain/lotePocAviso.js.
//
// Un envío grande se parte en varios docs (parte i de n) con el mismo
// envio_id: sale UN correo, desde la parte 1, con el enlace de cada parte.
module.exports = onDocumentCreated(
  { document: "poc_lotes_preparados/{loteId}", region: "us-central1" },
  async (event) => {
    const lote = event.data?.data();
    if (!lote || lote.estado !== "pendiente") return null;
    if (Number(lote.parte || 1) !== 1) return null;
    const loteId = event.params.loteId;

    try {
      let partes = [{ id: loteId, ...lote }];
      if (Number(lote.partes || 1) > 1 && lote.envio_id) {
        const s = await db.collection("poc_lotes_preparados").where("envio_id", "==", lote.envio_id).get();
        partes = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.parte || 0) - (b.parte || 0));
      }
      const total = partes.reduce((n, p) => n + Number(p.total || (p.filas || []).length || 0), 0);

      let tramites = [];
      if (lote.cliente_id) {
        const [cs, gs] = await Promise.all([
          db.collection("contratos").where("cliente_id", "==", lote.cliente_id).get(),
          db.collection("gestiones").where("cliente_id", "==", lote.cliente_id).get(),
        ]);
        tramites = tramitesDelCliente(
          cs.docs.map(d => ({ id: d.id, ...d.data() })),
          gs.docs.map(d => ({ id: d.id, ...d.data() })),
        );
      }

      const to = await recepcionEmails();
      if (!to.length) {
        logger.warn("[onLotePocPreparado] sin destinatarios de recepción; no se envía", { loteId });
        return null;
      }

      const vendedor = lote.creado_por_nombre || lote.creado_por_email || "Ventas";
      const cliente = lote.cliente_nombre || "sin cliente";
      const codigos = partes.map(p => `#${p.codigo || p.id.slice(0, 6).toUpperCase()}`).join(", ");
      const contrato = lineaContrato(tramites);
      const varias = partes.length > 1;
      const enlaces = partes.map(p => ({
        url: `${APP_BASE_URL}/POC/nuevo-batch.html?lote=${encodeURIComponent(p.id)}`,
        label: varias ? `Cargar parte ${p.parte} de ${p.partes} (${p.total} equipos)` : "Cargar el lote en Nuevo lote",
      }));

      const fila = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:4px 0;"><b>${v}</b></td></tr>`;
      const bodyContent = `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Lote PoC por cargar</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">${escapeHtml(vendedor)} envió una programación de equipos PoC. Está esperando en <b>Nuevo lote de equipos PoC</b>.</p>
        <table role="presentation" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:0 0 12px;">
          ${fila("Vendedor", escapeHtml(vendedor))}
          ${fila("Cliente", escapeHtml(cliente))}
          ${fila("Contrato", escapeHtml(contrato))}
          ${fila("Equipos", String(total))}
          ${fila("Lote", escapeHtml(codigos))}
          ${lote.notas ? fila("Notas", escapeHtml(lote.notas)) : ""}
        </table>
        <ul style="margin:0;padding-left:18px;font:14px/1.6 Arial,sans-serif;">
          ${enlaces.map(e => `<li><a href="${e.url}">${escapeHtml(e.label)}</a></li>`).join("")}
        </ul>`;

      const text = [
        `${vendedor} envió una programación de equipos PoC para cargar.`,
        "",
        `Vendedor: ${vendedor}`,
        `Cliente: ${cliente}`,
        `Contrato: ${contrato}`,
        `Equipos: ${total}`,
        `Lote: ${codigos}`,
        ...(lote.notas ? [`Notas: ${lote.notas}`] : []),
        "",
        ...enlaces.map(e => `${e.label}: ${e.url}`),
      ].join("\n");

      await db.collection("mail_queue").add({
        to: to[0],
        cc: to.length > 1 ? to.slice(1).join(",") : null,
        subject: `Lote PoC por cargar – ${cliente} (${total} equipos) · enviado por ${vendedor}`,
        preheader: `Contrato: ${contrato}`,
        bodyContent,
        text,
        meta: {
          created_at: FieldValue.serverTimestamp(),
          source: "poc_lote_preparado",
          lote_ids: partes.map(p => p.id),
          envio_id: lote.envio_id || null,
        },
        status: "queued",
      });
      return null;
    } catch (e) {
      logger.error("[onLotePocPreparado] no se pudo avisar a recepción", { loteId, message: e.message });
      return null;
    }
  }
);
