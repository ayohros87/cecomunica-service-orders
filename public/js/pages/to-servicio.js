// @ts-nocheck
// Trabajar-Orden: modal de mano de obra / servicio
window.TOServicio = {

  abrirModal(eqId) {
    if (TO.ordenData?.cotizacion_emitida === true) { alert('Orden bloqueada.'); return; }
    TO.equipoSeleccionado        = eqId;
    TO.byId('serv_desc').value   = '';
    TO.byId('serv_qty').value    = 1;
    TO.byId('serv_precio').value = '';
    TO.byId('serv_tipo').value   = 'cobro';
    Modal.open('modalServicio');
    this.actualizarSubtotal();
  },

  cerrarModal() { Modal.close('modalServicio'); },

  actualizarSubtotal() {
    const qty    = Math.max(1, parseInt(TO.byId('serv_qty').value || '1', 10));
    const precio = Number(TO.byId('serv_precio').value || 0);
    const tipo   = TO.byId('serv_tipo').value || 'cobro';
    const sub    = (tipo === 'cobro') ? (qty * precio) : 0;

    let ayuda = TO.byId('ayudaServicio');
    if (!ayuda) {
      ayuda = document.createElement('div'); ayuda.id = 'ayudaServicio'; ayuda.className = 'ayuda';
      TO.byId('modalServicio').querySelector('.modal').appendChild(ayuda);
    }
    ayuda.innerHTML = `Cantidad: ${qty} · Precio: ${TO.fmtMoney(precio)} · Subtotal: <strong>${TO.fmtMoney(sub)}</strong>`;
  },

  async confirmarServicio() {
    if (!TO.equipoSeleccionado) { alert('Equipo no válido'); return; }
    const desc   = TO.byId('serv_desc').value.trim();
    const qty    = Math.max(1, parseInt(TO.byId('serv_qty').value || '1', 10));
    const precio = Number(TO.byId('serv_precio').value || 0);
    const tipo   = TO.byId('serv_tipo').value || 'cobro';
    if (!desc || precio < 0) { alert('Descripción y precio son requeridos'); return; }

    const subtotal = (tipo === 'cobro') ? (qty * precio) : 0;
    await OrdenesService.addConsumo(TO.ordenId, {
      equipoId:       TO.equipoSeleccionado,
      pieza_id:       null,
      pieza_nombre:   desc,
      sku:            'SERV',
      qty, precio_unit: precio, tipo, subtotal,
      added_by_uid:   TO.usuarioActual.uid,
      added_by_email: TO.usuarioActual.email,
      added_at:       firebase.firestore.FieldValue.serverTimestamp()
    });

    await TO.ensureEnProgreso();
    this.cerrarModal();
    alert('✅ Servicio agregado');
  },

  init() {
    const self = this;
    TO.byId('serv_qty').addEventListener('input',    () => self.actualizarSubtotal());
    TO.byId('serv_precio').addEventListener('input', () => self.actualizarSubtotal());
    TO.byId('serv_tipo').addEventListener('change',  () => self.actualizarSubtotal());
  }
};

TOServicio.init();
