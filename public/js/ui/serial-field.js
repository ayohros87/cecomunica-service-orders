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
//     opts.onUsarModelo : (unidad) => bool — si viene, el chip "modelo distinto"
//                      ofrece "usar este" y llama aquí para poner el modelo del
//                      pool en el formulario (false = no se pudo).
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

  // ── "¿Quisiste decir…?" (2026-10-09, OS 2026100101 de APMT) ─────────────
  // Un dígito de más o de menos al recibir (B11000165 por B1100165) no daba
  // más que el chip gris "sin registro": la orden se guardaba, el trigger daba
  // de alta una ficha "del cliente, sin factura" y el radio de alquiler
  // quedaba bloqueado para reemplazo. Si el serial no existe, se busca en la
  // flota del cliente uno a UNA edición de distancia (cambiar, sobrar o faltar
  // un carácter, o dos vecinos al revés) y se ofrece con un clic.
  _flota: new Map(), // clienteId → {docs, at}

  async _flotaDe(clienteId) {
    const hit = this._flota.get(clienteId);
    if (hit && Date.now() - hit.at < 5 * this._TTL_MS) return hit.docs;
    const docs = await EquiposPoolService.listarPorCliente(clienteId);
    this._flota.set(clienteId, { docs, at: Date.now() });
    return docs;
  },

  _aUnaEdicion(a, b) {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) {
      const dif = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dif.push(i);
      if (dif.length === 1) return true;
      return dif.length === 2 && dif[1] === dif[0] + 1
        && a[dif[0]] === b[dif[1]] && a[dif[1]] === b[dif[0]];
    }
    const [largo, corto] = a.length > b.length ? [a, b] : [b, a];
    for (let i = 0; i < largo.length; i++) {
      if (largo.slice(0, i) + largo.slice(i + 1) === corto) return true;
    }
    return false;
  },

  async parecidos(norm, clienteId) {
    if (!clienteId || !norm) return [];
    const flota = await this._flotaDe(clienteId);
    return flota
      .filter(u => u.estado !== 'baja'
        && this._aUnaEdicion(norm, u.serial_norm || EquiposPoolService.normalizarSerial(u.serial)))
      .slice(0, 3);
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
          'Este serial no existe en el inventario — se dará de alta automáticamente al guardar. Verifica que esté bien escrito.');
        if (opts.onInfo) opts.onInfo({ docs, unidad: null, descartado, condicion });
        const clienteId = typeof opts.clienteId === 'function' ? (opts.clienteId() || '') : '';
        let cerca = [];
        try { cerca = await this.parecidos(norm, clienteId); } catch (_) { /* sin sugerencia */ }
        if (EquiposPoolService.normalizarSerial(input.value) !== norm) return;
        for (const u of cerca) {
          const donde = u.asignacion?.contrato_id ? `en ${u.asignacion.contrato_id}` : 'del cliente';
          const a = chip(`¿Quisiste decir <b>${esc(u.serial)}</b>? · ${esc(u.modelo_label || '')} ${esc(donde)}`,
            'eqpool-chip-aviso',
            `${u.serial} está en la flota de este cliente y difiere en un solo carácter de lo escrito. Clic para usarlo.`);
          a.addEventListener('click', (ev) => {
            ev.preventDefault(); ev.stopImmediatePropagation();
            input.value = u.serial;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }, { capture: true });
        }
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
        '', 'Estado en el inventario — clic para ver la ficha del equipo');
      est.classList.add(`eqpool-chip-${EquiposPoolService.ESTADO_LABELS[u.estado] ? u.estado : 'desconocido'}`);

      const clienteId = typeof opts.clienteId === 'function' ? (opts.clienteId() || '') : '';
      const clientePool = u.asignacion?.cliente_id || '';
      if (clientePool && clienteId && clientePool !== clienteId) {
        chip('⚠ otro cliente', 'eqpool-chip-aviso',
          `En el inventario esta unidad figura con ${u.asignacion?.cliente_nombre || 'otro cliente'} — verifica el serial`);
      }

      const m = typeof opts.modelo === 'function' ? opts.modelo() : null;
      if (m && (m.modelo_id || (m.modelo_label || '').trim())
          && !EquiposPoolService._mismoModelo(u, m.modelo_id || null, m.modelo_label || '')) {
        // Con onUsarModelo el chip corrige la fila de un clic: un radio de la
        // flota recibido con el modelo de la fila de al lado (B6C10768, NX-420-R
        // recibido como NX-410-R) partía una ficha aparte "del cliente".
        const usar = typeof opts.onUsarModelo === 'function';
        const a = chip(`modelo distinto: ${esc(u.modelo_label || u.modelo_id || '?')}${usar ? ' · <b>usar este</b>' : ''}`,
          'eqpool-chip-alerta',
          usar
            ? `El inventario registra esta unidad como ${u.modelo_label || u.modelo_id}. Clic para poner ese modelo en la fila. Si guardas con otro modelo, se crea una ficha aparte.`
            : 'El inventario registra esta unidad con OTRO modelo — puede ser un error de dedo o una ficha por fusionar.');
        if (usar) {
          a.addEventListener('click', (ev) => {
            ev.preventDefault(); ev.stopImmediatePropagation();
            if (opts.onUsarModelo(u) !== false) { slot._sfNorm = null; refrescar(); }
          }, { capture: true });
        }
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
