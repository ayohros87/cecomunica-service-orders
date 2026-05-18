const fs   = require("fs");
const path = require("path");

// HTML escape. Every interpolated value built from user input MUST pass
// through here — receptorNombre, motivo, sinIdMotivo, personaInterna,
// equipo fields, cliente/técnico names are all user-controlled and the
// rendered email is HTML.
function escapeHtml(v) {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailFromBase({ preheader, bodyHtml, ctaUrl, ctaLabel }) {
  const templatePath = path.join(__dirname, "../../templates", "email-base.html");
  let tpl = fs.readFileSync(templatePath, "utf8");

  tpl = tpl
    .replace("{{PREHEADER}}", preheader || "")
    .replace("{{BODY_CONTENT}}", bodyHtml || "")
    .replace(/{{CTA_URL}}/g, ctaUrl || "#")
    .replace(/{{CTA_LABEL}}/g, ctaLabel || "Abrir");

  return tpl;
}

function buildBodyOrdenCompletada(orden) {
  const chip = v => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#eef2ff;border:1px solid #e5e7eb;font:12px Arial,sans-serif;">${v}</span>`;
  const cliente = orden.cliente_nombre || orden.cliente || "—";
  const tecnico = orden.tecnico_nombre || orden.tecnico || "—";
  const costo   = isFinite(+orden.costo_estimado) ? `$${Number(orden.costo_estimado).toFixed(2)}` : "—";
  const equipos = Array.isArray(orden.equipos) ? orden.equipos : [];
  const equiposHtml = equipos.map((e, i) =>
    `<li>${e.serial || e.SERIAL || `Equipo #${i+1}`} ${e.modelo ? `– ${e.modelo}` : ""} ${e.gps ? "· GPS" : ""}</li>`
  ).join("");

  return `
    <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Orden de servicio completada</h2>
    <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
      La orden <b>${orden.orden_id || orden.id || "—"}</b> ha sido marcada como ${chip(orden.estado_reparacion || "COMPLETADO")}.
    </p>
    <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
      <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${cliente}</td></tr>
      <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Técnico</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${tecnico}</td></tr>
      <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Costo estimado</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${costo}</td></tr>
    </table>
    ${equiposHtml ? `<h4 style="margin:0 0 8px;font:600 16px Arial,sans-serif;">Equipos</h4><ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${equiposHtml}</ul>` : ""}
  `;
}

/**
 * Build the HTML body for a "nota de entrega" email.
 *
 * Replaces the legacy frontend builder `_buildEmailHtml` in
 * `public/js/pages/ordenes-flujo.js`. Keeps two branches:
 *  - opts.noRecibido === true → "artículo no recibido" notice
 *  - otherwise → normal delivery with receptor + firma + optional sin-id note
 *
 * @param {object} params
 * @param {object} params.orden       Order snapshot (cliente_nombre, tecnico_asignado, tipo_de_servicio, equipos[])
 * @param {string} params.ordenId
 * @param {object} params.opts        { noRecibido, motivo, personaInterna, receptorNombre, firmaUrl, sinId, sinIdMotivo, fechaISO? }
 * @returns {string} HTML fragment (NOT wrapped in <html>/email-base — call buildEmailFromBase for that)
 */
function buildBodyNotaEntrega({ orden, ordenId, opts }) {
  const f = v => (v == null || v === "") ? "—" : escapeHtml(String(v));
  orden = orden || {};
  opts  = opts  || {};

  const fechaSource = opts.fechaISO ? new Date(opts.fechaISO) : new Date();
  const fecha = fechaSource.toLocaleDateString("es-PA", { day: "2-digit", month: "long", year: "numeric" });

  const equipos = (Array.isArray(orden.equipos) ? orden.equipos : []).filter(e => !e.eliminado);
  const rows = equipos.map(e => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${f(e.nombre)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${f(e.modelo)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">${f(e.numero_de_serie || e.SERIAL || e.serial)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;">${f(e.trabajo_tecnico)}</td>
    </tr>`).join("");

  const equiposTable = equipos.length ? `
    <h3 style="margin:18px 0 8px;font:600 15px Arial,sans-serif;color:#111827;">Equipos</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:13px Arial,sans-serif;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb;">Nombre</th>
          <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb;">Modelo</th>
          <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb;">Serial</th>
          <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb;">Intervención</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>` : "";

  const infoRows = (pairs) => pairs.map(([k, v]) =>
    `<tr><td style="padding:5px 0;border-bottom:1px solid #eee;width:42%;"><strong>${k}</strong></td><td style="padding:5px 0;border-bottom:1px solid #eee;">${v}</td></tr>`
  ).join("");

  if (opts.noRecibido) {
    return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:16px;">
        <strong style="color:#92400e;">&#9888;&#65039; Artículo NO recibido por el cliente</strong>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:14px Arial,sans-serif;margin-bottom:8px;">
        ${infoRows([
          ["Orden", f(ordenId)],
          ["Cliente", f(orden.cliente_nombre)],
          ["Tipo", f(orden.tipo_de_servicio)],
          ["Fecha", escapeHtml(fecha)],
          ["Motivo", f(opts.motivo)],
          ["Responsable interno", f(opts.personaInterna)]
        ])}
      </table>
      ${equiposTable}
    </div>`;
  }

  const sinIdNote = opts.sinId
    ? `<p style="font-size:13px;color:#6b7280;margin:6px 0 0;"><em>* Cliente no proporcionó identificación. Motivo: ${f(opts.sinIdMotivo)}</em></p>`
    : "";
  // firmaUrl gets escaped as text inside the src attr — it's a Storage
  // download URL, but treat as untrusted just in case.
  const firmaImg = opts.firmaUrl
    ? `<div style="margin-top:10px;"><p style="margin:0 0 4px;font-size:13px;color:#6b7280;font-weight:500;">Firma:</p><img src="${escapeHtml(String(opts.firmaUrl))}" alt="Firma" style="max-width:280px;border:1px solid #e5e7eb;border-radius:6px;display:block;"></div>`
    : "";

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:14px Arial,sans-serif;margin-bottom:8px;">
      ${infoRows([
        ["Orden", f(ordenId)],
        ["Cliente", f(orden.cliente_nombre)],
        ["Técnico", f(orden.tecnico_asignado)],
        ["Tipo", f(orden.tipo_de_servicio)],
        ["Fecha de entrega", escapeHtml(fecha)]
      ])}
    </table>
    ${equiposTable}
    <div style="margin-top:18px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;font-weight:600;">Recibido por:</p>
      <p style="margin:0;font-size:16px;font-weight:600;">${f(opts.receptorNombre)}</p>
      ${sinIdNote}
      ${firmaImg}
    </div>
  </div>`;
}

/**
 * Dispatcher: given a queued mail doc with `template` + `data`, returns the full
 * rendered HTML (body + email-base wrapper). Used by `onMailQueued`.
 * Returns `null` if `template` doesn't match a known renderer — the caller
 * should fall back to the legacy `html` / `bodyContent` path.
 */
function renderByTemplate(data) {
  const template = data?.template;
  if (!template) return null;
  const payload = data.data || {};

  switch (template) {
    case "nota_entrega": {
      const bodyHtml = buildBodyNotaEntrega({
        orden:   payload.orden,
        ordenId: payload.ordenId,
        opts:    payload.opts,
      });
      const preheader = payload.opts?.noRecibido
        ? `Artículo NO recibido — Orden ${payload.ordenId}`
        : `Entrega registrada — Orden ${payload.ordenId}`;
      return buildEmailFromBase({
        preheader,
        bodyHtml,
        // No CTA for entrega — the body is informational. Keep the
        // button hidden by routing to the order URL but with a label
        // that makes sense if a client decides to render it anyway.
        ctaUrl:   payload.ctaUrl   || "#",
        ctaLabel: payload.ctaLabel || "Ver orden",
      });
    }
    default:
      return null;
  }
}

module.exports = {
  escapeHtml,
  buildEmailFromBase,
  buildBodyOrdenCompletada,
  buildBodyNotaEntrega,
  renderByTemplate,
};
