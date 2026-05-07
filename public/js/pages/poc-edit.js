// @ts-nocheck
// POC edit drawer — open, close, save
window.PocEdit = {
  _docId: null,
  _row:   null,

  abrir(row, docId, data) {
    if (PocState.esLectura()) {
      alert('🔒 Modo lectura: el rol técnico no puede editar PoC.');
      return;
    }
    this._docId = docId;
    this._row   = row;

    document.querySelectorAll('tr.row-editing').forEach(r => r.classList.remove('row-editing'));
    row.classList.add('row-editing');

    document.getElementById('drawer-serial').value     = data.serial     || '';
    document.getElementById('drawer-unit-id').value    = data.unit_id    || '';
    document.getElementById('drawer-radio-name').value = data.radio_name || '';
    document.getElementById('drawer-modelo').value     = PocState.obtenerModeloTexto(data);
    document.getElementById('drawer-grupos').value     = (data.grupos || []).join(', ');
    document.getElementById('drawer-activo').checked   = data.activo !== false;
    document.getElementById('drawer-sim-number').value = data.sim_number || '';
    document.getElementById('drawer-sim-phone').value  = data.sim_phone  || '';
    document.getElementById('drawer-ip').value         = data.ip         || '';
    document.getElementById('drawer-gps').checked      = data.gps        || false;
    document.getElementById('drawer-notas').value      = data.notas      || '';

    const sel = document.getElementById('drawer-operador');
    sel.innerHTML = '<option value="">Seleccione...</option>';
    (PocState.listaOperadores || []).forEach(op => {
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
  },

  async guardar() {
    if (!this._docId) return;
    try {
      const grupos = document.getElementById('drawer-grupos').value
        .split(',').map(g => g.trim()).filter(Boolean);
      const user    = firebase.auth().currentUser;
      const prevData = (await PocService.getPocDevice(this._docId)) || {};
      const newData  = {
        serial:      document.getElementById('drawer-serial').value,
        unit_id:     document.getElementById('drawer-unit-id').value,
        radio_name:  document.getElementById('drawer-radio-name').value,
        modelo:      document.getElementById('drawer-modelo').value,
        grupos,
        activo:      document.getElementById('drawer-activo').checked,
        sim_number:  document.getElementById('drawer-sim-number').value,
        sim_phone:   document.getElementById('drawer-sim-phone').value,
        operador:    document.getElementById('drawer-operador').value,
        ip:          document.getElementById('drawer-ip').value,
        gps:         document.getElementById('drawer-gps').checked,
        notas:       document.getElementById('drawer-notas').value,
        updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
        updated_by:       user?.uid   || null,
        updated_by_email: user?.email || null
      };
      await PocService.updatePocDevice(this._docId, newData);
      await PocService.addLog({
        equipo_id: this._docId,
        fecha:     firebase.firestore.FieldValue.serverTimestamp(),
        usuario:   user?.email,
        cambios:   { antes: prevData, despues: newData }
      });
      this.cerrar();
      alert('✅ Cambios guardados');
      PocList.refresh();
    } catch (err) {
      console.error('Error saving changes:', err);
      alert('❌ Error al guardar cambios: ' + err.message);
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
