// @ts-nocheck
// POC bulk (masiva) edit — activate inline inputs, save, cancel
window.PocBulk = {
  _campos: ['activo','serial','unit_id','radio_name','grupos','sim_number','sim_phone'],
  _modo:   false,

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
    if (this._modo) { alert('⚠️ Ya estás en modo edición masiva.'); return; }
    if (PocState.rolActual !== ROLES.ADMIN && PocState.rolActual !== ROLES.RECEPCION) {
      alert('❌ Solo administradores o recepción pueden usar edición masiva.');
      return;
    }
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) { alert('Selecciona al menos un equipo.'); return; }
    if (seleccionados.length > 10) {
      alert('⚠️ El máximo permitido es 10 equipos por edición masiva.');
      return;
    }
    this._modo = true;
    const COL  = PocState.COL;

    seleccionados.forEach(({ fila }) => {
      const celdas = fila.querySelectorAll('td');

      const activoOrig = celdas[COL.activo].textContent.includes('🟢');
      celdas[COL.activo].setAttribute('data-original', activoOrig ? '🟢' : '🔴');
      celdas[COL.activo].innerHTML = `<input type="checkbox" class="mass-activo" ${activoOrig ? 'checked' : ''}>`;

      const serialOrig = celdas[COL.serial].textContent.trim();
      celdas[COL.serial].setAttribute('data-original', serialOrig);
      celdas[COL.serial].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${serialOrig}">`;

      const unitOrig = celdas[COL.unit_id].textContent.trim();
      celdas[COL.unit_id].setAttribute('data-original', unitOrig);
      celdas[COL.unit_id].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${unitOrig}">`;

      const radioOrig = celdas[COL.radio_name].textContent.trim();
      celdas[COL.radio_name].setAttribute('data-original', radioOrig);
      celdas[COL.radio_name].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${radioOrig}">`;

      const celdaGrupos = celdas[COL.grupos];
      const btnExp = celdaGrupos.querySelector('.expandir-btn');
      let gruposOrig = btnExp?.title || celdaGrupos.textContent.replace('🔍','').replace('…','').trim();
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

    const primaryGroup = document.querySelector('.actions-toolbar .actions-group:first-child');
    const btnGuardar   = document.getElementById('btnGuardarMasivo');
    const btnCancelar  = document.getElementById('btnCancelarMasivo');
    primaryGroup.appendChild(btnGuardar);
    primaryGroup.appendChild(btnCancelar);
    btnGuardar.style.display  = 'inline-block';
    btnCancelar.style.display = 'inline-block';
  },

  async guardar() {
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) { alert('Selecciona al menos un equipo.'); return; }
    if (seleccionados.length > 10) {
      alert('⚠️ No puedes guardar más de 10 equipos en una sola operación.');
      return;
    }
    if (!confirm(`⚠️ Vas a actualizar ${seleccionados.length} equipos. ¿Confirmas continuar?`)) return;

    const user = firebase.auth().currentUser;
    const COL  = PocState.COL;
    let actualizados = 0;

    for (const { id, fila } of seleccionados) {
      const celdas    = fila.querySelectorAll('td');
      const activo    = celdas[COL.activo].querySelector('input')?.checked  || false;
      const serial    = celdas[COL.serial].querySelector('input')?.value    || '';
      const unit_id   = celdas[COL.unit_id].querySelector('input')?.value   || '';
      const radio_name = celdas[COL.radio_name].querySelector('input')?.value || '';
      const grupos    = (celdas[COL.grupos].querySelector('input')?.value || '')
        .split(',').map(g => g.trim()).filter(Boolean);
      const sim_number = celdas[COL.sim_tel].querySelector('.sim-number')?.value || '';
      const sim_phone  = celdas[COL.sim_tel].querySelector('.sim-phone')?.value  || '';

      const newData = {
        activo, serial, unit_id, radio_name, grupos, sim_number, sim_phone,
        updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
        updated_by:       user?.uid   || null,
        updated_by_email: user?.email || null
      };
      const prevData = (await PocService.getPocDevice(id)) || {};
      await PocService.updatePocDevice(id, newData);
      await PocService.addLog({
        equipo_id: id,
        fecha:     firebase.firestore.FieldValue.serverTimestamp(),
        usuario:   user?.email,
        cambios:   { antes: prevData, despues: { ...prevData, ...newData } }
      });

      fila.style.backgroundColor = '#d4edda';
      setTimeout(() => { fila.style.backgroundColor = 'transparent'; }, 1000);
      actualizados++;
    }

    alert(`✅ ${actualizados} equipos actualizados.`);
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
      celdas[COL.activo].innerHTML    = celdas[COL.activo].getAttribute('data-original')    || '🔴';
      celdas[COL.serial].innerHTML    = celdas[COL.serial].getAttribute('data-original')    || '';
      celdas[COL.unit_id].innerHTML   = celdas[COL.unit_id].getAttribute('data-original')   || '';
      celdas[COL.radio_name].innerHTML = celdas[COL.radio_name].getAttribute('data-original') || '';
      celdas[COL.grupos].innerHTML    = celdas[COL.grupos].getAttribute('data-original')    || '';
      celdas[COL.sim_tel].innerHTML   = celdas[COL.sim_tel].getAttribute('data-original')   || '';
    });

    this._resetButtons();
    this._modo = false;
  },

  _resetButtons() {
    const primaryGroup = document.querySelector('.actions-toolbar .actions-group:first-child');
    const btnGuardar   = document.getElementById('btnGuardarMasivo');
    const btnCancelar  = document.getElementById('btnCancelarMasivo');
    if (primaryGroup && btnGuardar)  primaryGroup.appendChild(btnGuardar);
    if (primaryGroup && btnCancelar) primaryGroup.appendChild(btnCancelar);
    if (btnGuardar)  btnGuardar.style.display  = 'none';
    if (btnCancelar) btnCancelar.style.display = 'none';
  }
};
