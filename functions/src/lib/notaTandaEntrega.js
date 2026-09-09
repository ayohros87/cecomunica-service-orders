// Nota de ENTREGA PARCIAL — el correo que recibe el cliente cuando se lleva
// una tanda de radios y el resto se queda en el taller (2026-09-09).
//
// Flujo: la UI (ordenes-entrega-parcial.js) marca
// entrega.tandas[].envio = {status:'solicitado', to}; onOrdenEntregada reclama
// esa solicitud (solicitado → encolado, en transacción) y encola aquí el
// correo en mail_queue con meta.source 'entrega-parcial'. onMailQueued espeja
// el resultado real del SMTP de vuelta a la tanda (enviado / fallo) para que
// la tarjeta diga la verdad y ofrezca reenviar. Es el mismo circuito del
// acuse de devolución (lib/acuseDevolucion.js), al que espeja a propósito.
//
// El HTML espeja el documento imprimible del frontend (mismo número, mismas
// columnas, misma leyenda). Son dos plantillas a propósito — el correo
// necesita estilos inline; la impresión vive en el navegador — pero el
// CONTENIDO debe decir lo mismo: si cambias la leyenda o las columnas aquí,
// cámbialas también en ordenes-entrega-parcial.js (_docNotaTandaHtml).

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));

// Lo que el cliente firma en el mostrador al llevarse una parte. Dice las dos
// cosas que importan y ninguna que no podamos sostener: qué se llevó hoy, y
// que lo que falta sigue bajo nuestra custodia con la orden abierta.
const LEYENDA_TANDA =
  "Esta nota deja constancia de la entrega de los equipos listados arriba. " +
  "Los equipos que aún no se retiran permanecen en nuestro taller bajo la " +
  "misma orden de servicio, que sigue abierta hasta que se entregue el " +
  "último. La entrega de cada tanda se documenta por separado.";

// Número correlativo de la tanda dentro de la orden: {ordenId}-E{n}. Lo
// estampa OrdenesService.registrarTandaEntrega; si faltara (dato viejo o
// escrito a mano) se deriva de `n`, y en último caso de la posición.
function numeroDeTanda(ordenId, tandas, tanda) {
  if (tanda && tanda.numero) return tanda.numero;
  if (tanda && tanda.n) return `${ordenId}-E${tanda.n}`;
  const idx = (tandas || []).indexOf(tanda);
  return `${ordenId}-E${(idx >= 0 ? idx : (tandas || []).length) + 1}`;
}

function _fechaLegible(at) {
  const d = at && typeof at.toDate === "function" ? at.toDate()
    : at instanceof Date ? at : null;
  if (!d) return "";
  return d.toLocaleString("es-PA", {
    timeZone: "America/Panama", day: "numeric", month: "long",
    year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// Equipos de la orden que NO están en ninguna tanda: lo que el cliente deja
// en el taller. Es la mitad de la información que hace útil esta nota — sin
// ella el cliente no sabe qué le falta por recoger.
function pendientesTrasTanda(orden, hastaTanda) {
  const tandas = Array.isArray(orden && orden.entrega && orden.entrega.tandas)
    ? orden.entrega.tandas : [];
  const corte = tandas.indexOf(hastaTanda);
  const cubiertas = corte >= 0 ? tandas.slice(0, corte + 1) : tandas;
  const fuera = new Set();
  for (const t of cubiertas) {
    for (const u of (Array.isArray(t.equipos) ? t.equipos : [])) {
      if (u && u.id) fuera.add(String(u.id));
      const s = String((u && u.serial) || "").trim().toUpperCase();
      if (s) fuera.add("s:" + s);
    }
  }
  return (Array.isArray(orden.equipos) ? orden.equipos : [])
    .filter(e => e && !e.eliminado)
    .filter(e => {
      if (e.id && fuera.has(String(e.id))) return false;
      const s = String(e.numero_de_serie || e.serial || "").trim().toUpperCase();
      return !(s && fuera.has("s:" + s));
    });
}

const TH = "text-align:left;padding:6px 8px;border-bottom:2px solid #111827;"
  + "font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;";
const TD = "padding:6px 8px;border-bottom:1px solid #eee;";
const TD_MONO = TD + "font-family:monospace;white-space:nowrap;";

function emailNotaTanda(ordenId, orden, tanda) {
  const tandas = (orden.entrega || {}).tandas || [];
  const numero = numeroDeTanda(ordenId, tandas, tanda);
  const equipos = Array.isArray(tanda.equipos) ? tanda.equipos : [];
  const quedan = pendientesTrasTanda(orden, tanda);

  const filas = equipos.map(u => `
    <tr>
      <td style="${TD_MONO}">${escapeHtml(u.serial || "—")}</td>
      <td style="${TD}">${escapeHtml(u.modelo || "—")}</td>
    </tr>`).join("");

  const filasPend = quedan.map(e => `
    <tr>
      <td style="${TD_MONO}">${escapeHtml(e.numero_de_serie || e.serial || "—")}</td>
      <td style="${TD}">${escapeHtml(e.modelo || "—")}</td>
    </tr>`).join("");

  const bloquePendientes = quedan.length ? `
    <p style="margin:20px 0 6px;font:600 14px Arial,sans-serif;color:#111827;">
      Queda${quedan.length === 1 ? "" : "n"} en el taller (${quedan.length})
    </p>
    <table role="presentation" width="100%" style="border-collapse:collapse;font:13px Arial,sans-serif;">
      <thead><tr><th style="${TH}">Serial</th><th style="${TH}">Modelo</th></tr></thead>
      <tbody>${filasPend}</tbody>
    </table>
    <p style="margin:8px 0 0;font:13px/1.5 Arial,sans-serif;color:#6b7280;">
      Te avisamos cuando puedas pasar por ${quedan.length === 1 ? "el que falta" : "los que faltan"}.
    </p>` : `
    <p style="margin:18px 0 0;font:14px/1.6 Arial,sans-serif;">
      Con esta entrega no queda ningún equipo pendiente en el taller.
    </p>`;

  const firmaBloque = tanda.firma_url
    ? `<div style="margin:18px 0 0;">
         <img src="${escapeHtml(tanda.firma_url)}" alt="Firma" style="max-height:70px;max-width:240px;display:block;">
         <div style="border-top:1px solid #9ca3af;max-width:260px;padding-top:4px;font:13px Arial,sans-serif;">
           <b>${escapeHtml(tanda.receptor_nombre || "—")}</b><br>
           ${tanda.receptor_cedula ? `<span style="font-size:11.5px;color:#6b7280;">Cédula ${escapeHtml(tanda.receptor_cedula)}</span><br>` : ""}
           <span style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Recibe — por el cliente</span>
         </div>
       </div>`
    : "";

  const bodyContent = `
    <h2 style="margin:0 0 4px;font:700 22px Arial,sans-serif;color:#111827;">Nota de entrega parcial</h2>
    <p style="margin:0 0 14px;font:13px/1.5 Arial,sans-serif;color:#6b7280;">
      N.º <b style="font-family:monospace;color:#111827;">${escapeHtml(numero)}</b>
      · Orden <b style="font-family:monospace;color:#111827;">${escapeHtml(ordenId)}</b>
      · ${escapeHtml(_fechaLegible(tanda.fecha))}
    </p>
    <p style="margin:0 0 12px;font:14px/1.6 Arial,sans-serif;">
      <b>${escapeHtml(orden.cliente_nombre || "—")}</b> retiró
      ${equipos.length === 1 ? "el siguiente equipo" : `los siguientes <b>${equipos.length}</b> equipos`}
      de la orden de servicio${tanda.receptor_nombre ? `, recibidos por <b>${escapeHtml(tanda.receptor_nombre)}</b>` : ""}:
    </p>
    <table role="presentation" width="100%" style="border-collapse:collapse;font:13px Arial,sans-serif;margin:4px 0 8px;">
      <thead><tr><th style="${TH}">Serial</th><th style="${TH}">Modelo</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    ${bloquePendientes}
    ${tanda.notas ? `<p style="margin:16px 0 0;font:13px/1.6 Arial,sans-serif;"><b>Notas:</b> ${escapeHtml(tanda.notas)}</p>` : ""}
    <p style="margin:16px 0 0;font:italic 12px/1.5 Arial,sans-serif;color:#6b7280;border-left:2px solid #e5e7eb;padding-left:12px;">
      ${escapeHtml(LEYENDA_TANDA)}
    </p>
    ${firmaBloque}
    <p style="margin:18px 0 0;font:12px/1.5 Arial,sans-serif;color:#9ca3af;">
      Esta nota fue generada por el sistema de órdenes de servicio de C Comunica, S.A.
      Guarda este correo como constancia de la entrega.
    </p>`;

  return {
    subject: `Nota de entrega ${numero} — orden ${ordenId}`,
    preheader: quedan.length
      ? `${equipos.length} equipo(s) retirados · ${quedan.length} quedan en el taller`
      : `${equipos.length} equipo(s) retirados`,
    bodyContent,
  };
}

module.exports = { emailNotaTanda, numeroDeTanda, pendientesTrasTanda, LEYENDA_TANDA };
