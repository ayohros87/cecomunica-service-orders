// ¿Este contrato tiene equipos pendientes de devolución?
//
// Fuente ÚNICA del predicado — lo usa la columna "Devolución" de la lista de
// contratos (contratos-list.js). Mismo patrón que js/domain/transicionPendiente.js.
//
// El conteo NO se calcula aquí: lo denormaliza onOrdenDevolucionWrite en el
// contrato (devolucion_estado / devolucion_pendientes / devolucion_esperado) a
// partir de la orden de DEVOLUCIÓN, que es la fuente de verdad. Este módulo
// solo decide qué mostrar, incluido el caso que el espejo NO puede cubrir:
// el contrato que debería estar devolviendo pero nunca generó tiquete.
window.DevolucionContrato = {

  // Universo de contratos a los que la devolución APLICA sin que haya tiquete:
  // el contrato MURIÓ (anulado / baja aprobada / terminación total) y por tanto
  // ya no debería tener equipo afuera.
  //
  // Ser origen de una renovación (`renovado_por_ids`) NO entra aquí, aunque
  // suene lógico. Medido contra producción (2026-08-10), la regla fallaba en 5
  // de 6 casos: tres tenían la renovación todavía SIN ENTREGAR —el cliente
  // conserva su equipo con todo derecho hasta que reciba el nuevo— y dos no
  // tenían una sola ficha colgando. El momento en que el origen empieza a deber
  // no es la firma de la renovación, es su ENTREGA, y de eso se encarga
  // onEntregaTransicion: al confirmarse la entrega crea el tiquete (chip real)
  // o marca el origen `no_aplica` verificado contra el pool. Adivinarlo aquí
  // solo producía falsas alarmas.
  enModoDevolucion(data) {
    if (!data) return false;
    return data.estado === 'anulado'
        || data.baja_estado === 'aprobada'
        || !!data.terminacion_total;
  },

  // ¿Hay evidencia de que este contrato llegó a tener equipo físico afuera?
  //
  // Un contrato anulado el mismo día de crearlo —el patrón normal: se capturó
  // mal y se rehízo— nunca asignó seriales ni confirmó entrega. No hay nada que
  // devolver, y marcarlo "sin registro" es una falsa alarma.
  //
  // Medido contra producción (2026-08-07): de 80 anulados sin tiquete, **73 no
  // tenían entrega confirmada NI un solo serial**. Sin este filtro el chip gris
  // habría salido 80 veces para señalar 7 casos reales — y una bandeja que
  // miente 9 de cada 10 veces se deja de mirar en una semana.
  huboEquipo(data) {
    if (!data) return false;
    return Number(data.seriales_count || 0) > 0 || data.entrega_confirmada === true;
  },

  // 'pendiente' | 'completa' | 'cerrada_con_faltantes' | 'no_aplica'
  //            | 'sin_registro' | null (sin chip)
  //
  // 'sin_registro' = el contrato terminó (o fue renovado) teniendo equipo
  // afuera, pero nunca se creó el tiquete: el vínculo de origen no se registró,
  // o la baja es anterior al circuito. Pintarlo 'completa' sería mentir — el
  // sistema no sabe si el cliente devolvió. Ver PLAN_DEVOLUCION_EN_CONTRATOS.md §7.
  estado(data) {
    if (!data) return null;
    if (data.devolucion_estado) return data.devolucion_estado;
    return (this.enModoDevolucion(data) && this.huboEquipo(data)) ? 'sin_registro' : null;
  },

  // Cuántos equipos faltan (0 si no aplica o no se sabe).
  pendientes(data) {
    return Math.max(0, Number((data && data.devolucion_pendientes) || 0));
  },

  esperados(data) {
    return Math.max(0, Number((data && data.devolucion_esperado) || 0));
  },

  // Id de la orden de DEVOLUCIÓN si hay UNA sola (para enlazar el chip).
  // Con varios tiquetes no se elige uno: el enlace llevaría a media verdad.
  ordenUnica(data) {
    const ids = Object.keys((data && data.devolucion_tiquetes) || {});
    return ids.length === 1 ? ids[0] : null;
  },
};
