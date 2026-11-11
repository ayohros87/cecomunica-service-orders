// Escalación semanal de órdenes listas que el cliente no retira (propuesta de
// la jefa de taller, 2026-10-22; decisión de Alberto, 2026-11-11).
//
//   · Sin correo al cliente: el VENDEDOR es quien lo persigue. Va en copia; el
//     destinatario es el taller más lo que diga empresa/config.email_retiro_escalacion.
//   · Solo lo completado DESDE `retiro_escalacion_desde`. El atraso anterior
//     (74 órdenes con más de 15 días el 2026-11-11, la mayoría ya entregadas
//     sin marcar) se limpia aparte y sigue bajo el corte de 30 días "por
//     depurar" del home. Sin esta fecha el primer correo habría sido justo la
//     lista mezclada que no queríamos mandar.
//   · El umbral (`retiro_escalacion_dias`, 15) es el mismo que pinta ámbar el
//     chip de la bandeja (public/js/pages/ordenes-render.js edadChip).
//
// Lo puro vive aquí para probarlo sin Firestore (test/escalacionRetiro.test.js)
// y para previsualizar el correo (scripts/preview-escalacion-retiro.js).
const PEND = require("../domain/pendientes");

const MAX_FILAS = 30;

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtFecha(ts) {
  const d = PEND.aDate(ts);
  return d ? d.toLocaleDateString("es-PA", { timeZone: "America/Panama" }) : "";
}

function leerConfig(cfg) {
  const dias = Number(cfg.retiro_escalacion_dias);
  const desde = PEND.aDate(cfg.retiro_escalacion_desde);
  const extra = Array.isArray(cfg.email_retiro_escalacion) ? cfg.email_retiro_escalacion.join(",") : String(cfg.email_retiro_escalacion || "");
  return {
    dias: Number.isFinite(dias) && dias >= 1 ? dias : PEND.DEFAULTS.retiro_dias,
    desde,
    extra: extra.trim(),
  };
}

// Lunes en Panamá.
function esDiaDeEnvio(now) {
  return new Date((PEND.aDate(now) || new Date()).toLocaleString("en-US", { timeZone: "America/Panama" })).getDay() === 1;
}

function esEscalable(orden, now, { dias, desde }) {
  if (!PEND.esListaParaEntregar(orden, now, dias)) return false;
  if (PEND.estaPospuesto(orden, now)) return false;
  if (desde) {
    const fc = PEND.aDate(orden.fecha_completado);
    if (!fc || fc < desde) return false;
  }
  return true;
}

function fila(id, o, now) {
  const seg = o.seguimiento_retiro || {};
  return {
    id,
    orden: o.numero_orden || id,
    cliente: o.cliente_nombre || o.cliente || "—",
    tipo: o.tipo_de_servicio || "—",
    vendedor_uid: o.vendedor_asignado ? String(o.vendedor_asignado) : "",
    vendedor: "",
    dias: Math.floor(PEND.edadDias(o.fecha_completado, now) || 0),
    nota_impresa: fmtFecha(o.nota_entrega_impresa && o.nota_entrega_impresa.at),
    seguimiento: seg.nota || "",
    seguimiento_meta: seg.nota ? `${(seg.por_email || "").split("@")[0]} ${fmtFecha(seg.at)}`.trim() : "",
  };
}

function armarCorreo(filas, dias, appBaseUrl) {
  const orden = filas.slice().sort((a, b) => b.dias - a.dias);
  const th = ["Orden", "Cliente", "Tipo", "Vendedor", "Días", "Nota impresa", "Último seguimiento"]
    .map(h => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">${h}</th>`).join("");
  const trs = orden.slice(0, MAX_FILAS).map(f => [
    `<a href="${appBaseUrl}/ordenes/index.html?ids=${encodeURIComponent(f.id)}">${esc(f.orden)}</a>`,
    esc(f.cliente), esc(f.tipo), esc(f.vendedor), `<b>${f.dias}</b>`,
    f.nota_impresa ? `<b>sí</b> (${esc(f.nota_impresa)})` : "—",
    f.seguimiento ? `${esc(f.seguimiento)} <span style="color:#6b7280;">· ${esc(f.seguimiento_meta)}</span>` : '<span style="color:#9ca3af;">sin nota</span>',
  ]).map(cols => `<tr>${cols.map(c => `<td style="padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top;">${c}</td>`).join("")}</tr>`).join("");
  const extra = orden.length > MAX_FILAS
    ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${orden.length - MAX_FILAS} más.</p>` : "";
  const ids = orden.slice(0, MAX_FILAS).map(f => f.id).join(",");
  return {
    subject: `Sin retirar: ${orden.length} orden(es) listas hace ${dias}+ días`,
    preheader: `${orden.length} órdenes terminadas que el cliente no ha retirado — vendedor en copia`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Órdenes listas que el cliente no retira</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Trabajo <b>terminado</b> y control de calidad <b>aprobado</b> hace <b>${dias} días o más</b>, y el equipo sigue en la oficina.
        El <b>vendedor de cada cuenta va en copia</b>: es quien llama al cliente.
        Si la nota de entrega ya se imprimió, lo más probable es que el cliente ya se llevó los radios y solo falte registrar la entrega.
      </p>
      <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
        <thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
      ${extra}
      <p style="margin:12px 0 0;font:13px/1.5 Arial,sans-serif;color:#6b7280;">
        En la bandeja, cada fila tiene en el menú ⋯ <b>Anotar seguimiento de retiro</b> (lo que se habló con el cliente),
        <b>Entregar</b> y, pasados 30 días, <b>Casos viejos</b> para cerrarla si no van a retirar.
      </p>`,
    ctaUrl: `${appBaseUrl}/ordenes/index.html${ids ? "?ids=" + encodeURIComponent(ids) : ""}`,
    ctaLabel: "Ver estas órdenes",
  };
}

module.exports = { leerConfig, esDiaDeEnvio, esEscalable, fila, armarCorreo, MAX_FILAS };
