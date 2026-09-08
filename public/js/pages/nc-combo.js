// @ts-nocheck
// nuevo-contrato · combo de cliente. Desde 2026-09-08 (F3 de "Bandejas y
// pickers") es EntityCombo (js/ui/entity-combo.js) adoptando el input
// #clienteCombo y la lista #clienteList: búsqueda remota por tokens
// (ClientesService.searchByToken + searchByPrefix), recientes con la caja
// vacía, "Crear cliente" cuando no hay coincidencias y teclado completo. Aquí
// quedan solo los efectos de elegir un cliente sobre el formulario.
window.NCCombo = {
  RECENTS_KEY: 'clientes_recent_v1',
  _combo: null,

  renderInfoCliente(id) {
    const c    = NC.listaClientes[id];
    const html = c ? `
      📍 <b>Dirección:</b> ${NC.escapeHtml(c.direccion || '')}<br>
      🧾 <b>RUC:</b> ${NC.escapeHtml(c.ruc || '')}${c.dv ? ' - DV' + c.dv : ''}<br>
      📧 <b>Email:</b> ${NC.escapeHtml(c.email || '')}<br>
      ☎️ <b>Tel:</b> ${NC.escapeHtml(c.telefono || '')}
    ` : '';
    document.getElementById('infoCliente').innerHTML = html;
    document.getElementById('btnEditarCliente').disabled = !id;
  },

  loadRecent() {
    try { return JSON.parse(localStorage.getItem(this.RECENTS_KEY) || '[]'); } catch { return []; }
  },

  saveRecent(id) {
    const d = NC.listaClientes[id];
    if (!d) return;
    const rec = this.loadRecent().filter(x => x.id !== id);
    rec.unshift({ id, nombre: d.nombre || '', ruc: d.ruc || '', dv: d.dv || '' });
    localStorage.setItem(this.RECENTS_KEY, JSON.stringify(rec.slice(0, 5)));
  },

  // Búsqueda remota: tokens contra searchTokens (o el nombre normalizado) y,
  // sin resultados, prefijo.
  async buscar(text) {
    const _norm = s => FMT.normalize(s);
    const parts = _norm(text).split(/[^a-z0-9]+/).filter(Boolean);
    if (!parts.length) return [];
    const rawDocs = await ClientesService.searchByToken(parts[0], { limit: 50 });
    const items = [];
    NC.listaClientes = {};
    rawDocs.forEach(c => {
      const hasTokens = Array.isArray(c.searchTokens) && c.searchTokens.length;
      const pass = hasTokens
        ? parts.every(t => c.searchTokens.includes(t))
        : parts.every(t => _norm(c.nombre || '').includes(t));
      if (pass) { NC.listaClientes[c.id] = c; items.push(c); }
    });
    if (!items.length) {
      const prefixDocs = await ClientesService.searchByPrefix(text, 25);
      prefixDocs.forEach(d => {
        if (_norm(d.nombre || '').includes(_norm(text))) { NC.listaClientes[d.id] = d; items.push(d); }
      });
    }
    return items;
  },

  async selectCliente(id, close = true) {
    let d = NC.listaClientes[id];
    if (!d) {
      // Los "recientes" no están en NC.listaClientes (solo se llena al buscar):
      // traer el documento completo para poder seleccionarlo.
      try { d = await ClientesService.getCliente(id); } catch (e) { d = null; }
      if (d) NC.listaClientes[id] = d;
    }
    if (!d) return;
    document.getElementById('cliente').value      = id;
    document.getElementById('clienteCombo').value = d.nombre || '';
    this.renderInfoCliente(id);
    this.saveRecent(id);
    const selItbms = document.getElementById('itbms_aplica');
    if (selItbms) {
      selItbms.value = d.itbms_exento ? 'false' : 'true';
      NCForm.recalcularTotalesContrato();
    }
    // Cambió el cliente → recargar sus contratos para el vínculo de origen.
    if (window.NCForm) { NCForm._origenClienteCargado = null; NCForm.refreshOrigenUI(); }
    NCForm.updateContratoBadges();
    // "Limpiar selección" deshabilita Guardar; al elegir cliente hay que revivirlo
    // (antes quedaba muerto para siempre y obligaba a recargar la página).
    const $btnGuardar = document.getElementById('btnGuardar');
    if ($btnGuardar) { $btnGuardar.disabled = false; $btnGuardar.title = ''; }
  },

  init() {
    const self = this;
    const $combo   = document.getElementById('clienteCombo');
    const $hidden  = document.getElementById('cliente');
    const $list    = document.getElementById('clienteList');
    const $btnEdit = document.getElementById('btnEditarCliente');
    const $btnClr  = document.getElementById('btnClearCliente');

    this._combo = EntityCombo.montar(null, {
      input: $combo, lista: $list,
      buscar: (q) => self.buscar(q),
      recientes: () => self.loadRecent().map(r => ({ id: r.id, nombre: r.nombre, _reciente: true, ruc: r.ruc, dv: r.dv })),
      id: (c) => c.id,
      label: (c) => c.nombre || '(sin nombre)',
      sub: (c) => `${c.ruc || ''}${c.dv ? ' - DV' + c.dv : ''}${c.representante ? ' · ' + c.representante : ''}${c._reciente ? ' · reciente' : ''}`,
      limite: 50,
      vacio: (q) => {
        const propuesta = NC.escapeHtml((q || '').trim());
        return `<div class="combo-empty">Sin resultados.<br>
          <button type="button" class="btn btn-pill" data-crear-cliente>➕ Crear cliente${propuesta ? ` "${propuesta}"` : ''}</button></div>`;
      },
      onSelect: (id) => {
        if (id) { self.selectCliente(id, true); return; }
        // Escribir invalida la selección previa.
        $hidden.value = '';
        $btnEdit.disabled = true;
        self.renderInfoCliente(null);
      },
    });
    $list.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-crear-cliente]')) { e.preventDefault(); window.open('../contratos/nuevo-cliente.html?redirect=true', '_blank'); }
    });

    $btnClr.addEventListener('click', () => {
      self._combo.clear();
      $hidden.value = '';
      self.renderInfoCliente(null);
      $combo.focus();
      NCForm.updateContratoBadges();
      const $btnGuardar = document.getElementById('btnGuardar');
      if ($btnGuardar) { $btnGuardar.disabled = true; $btnGuardar.title = 'Seleccione un cliente'; }
    });

    $btnEdit.addEventListener('click', () => {
      const id = $hidden.value;
      if (!id) { Toast.show('Seleccione un cliente para editar', 'warn'); return; }
      window.open(`../contratos/nuevo-cliente.html?id=${id}&redirect=true`, '_blank');
    });
  }
};

NCCombo.init();
