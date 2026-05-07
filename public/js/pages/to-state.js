// @ts-nocheck
// Trabajar-Orden shared state, helpers, status chip, inventory cache
window.TO = {
  inventarioById:    new Map(),
  equiposById:       new Map(),
  ordenId:           new URLSearchParams(location.search).get('id'),
  ordenData:         null,
  equipos:           [],
  inventario:        [],
  equipoSeleccionado: null,
  piezaSeleccionada:  null,
  rolUsuario:        null,
  usuarioActual:     { uid: null, email: null, nombre: null },
  itbmsPct:          0.07,
  unsubByEquipo:     new Map(),

  norm(x = '') {
    return String(x).toLowerCase().trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  },

  modeloNorm(modelo = '', marca = '') {
    const m = this.norm(modelo);
    const b = this.norm(marca);
    return b ? `${b}_${m}` : m;
  },

  byId(x) { return document.getElementById(x); },

  fmtMoney(n) { return '$' + Number(n || 0).toFixed(2); },

  showToast(txt = '💾 Guardado') {
    const t = this.byId('toast');
    if (!t) return;
    t.textContent = txt;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1000);
  },

  pintarChipTrabajo(estado) {
    const chip = this.byId('chipTrabajo');
    if (!chip) return;
    let label = 'SIN INICIAR', cls = 'estado-sin';
    if (estado === 'EN_PROGRESO') { label = 'EN PROGRESO'; cls = 'estado-prog'; }
    if (estado === 'COMPLETADO')  { label = 'COMPLETADO';  cls = 'estado-ok';  }
    chip.className  = `chip estado-chip ${cls}`;
    chip.textContent = label;
  },

  async setTrabajoEstado(nuevo) {
    try {
      await OrdenesService.mergeOrder(this.ordenId, { trabajo_estado: nuevo });
      this.pintarChipTrabajo(nuevo);
    } catch (e) { console.warn('setTrabajoEstado', e); }
  },

  async ensureEnProgreso() {
    try {
      const s   = await OrdenesService.getOrder(this.ordenId);
      const cur = s ? s.trabajo_estado : null;
      if (cur !== 'COMPLETADO') {
        await OrdenesService.mergeOrder(this.ordenId, { trabajo_estado: 'EN_PROGRESO' });
        this.pintarChipTrabajo('EN_PROGRESO');
      }
    } catch (e) { console.warn('ensureEnProgreso', e); }
  },

  async cargarInventarioConCache() {
    try {
      const cache = localStorage.getItem('inv_cache');
      const t     = Number(localStorage.getItem('inv_cache_time') || 0);
      if (cache && Date.now() - t < 3600000) {
        this.inventario = JSON.parse(cache);
        this._reindexar();
        return;
      }
    } catch {}
    this.inventario = (await PiezasService.getPiezas()).filter(p => p.activo);
    this._reindexar();
    try {
      localStorage.setItem('inv_cache', JSON.stringify(this.inventario));
      localStorage.setItem('inv_cache_time', String(Date.now()));
    } catch {}
  },

  _reindexar() {
    this.inventarioById.clear();
    this.inventario.forEach(p => this.inventarioById.set(p.id, p));
    this.equiposById.clear();
    this.equipos.forEach(e => {
      const eid = e.id || e.numero_de_serie || 'X';
      this.equiposById.set(eid, e);
    });
  }
};
