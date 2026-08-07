// ¿A este contrato le falta registrar la TRANSICIÓN de equipos?
// Fuente ÚNICA del predicado — lo usan el CTA "Transición de equipos" de la
// lista de contratos (contratos-list.js) y la bandeja "Pendientes de
// inventario" (js/services/colaInventarioService.js). Si el criterio cambia,
// cambia solo aquí. Mismo patrón que js/domain/ordenProgPendiente.js.
//
// Requiere el doc COMPLETO del contrato: usa `accion`/`codigo_tipo` y el
// contador denormalizado `transicion_mapeos_count` que estampa onMapeoWrite.
window.TransicionPendiente = {

  // Renovación / adición / reemplazo CON equipo físico, sobre un contrato
  // vigente. Es el universo de contratos a los que la transición APLICA;
  // que esté pendiente o no lo decide contratoNecesitaTransicion.
  esTransicionable(data) {
    if (!data) return false;
    if (!['activo', 'aprobado'].includes(data.estado)) return false;
    if (data.renovacion_sin_equipo) return false;
    return data.accion === 'Renovación' || data.accion === 'Adición'
        || data.codigo_tipo === 'REEMP';
  },

  // Pendiente = aplica y no hay NINGÚN mapeo registrado todavía.
  // Corte legacy (mismo criterio que seriales): a los contratos del backfill
  // 'legacy' NO se les exige transición — su intercambio físico ocurrió antes
  // del pool y ya no es reconstruible (auditoría 2026-07-20: 191/206 de la
  // cola eran legacy). La acción sigue disponible en el menú ⋯ de la lista
  // por si se quiere registrar voluntariamente.
  contratoNecesitaTransicion(data) {
    return this.esTransicionable(data)
      && data.seriales_estado !== 'legacy'
      && !Number(data.transicion_mapeos_count || 0);
  },
};
