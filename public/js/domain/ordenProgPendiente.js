// ¿A este contrato ya se le puede (y debe) crear la orden de PROGRAMACIÓN?
// Fuente ÚNICA del predicado — lo usan el CTA "Crear orden" de la lista de
// contratos (contratos-list.js) y el feed "Órdenes por crear" del home
// (home-feed-ordenes.js). Si el criterio cambia, cambia solo aquí.
//
// Requiere el doc COMPLETO del contrato: usa equipos[] y los contadores
// denormalizados que estampan los triggers (seriales_count, os_count, …).
//
// DESCARTE (2026-08-11): a veces la orden NO se va a crear — el cliente la
// atendió otro proveedor, la entrega ya se hizo a mano, el contrato quedó de
// muestra… Sin una salida, esos casos se quedaban en la bandeja para siempre y
// la volvían un listado de cosas que no sirven. Recepción/admin los descarta
// con motivo (`orden_prog_descartada`) y el contrato sale del feed y del CTA.
// El descarte CADUCA si cambian los equipos del contrato — mismo criterio que
// el QC del taller: se descartó ESA foto del contrato, no el contrato para
// siempre. Si mañana le agregan equipo o seriales, vuelve a pedir su orden.
window.OrdenProgPendiente = {

  // Motivos ofrecidos al descartar (feed del home). `otro` obliga a escribir
  // la nota: un descarte sin explicación es un dato perdido.
  MOTIVOS: [
    { codigo: 'ya_creada',    label: 'La orden ya existe (se creó por otra vía)' },
    { codigo: 'entregado',    label: 'El equipo ya se entregó, sin orden' },
    { codigo: 'no_aplica',    label: 'Este contrato no lleva orden de programación' },
    { codigo: 'cliente_paro', label: 'El cliente canceló / paró la instalación' },
    { codigo: 'datos_malos',  label: 'Datos del contrato incorrectos (se corrige aparte)' },
    { codigo: 'otro',         label: 'Otro (explicar)' },
  ],

  motivoLabel(codigo) {
    return (this.MOTIVOS.find(m => m.codigo === codigo) || {}).label || codigo || '—';
  },

  // Evaluación cruda del contrato: ¿está listo para su orden? ¿tiene un
  // descarte vigente encima? Los dos predicados públicos salen de aquí, para
  // que "pendiente" y "descartado" nunca se calculen con criterios distintos.
  evaluar(data) {
    const nada = { listo: false, descartada: false };
    if (!data) return nada;
    if (!['activo', 'aprobado'].includes(data.estado)) return nada;
    // Corte legacy (mismo criterio que seriales): a los contratos del backfill
    // no se les exige orden — su ciclo ocurrió antes de este circuito.
    if (data.seriales_estado === 'legacy') return nada;
    const totalEq   = (data.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    const activosEq = Math.max(0, totalEq - Number(data.baja_cancelado_total || 0));
    const resueltos = Number(data.seriales_count || 0) + Number(data.seriales_omitidos_count || 0);
    const osVinculada = !!(data.os_linked || data.tiene_os || (data.os_count ?? 0) > 0);
    const listo = activosEq > 0 && resueltos >= activosEq
      && !data.entrega_confirmada && !osVinculada;
    if (!listo) return nada;
    return { listo: true, descartada: this._descarteVigente(data, activosEq, resueltos) };
  },

  // El descarte guarda la foto de los equipos al momento de descartar; si esa
  // foto ya no cuadra, caducó y el contrato vuelve a la bandeja. Descartes
  // viejos sin la foto (no debería haberlos) valen siempre.
  _descarteVigente(data, activosEq, resueltos) {
    const d = data.orden_prog_descartada;
    if (!d) return false;
    if (d.equipos_activos != null && Number(d.equipos_activos) !== activosEq) return false;
    if (d.seriales_resueltos != null && Number(d.seriales_resueltos) !== resueltos) return false;
    return true;
  },

  // Listo y sin descartar: lo que la bandeja pide crear y lo que enciende el
  // CTA ámbar de la lista de contratos.
  contratoNecesitaOrden(data) {
    const r = this.evaluar(data);
    return r.listo && !r.descartada;
  },

  // Listo pero descartado a mano: no estorba, pero sigue a la vista bajo
  // "descartadas" para poder reactivarlo si fue un error.
  contratoDescartado(data) {
    const r = this.evaluar(data);
    return r.listo && r.descartada;
  },
};
