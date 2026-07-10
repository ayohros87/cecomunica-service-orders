// @ts-nocheck
// POC shared state, lookup maps, role helpers
window.PocState = {
  listaOperadores: [],
  listaModelos:    [],
  clientesMap:     {},
  modelosMap:      {},
  rolActual:       ROLES.VISTA,
  COL: {
    checkbox:   0,
    cliente:    1,
    operador:   2,
    activo:     3,
    serial:     4,
    ip:         5,
    unit_id:    6,
    radio_name: 7,
    modelo:     8,
    grupos:     9,
    sim_tel:    10,
    acciones:   11
  },

  esLectura() {
    return this.rolActual === ROLES.TECNICO
        || this.rolActual === ROLES.VISTA
        || this.rolActual === ROLES.JEFE_TALLER;
  },

  obtenerModeloTexto(d = {}) {
    return (d.modelo_id && this.modelosMap[d.modelo_id])
      || (d.modeloId  && this.modelosMap[d.modeloId])
      || (d.model_id  && this.modelosMap[d.model_id])
      || (d.modelId   && this.modelosMap[d.modelId])
      || d.modelo_label || d.modeloLabel || d.Modelo || d.modelo
      || d.model_label  || d.modelLabel  || d.model
      || '';
  },

  // Resolve the canonical modelo ID for a device doc. Prefers any FK field;
  // if only a free-text label exists (legacy poc-edit), tries to match it
  // against listaModelos by label so the dropdown can pre-select correctly.
  obtenerModeloId(d = {}) {
    const direct = d.modelo_id || d.modeloId || d.model_id || d.modelId;
    if (direct) return direct;
    const txt = (d.modelo_label || d.modeloLabel || d.Modelo || d.modelo ||
                 d.model_label  || d.modelLabel  || d.model || '').toString().trim();
    if (!txt) return '';
    const lc = txt.toLowerCase();
    const match = (this.listaModelos || []).find(m => (m.label || '').toLowerCase() === lc);
    return match ? match.id : '';
  },

  // Build the inner <option>s for a modelo dropdown, pre-selecting `currentId`.
  // If the current value points to an inactive/removed modelo it is still
  // surfaced (marked "inactivo") so the user sees what is assigned.
  buildModeloOptionsHTML(currentId = '') {
    let lista = this.listaModelos || [];
    if (currentId && !lista.some(m => m.id === currentId)) {
      const label = this.modelosMap[currentId] || currentId;
      lista = [{ id: currentId, label: `${label} (inactivo)` }, ...lista];
    }
    return [
      '<option value="">— Selecciona modelo —</option>',
      ...lista.map(m => `<option value="${m.id}"${m.id === currentId ? ' selected' : ''}>${m.label}</option>`)
    ].join('');
  },

  nombreClienteDe(d) {
    const id = d?.cliente_id;
    return (id && this.clientesMap[id]) || d?.cliente || '';
  },

  actualizarResumen({ total = 0, activos = 0, incompletos = 0 } = {}) {
    const footer = document.getElementById('resumenEquipos');
    const top    = document.getElementById('resumenEquiposTop');

    if (!total) {
      if (footer) footer.textContent = 'No se encontraron resultados.';
      if (top)    top.textContent    = 'No se encontraron resultados.';
      return;
    }

    const base = `
      <strong title="Total de equipos listados (activos e inactivos)">${total}</strong>
      <span style="color:var(--muted);font-size:12px;">equipos</span>
      <span class="badge completo" title="Activos">✅ ${activos}</span>
      <span class="badge asignado" title="Incompletos (faltan campos)">⚠️ ${incompletos}</span>`;

    if (footer) footer.innerHTML = base;
    // The top strip mirrors the footer and adds a live "seleccionados" tally
    // so the user can compare total vs. selected without scrolling/printing.
    if (top) top.innerHTML = base +
      `\n      <span class="badge" id="resumenSeleccionados" title="Equipos seleccionados">0 seleccionados</span>`;

    // Reflect any current checkbox selection (normally 0 right after a render).
    window.PocList?.actualizarSeleccion?.();
  },

  async cargarModelosMap() {
    try {
      const modelos = await ModelosService.getModelos();
      this.modelosMap = {};
      modelos.forEach(m => {
        const label = `${(m.marca || '').trim()} ${(m.modelo || '').trim()}`.trim();
        this.modelosMap[m.id] = label || m.modelo || m.marca || m.id;
      });
      // Active-only list, sorted, used to populate dropdowns (drawer + bulk)
      this.listaModelos = modelos
        .filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: this.modelosMap[m.id] }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
    } catch (e) {
      console.error('Error al cargar modelos:', e);
      this.modelosMap = {};
      this.listaModelos = [];
    }
  },

  async cargarClientesMap() {
    try {
      const raw = await ClientesService.loadClientes();
      this.clientesMap = {};
      raw.forEach((cliente, id) => {
        this.clientesMap[id] = (cliente.nombre || '').trim() || id;
      });
    } catch (e) {
      console.error('Error al cargar clientes:', e);
      this.clientesMap = {};
    }
  },

  async cargarOperadores() {
    try {
      let arr = [];
      const snap = await EmpresaService.getOperadores();
      if (snap) {
        if (Array.isArray(snap.list))       arr = snap.list;
        else if (Array.isArray(snap.operadores)) arr = snap.operadores;
      }
      if (!arr.length) {
        arr = await PocService.getUniqueOperadores(1000);
      }
      this.listaOperadores = (arr || [])
        .map(v => v.toString().trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    } catch (e) {
      console.error('Error al cargar operadores:', e);
      this.listaOperadores = [];
    }
  },

  aplicarPermisosRol() {
    if (this.esLectura()) {
      document.getElementById('btnBatch')?.remove();
      document.getElementById('btnSim')?.remove();
      document.getElementById('btnSimPool')?.remove();
      document.getElementById('btnImportar')?.remove();
      document.getElementById('btnAdminGrupos')?.remove();  // solo admin/recepcion administran grupos
      document.querySelector('.check-all')?.setAttribute('disabled', 'disabled');
    }
  }
};
