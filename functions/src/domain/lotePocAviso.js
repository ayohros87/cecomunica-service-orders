// Aviso a recepción cuando ventas envía un lote PoC (2026-11-25, Brenda).
//
// El vendedor prepara la programación en POC/vendedores-batch y la "envía a
// recepción" (poc_lotes_preparados). Hasta hoy el correo lo armaba el
// navegador del vendedor y salía a empresa/config.mail_orden_creada_to — que
// está vacío, así que caía al respaldo tecnico@: recepción nunca lo recibía
// y solo se enteraba al abrir "Nuevo lote". Ahora lo manda el servidor a
// email_recepcion, con lo que Brenda pidió: vendedor, cliente y contrato.
//
// El lote no trae contrato (el vendedor a veces programa ANTES de que el
// contrato exista), así que aquí se buscan los contratos y gestiones del
// cliente que siguen en trámite. Si no hay ninguno se dice tal cual — es
// justamente la señal de que la programación llegó antes que el contrato.

const GESTIONES_ABIERTAS = ["pendiente_aprobacion", "pendiente_cliente", "pendiente_firma",
  "pendiente_bodega", "en_proceso", "en_demo", "retorno"];

const TIPO_GESTION = {
  reemplazo: "Reemplazo", demo: "Demo", baja: "Baja de equipos", aumento: "Aumento de equipos",
  devolucion: "Devolución", cambio_serial: "Cambio de serial",
};

const ESTADO_CONTRATO = {
  pendiente_aprobacion: "pendiente de aprobación",
  aprobado: "aprobado, por entregar",
};

// Contrato que todavía no se entregó: el que espera aprobación o el aprobado
// con circuito de seriales vivo y sin entrega confirmada. El histórico
// 'aprobado' (seriales 'legacy' o sin circuito) es contrato operando, no
// trámite: no se lista.
function contratoEnTramite(c) {
  if (!c || c.deleted === true) return false;
  if (c.estado === "pendiente_aprobacion") return true;
  if (c.estado !== "aprobado") return false;
  if (!c.seriales_estado || c.seriales_estado === "legacy") return false;
  return c.entrega_confirmada !== true;
}

function gestionEnTramite(g) {
  if (!g || g.deleted === true) return false;
  if (g.dormido === true && g.estado === "pendiente_firma") return false;
  return GESTIONES_ABIERTAS.includes(g.estado);
}

const ms = (t) => (t && typeof t.toMillis === "function") ? t.toMillis()
  : (t instanceof Date ? t.getTime() : (Number(t) || 0));

/**
 * Referencias en trámite del cliente, las más recientes primero.
 * @param {Array<{id, ...}>} contratos
 * @param {Array<{id, ...}>} gestiones
 * @returns {Array<{codigo, detalle}>}
 */
function tramitesDelCliente(contratos = [], gestiones = [], max = 4) {
  const cs = contratos.filter(contratoEnTramite)
    .sort((a, b) => ms(b.fecha_creacion || b.created_at) - ms(a.fecha_creacion || a.created_at))
    .map(c => ({
      codigo: c.contrato_id || c.id,
      detalle: `contrato ${ESTADO_CONTRATO[c.estado] || c.estado}`,
    }));
  const gs = gestiones.filter(gestionEnTramite)
    .sort((a, b) => ms(b.creado_at || b.created_at) - ms(a.creado_at || a.created_at))
    .map(g => ({
      codigo: g.id,
      detalle: `${(TIPO_GESTION[g.tipo] || "gestión").toLowerCase()}${g.contrato_id ? ` del contrato ${g.contrato_id}` : ""}`,
    }));
  return [...cs, ...gs].slice(0, max);
}

/** Texto de la línea "Contrato" del correo. */
function lineaContrato(tramites) {
  if (!tramites.length) return "Sin contrato ni gestión en trámite todavía";
  return tramites.map(t => `${t.codigo} (${t.detalle})`).join(" · ");
}

module.exports = { contratoEnTramite, gestionEnTramite, tramitesDelCliente, lineaContrato };
