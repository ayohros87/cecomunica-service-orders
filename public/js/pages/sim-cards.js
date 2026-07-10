// @ts-nocheck
// Pool de SIM cards — listado, alta manual, edición e import desde Excel.
// Los SIMs disponibles se asignan a equipos desde la lista POC (poc-sim-pool.js).
function cerrarSesion() {
  firebase.auth().signOut()
    .then(() => { window.location.href = '/login.html'; })
    .catch(() => { window.location.href = '/login.html'; });
}

window.SimCards = {
  _sims: [],
  _tab: 'disponible',
  _rol: null,
  _editandoSim: null,
  _importRows: null,
  listaOperadores: [],

  puedeEscribir() {
    return this._rol === ROLES.ADMIN || this._rol === ROLES.RECEPCION;
  },

  // ── Carga ────────────────────────────────────────────────────────────
  async cargar() {
    try {
      this._sims = await SimCardsService.listar();
      this.render();
    } catch (e) {
      console.error('Error al cargar SIMs:', e);
      Toast.show('Error al cargar los SIMs: ' + (e.message || e), 'bad');
    }
  },

  async cargarOperadores() {
    // Mismo origen que el POC: empresa/operadores con fallback a los usados.
    try {
      let arr = [];
      const snap = await EmpresaService.getOperadores();
      if (snap) {
        if (Array.isArray(snap.list)) arr = snap.list;
        else if (Array.isArray(snap.operadores)) arr = snap.operadores;
      }
      if (!arr.length) arr = await PocService.getUniqueOperadores(1000);
      this.listaOperadores = (arr || [])
        .map(v => v.toString().trim()).filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    } catch (e) {
      console.error('Error al cargar operadores:', e);
      this.listaOperadores = [];
    }
    // Poblar los selects que dependen de la lista
    ['simFiltroOperador', 'altaSimOperador', 'editSimOperador'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const base = sel.options[0]?.outerHTML || '<option value="">Seleccione…</option>';
      sel.innerHTML = base + this.listaOperadores
        .map(op => `<option value="${FMT.esc(op)}">${FMT.esc(op)}</option>`).join('');
    });
  },

  // ── Render ───────────────────────────────────────────────────────────
  setTab(tab) {
    this._tab = tab;
    document.querySelectorAll('.sim-tab').forEach(b =>
      b.classList.toggle('is-active', b.dataset.tab === tab));
    this.render();
  },

  _filtrados() {
    const q  = (document.getElementById('simBusqueda')?.value || '').trim().toLowerCase();
    const op = document.getElementById('simFiltroOperador')?.value || '';
    return this._sims.filter(s => {
      if (this._tab !== 'todos' && s.estado !== this._tab) return false;
      if (op && (s.operador || '') !== op) return false;
      if (q) {
        const blob = [s.sim_number, s.sim_phone, s.operador,
          s.asignado_a?.cliente_nombre, s.asignado_a?.serial]
          .map(x => (x || '').toString().toLowerCase()).join(' ');
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  },

  render() {
    const tbody = document.getElementById('simTabla');
    if (!tbody) return;
    const lista = this._filtrados();
    const esc = FMT.esc;

    // Contadores por tab (sobre el total, no sobre el filtro)
    const nDisp = this._sims.filter(s => s.estado === 'disponible').length;
    const nAsig = this._sims.filter(s => s.estado === 'asignado').length;
    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = `(${n})`; };
    setCount('countDisponible', nDisp);
    setCount('countAsignado', nAsig);
    setCount('countTodos', this._sims.length);

    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--fg-3); padding:var(--sp-6);">
        ${this._sims.length ? 'Sin resultados con el filtro actual.' : 'No hay SIMs registrados. Usa "Agregar SIM" o "Importar Excel".'}
      </td></tr>`;
    } else {
      const puede = this.puedeEscribir();
      const esAdmin = this._rol === ROLES.ADMIN;
      tbody.innerHTML = lista.map(s => {
        const asignado = s.estado === 'asignado';
        const asignadoA = asignado && s.asignado_a
          ? `${esc(s.asignado_a.cliente_nombre || '—')}<span class="sim-asignado-a">serial ${esc(s.asignado_a.serial || '—')}</span>`
          : '—';
        const acciones = [
          (puede && !asignado) ? `<button class="btn btn-ghost btn-icon btn-sm" title="Editar teléfono/operador" onclick="SimCards.abrirEdicion('${esc(s.id)}')"><i data-lucide="pencil"></i></button>` : '',
          (esAdmin && !asignado) ? `<button class="btn btn-danger btn-icon btn-sm" title="Eliminar del pool" onclick="SimCards.eliminar('${esc(s.id)}')"><i data-lucide="trash-2"></i></button>` : '',
        ].join('');
        return `<tr>
          <td class="td-mono">${esc(s.sim_number)}</td>
          <td class="td-mono">${esc(s.sim_phone || '—')}</td>
          <td>${esc(s.operador || '—')}</td>
          <td><span class="sim-badge sim-badge-${esc(s.estado)}">${asignado ? 'Asignado' : 'Disponible'}</span></td>
          <td>${asignadoA}</td>
          <td style="font-size:12px; color:var(--fg-3);">${esc(s.origen || '—')}</td>
          <td>${acciones}</td>
        </tr>`;
      }).join('');
    }

    const resumen = document.getElementById('simResumen');
    if (resumen) resumen.innerHTML =
      `<strong>${lista.length}</strong> <span style="color:var(--muted);font-size:12px;">SIMs mostrados</span>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  // ── Alta manual ──────────────────────────────────────────────────────
  abrirAlta() {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o recepción pueden agregar SIMs.', 'bad'); return; }
    document.getElementById('altaSimNumber').value = '';
    document.getElementById('altaSimPhone').value = '';
    document.getElementById('altaSimOperador').selectedIndex = 0;
    Modal.open('simAltaModal');
  },

  async guardarAlta() {
    const sim_number = document.getElementById('altaSimNumber').value;
    const sim_phone  = document.getElementById('altaSimPhone').value;
    const operador   = document.getElementById('altaSimOperador').value;
    if (!SimCardsService.esSimValido(SimCardsService.normalizarSim(sim_number))) {
      Toast.show('Número SIM inválido: se esperan 10-22 dígitos.', 'bad'); return;
    }
    try {
      await SimCardsService.agregar({ sim_number, sim_phone, operador }, firebase.auth().currentUser);
      Modal.close('simAltaModal');
      Toast.show('SIM agregado como disponible.', 'ok');
      this.cargar();
    } catch (e) {
      Toast.show(e.code === 'sim-existe' ? 'Ese SIM ya está registrado en el pool.' : 'Error: ' + (e.message || e), 'bad');
    }
  },

  // ── Edición (teléfono/operador) ──────────────────────────────────────
  abrirEdicion(simId) {
    const s = this._sims.find(x => x.id === simId);
    if (!s) return;
    this._editandoSim = simId;
    document.getElementById('editSimLabel').textContent = simId;
    document.getElementById('editSimPhone').value = s.sim_phone || '';
    const sel = document.getElementById('editSimOperador');
    // Si el operador actual no está en el catálogo, mostrarlo igual.
    if (s.operador && ![...sel.options].some(o => o.value === s.operador)) {
      sel.insertAdjacentHTML('beforeend', `<option value="${FMT.esc(s.operador)}">${FMT.esc(s.operador)}</option>`);
    }
    sel.value = s.operador || '';
    Modal.open('simEditModal');
  },

  async guardarEdicion() {
    if (!this._editandoSim) return;
    try {
      await SimCardsService.actualizar(this._editandoSim, {
        sim_phone: document.getElementById('editSimPhone').value,
        operador:  document.getElementById('editSimOperador').value,
      }, firebase.auth().currentUser);
      Modal.close('simEditModal');
      this._editandoSim = null;
      Toast.show('SIM actualizado.', 'ok');
      this.cargar();
    } catch (e) {
      Toast.show('Error al actualizar: ' + (e.message || e), 'bad');
    }
  },

  async eliminar(simId) {
    if (!await Modal.confirm({
      message: `Vas a eliminar el SIM ${simId} del pool. Esta acción no se puede deshacer.`,
      danger: true, confirmLabel: 'Eliminar',
    })) return;
    try {
      await SimCardsService.eliminar(simId);
      Toast.show('SIM eliminado.', 'ok');
      this.cargar();
    } catch (e) {
      Toast.show('Error al eliminar: ' + (e.message || e), 'bad');
    }
  },

  // ── Import Excel ─────────────────────────────────────────────────────
  abrirImport() {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o recepción pueden importar SIMs.', 'bad'); return; }
    this._importRows = null;
    document.getElementById('simImportFile').value = '';
    document.getElementById('importPreview').innerHTML = '';
    document.getElementById('btnConfirmarImport').disabled = true;
    Modal.open('simImportModal');
  },

  cerrarImport() {
    Modal.close('simImportModal');
    this._importRows = null;
  },

  descargarPlantilla() {
    const ws = XLSX.utils.json_to_sheet([
      { SIM: '8950701000000000000', TELEFONO: '6123-4567', OPERADOR: 'MAS MOVIL' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SIMS');
    XLSX.writeFile(wb, 'plantilla-sim-cards.xlsx');
  },

  // Encuentra la columna del archivo cuyo header calza con los alias conocidos.
  _mapearColumnas(headers) {
    const norm = h => (h || '').toString().trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const buscar = (alias) => headers.find(h => alias.some(a => norm(h).includes(a)));
    return {
      sim:      buscar(['iccid', 'simcard', 'sim card', 'sim']),
      telefono: buscar(['telefono', 'tel simcard', 'phone', 'tel']),
      operador: buscar(['operador', 'operator', 'proveedor']),
    };
  },

  async previsualizarImport(input) {
    const archivo = input.files?.[0];
    if (!archivo) return;
    const preview = document.getElementById('importPreview');
    try {
      const data = await archivo.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!jsonData.length) { preview.innerHTML = '<p style="color:var(--fg-3);">El archivo no tiene filas.</p>'; return; }

      const cols = this._mapearColumnas(Object.keys(jsonData[0]));
      if (!cols.sim) {
        preview.innerHTML = '<p style="color:#b91c1c;">No se encontró la columna del SIM. Se espera un header <code>SIM</code>, <code>ICCID</code> o <code>SIMCARD</code>.</p>';
        return;
      }

      const rows = jsonData.map(f => ({
        sim_number: f[cols.sim],
        sim_phone:  cols.telefono ? f[cols.telefono] : '',
        operador:   cols.operador ? f[cols.operador] : '',
      }));
      const validos = rows.filter(r => SimCardsService.esSimValido(SimCardsService.normalizarSim(r.sim_number)));
      const invalidos = rows.length - validos.length;
      this._importRows = rows;

      const esc = FMT.esc;
      const muestra = validos.slice(0, 8).map(r => `<tr>
        <td class="td-mono">${esc(SimCardsService.normalizarSim(r.sim_number))}</td>
        <td class="td-mono">${esc((r.sim_phone || '').toString().trim() || '—')}</td>
        <td>${esc((r.operador || '').toString().trim() || '—')}</td>
      </tr>`).join('');
      preview.innerHTML = `
        <div style="margin-bottom:var(--sp-2);">
          <span class="import-stat"><strong>${rows.length}</strong> filas</span>
          <span class="import-stat" style="color:#15803d;"><strong>${validos.length}</strong> válidas</span>
          <span class="import-stat" style="color:#b91c1c;"><strong>${invalidos}</strong> inválidas</span>
        </div>
        <div class="app-table-wrap" style="max-height:220px; overflow:auto;">
          <table class="app-table compact">
            <thead><tr><th>SIM</th><th>Teléfono</th><th>Operador</th></tr></thead>
            <tbody>${muestra}</tbody>
          </table>
        </div>
        ${validos.length > 8 ? `<p style="font-size:12px; color:var(--fg-3); margin:var(--sp-2) 0 0;">Mostrando 8 de ${validos.length} filas válidas.</p>` : ''}`;
      document.getElementById('btnConfirmarImport').disabled = validos.length === 0;
    } catch (e) {
      console.error('Error al leer el archivo:', e);
      preview.innerHTML = '<p style="color:#b91c1c;">No se pudo leer el archivo. ¿Es un Excel válido?</p>';
    }
  },

  async confirmarImport() {
    if (!this._importRows) return;
    const btn = document.getElementById('btnConfirmarImport');
    btn.disabled = true;
    btn.innerHTML = 'Importando…';
    try {
      const res = await SimCardsService.importar(this._importRows, firebase.auth().currentUser);
      Toast.show(`Import completado: ${res.nuevos} nuevos, ${res.existentes} ya existían, ${res.invalidos} inválidos.`, 'ok');
      this.cerrarImport();
      this.cargar();
    } catch (e) {
      console.error('Error al importar:', e);
      Toast.show('Error al importar: ' + (e.message || e), 'bad');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check"></i> Importar';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '/login.html'; return; }
    const userDoc = await UsuariosService.getUsuario(user.uid);
    SimCards._rol = userDoc?.rol || ROLES.VISTA;

    // Mismo universo de acceso que el módulo POC; escritura solo admin/recepción.
    const permitidos = [ROLES.ADMIN, ROLES.RECEPCION, ROLES.TECNICO, ROLES.VISTA, ROLES.JEFE_TALLER, ROLES.GERENTE];
    if (!permitidos.includes(SimCards._rol)) {
      Toast.show('No autorizado. Tu rol no tiene acceso a este módulo.', 'bad');
      window.location.href = '/index.html';
      return;
    }
    if (!SimCards.puedeEscribir()) {
      document.getElementById('btnAgregarSim')?.remove();
      document.getElementById('btnImportarSims')?.remove();
      document.getElementById('btnPlantilla')?.remove();
    }
    await SimCards.cargarOperadores();
    await SimCards.cargar();
  });
});
