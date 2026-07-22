// ¿A este contrato ya se le puede (y debe) crear la orden de PROGRAMACIÓN?
// Fuente ÚNICA del predicado — lo usan el CTA "Crear orden" de la lista de
// contratos (contratos-list.js) y el feed "Órdenes por crear" del home
// (home-feed-ordenes.js). Si el criterio cambia, cambia solo aquí.
//
// Requiere el doc COMPLETO del contrato: usa equipos[] y los contadores
// denormalizados que estampan los triggers (seriales_count, os_count, …).
window.OrdenProgPendiente = {
  contratoNecesitaOrden(data) {
    if (!data) return false;
    if (!['activo', 'aprobado'].includes(data.estado)) return false;
    // Corte legacy (mismo criterio que seriales): a los contratos del backfill
    // no se les exige orden — su ciclo ocurrió antes de este circuito.
    if (data.seriales_estado === 'legacy') return false;
    const totalEq   = (data.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    const activosEq = Math.max(0, totalEq - Number(data.baja_cancelado_total || 0));
    const resueltos = Number(data.seriales_count || 0) + Number(data.seriales_omitidos_count || 0);
    const osVinculada = !!(data.os_linked || data.tiene_os || (data.os_count ?? 0) > 0);
    return activosEq > 0 && resueltos >= activosEq
      && !data.entrega_confirmada && !osVinculada;
  },
};
