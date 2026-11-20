// @ts-nocheck
/* =============================================================
   Orden INTERNA: C COMUNICA, S.A. como cliente de sus propias órdenes
   (maquillaje, revisión general, radios para tener en stock).

   No terminan en una entrega: los radios vuelven a bodega. Su cierre es
   "Devolver a bodega" → CERRADA (A BODEGA) (2026-11-20, correo de Solangel).

   Espejo de functions/src/domain/clienteInterno.js y de
   devolverOrdenABodega.motivoRechazo — el callable decide; esto solo evita
   ofrecer un botón que no va a funcionar. Mantener sincronizados.
   ============================================================= */
(function () {
  const ID_POR_DEFECTO = '6yoaiUMRAhhSMtiC4O0S';
  const ROLES_OK = ['administrador', 'recepcion', 'jefe_taller', 'inventario'];
  const VIVOS = ['POR ASIGNAR', 'RECIBIDO EN MOSTRADOR', 'ASIGNADO', 'COMPLETADO (EN OFICINA)'];
  const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

  // empresa/config manda; el literal es el respaldo (convención de
  // EMPRESA_CONFIG: capa de ajuste, nunca una dependencia dura).
  function clienteInternoId() {
    const v = String((window.EMPRESA_CONFIG && window.EMPRESA_CONFIG.cliente_interno_id) || '').trim();
    return v || ID_POR_DEFECTO;
  }
  function esOrdenInterna(orden) {
    return !!(orden && orden.cliente_id) && orden.cliente_id === clienteInternoId();
  }
  // Visita, ENTRADA y DEVOLUCIÓN tienen su propio cierre.
  function tipoAdmite(orden) {
    const t = sinTildes(orden && orden.tipo_de_servicio);
    return !(t.includes('VISITA') || t.includes('ENTRADA') || t.includes('DEVOLUCION')) && !(orden && orden.entrada_inspeccion);
  }
  function admiteDevolverABodega(orden, rol) {
    if (!orden || orden.eliminado === true || !ROLES_OK.includes(rol)) return false;
    if (!esOrdenInterna(orden) || !tipoAdmite(orden)) return false;
    return VIVOS.includes(sinTildes(orden.estado_reparacion || 'POR ASIGNAR'));
  }

  window.OrdenInterna = { clienteInternoId, esOrdenInterna, tipoAdmite, admiteDevolverABodega, VIVOS, ROLES_OK };
})();
