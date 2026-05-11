// @ts-nocheck
// Vendedores batch tool — all logic in window.VB
window.VB = {
  grupos:                 [],
  modelosDisponibles:     [],
  clienteIDSeleccionado:  null,
  clienteNombreSeleccionado: null,
  clientesCache:          [],
  clientesCargados:       false,
  gruposClienteCache:     new Map(),
  _draftKey:              null,
  _timeoutCliente:        null,

  // ---- LS cache helpers ----
  lsGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { exp, data } = JSON.parse(raw);
      return (!exp || Date.now() > exp) ? null : data;
    } catch { return null; }
  },
  lsSet(key, data, ttlMs = 6 * 60 * 60 * 1000) {
    localStorage.setItem(key, JSON.stringify({ exp: Date.now() + ttlMs, data }));
  },

  // ---- Model loading ----
  async cargarModelos() {
    const cached = this.lsGet('cache_modelos_v1');
    if (cached) { this.modelosDisponibles = cached; return; }
    try {
      const lista = await ModelosService.getModelos();
      this.modelosDisponibles = lista
        .map(m => ({ id: m.id, marca: m.marca || '', modelo: m.modelo || '', tipo: m.tipo || '', estado: m.estado || '', alto_movimiento: !!m.alto_movimiento, activo: m.activo !== false }))
        .filter(m => m.activo)
        .sort((a, b) => {
          if (a.marca.toLowerCase() !== b.marca.toLowerCase()) return a.marca.toLowerCase().localeCompare(b.marca.toLowerCase());
          return a.modelo.toLowerCase().localeCompare(b.modelo.toLowerCase());
        })
        .map(m => ({ ...m, label: `${m.marca} ${m.modelo}`.trim() }));
      this.lsSet('cache_modelos_v1', this.modelosDisponibles);
    } catch (e) { console.error('Error al cargar modelos:', e); this.modelosDisponibles = []; }
  },

  poblarDropdownModeloGlobal() {
    const sel = document.getElementById('modeloGlobal');
    if (!sel) return;
    sel.innerHTML = ['<option value="">— Selecciona modelo —</option>',
      ...this.modelosDisponibles.map(m => `<option value="${m.id}">${m.label}</option>`)
    ].join('');
  },

  async refrescarModelos() {
    localStorage.removeItem('cache_modelos_v1');
    try {
      const lista = await ModelosService.getModelos({ source: 'server' });
      this.modelosDisponibles = lista
        .map(m => ({ id: m.id, marca: m.marca || '', modelo: m.modelo || '', tipo: m.tipo || '', estado: m.estado || '', alto_movimiento: !!m.alto_movimiento, activo: m.activo !== false }))
        .filter(m => m.activo)
        .sort((a, b) => {
          if (a.marca.toLowerCase() !== b.marca.toLowerCase()) return a.marca.toLowerCase().localeCompare(b.marca.toLowerCase());
          return a.modelo.toLowerCase().localeCompare(b.modelo.toLowerCase());
        })
        .map(m => ({ ...m, label: `${m.marca} ${m.modelo}`.trim() }));
      this.poblarDropdownModeloGlobal();
      this.lsSet('cache_modelos_v1', this.modelosDisponibles);
      Toast.show('Lista de modelos actualizada ✅', 'ok');
    } catch (e) { console.error('Error al refrescar modelos:', e); Toast.show('Error al refrescar modelos', 'bad'); }
  },

  // ---- Client cache loading ----
  async cargarClientesCache() {
    const cached = this.lsGet('cache_clientes_v1');
    if (cached && Array.isArray(cached) && cached.length) { this.clientesCache = cached; this.clientesCargados = true; return; }
    const clientes = await ClientesService.getAllClientes();
    this.clientesCache = clientes.map(c => {
      const nombre = (c.nombre || '').toString();
      return { id: c.id, nombre, norm: FMT.normalize(nombre) };
    });
    this.lsSet('cache_clientes_v1', this.clientesCache);
    this.clientesCargados = true;
  },

  async refrescarClientes() {
    try {
      localStorage.removeItem('cache_clientes_v1');
      this.clientesCargados = false;
      await this.cargarClientesCache();
      Toast.show('Lista de clientes actualizada ✅', 'ok');
    } catch (e) { console.error('Error al refrescar clientes:', e); Toast.show('Error al refrescar clientes', 'bad'); }
  },

  // ---- Client autocomplete ----
  sugerirClientes() {
    const contenedor = document.getElementById('sugerenciasClientes');
    contenedor.innerHTML = '';
    const inputEl = document.getElementById('clienteGlobal');
    const texto   = (inputEl.value || '').trim();
    if (texto.length < 2) { this.clienteIDSeleccionado = null; this.clienteNombreSeleccionado = null; return; }
    clearTimeout(this._timeoutCliente);
    this._timeoutCliente = setTimeout(async () => {
      if (!this.clientesCargados) { try { await this.cargarClientesCache(); } catch (e) { console.error(e); } }
      const needle  = FMT.normalize(texto);
      let matches   = this.clientesCache
        .filter(c => c.norm.includes(needle))
        .map(c => ({ id: c.id, nombre: c.nombre, pos: c.norm.indexOf(needle) }));
      matches.sort((a, b) => a.pos !== b.pos ? a.pos - b.pos : a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
      this.renderSugerencias(matches, contenedor, inputEl);
    }, 200);
  },

  toTitleCase(str) {
    return (str || '').toLowerCase().replace(/\b[\p{L}\p{M}]+/gu, s => s.charAt(0).toUpperCase() + s.slice(1));
  },

  renderSugerencias(items, contenedor, inputEl) {
    contenedor.innerHTML = '';
    if (!items || !items.length) return;
    const lista = document.createElement('ul');
    lista.className = 'suggest-list';
    items.forEach(it => {
      const li = document.createElement('li');
      li.className = 'suggest-item';
      li.textContent = this.toTitleCase(it.nombre || '');
      li.onclick = () => {
        inputEl.value = it.nombre || '';
        VB.clienteIDSeleccionado      = it.id;
        VB.clienteNombreSeleccionado  = it.nombre || '';
        contenedor.innerHTML = '';
        VB.buscarGruposCliente();
      };
      lista.appendChild(li);
    });
    contenedor.appendChild(lista);
  },

  // ---- Groups search ----
  async buscarGruposCliente() {
    const escrito    = (document.getElementById('clienteGlobal').value || '').trim();
    let nombreExacto = this.clienteNombreSeleccionado || escrito;
    if (!this.clientesCargados) { try { await this.cargarClientesCache(); } catch (_) {} }
    if (!this.clienteNombreSeleccionado && nombreExacto) {
      const needle = FMT.normalize(nombreExacto);
      const hit    = (this.clientesCache || []).find(c => c.norm === needle);
      if (hit) {
        nombreExacto = hit.nombre;
        this.clienteNombreSeleccionado = hit.nombre;
        this.clienteIDSeleccionado     = hit.id;
        document.getElementById('clienteGlobal').value = hit.nombre;
      }
    }
    if (!nombreExacto) { alert('Primero escribe el nombre del cliente.'); return; }

    const cacheKey = this.clienteIDSeleccionado || FMT.normalize(nombreExacto);
    const lsKey    = 'grupos_id_' + cacheKey;

    if (this.gruposClienteCache.has(cacheKey)) {
      const g = this.gruposClienteCache.get(cacheKey);
      document.getElementById('grupoInput').value = g.join(', ');
      this.renderGrupoChips(); this.actualizarResumenBatch(); this.feedbackGrupos(g.length);
      return;
    }
    const gLS = this.lsGet(lsKey);
    if (gLS && Array.isArray(gLS) && gLS.length) {
      this.gruposClienteCache.set(cacheKey, gLS);
      document.getElementById('grupoInput').value = gLS.join(', ');
      this.renderGrupoChips(); this.actualizarResumenBatch(); this.feedbackGrupos(gLS.length);
      return;
    }
    try {
      const devices = await PocService.getByCliente({
        clienteId: this.clienteIDSeleccionado || null,
        clienteNombre: this.clienteIDSeleccionado ? null : nombreExacto,
      });
      const gruposSet = new Set();
      devices.forEach(d => {
        if (d.deleted === true) return;
        (d.grupos || []).forEach(g => { const v = (g || '').toString().trim(); if (v) gruposSet.add(v); });
      });
      const found = Array.from(gruposSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
      if (!found.length) { alert('No se encontraron grupos para este cliente.'); return; }
      this.gruposClienteCache.set(cacheKey, found);
      this.lsSet(lsKey, found);
      document.getElementById('grupoInput').value = found.join(', ');
      this.renderGrupoChips(); this.actualizarResumenBatch(); this.feedbackGrupos(found.length);
    } catch (e) { console.error('Error buscando grupos:', e); alert('Ocurrió un error al buscar los grupos.'); }
  },

  feedbackGrupos(n) {
    let el = document.getElementById('estadoFeedback');
    const input = document.getElementById('grupoInput');
    if (!el) { el = document.createElement('div'); el.id = 'estadoFeedback'; input.after(el); }
    el.textContent = `✅ Grupos encontrados: ${n}`;
    el.style.cssText = 'color:green;padding:6px 12px;background:#e6ffe6;border:1px solid #7ccc7c;border-radius:5px;margin-top:10px;';
    setTimeout(() => el.remove(), 5000);
  },

  // ---- Groups chip editor ----
  renderGrupoChips() {
    const cont = document.getElementById('grupoChips');
    const val  = (document.getElementById('grupoInput').value || '');
    const arr  = val.split(',').map(s => s.trim()).filter(Boolean);
    VB.grupos  = arr;
    this.actualizarResumenBatch();
    cont.innerHTML = arr.map((g, i) => `
      <span class="chip-x">${g} <button title="Quitar" onclick="VB.quitarGrupo(${i})">×</button></span>
    `).join('') + `<button class="btn btn-pill" onclick="VB.agregarGrupoPrompt()" title="Agregar grupo"><span style="margin-right:4px">+</span> Grupo</button>`;
  },

  quitarGrupo(index) {
    const input = document.getElementById('grupoInput');
    const arr   = input.value.split(',').map(s => s.trim()).filter(Boolean);
    arr.splice(index, 1);
    input.value = arr.join(', ');
    this.renderGrupoChips();
    if (document.getElementById('tablaEquipos').style.display !== 'none') this.generarTabla();
  },

  agregarGrupoPrompt() {
    const g = prompt('Nombre del grupo:');
    if (!g) return;
    const input = document.getElementById('grupoInput');
    const arr   = input.value.split(',').map(s => s.trim()).filter(Boolean);
    arr.push(g.trim());
    input.value = arr.join(', ');
    this.renderGrupoChips();
    if (document.getElementById('tablaEquipos').style.display !== 'none') this.generarTabla();
  },

  agregarGrupo() {
    const nuevoGrupo = prompt('Nombre del nuevo grupo:');
    if (!nuevoGrupo) return;
    const input = document.getElementById('grupoInput');
    const arr   = input.value.split(',').map(g => g.trim()).filter(Boolean);
    arr.push(nuevoGrupo.trim());
    input.value = arr.join(', ');
    this.renderGrupoChips();
    this.generarTabla();
  },

  // ---- Batch table ----
  generarTabla() {
    const cliente = document.getElementById('clienteGlobal').value.trim();
    if (/[\\/#[\]$]/.test(cliente)) {
      Toast.show('El nombre del cliente contiene caracteres no permitidos: / # [ ] $', 'bad');
      return;
    }
    const input = document.getElementById('grupoInput').value;
    VB.grupos = input.split(',').map(g => g.trim()).filter(Boolean);
    const grupos = VB.grupos;

    const nombres = document.getElementById('serialesPaste').value.trim().split('\n').map(s => s.trim()).filter(Boolean);
    document.getElementById('encabezadoTabla').innerHTML = `
      <th>Cliente</th>
      <th>Nombre del Radio</th>
      <th><input type="checkbox" id="gpsMaster" onchange="VB.toggleGPS(this)"> GPS</th>
      ${grupos.map((g, i) => `<th><input type='checkbox' onchange='VB.toggleGrupo(${i}, this)'> ${g}</th>`).join('')}
      <th>Modelo</th>
      <th></th>
    `;
    document.getElementById('tablaEquipos').style.display = 'table';
    document.getElementById('wrapTablaEquipos').style.display = 'block';
    document.getElementById('scrollHintEquipos').style.display = 'block';
    document.getElementById('tableSection').style.display = 'flex';
    document.getElementById('exportSection').style.display = 'flex';
    document.getElementById('actionCard').style.display = 'block';
    this.actualizarResumenBatch();
    const cuerpo = document.getElementById('cuerpoTabla');
    cuerpo.innerHTML = '';
    nombres.forEach(n => this.agregarFila('', n));
    document.getElementById('tablaEquipos').scrollIntoView({ behavior: 'smooth' });
  },

  agregarFila(_, nombreRadio = '') {
    const cliente      = document.getElementById('clienteGlobal').value;
    const modeloGlobal = document.getElementById('modeloGlobal').value;
    const grupos       = VB.grupos;
    const fila         = document.createElement('tr');
    fila.innerHTML = `
      <td>${cliente}</td>
      <td><input type="text" class="table-input nombre" value="${nombreRadio}"></td>
      <td><input type="checkbox" class="table-checkbox gps"></td>
      ${grupos.map(() => `<td><input type="checkbox" class="table-checkbox grupo"></td>`).join('')}
      <td>
        <select class="table-input table-select modelo">
          <option value="">— Selecciona modelo —</option>
          ${VB.modelosDisponibles.map(m => `<option value="${m.id}" ${m.id === modeloGlobal ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </td>
      <td><button class="btn danger" onclick="this.closest('tr').remove(); VB.actualizarResumenBatch();">❌</button></td>
    `;
    fila.dataset.cliente = cliente;
    document.getElementById('tablaEquipos').style.display = 'table';
    document.getElementById('cuerpoTabla').appendChild(fila);
    document.getElementById('wrapTablaEquipos').style.display = 'block';
    document.getElementById('scrollHintEquipos').style.display = 'block';
    document.getElementById('tableSection').style.display = 'flex';
    document.getElementById('exportSection').style.display = 'flex';
    document.getElementById('actionCard').style.display = 'block';
    this.actualizarResumenBatch();
    fila.addEventListener('click', () => fila.classList.toggle('selected'));
    fila.addEventListener('keydown', e => { if (e.key === 'Delete') { fila.remove(); VB.actualizarResumenBatch(); } });
  },

  toggleGrupo(index, master) {
    document.querySelectorAll('#cuerpoTabla tr').forEach(fila => {
      const checks = fila.querySelectorAll('.grupo');
      if (checks[index]) checks[index].checked = master.checked;
    });
  },

  toggleGPS(master) {
    document.querySelectorAll('.gps').forEach(c => c.checked = master.checked);
  },

  resetTablaEdicion() {
    const thead = document.querySelector('#tablaEquipos thead');
    const tbody = document.getElementById('cuerpoTabla');
    const table = document.getElementById('tablaEquipos');
    if (thead) {
      thead.innerHTML = `
        <tr id="encabezadoTabla">
          <th>Cliente</th><th>Nombre del Radio</th>
          <th><input type="checkbox" id="gpsMaster" onchange="VB.toggleGPS(this)"> GPS</th>
          <th>Modelo</th><th>🗑️</th>
        </tr>`;
    }
    if (tbody) tbody.innerHTML = '';
    if (table) table.style.display = 'none';
    document.getElementById('wrapTablaEquipos').style.display = 'none';
    document.getElementById('scrollHintEquipos').style.display = 'none';
    document.getElementById('tableSection').style.display = 'none';
    document.getElementById('exportSection').style.display = 'none';
    document.getElementById('actionCard').style.display = 'none';
    this.actualizarResumenBatch();
  },

  actualizarResumenBatch() {
    const resumenEl = document.getElementById('resumenBatch');
    if (!resumenEl) return;
    const filas      = document.querySelectorAll('#cuerpoTabla tr').length;
    const gruposArr  = (document.getElementById('grupoInput').value || '').split(',').map(g => g.trim()).filter(Boolean);
    const tooltip    = gruposArr.length ? gruposArr.join(', ') : 'Sin grupos';
    resumenEl.innerHTML = `<strong>${filas}</strong> filas · <span class="badge completo" title="${tooltip}">${gruposArr.length}</span>`;
  },

  setStep(step) {
    document.getElementById('step-prep').classList.toggle('active', step === 'prep');
    document.getElementById('step-rev').classList.toggle('active', step === 'rev');
    document.getElementById('step-exp').classList.toggle('active', step === 'exp');
  },

  limpiarTodo() {
    ['clienteGlobal','modeloGlobal','grupoInput','serialesPaste'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const sug = document.getElementById('sugerenciasClientes');
    const sal = document.getElementById('salida');
    if (sug) sug.innerHTML = '';
    if (sal) sal.innerHTML = '';
    const fb = document.getElementById('estadoFeedback');
    if (fb) fb.remove();
    this.clienteIDSeleccionado   = null;
    this.clienteNombreSeleccionado = null;
    VB.grupos = [];
    this.renderGrupoChips();
    this.actualizarResumenBatch();
    this.resetTablaEdicion();
    this.setStep('prep');
  },

  // ---- Export / review ----
  generarJSON() {
    const filas      = document.querySelectorAll('#cuerpoTabla tr');
    const inputNombre = (document.getElementById('clienteGlobal').value || '').trim();
    let cid = this.clienteIDSeleccionado || null;
    let cn  = this.clienteNombreSeleccionado || inputNombre;
    if (!cid && cn && this.clientesCache.length) {
      const needle = FMT.normalize(cn);
      const hit    = this.clientesCache.find(c => c.norm === needle);
      if (hit) { cid = hit.id; cn = hit.nombre; }
    }
    if (!cn) { alert('⚠️ Escribe el nombre del cliente o selecciónalo de la lista.'); return []; }
    const datos = [];
    filas.forEach(fila => {
      const nombre   = (fila.querySelector('.nombre')?.value || '').trim();
      const gps      = !!fila.querySelector('.gps')?.checked;
      const modeloId = (fila.querySelector('.modelo')?.value || '').trim();
      const checks   = fila.querySelectorAll('.grupo');
      const gruposMarcados = VB.grupos.filter((g, i) => checks[i]?.checked);
      if (nombre) {
        const modeloSel = this.modelosDisponibles.find(m => m.id === modeloId);
        datos.push({ cliente_id: cid, cliente_nombre: cn, radio_name: nombre, gps, modelo_id: modeloId || null, modelo_label: modeloSel ? modeloSel.label : '', grupos: gruposMarcados });
      }
    });
    return datos;
  },

  mostrarTablaResultado() {
    const datos  = this.generarJSON();
    const salida = document.getElementById('salida');
    salida.innerHTML = `
      <div class="table-wrap compact">
        <table>
          <thead><tr><th>Cliente</th><th>Nombre</th><th>GPS</th><th>Modelo</th><th class="col-grupos">Grupos</th></tr></thead>
          <tbody>
            ${datos.map(d => `
              <tr>
                <td>${d.cliente_nombre}</td>
                <td>${d.radio_name}</td>
                <td>${d.gps ? '✅' : ''}</td>
                <td>${d.modelo_label || ''}</td>
                <td class="col-grupos">${(d.grupos || []).join(', ')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
    document.querySelector('#salida .table-wrap').scrollIntoView({ behavior: 'smooth' });
    this.setStep('rev');
  },

  descargarExcel() {
    const filas   = document.querySelectorAll('#cuerpoTabla tr');
    const cliente = (this.clienteNombreSeleccionado || document.getElementById('clienteGlobal').value || '').trim();
    const datos   = [];
    filas.forEach(fila => {
      const nombre   = (fila.querySelector('.nombre')?.value || '').trim();
      const gps      = fila.querySelector('.gps')?.checked ? '✅' : '';
      const sel      = fila.querySelector('.modelo');
      const modeloId = (sel?.value || '').trim();
      const fromCatalog = this.modelosDisponibles.find(m => m.id === modeloId);
      const fromSelect  = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent.trim() : '';
      const modeloLabel = fromCatalog ? fromCatalog.label : (fromSelect === '— Selecciona modelo —' ? '' : fromSelect);
      const checks = fila.querySelectorAll('.grupo');
      const row    = { Cliente: cliente, 'Nombre del Radio': nombre, GPS: gps, Modelo: modeloLabel };
      VB.grupos.forEach((g, i) => { row[g] = checks[i]?.checked ? '✅' : ''; });
      datos.push(row);
    });
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Equipos');
    XLSX.writeFile(wb, 'equipos-vendedores.xlsx');
    this.setStep('exp');
  },

  descargarJSON() {
    const datos = this.generarJSON();
    if (!datos.length) { alert('No hay datos para descargar.'); return; }
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'equipos-vendedores.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    this.setStep('exp');
  },

  // ---- Draft autosave ----
  saveDraft() {
    if (!this._draftKey) return;
    const draft = {
      cliente: document.getElementById('clienteGlobal').value || '',
      modelo:  document.getElementById('modeloGlobal').value  || '',
      grupos:  document.getElementById('grupoInput').value    || '',
      lista:   document.getElementById('serialesPaste').value || '',
      tabla: Array.from(document.querySelectorAll('#cuerpoTabla tr')).map(tr => ({
        nombre: tr.querySelector('.nombre')?.value || '',
        gps:    !!tr.querySelector('.gps')?.checked,
        modelo: tr.querySelector('.modelo')?.value || '',
        grupos: Array.from(tr.querySelectorAll('.grupo')).map(ch => !!ch.checked)
      }))
    };
    localStorage.setItem(this._draftKey, JSON.stringify(draft));
    Toast.show('Borrador guardado', 'ok');
  },

  restoreDraft() {
    if (!this._draftKey) return;
    try {
      const raw = localStorage.getItem(this._draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      document.getElementById('clienteGlobal').value  = d.cliente || '';
      document.getElementById('modeloGlobal').value   = d.modelo  || '';
      document.getElementById('grupoInput').value     = d.grupos  || '';
      document.getElementById('serialesPaste').value  = d.lista   || '';
      this.renderGrupoChips();
      if ((d.tabla || []).length) {
        VB.grupos = (d.grupos || '').split(',').map(s => s.trim()).filter(Boolean);
        document.getElementById('encabezadoTabla').innerHTML = `
          <th>Cliente</th><th>Nombre del Radio</th>
          <th><input type="checkbox" id="gpsMaster" onchange="VB.toggleGPS(this)"> GPS</th>
          ${VB.grupos.map((g, i) => `<th><input type='checkbox' onchange='VB.toggleGrupo(${i}, this)'> ${g}</th>`).join('')}
          <th>Modelo</th><th>🗑️</th>`;
        document.getElementById('wrapTablaEquipos').style.display = 'block';
        const tbody = document.getElementById('cuerpoTabla');
        tbody.innerHTML = '';
        d.tabla.forEach(r => {
          this.agregarFila('', r.nombre);
          const tr = tbody.lastElementChild;
          tr.querySelector('.gps').checked = !!r.gps;
          const sel = tr.querySelector('.modelo');
          if (sel) sel.value = r.modelo || '';
          tr.querySelectorAll('.grupo').forEach((ch, idx) => { ch.checked = !!(r.grupos || [])[idx]; });
        });
        this.actualizarResumenBatch();
        Toast.show('Borrador restaurado', 'ok');
      }
    } catch (e) { console.warn('No se pudo restaurar borrador', e); }
  },

  clearDraft() {
    if (!this._draftKey) return;
    localStorage.removeItem(this._draftKey);
    Toast.show('Borrador eliminado', 'warn');
  },

  // ---- Step badges ----
  updateStepBadges() {
    const cliente = (document.getElementById('clienteGlobal').value || '').trim();
    const grupos  = (document.getElementById('grupoInput').value || '').trim();
    const lista   = (document.getElementById('serialesPaste').value || '').trim();
    const b1 = document.getElementById('badgeCliente');
    const b2 = document.getElementById('badgeLote');
    if (b1) { b1.textContent = cliente ? 'Listo' : 'Pendiente'; b1.className = cliente ? 'badge ready' : 'badge pending'; }
    if (b2) { b2.textContent = (grupos && lista) ? 'Listo' : 'Pendiente'; b2.className = (grupos && lista) ? 'badge ready' : 'badge pending'; }
  },

  init() {
    document.getElementById('grupoInput').addEventListener('input', () => VB.renderGrupoChips());
    document.addEventListener('DOMContentLoaded', () => VB.renderGrupoChips());

    document.addEventListener('click', e => {
      const box   = document.getElementById('sugerenciasClientes');
      const input = document.getElementById('clienteGlobal');
      if (!box) return;
      if (!box.contains(e.target) && !input.contains(e.target)) box.innerHTML = '';
    });

    document.getElementById('btnGuardarBorrador').addEventListener('click', () => VB.saveDraft());
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); VB.saveDraft(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); VB.generarTabla(); Toast.show('Tabla generada', 'ok'); }
    });

    ['clienteGlobal','grupoInput','serialesPaste'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => VB.updateStepBadges());
    });

    document.addEventListener('DOMContentLoaded', () => { VB.setStep('prep'); VB.updateStepBadges(); });
  }
};

VB.init();

firebase.auth().onAuthStateChanged(async user => {
  if (!user) { window.location.href = '../login.html'; return; }
  try {
    await VB.cargarModelos();
    VB.poblarDropdownModeloGlobal();
    const userDoc = await UsuariosService.getUsuario(user.uid);
    const rol     = userDoc ? userDoc.rol : null;
    if (![ROLES.ADMIN, ROLES.VENDEDOR, ROLES.RECEPCION].includes(rol)) {
      Toast.show('Acceso restringido.', 'bad');
      window.location.href = '../index.html';
      return;
    }
    VB._draftKey = 'vend_batch_draft_' + user.uid;
    VB.restoreDraft();
    setTimeout(() => document.getElementById('clienteGlobal')?.focus(), 100);
  } catch (error) {
    console.error('Error al verificar el rol o cargar modelos:', error);
    window.location.href = '../index.html';
  }
});
