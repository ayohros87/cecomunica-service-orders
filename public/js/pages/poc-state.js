// @ts-nocheck
// POC shared state, lookup maps, role helpers
window.PocState = {
  listaOperadores: [],
  clientesMap:     {},
  modelosMap:      {},
  rolActual:       ROLES.VISTA,
  COL: {
    checkbox:   0,
    cliente:    1,
    activo:     2,
    serial:     3,
    ip:         4,
    unit_id:    5,
    radio_name: 6,
    grupos:     7,
    sim_tel:    8,
    acciones:   9
  },

  esLectura() {
    return this.rolActual === ROLES.TECNICO || this.rolActual === ROLES.VISTA;
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

  nombreClienteDe(d) {
    const id = d?.cliente_id;
    return (id && this.clientesMap[id]) || d?.cliente || '';
  },

  actualizarResumen({ total = 0, activos = 0, incompletos = 0 } = {}) {
    const el = document.getElementById('resumenEquipos');
    if (!el) return;
    el.innerHTML = `
      <strong title="Total de equipos">${total}</strong>
      <span style="color:var(--muted);font-size:12px;">equipos</span>
      <span class="badge completo" title="Activos">✅ ${activos}</span>
      <span class="badge asignado" title="Incompletos (faltan campos)">⚠️ ${incompletos}</span>
    `;
  },

  async cargarModelosMap() {
    try {
      const modelos = await ModelosService.getModelos();
      this.modelosMap = {};
      modelos.forEach(m => {
        const label = `${(m.marca || '').trim()} ${(m.modelo || '').trim()}`.trim();
        this.modelosMap[m.id] = label || m.modelo || m.marca || m.id;
      });
    } catch (e) {
      console.error('Error al cargar modelos:', e);
      this.modelosMap = {};
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
        const s2 = await db.collection('poc_devices')
          .where('operador', '!=', null).limit(1000).get();
        const set = new Set();
        s2.forEach(doc => {
          const v = (doc.data().operador || '').toString().trim();
          if (v) set.add(v);
        });
        arr = Array.from(set);
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
      document.getElementById('btnImportar')?.remove();
      document.querySelector('.check-all')?.setAttribute('disabled', 'disabled');
    }
  }
};
