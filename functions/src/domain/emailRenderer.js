const fs   = require("fs");
const path = require("path");

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

module.exports = { buildEmailFromBase, buildBodyOrdenCompletada };
