// Acuse de recibo de devolución — el correo que recibe el CLIENTE cuando
// recepción envía la copia de un acuse firmado (2026-09-01).
//
// Flujo: la UI (ordenes-devolucion.js) marca devolucion.acuses[].envio con
// status 'solicitado' y el destinatario; onOrdenDevolucionWrite reclama esa
// solicitud (solicitado → encolado, transacción) y encola aquí el correo en
// mail_queue con meta.source 'acuse-devolucion'. onMailQueued espeja el
// resultado real del SMTP de vuelta al acuse (enviado / fallo) para que la
// tarjeta del acuse diga la verdad y ofrezca reenviar.
//
// El HTML espeja el documento imprimible del frontend (misma estructura:
// número, unidades con accesorios/daño, leyenda legal, firma). Son dos
// plantillas a propósito — el correo necesita estilos inline y tabla simple;
// la impresión vive en el navegador — pero el CONTENIDO debe decir lo mismo:
// si cambias la leyenda o las columnas aquí, cámbialas también en
// ordenes-devolucion.js (_docAcuseHtml).

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));

// Espeja ACCESORIOS de ordenes-devolucion.js (checklist del check-in).
const ACC_LABELS = {
  bateria: "Batería", antena: "Antena", clip: "Clip",
  cargador: "Cargador", fuente: "Fuente", cubrepolvo: "Cubrepolvo",
};

// Misma leyenda que firma el cliente en el mostrador (bloqueAcuse de la UI).
const LEYENDA_ACUSE =
  "Los equipos listados ingresan al taller para su revisión técnica. " +
  "Cualquier daño identificado como causado por mal uso, así como los " +
  "accesorios o equipos no devueltos, serán notificados oportunamente " +
  "mediante cotización para su posterior facturación. Este acuse deja " +
  "constancia de la entrega física; no constituye la inspección técnica final.";

// Número correlativo del acuse dentro de la orden: {ordenId}-A{n}. Los acuses
// firmados antes de este cambio no traen `numero` — se deriva de la posición
// en el array, que es estable porque las reglas lo hacen append-only.
function numeroDeAcuse(ordenId, acuses, acuse) {
  if (acuse && acuse.numero) return acuse.numero;
  const idx = (acuses || []).findIndex(a => a && a.id === acuse.id);
  return `${ordenId}-A${(idx >= 0 ? idx : (acuses || []).length) + 1}`;
}

function _resumenAccesorios(acc) {
  if (!acc) return "—";
  const keys = Object.keys(ACC_LABELS);
  const con = keys.filter(k => acc[k]).map(k => ACC_LABELS[k]);
  if (con.length === keys.length) return "Completo";
  return con.length ? con.join(", ") : "Ninguno";
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

/**
 * Payload del correo del acuse (subject/preheader/bodyContent) listo para
 * mail_queue — onMailQueued lo envuelve con la base de marca.
 * @param {string} ordenId
 * @param {object} orden  doc de la orden (cliente_nombre, contrato, devolucion)
 * @param {object} acuse  entrada de devolucion.acuses[]
 */
function emailAcuse(ordenId, orden, acuse) {
  const dev = orden.devolucion || {};
  const numero = numeroDeAcuse(ordenId, dev.acuses || [], acuse);
  const contratoId = dev.origen?.ref_papel || orden.contrato?.contrato_id || null;
  const unidades = Array.isArray(acuse.unidades) && acuse.unidades.length
    ? acuse.unidades
    : (acuse.seriales || []).map(s => ({ serial: s }));

  const filas = unidades.map(u => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;white-space:nowrap;">${escapeHtml(u.serial || "—")}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(u.modelo || "—")}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(_resumenAccesorios(u.accesorios))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(u.dano_visible || "—")}</td>
    </tr>`).join("");

  const firmaBloque = acuse.sin_firma
    ? `<p style="margin:14px 0 0;font:12.5px/1.5 Arial,sans-serif;color:#6b7280;">
         Registrado sin firma del cliente${acuse.sin_firma_motivo ? `: ${escapeHtml(acuse.sin_firma_motivo)}` : ""}.
       </p>`
    : `<div style="margin:16px 0 0;">
         ${acuse.firma_url ? `<img src="${escapeHtml(acuse.firma_url)}" alt="Firma" style="max-height:70px;max-width:240px;display:block;">` : ""}
         <div style="border-top:1px solid #9ca3af;max-width:260px;padding-top:4px;font:13px Arial,sans-serif;">
           <b>${escapeHtml(acuse.nombre_entrega || "—")}</b><br>
           <span style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Entrega — por el cliente</span>
         </div>
       </div>`;

  const bodyContent = `
    <h2 style="margin:0 0 4px;font:700 22px Arial,sans-serif;color:#111827;">Acuse de recibo de equipos</h2>
    <p style="margin:0 0 14px;font:13px/1.5 Arial,sans-serif;color:#6b7280;">
      N.º <b style="font-family:monospace;color:#111827;">${escapeHtml(numero)}</b> · ${escapeHtml(_fechaLegible(acuse.at))}
    </p>
    <p style="margin:0 0 12px;font:14px/1.6 Arial,sans-serif;">
      Recibimos de <b>${escapeHtml(orden.cliente_nombre || "—")}</b>${contratoId ? ` (contrato <b>${escapeHtml(contratoId)}</b>)` : ""}
      ${unidades.length === 1 ? "el siguiente equipo" : `los siguientes <b>${unidades.length}</b> equipos`}
      en devolución, tal como quedaron registrados al momento de la entrega:
    </p>
    <table role="presentation" width="100%" style="border-collapse:collapse;font:13px Arial,sans-serif;margin:4px 0 8px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;">Serial</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;">Modelo</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;">Accesorios entregados</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #111827;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;">Daño visible</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <p style="margin:12px 0 0;font:italic 12px/1.5 Arial,sans-serif;color:#6b7280;border-left:2px solid #e5e7eb;padding-left:12px;">
      ${escapeHtml(LEYENDA_ACUSE)}
    </p>
    ${firmaBloque}
    <p style="margin:18px 0 0;font:12px/1.5 Arial,sans-serif;color:#9ca3af;">
      Este acuse fue generado por el sistema de órdenes de servicio de C Comunica, S.A.
      Guarda este correo como constancia de la entrega.
    </p>`;

  return {
    subject: `Acuse de recibo ${numero} — devolución de equipos`,
    preheader: `${unidades.length} equipo(s) recibidos · ${orden.cliente_nombre || ""}`,
    bodyContent,
  };
}

module.exports = { emailAcuse, numeroDeAcuse, LEYENDA_ACUSE, ACC_LABELS };
