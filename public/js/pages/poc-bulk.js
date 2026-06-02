// @ts-nocheck
// POC bulk (masiva) edit — activate inline inputs, save, cancel
window.PocBulk = {
  _campos: ['activo','serial','ip','unit_id','radio_name','modelo_id','grupos','sim_number','sim_phone'],
  _modo:   false,
  MAX_BULK: 25,

  // Keys whose presence would shadow modelo_id/modelo_label after a save.
  MODEL_ALIAS_KEYS_TO_CLEAR: [
    'modeloId', 'model_id', 'modelId',
    'modeloLabel', 'Modelo', 'modelo',
    'model_label', 'modelLabel', 'model'
  ],

  buildOperadorSelectHTML(valorActual = '') {
    const opciones = (PocState.listaOperadores || [])
      .map(op => `<option value="${op}" ${op === valorActual ? 'selected' : ''}>${op}</option>`)
      .join('');
    return `<select class="table-input table-select w-100">
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
    this._modo = true;
    const COL  = PocState.COL;

    seleccionados.forEach(({ fila }) => {
      const celdas = fila.querySelectorAll('td');

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

      const simTelOrig = celdas[COL.sim_tel].textContent.trim();
      celdas[COL.sim_tel].setAttribute('data-original', simTelOrig);
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

  async guardar() {
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) { Toast.show('Selecciona al menos un equipo.', 'bad'); return; }
    if (seleccionados.length > this.MAX_BULK) {
      Toast.show(`No puedes guardar más de ${this.MAX_BULK} equipos en una sola operación.`, 'bad');
      return;
    }
    if (!await Modal.confirm({ message: `Vas a actualizar ${seleccionados.length} equipos. ¿Confirmas continuar?` })) return;

    const user = firebase.auth().currentUser;
    const COL  = PocState.COL;
    let actualizados = 0;

    for (const { id, fila } of seleccionados) {
      const celdas    = fila.querySelectorAll('td');
      const activo    = celdas[COL.activo].querySelector('input')?.checked  || false;
      const serial    = celdas[COL.serial].querySelector('input')?.value    || '';
      const ip        = celdas[COL.ip].querySelector('input')?.value        || '';
      const unit_id   = celdas[COL.unit_id].querySelector('input')?.value   || '';
      const radio_name = celdas[COL.radio_name].querySelector('input')?.value || '';
      const modelo_id  = celdas[COL.modelo].querySelector('select.bulk-modelo')?.value || '';
      const modelo_label = modelo_id ? (PocState.modelosMap[modelo_id] || '') : '';
      const modelo_id_orig = celdas[COL.modelo].dataset.modeloId || '';
      const modeloEditado  = modelo_id !== modelo_id_orig;
      const grupos    = FMT.dedupGrupos(
        (celdas[COL.grupos].querySelector('input')?.value || '').split(',')
      );
      const sim_number = celdas[COL.sim_tel].querySelector('.sim-number')?.value || '';
      const sim_phone  = celdas[COL.sim_tel].querySelector('.sim-phone')?.value  || '';

      const newData = {
        activo, serial, ip, unit_id, radio_name, grupos, sim_number, sim_phone,
        modelo_id:    modelo_id || firebase.firestore.FieldValue.delete(),
        modelo_label,
        updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
        updated_by:       user?.uid   || null,
        updated_by_email: user?.email || null
      };
      const prevData = (await PocService.getPocDevice(id)) || {};
      if (modeloEditado) {
        this.MODEL_ALIAS_KEYS_TO_CLEAR.forEach(k => {
          if (k in prevData) newData[k] = firebase.firestore.FieldValue.delete();
        });
      }
      await PocService.updatePocDevice(id, newData);

      // FieldValue sentinels (delete/serverTimestamp) can only appear at the
      // top level of an update — strip them before embedding newData in the
      // audit log, otherwise the addLog .add() throws and the loop aborts
      // before Toast/refresh run (page stays in edit mode).
      const FV = firebase.firestore.FieldValue;
      const cleanFields = Object.fromEntries(
        Object.entries(newData).filter(([, v]) => !(v instanceof FV))
      );

      PocService.addLog({
        equipo_id: id,
        fecha:     firebase.firestore.FieldValue.serverTimestamp(),
        usuario:   user?.email,
        cambios:   { antes: prevData, despues: { ...prevData, ...cleanFields } }
      }).catch(e => console.warn('poc_log write failed (non-critical):', e));

      fila.style.backgroundColor = '#d4edda';
      setTimeout(() => { fila.style.backgroundColor = 'transparent'; }, 1000);
      actualizados++;
    }

    Toast.show(`${actualizados} equipos actualizados.`, 'ok');
    this._resetButtons();
    this._modo = false;
    PocList.refresh();
  },

  cancelar() {
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) return;
    const COL = PocState.COL;

    seleccionados.forEach(({ fila }) => {
      const celdas = fila.querySelectorAll('td');
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
