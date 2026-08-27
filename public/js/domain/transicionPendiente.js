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
  //
  // Dos exenciones, y las dos por la misma razón de fondo: el equipo anterior
  // no existe como ficha en el pool, así que la pantalla de transición no
  // tendría un solo saliente que ofrecer. Pedir el paso ahí es pedir papeleo.
  //
  //   · seriales_estado 'legacy' — contratos del backfill: su intercambio
  //     físico ocurrió antes del pool y ya no es reconstruible (auditoría
  //     2026-07-20: 191/206 de la cola eran legacy).
  //   · origen_tipo 'legacy' — el vendedor MARCÓ en el formulario "el contrato
  //     original es de papel / no está en el sistema" (nc-guardar.js). El
  //     formulario hacía la pregunta y el predicado ignoraba la respuesta:
  //     10 contratos quedaban pidiendo para siempre un paso imposible
  //     (diagnóstico 2026-08-07).
  //
  // La acción sigue disponible en el menú ⋯ de la lista por si se quiere
  // registrar voluntariamente.
  contratoNecesitaTransicion(data) {
    if (!this.esTransicionable(data)) return false;
    if (Number(data.transicion_mapeos_count || 0)) return false;
    // Un auto-reclamo FRENADO gana sobre las dos exenciones: el trigger ya
    // intentó abrir la devolución y no pudo justificarla
    // (functions/src/lib/transicionAuto.js). Ahí sí hay algo concreto que
    // resolver —confirmar el origen o quitarlo— y si el CTA no aparece, la
    // marca queda enterrada en el documento y nadie se entera.
    if (data.transicion_auto_bloqueada) return true;
    return data.seriales_estado !== 'legacy' && data.origen_tipo !== 'legacy';
  },
};
