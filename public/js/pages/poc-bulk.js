// @ts-nocheck
// POC bulk (masiva) edit — activate inline inputs, save, cancel
window.PocBulk = {
  _campos: ['operador','activo','serial','ip','unit_id','radio_name','modelo_id','grupos','sim_number','sim_phone'],
  _modo:   false,
  MAX_BULK: 25,

  // Keys whose presence would shadow modelo_id/modelo_label after a save.
  MODEL_ALIAS_KEYS_TO_CLEAR: [
    'modeloId', 'model_id', 'modelId',
    'modeloLabel', 'Modelo', 'modelo',
    'model_label', 'modelLabel', 'model'
  ],

  buildOperadorSelectHTML(valorActual = '') {
    // Surface the current value even if it isn't in the canonical list, so a
    // legacy/free-text operador stays selected instead of silently resetting.
    const lista = [...(PocState.listaOperadores || [])];
    if (valorActual && !lista.includes(valorActual)) lista.push(valorActual);
    const opciones = lista
      .map(op => `<option value="${op}" ${op === valorActual ? 'selected' : ''}>${op}</option>`)
      .join('');
    return `<select class="table-input table-select bulk-operador" style="width:100%;">
              <option value="">— Selecciona operador —</option>
              ${opciones}
            </select>`;
  },

  activar() {
    if (this._modo) { Toast.show('Ya estás en modo edición masiva.', 'bad'); return; }
    if (PocState.rolActual !== ROLES.ADMIN && PocState.rolActual !== ROLES.RECEPCION) {
      Toast.show('Solo administradores o recepción pueden usar edición masiva.', 'bad');
      return;
    }
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) { Toast.show('Selecciona al menos un equipo.', 'bad'); return; }
    if (seleccionados.length > this.MAX_BULK) {
      Toast.show(`El máximo permitido es ${this.MAX_BULK} equipos por edición masiva.`, 'bad');
      return;
    }
    window.PocSimInline?.cancelar?.();   // un editor de SIM en sitio abierto se cierra antes de tomar las celdas
    this._modo = true;
    const COL  = PocState.COL;

    seleccionados.forEach(({ fila }) => {
      const celdas = fila.querySelectorAll('td');

      // Operador — read the raw value stamped on the cell (textContent is empty
      // when the cell only holds the "missing" marker) and render a dropdown.
      const operadorOrig = celdas[COL.operador].dataset.operador || '';
      celdas[COL.operador].setAttribute('data-original', celdas[COL.operador].innerHTML);
      celdas[COL.operador].innerHTML = this.buildOperadorSelectHTML(operadorOrig);

      const activoOrig = celdas[COL.activo].dataset.activo === 'true';
      celdas[COL.activo].setAttribute('data-original', celdas[COL.activo].innerHTML);
      celdas[COL.activo].innerHTML = `<input type="checkbox" class="mass-activo" ${activoOrig ? 'checked' : ''}>`;

      const serialOrig = celdas[COL.serial].textContent.trim();
      celdas[COL.serial].setAttribute('data-original', serialOrig);
      celdas[COL.serial].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${serialOrig}">`;

      // IP cell renders as host + .cecomunica.net suffix in two spans, so we
      // can't trust textContent — read the raw value from data-ip set by
      // PocList.crearCeldaIp.
      const ipOrig = celdas[COL.ip].dataset.ip || celdas[COL.ip].textContent.trim();
      celdas[COL.ip].setAttribute('data-original', celdas[COL.ip].innerHTML);
      celdas[COL.ip].innerHTML = `<input type="text" class="table-input" style="width:100%;font-family:var(--font-mono);" value="${ipOrig}">`;

      const unitOrig = celdas[COL.unit_id].textContent.trim();
      celdas[COL.unit_id].setAttribute('data-original', unitOrig);
      celdas[COL.unit_id].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${unitOrig}">`;

      const radioOrig = celdas[COL.radio_name].textContent.trim();
      celdas[COL.radio_name].setAttribute('data-original', radioOrig);
      celdas[COL.radio_name].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${radioOrig}">`;

      // Modelo is dropdown-only — read the FK stored on the cell by the row
      // builder and render a <select> populated from PocState.listaModelos.
      const modeloIdOrig = celdas[COL.modelo].dataset.modeloId || '';
      celdas[COL.modelo].setAttribute('data-original', celdas[COL.modelo].innerHTML);
      celdas[COL.modelo].innerHTML =
        `<select class="table-input table-select bulk-modelo" style="width:100%;">${PocState.buildModeloOptionsHTML(modeloIdOrig)}</select>`;

      const celdaGrupos = celdas[COL.grupos];
      const btnExp = celdaGrupos.querySelector('.expand-btn');
      let gruposOrig = btnExp?.title || celdaGrupos.textContent.replace('🔍','').trim();
      celdaGrupos.setAttribute('data-original', celdaGrupos.innerHTML);
      celdaGrupos.innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${gruposOrig}">`;

      // El texto sale de .sim-txt (la celda trae además el lápiz del editor en
      // sitio); se guarda el HTML para que cancelar reponga el lápiz.
      const celdaSim = celdas[COL.sim_tel];
      const simTelOrig = (celdaSim.querySelector('.sim-txt') || celdaSim).textContent.trim();
      celdaSim.setAttribute('data-original', celdaSim.innerHTML);
      const partes = simTelOrig.replace('📱','').trim().split('/').map(s => s.trim());
      celdas[COL.sim_tel].innerHTML = `
        <input type="text" class="table-input sim-number" placeholder="SIM" value="${partes[0] || ''}" style="width:48%;margin-right:4%;">
        <input type="text" class="table-input sim-phone" placeholder="TEL" value="${partes[1] || ''}" style="width:48%;">
      `;
    });

    const btnGuardar   = document.getElementById('btnGuardarMasivo');
    const btnCancelar  = document.getElementById('btnCancelarMasivo');
    if (btnGuardar)  btnGuardar.style.display  = 'inline-block';
    if (btnCancelar) btnCancelar.style.display = 'inline-block';
  },

  // withBusy + try/catch por fila (auditoría UX 2026-09-28, T3 y 4.7 #5-6):
  // antes un fallo a la mitad abortaba el bucle sin aviso, dejaba la página en
  // modo edición y un doble click guardaba dos veces.
  async guardar() {
    const btn = document.getElementById('btnGuardarMasivo');
    return withBusy(btn, () => this._guardar(), { label: 'Guardando…', rethrow: false });
  },

  async _guardar() {
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) { Toast.show('Selecciona al menos un equipo.', 'bad'); return; }
    if (seleccionados.length > this.MAX_BULK) {
      Toast.show(`No puedes guardar más de ${this.MAX_BULK} equipos en una sola operación.`, 'bad');
      return;
    }

    const user = firebase.auth().currentUser;
    const COL  = PocState.COL;

    // 1) Leer lo tecleado y el doc actual de cada fila ANTES de escribir nada.
    const filas = seleccionados.map(({ id, fila }) => {
      const celdas    = fila.querySelectorAll('td');
      const modelo_id = celdas[COL.modelo].querySelector('select.bulk-modelo')?.value || '';
      return {
        id, fila,
        operador:   celdas[COL.operador].querySelector('select.bulk-operador')?.value || '',
        activo:     celdas[COL.activo].querySelector('input')?.checked  || false,
        serial:     celdas[COL.serial].querySelector('input')?.value    || '',
        ip:         celdas[COL.ip].querySelector('input')?.value        || '',
        unit_id:    (celdas[COL.unit_id].querySelector('input')?.value || '').trim(),
        radio_name: celdas[COL.radio_name].querySelector('input')?.value || '',
        modelo_id,
        modelo_label: modelo_id ? (PocState.modelosMap[modelo_id] || '') : '',
        modeloEditado: modelo_id !== (celdas[COL.modelo].dataset.modeloId || ''),
        grupos: FMT.dedupGrupos((celdas[COL.grupos].querySelector('input')?.value || '').split(',')),
        sim_number: celdas[COL.sim_tel].querySelector('.sim-number')?.value || '',
        sim_phone:  celdas[COL.sim_tel].querySelector('.sim-phone')?.value  || '',
      };
    });
    let prevs;
    try {
      prevs = await Promise.all(filas.map(f => PocService.getPocDevice(f.id).then(d => d || {})));
    } catch (e) {
      console.error('[PocBulk] no se pudieron leer los equipos:', e);
      Toast.show('No se pudieron leer los equipos. Revisa tu conexión e intenta de nuevo.', 'bad');
      return;
    }
    filas.forEach((f, k) => { f.prev = prevs[k]; });

    // 2) Unit IDs que cambiaron: no pueden chocar con otro equipo del mismo
    //    cliente ni entre sí (misma regla que el lote y la consola).
    const cambiados = filas.filter(f => f.unit_id && f.unit_id !== String(f.prev.unit_id ?? '').trim())
      .map(f => ({ id: f.id, unit_id: f.unit_id, cliente_id: f.prev.cliente_id || null, cliente: f.prev.cliente || null }));
    if (cambiados.length) {
      let choques;
      try { choques = await PocState.choquesUnitId(cambiados); }
      catch (e) {
        console.error('[PocBulk] validación de Unit ID falló:', e);
        Toast.show('No se pudo validar los Unit ID. Revisa tu conexión e intenta de nuevo.', 'bad');
        return;
      }
      if (choques.length) {
        const lista = choques.map(c => `<li>Unit ID <b>${FMT.esc(c.item.unit_id)}</b> ya lo usa ${FMT.esc(PocState.etiquetaEquipo(c.otro))}</li>`).join('');
        await Modal.alert({ title: 'Unit ID repetidos', icon: 'alert-triangle',
          message: `No se guardó nada. Corrige estos Unit ID (no se repiten dentro del mismo cliente):<ul style="margin:8px 0 0 18px;">${lista}</ul>` });
        return;
      }
    }

    // SIM que ya está en otro radio (auditoría de módulos 2026-10-01, PoC
    // R2/D2): se revisan solo los SIM que cambiaron, en UN aviso con un solo
    // motivo para todos; no bloquea.
    const simItems = filas
      .filter(f => { const n = SimCardsService.normalizarSim(f.sim_number); return n && n !== SimCardsService.normalizarSim(f.prev.sim_number); })
      .map(f => ({ id: f.id, sim_number: f.sim_number, serial: f.serial, cliente: PocState.nombreClienteDe(f.prev) }));
    const simCambiados = new Set(simItems.map(i => i.id));
    const revisionSim = simItems.length ? await PocSimConflicto.revisar(simItems) : null;
    if (revisionSim?.cancelado) return;

    if (!await Modal.confirm({ message: `Vas a actualizar ${filas.length} equipos. ¿Confirmas continuar?` })) return;

    // 3) Escribir fila por fila; un fallo no aborta las demás.
    let actualizados = 0;
    const errores = [];
    const cambiosParaLiberar = [];   // equipos que pasaron a inactivo con SIM

    for (const f of filas) {
      const prevData = f.prev;
      try {
        const newData = {
          operador: f.operador, activo: f.activo, serial: f.serial, ip: f.ip,
          radio_name: f.radio_name, grupos: f.grupos, sim_number: f.sim_number, sim_phone: f.sim_phone,
          unit_id: f.unit_id,
          unit_id_num: PocService.unitIdNum(f.unit_id),
          modelo_id:    f.modelo_id || firebase.firestore.FieldValue.delete(),
          modelo_label: f.modelo_label,
          updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
          updated_by:       user?.uid   || null,
          updated_by_email: user?.email || null
        };
        if (f.modeloEditado) {
          this.MODEL_ALIAS_KEYS_TO_CLEAR.forEach(k => {
            if (k in prevData) newData[k] = firebase.firestore.FieldValue.delete();
          });
        }
        if (simCambiados.has(f.id)) {
          const sc = PocSimConflicto.campo(revisionSim, f.id, user);
          if (sc) newData.sim_conflicto = sc;
          else if (prevData.sim_conflicto) newData.sim_conflicto = firebase.firestore.FieldValue.delete();
        }
        await PocService.updatePocDevice(f.id, newData);

        // FieldValue sentinels (delete/serverTimestamp) can only appear at the
        // top level of an update — strip them before embedding newData in the
        // audit log.
        const cleanFields = PocService.stripSentinels(newData);

        PocService.addLog({
          equipo_id: f.id,
          fecha:     firebase.firestore.FieldValue.serverTimestamp(),
          usuario:   user?.email,
          ...(cleanFields.sim_conflicto ? { motivo: cleanFields.sim_conflicto.motivo, sim_conflicto: cleanFields.sim_conflicto } : {}),
          cambios:   { antes: prevData, despues: { ...prevData, ...cleanFields } }
        }).catch(e => console.warn('poc_log write failed (non-critical):', e));

        cambiosParaLiberar.push({ id: f.id, antes: prevData, despues: { ...prevData, ...cleanFields } });

        // SIM tecleado a mano en un equipo que sigue activo y que existe
        // disponible en el pool → marcarlo asignado. Best-effort.
        if (f.activo && f.sim_number &&
            SimCardsService.normalizarSim(f.sim_number) !== SimCardsService.normalizarSim(prevData.sim_number)) {
          SimCardsService.marcarAsignadoSiExiste(f.sim_number, {
            id: f.id, serial: f.serial, cliente_nombre: PocState.nombreClienteDe(prevData),
          }, user);
        }
        actualizados++;
      } catch (e) {
        console.error('[PocBulk] fila', f.id, e);
        errores.push({ f, msg: (e && e.message) || String(e) });
      }
    }

    // Equipos que quedaron inactivos con SIM → ofrecer devolverlos al pool.
    try { await SimLiberar.procesarDesactivados(cambiosParaLiberar); }
    catch (e) { console.warn('[PocBulk] liberar SIM falló (no crítico):', e); }
    this._resetButtons();
    this._modo = false;
    PocList.refresh();

    if (!errores.length) {
      Toast.show(`${actualizados} equipos actualizados.`, 'ok');
      return;
    }
    const lista = errores.map(({ f, msg }) =>
      `<li><b>${FMT.esc(f.radio_name || f.serial || f.id)}</b>${f.unit_id ? ` (Unit ID ${FMT.esc(f.unit_id)})` : ''}: ${FMT.esc(msg)}</li>`).join('');
    await Modal.alert({ title: 'Edición masiva incompleta', icon: 'alert-triangle',
      message: `Se guardaron ${actualizados} de ${filas.length}. Estos no se guardaron; vuelve a editarlos:<ul style="margin:8px 0 0 18px;">${lista}</ul>` });
  },

  cancelar() {
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) return;
    const COL = PocState.COL;

    seleccionados.forEach(({ fila }) => {
      const celdas = fila.querySelectorAll('td');
      celdas[COL.operador].innerHTML  = celdas[COL.operador].getAttribute('data-original')  || '';
      celdas[COL.activo].innerHTML    = celdas[COL.activo].getAttribute('data-original')    || '';
      celdas[COL.serial].innerHTML    = celdas[COL.serial].getAttribute('data-original')    || '';
      celdas[COL.ip].innerHTML        = celdas[COL.ip].getAttribute('data-original')        || '';
      celdas[COL.unit_id].innerHTML   = celdas[COL.unit_id].getAttribute('data-original')   || '';
      celdas[COL.radio_name].innerHTML = celdas[COL.radio_name].getAttribute('data-original') || '';
      celdas[COL.modelo].innerHTML    = celdas[COL.modelo].getAttribute('data-original')    || '';
      celdas[COL.grupos].innerHTML    = celdas[COL.grupos].getAttribute('data-original')    || '';
      celdas[COL.sim_tel].innerHTML   = celdas[COL.sim_tel].getAttribute('data-original')   || '';
    });

    this._resetButtons();
    this._modo = false;
  },

  _resetButtons() {
    const btnGuardar   = document.getElementById('btnGuardarMasivo');
    const btnCancelar  = document.getElementById('btnCancelarMasivo');
    if (btnGuardar)  btnGuardar.style.display  = 'none';
    if (btnCancelar) btnCancelar.style.display = 'none';
  }
};
