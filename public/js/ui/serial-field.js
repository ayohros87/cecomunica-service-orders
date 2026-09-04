// SerialField — decorador ÚNICO para campos de serial en todo el sistema.
// Auditoría 2026-07-24: había 8 comportamientos distintos para el mismo acto
// de teclear un serial (toast pasajero, confirm al guardar, o nada). Este
// componente deja un chip PERSISTENTE junto al input con el estado del serial
// en el pool, con la misma paleta .eqpool-chip de todas las páginas.
//
// Estados del chip:
//   · (vacío/inválido)        → sin chip
//   · sin registro            → chip punteado neutro (se creará al guardar)
//   · 1 ficha                 → chip de estado (+ modelo), y avisos apilados:
//       - "otro cliente" si la asignación no coincide con opts.clienteId()
//       - "modelo distinto" si el pool trae otro modelo que opts.modelo()
//   · 2+ fichas (compartido)  → chip de conflicto; click abre el selector
// Y por encima de todos, independiente del pool:
//   · descartado en QC        → chip de alerta "EQUIPO DESCARTADO — no utilizar"
//     (equipos_descartados). Sale ANTES que cualquier otro chip y también
//     cuando el serial no tiene ficha en el pool, que es justo el caso de un
//     equipo descartado que alguien intenta reingresar a bodega.
//   · con condición particular → chip amarillo "⚠ condición: …" (equipos_condiciones).
//     El radio sirve, pero arrastra una limitación que hay que tener en cuenta
//     antes de asignarlo o de volver a diagnosticarlo (petición Solangel).
// Click en cualquier chip → EquipoFicha.abrir(serial) (si está cargada).
//
// API:
//   SerialField.adjuntar(inputEl, opts?)
//     opts.clienteId : () => string|null   — para detectar "otro cliente"
//     opts.modelo    : () => ({modelo_id, modelo_label})|null — para detectar
//                      desacuerdo de modelo con la ficha del pool
//     opts.onInfo    : (info) => {}        — {docs, unidad|null, descartado|null, condicion|null}
//                      tras cada lookup (p.ej. autocompletar el modelo del
//                      formulario, o bloquear el guardado si viene descartado).
//                      `descartado` = doc de equipos_descartados vigente o null.
//                      `condicion`  = doc de equipos_condiciones vigente o null.
//     opts.slot      : Element             — dónde inyectar el chip (default:
//                      un <span> insertado justo después del input)
// Dependencias: EquiposPoolService; EquiposDescartadosService,
// EquiposCondicionesService y EquipoFicha opcionales (si no están cargados, el
// chip correspondiente simplemente no sale).
window.SerialField = {

  _cache: new Map(), // norm → {docs, at}
  _TTL_MS: 60 * 1000,

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[m]));
  },

  async _lookup(norm) {
    const hit = this._cache.get(norm);
    if (hit && Date.now() - hit.at < this._TTL_MS) return hit.docs;
    const docs = await EquiposPoolService.findBySerial(norm);
    this._cache.set(norm, { docs, at: Date.now() });
    return docs;
  },

  invalidar(serial) {
    this._cache.delete(EquiposPoolService.normalizarSerial(serial));
  },

  adjuntar(input, opts = {}) {
    if (!input || input._sfAdjuntado) return;
    input._sfAdjuntado = true;

    let slot = opts.slot;
    if (!slot) {
      slot = document.createElement('span');
      slot.className = 'sf-slot';
      slot.style.cssText = 'display:inline-flex; flex-wrap:wrap; gap:4px; margin-left:6px; vertical-align:middle;';
      input.insertAdjacentElement('afterend', slot);
    }

    const refrescar = async () => {
      const raw = (input.value || '').trim();
      const norm = EquiposPoolService.normalizarSerial(raw);
      slot.innerHTML = '';
      if (!norm || !EquiposPoolService.esSerialValido(norm)) {
        // Texto que no es un serial (sin un solo dígito): el campo se usa de
        // cajón de sastre para consolas, GPS, cargadores, celulares del
        // cliente… Eso ya no entra al inventario por serial, así que se avisa
        // en vez de callar — si no, el equipo desaparece sin explicación.
        if (norm.length >= 3 && !/\d/.test(norm)) {
          const hint = document.createElement('span');
          hint.className = 'eqpool-chip eqpool-chip-vacio';
          hint.title = 'Un serial lleva al menos un número. Este texto no se registra en el inventario por serial (sí queda en la orden o el contrato).';
          hint.textContent = 'no es un serial';
          slot.appendChild(hint);
        }
        slot._sfNorm = null;
        if (opts.onInfo) opts.onInfo({ docs: [], unidad: null, descartado: null, condicion: null });
        return;
      }
      // Evita re-consultar si el usuario solo pasó el foco sin cambiar nada.
      if (slot._sfNorm === norm && slot.childElementCount) return;
      slot._sfNorm = norm;

      let docs = [];
      // El descarte se consulta EN PARALELO y antes de cualquier salida
      // temprana: un serial descartado tiene que avisar aunque no tenga ficha
      // en el pool (equipo del cliente que nunca entró a bodega) o aunque
      // tenga varias (colisión de modelos). Es la alerta más importante del
      // campo — el equipo ya se declaró inservible en control de calidad.
      let descartado = null;
      let condicion = null;
      try {
        const [d, desc, cond] = await Promise.all([
          this._lookup(norm),
          typeof EquiposDescartadosService !== 'undefined'
            ? EquiposDescartadosService.buscar(norm)
            : Promise.resolve(null),
          typeof EquiposCondicionesService !== 'undefined'
            ? EquiposCondicionesService.buscar(norm)
            : Promise.resolve(null),
        ]);
        docs = d; descartado = desc; condicion = cond;
      } catch (e) { return; }
      if (EquiposPoolService.normalizarSerial(input.value) !== norm) return; // cambió mientras consultaba
      slot.innerHTML = '';

      const esc = this._esc.bind(this);
      // El segundo argumento es una CLASE de la familia .eqpool-chip-* (viven en
      // ceco-ui.css). Antes era un `style` inline por llamada y ya había derivado
      // respecto a los mismos avisos en ordenes-render.js.
      const chip = (html, extraClass, title) => {
        const a = document.createElement('a');
        a.className = `eqpool-chip${extraClass ? ' ' + extraClass : ''}`;
        a.style.cssText = 'text-decoration:none; cursor:pointer;';
        if (title) a.title = title;
        a.innerHTML = html;
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (window.EquipoFicha) EquipoFicha.abrir(raw);
        });
        slot.appendChild(a);
        return a;
      };

      // Alerta de descarte — SIEMPRE primero y fuera de las salidas tempranas
      // de abajo. Si control de calidad declaró la unidad inservible, eso pesa
      // más que su estado en el pool: reingresarla a bodega o montarla en una
      // orden es exactamente lo que hay que evitar.
      if (descartado) {
        const cuando = descartado.descartado_at?.toDate
          ? descartado.descartado_at.toDate().toLocaleDateString('es-PA') : '';
        const detalle = [
          descartado.motivo ? `Motivo: ${descartado.motivo}` : '',
          descartado.orden_id ? `Orden ${descartado.orden_id}` : '',
          descartado.por_email || '',
          cuando,
        ].filter(Boolean).join(' · ');
        chip('⛔ EQUIPO DESCARTADO — no utilizar', 'eqpool-chip-alerta',
          `Control de calidad descartó esta unidad${detalle ? '. ' + detalle : ''}. No debe entregarse ni volver a inventario.`);
      }

      // Condición particular — también fuera de las salidas tempranas: el
      // radio sirve, pero con una limitación que hay que saber ANTES de
      // asignarlo a un cliente que sí necesite esa función, o de volver a
      // diagnosticarlo en taller. Amarillo, no rojo: no prohíbe, advierte.
      if (condicion) {
        const cuando = condicion.registrado_at?.toDate
          ? condicion.registrado_at.toDate().toLocaleDateString('es-PA') : '';
        const detalle = [
          condicion.orden_id ? `Orden ${condicion.orden_id}` : '',
          condicion.por_email || '',
          cuando,
        ].filter(Boolean).join(' · ');
        const corto = typeof EquiposCondicionesService !== 'undefined'
          ? EquiposCondicionesService.resumen(condicion.condicion, 48) : String(condicion.condicion || '');
        chip(`⚠ condición: ${esc(corto)}`, 'eqpool-chip-aviso',
          `Funciona, pero con una condición particular: ${condicion.condicion || ''}${detalle ? ' (' + detalle + ')' : ''}. Tenlo en cuenta antes de asignarlo o de diagnosticarlo de nuevo.`);
      }

      if (!docs.length) {
        chip('sin registro en el pool', 'eqpool-chip-vacio',
          'Este serial no existe en el pool — se dará de alta automáticamente al guardar. Verifica que esté bien escrito.');
        if (opts.onInfo) opts.onInfo({ docs, unidad: null, descartado, condicion });
        return;
      }

      if (docs.length > 1) {
        // "2+ modelos" = el mismo nombre que usa la fila de Inventario, la
        // ficha del equipo y la pestaña Conflictos (auditoría 2026-08-04, A4).
        // Elegir toca en los dos casos; lo que cambia es si además hay algo que
        // resolver — si ya se confirmó que son radios distintos, no lo hay.
        const confirmado = docs.every(d => d.conflicto_revisado === true);
        chip(`⚠ 2+ modelos (${docs.length} fichas) — elegir`, 'eqpool-chip-alerta',
          confirmado
            ? 'Confirmado: son radios físicos distintos que comparten numeración (típico Kenwood NX-420 / NX-920). Click para elegir el modelo correcto.'
            : 'Este serial existe en más de una ficha, con modelos distintos. Click para ver y elegir; se resuelve en Inventario · pestaña Conflictos.');
        if (opts.onInfo) opts.onInfo({ docs, unidad: null, descartado, condicion });
        return;
      }

      const u = docs[0];
      const label = EquiposPoolService.ESTADO_LABELS[u.estado] || u.estado || '—';
      const modeloCorto = (u.modelo_label || '').trim();
      const est = chip(
        `${esc(label)}${modeloCorto ? ` · ${esc(modeloCorto)}` : ''}`,
        '', 'Estado en el pool — click para ver la ficha del equipo');
      est.classList.add(`eqpool-chip-${EquiposPoolService.ESTADO_LABELS[u.estado] ? u.estado : 'desconocido'}`);

      const clienteId = typeof opts.clienteId === 'function' ? (opts.clienteId() || '') : '';
      const clientePool = u.asignacion?.cliente_id || '';
      if (clientePool && clienteId && clientePool !== clienteId) {
        chip('⚠ otro cliente', 'eqpool-chip-aviso',
          `En el pool esta unidad figura con ${u.asignacion?.cliente_nombre || 'otro cliente'} — verifica el serial`);
      }

      const m = typeof opts.modelo === 'function' ? opts.modelo() : null;
      if (m && (m.modelo_id || (m.modelo_label || '').trim())
          && !EquiposPoolService._mismoModelo(u, m.modelo_id || null, m.modelo_label || '')) {
        chip(`modelo distinto: ${esc(u.modelo_label || u.modelo_id || '?')}`, 'eqpool-chip-alerta',
          'El pool registra esta unidad con OTRO modelo — puede ser un error de dedo o una ficha por fusionar.');
      }

      if (opts.onInfo) opts.onInfo({ docs, unidad: u, descartado, condicion });
    };

    input.addEventListener('blur', refrescar);
    input.addEventListener('change', refrescar);
    // Si llega con valor (edición), decora de una vez.
    if ((input.value || '').trim()) refrescar();
    input._sfRefrescar = refrescar;
  },
};
