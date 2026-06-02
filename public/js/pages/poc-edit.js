// @ts-nocheck
// POC edit drawer — open, close, save
window.PocEdit = {
  _docId: null,
  _row:   null,
  _data:  null,

  abrir(row, docId, data) {
    if (PocState.esLectura()) {
      Toast.show('Modo lectura: el rol técnico no puede editar PoC.', 'bad');
      return;
    }
    this._docId = docId;
    this._row   = row;
    this._data  = data;

    document.querySelectorAll('tr.row-editing').forEach(r => r.classList.remove('row-editing'));
    row.classList.add('row-editing');

    document.getElementById('drawer-serial').value     = data.serial     || '';
    document.getElementById('drawer-unit-id').value    = data.unit_id    || '';
    document.getElementById('drawer-radio-name').value = data.radio_name || '';

    // Populate the modelo dropdown from the active-models list, preselecting
    // the device's current modelo.
    const modeloIdActual = PocState.obtenerModeloId(data);
    document.getElementById('drawer-modelo').innerHTML =
      PocState.buildModeloOptionsHTML(modeloIdActual);

    document.getElementById('drawer-grupos').value     = (data.grupos || []).join(', ');
    document.getElementById('drawer-activo').checked   = data.activo !== false;
    document.getElementById('drawer-sim-number').value = data.sim_number || '';
    document.getElementById('drawer-sim-phone').value  = data.sim_phone  || '';
    document.getElementById('drawer-ip').value         = data.ip         || '';
    document.getElementById('drawer-gps').checked      = data.gps        || false;
    document.getElementById('drawer-notas').value      = data.notas      || '';

    const sel = document.getElementById('drawer-operador');
    sel.innerHTML = '<option value="">Seleccione...</option>';
    const opList = [...(PocState.listaOperadores || [])];
    if (data.operador && !opList.includes(data.operador)) opList.push(data.operador);
    opList.forEach(op => {
      const opt = document.createElement('option');
      opt.value = op;
      opt.textContent = op;
      if (op === data.operador) opt.selected = true;
      sel.appendChild(opt);
    });

    document.getElementById('editDrawerOverlay').classList.add('active');
    document.getElementById('editDrawer').classList.add('active');
  },

  cerrar() {
    document.getElementById('editDrawerOverlay').classList.remove('active');
    document.getElementById('editDrawer').classList.remove('active');
    if (this._row) this._row.classList.remove('row-editing');
    this._docId = null;
    this._row   = null;
    this._data  = null;
  },

  async guardar() {
    if (!this._docId) return;
    try {
      const docId        = this._docId;
      const rowRef       = this._row;
      const originalData = this._data;
      const grupos = FMT.dedupGrupos(
        document.getElementById('drawer-grupos').value.split(',')
      );
      const user   = firebase.auth().currentUser;

      // Modelo is now picked from a dropdown — write the canonical FK and a
      // label snapshot (modelo_label) matching the field name used by the
      // vendedores-batch flow. Other alias keys are cleared below.
      const newModeloId    = (document.getElementById('drawer-modelo').value || '').trim();
      const newModeloLabel = newModeloId ? (PocState.modelosMap[newModeloId] || '') : '';
      const oldModeloId    = PocState.obtenerModeloId(originalData);
      const modeloEditado  = newModeloId !== oldModeloId;

      // Fields sent to Firestore update() — FieldValue sentinels are valid here.
      const updatePayload = {
        serial:           document.getElementById('drawer-serial').value,
        unit_id:          document.getElementById('drawer-unit-id').value,
        radio_name:       document.getElementById('drawer-radio-name').value,
        modelo_id:        newModeloId || firebase.firestore.FieldValue.delete(),
        modelo_label:     newModeloLabel,
        grupos,
        activo:           document.getElementById('drawer-activo').checked,
        sim_number:       document.getElementById('drawer-sim-number').value,
        sim_phone:        document.getElementById('drawer-sim-phone').value,
        operador:         document.getElementById('drawer-operador').value,
        ip:               document.getElementById('drawer-ip').value,
        gps:              document.getElementById('drawer-gps').checked,
        notas:            document.getElementById('drawer-notas').value,
        updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
        updated_by:       user?.uid   || null,
        updated_by_email: user?.email || null
      };

      // Stale aliases that obtenerModeloTexto could fall back to. We now write
      // modelo_id (FK) and modelo_label (snapshot) as the only sources of truth,
      // so drop every other variant so none shadow the new value.
      const MODEL_ALIAS_KEYS_TO_CLEAR = [
        'modeloId', 'model_id', 'modelId',
        'modeloLabel', 'Modelo', 'modelo',
        'model_label', 'modelLabel', 'model'
      ];

      if (modeloEditado) {
        MODEL_ALIAS_KEYS_TO_CLEAR.forEach(k => {
          if (k in (originalData || {})) {
            updatePayload[k] = firebase.firestore.FieldValue.delete();
          }
        });
      }

      await PocService.updatePocDevice(docId, updatePayload);

      // Clean snapshot for the UI row and audit log — strip FieldValue sentinels.
      const FV = firebase.firestore.FieldValue;
      const cleanFields = Object.fromEntries(
        Object.entries(updatePayload).filter(([, v]) => !(v instanceof FV))
      );

      PocService.addLog({
        equipo_id: docId,
        fecha:     firebase.firestore.FieldValue.serverTimestamp(),
        usuario:   user?.email,
        cambios:   { antes: originalData || {}, despues: cleanFields }
      }).catch(e => console.warn('poc_log write failed (non-critical):', e));

      const mergedData = { ...originalData, ...cleanFields };
      if (modeloEditado) {
        MODEL_ALIAS_KEYS_TO_CLEAR.forEach(k => delete mergedData[k]);
        // FieldValue.delete() sentinels were filtered out of cleanFields, so
        // when the user cleared the modelo we must also drop the inherited FK.
        if (!newModeloId) delete mergedData.modelo_id;
      }

      this.cerrar();
      Toast.show('Cambios guardados', 'ok');
      const newRow = PocList._buildRow(docId, mergedData);
      rowRef.replaceWith(newRow);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
      console.error('Error en guardar():', err);
      Toast.show('Error al guardar: ' + (err.message || err), 'bad');
    }
  },

  init() {
    const overlay = document.getElementById('editDrawerOverlay');
    if (overlay) overlay.addEventListener('click', () => this.cerrar());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('editDrawer')?.classList.contains('active')) {
        this.cerrar();
      }
    });
  }
};

PocEdit.init();
