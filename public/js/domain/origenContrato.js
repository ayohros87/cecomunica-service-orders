// ¿De dónde viene este contrato? — regla del vínculo al contrato original.
// Fuente ÚNICA del criterio: lo usan el formulario de contrato nuevo
// (nc-form.js para pintar la exigencia, nc-preview.js para bloquear el guardado
// y nc-guardar.js para derivar `origen_tipo`). Si el criterio cambia, cambia
// solo aquí. Mismo patrón que js/domain/transicionPendiente.js.
//
// POR QUÉ ES OBLIGATORIO (diagnóstico 2026-08-11, caso REEMP20260811-01):
// el enlace nació SUAVE — si el vendedor no marcaba nada quedaba
// `origen_tipo: 'ninguno'` y el contrato no apuntaba a ningún original. Nadie
// lo llenaba: 67 de 74 contratos transicionables no-legacy sin origen, y de
// las 25 renovaciones, CERO. Sin ese vínculo se cae la cadena entera de la
// devolución:
//
//   · onEntregaTransicion corta en `!origenIds.length` — es el único que crea
//     los mapeos de devolución y la orden de recuperación. Contratos con
//     `transicion_auto_at` en toda la base: 0. Nunca corrió.
//   · la pantalla de transición cae a "todos los equipos del cliente", que en
//     REEMP20260811-01 ofrecía 3 radios de contratos ajenos y escondía los 10
//     HYTERA P50 que la observación mandaba reemplazar.
//
// El escape SÍ existe y es explícito: "el contrato original es de papel / no
// está en el sistema". Nadie queda bloqueado — pero la excepción se declara y
// deja rastro (`origen_legacy_ref`), en vez de ser el silencio por defecto.
window.OrigenContrato = {

  // El universo al que la pregunta le aplica: un contrato que renueva,
  // adiciona o reemplaza nació de otro.
  aplica(sel) {
    if (!sel) return false;
    return sel.accion === 'Renovación' || sel.accion === 'Adición'
        || sel.codigo_tipo === 'REEMP';
  },

  // Dónde se EXIGE la respuesta. Renovación y Reemplazo SUSTITUYEN el equipo
  // del original: sin saber cuál es, no hay nada que devolver ni a quién
  // pedírselo. Es el mismo corte que usa onEntregaTransicion para decidir
  // "¿se devuelve el origen?".
  //
  // La Adición queda FUERA a propósito: agrega unidades a un contrato que
  // sigue vigente — el cliente se queda con las de antes Y con las nuevas, así
  // que no genera devolución (2026-08-10: tratarla como renovación abrió
  // órdenes de recuperación falsas en NADCAR y DESARROLLO ACQUA TRES). El
  // vínculo se le sigue ofreciendo porque es contexto útil, pero no se exige.
  //
  // La "renovación sin equipo" SÍ entra: no mueve radios, pero renueva un
  // contrato concreto y el vendedor sabe cuál. Una regla sin excepciones
  // ("¿renuevas o reemplazas? di qué") se sostiene mejor que una con carve-out.
  obligatorio(sel) {
    if (!this.aplica(sel)) return false;
    return sel.accion === 'Renovación' || sel.codigo_tipo === 'REEMP';
  },

  // Valida la selección del formulario.
  // sel = { accion, codigo_tipo, legacy, origen_ids[], legacy_ref, candidatos }
  //   · candidatos = cuántos contratos del cliente ofrece la lista. Si es 0 el
  //     vendedor NO puede elegir ninguno, así que el mensaje tiene que
  //     mandarlo al escape en vez de pedirle lo imposible.
  // Devuelve { ok } o { ok:false, motivo, mensaje, foco }.
  validar(sel) {
    const s = sel || {};
    const ids = Array.isArray(s.origen_ids) ? s.origen_ids.filter(Boolean) : [];

    // El escape declarado exige su referencia: sin ella la excepción no deja
    // rastro y se vuelve un "siguiente" más del formulario.
    if (this.aplica(s) && s.legacy && !String(s.legacy_ref || '').trim()) {
      return {
        ok: false,
        motivo: 'falta_ref_papel',
        foco: 'ref',
        mensaje: 'Escribe la referencia del contrato en papel (número, año…). '
               + 'Sin ella no queda rastro de cuál es el original.',
      };
    }

    if (!this.obligatorio(s) || s.legacy || ids.length) return { ok: true };

    if (!Number(s.candidatos || 0)) {
      return {
        ok: false,
        motivo: 'sin_candidatos',
        foco: 'legacy',
        mensaje: 'Este cliente no tiene contratos vigentes en el sistema. '
               + 'Marca «El contrato original es de papel / no está en el sistema» '
               + 'y anota su referencia.',
      };
    }
    return {
      ok: false,
      motivo: 'falta_origen',
      foco: 'lista',
      mensaje: `Falta indicar a qué contrato ${s.accion === 'Renovación' ? 'renueva' : 'reemplaza'} este. `
             + 'Marca el original en la lista — de ahí salen los equipos que el cliente debe devolver.',
    };
  },

  // Valor de `origen_tipo` que se guarda en el contrato.
  //   ''        → la pregunta no aplica (contrato nuevo, demo…)
  //   'legacy'  → el original es de papel / no está en el sistema
  //   'interno' → apunta a uno o más contratos del sistema
  //   'ninguno' → aplica, se pudo omitir (solo Adición) y se omitió
  tipoDe(sel) {
    const s = sel || {};
    if (!this.aplica(s)) return '';
    if (s.legacy) return 'legacy';
    const ids = Array.isArray(s.origen_ids) ? s.origen_ids.filter(Boolean) : [];
    return ids.length ? 'interno' : 'ninguno';
  },
};
