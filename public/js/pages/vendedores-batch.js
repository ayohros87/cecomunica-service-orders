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
  DRAFT_TTL_MS:           3 * 24 * 60 * 60 * 1000,
  _timeoutCliente:        null,
  _autosaveTimer:         null,
  _iconTimer:             null,

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
  // Normaliza, filtra activos, ordena por marca/modelo y agrega label — única
  // ruta de preparación, compartida por la carga inicial y el refresco.
  _mapModelos(lista) {
    return lista
      .map(m => ({ id: m.id, marca: m.marca || '', modelo: m.modelo || '', tipo: m.tipo || '', estado: m.estado || '', alto_movimiento: !!m.alto_movimiento, activo: m.activo !== false }))
      .filter(m => m.activo)
      .sort((a, b) => {
        const ma = a.marca.toLowerCase(), mb = b.marca.toLowerCase();
        if (ma !== mb) return ma.localeCompare(mb);
        return a.modelo.toLowerCase().localeCompare(b.modelo.toLowerCase());
      })
      .map(m => ({ ...m, label: `${m.marca} ${m.modelo}`.trim() }));
  },

  async cargarModelos() {
    const cached = this.lsGet('cache_modelos_v1');
    if (cached) { this.modelosDisponibles = cached; return; }
    try {
      this.modelosDisponibles = this._mapModelos(await ModelosService.getModelos());
      this.lsSet('cache_modelos_v1', this.modelosDisponibles);
    } catch (e) { console.error('Error al cargar modelos:', e); this.modelosDisponibles = []; }
  },

  poblarDropdownModeloGlobal() {
    const sel = document.getElementById('modeloGlobal');
    if (!sel) return;
    sel.innerHTML = ['<option value="">— Selecciona modelo —</option>',
      ...this.modelosDisponibles.map(m => `<option value="${m.id}">${this._esc(m.label)}</option>`)
    ].join('');
  },

  async refrescarModelos() {
    localStorage.removeItem('cache_modelos_v1');
    try {
      this.modelosDisponibles = this._mapModelos(await ModelosService.getModelos({ source: 'server' }));
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
      this.renderSugerencias(matches.slice(0, 30), contenedor, inputEl);
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

  // Carga automática: si el texto escrito coincide exactamente con un cliente
  // del caché (y aún no hay uno seleccionado), lo fija y carga sus grupos sin
  // tener que pulsar "Buscar". Se llama en el blur del input.
  async intentarCargarGruposAuto() {
    if (this.clienteIDSeleccionado) return;
    const texto = (document.getElementById('clienteGlobal').value || '').trim();
    if (texto.length < 3) return;
    if (!this.clientesCargados) { try { await this.cargarClientesCache(); } catch (_) {} }
    const needle = FMT.normalize(texto);
    const hit = (this.clientesCache || []).find(c => c.norm === needle);
    if (!hit) return;
    this.clienteIDSeleccionado     = hit.id;
    this.clienteNombreSeleccionado = hit.nombre;
    document.getElementById('clienteGlobal').value = hit.nombre;
    this.buscarGruposCliente();
  },

  // ---- Groups search ----
  // Fuente de verdad: el catálogo del cliente (clientes/{id}.poc_grupos), leído
  // FRESCO del servidor — así el vendedor ve los grupos que recepción/admin
  // acaban de agregar (la caché local quedaría obsoleta). La caché en memoria
  // evita re-lecturas dentro de la sesión; localStorage queda solo como respaldo
  // offline. `force` (botón "refrescar grupos") salta la caché de sesión.
  async buscarGruposCliente({ force = false } = {}) {
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
    if (!nombreExacto) { Toast.show('Primero escribe el nombre del cliente.', 'bad'); return; }

    const cacheKey = this.clienteIDSeleccionado || FMT.normalize(nombreExacto);
    // v2: invalida cachés viejos que se llenaron con la query solo-por-id
    // (antes faltaban grupos de equipos legacy sin cliente_id).
    const lsKey    = 'grupos_v2_' + cacheKey;

    // Caché de sesión (en memoria): consistente mientras la página esté abierta.
    // El botón refrescar (force) la salta para volver a leer del servidor.
    if (!force && this.gruposClienteCache.has(cacheKey)) {
      this._pintarGrupos(this.gruposClienteCache.get(cacheKey));
      return;
    }

    try {
      // Fuente preferida: el catálogo canónico del cliente
      // (clientes/{id}.poc_grupos), leído FRESCO. Para clientes aún sin catálogo
      // se cae a derivar de los equipos — pasando id Y nombre para incluir
      // equipos legacy que solo tienen `cliente` (string) sin `cliente_id`.
      let found = null;
      if (this.clienteIDSeleccionado) {
        try {
          const cat = await PocService.getCatalogoGrupos(this.clienteIDSeleccionado, { fresh: true });
          if (Array.isArray(cat)) found = cat.slice();
        } catch (_) {}
      }
      if (found === null) {
        const devices = await PocService.getByCliente({
          clienteId: this.clienteIDSeleccionado || null,
          clienteNombre: nombreExacto || null,
          fresh: force,
        });
        const gruposSet = new Set();
        devices.forEach(d => {
          if (d.deleted === true) return;
          (d.grupos || []).forEach(g => { const v = (g || '').toString().trim(); if (v) gruposSet.add(v); });
        });
        found = Array.from(gruposSet);
      }
      found = found.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
      if (!found.length) Toast.show('Este cliente aún no tiene grupos. Agrégalos con “+ Grupo”.', 'warn');
      this.gruposClienteCache.set(cacheKey, found);
      this.lsSet(lsKey, found);
      this._pintarGrupos(found);
    } catch (e) {
      // Sin red: último recurso, lo último que se cacheó en localStorage.
      const gLS = this.lsGet(lsKey);
      if (gLS && Array.isArray(gLS) && gLS.length) {
        this.gruposClienteCache.set(cacheKey, gLS);
        this._pintarGrupos(gLS);
        return;
      }
      console.error('Error buscando grupos:', e);
      Toast.show('Ocurrió un error al buscar los grupos.', 'bad');
    }
  },

  // Descarta grupos basura del catálogo (placeholder de lupa, vacíos, símbolos
  // sueltos, o con el carácter de reemplazo U+FFFD de importaciones corruptas)
  // para que el vendedor no los vea ni los marque por error.
  _grupoValido(g) {
    const s = (g || '').toString().trim();
    return s.length > 1 && s !== '🔍' && !/^[🔍]+$/.test(s) && !s.includes('�');
  },

  // Vuelca una lista de grupos al input + chips + feedback. Único punto de
  // pintado para todas las rutas de buscarGruposCliente.
  _pintarGrupos(arr) {
    const lista = (Array.isArray(arr) ? arr : []).filter(g => this._grupoValido(g));
    document.getElementById('grupoInput').value = lista.join(', ');
    this.renderGrupoChips();           // ya llama a actualizarResumenBatch()
    this.feedbackGrupos(lista.length);
  },

  // Botón "refrescar grupos": salta la caché de sesión y vuelve a leer el
  // catálogo del servidor (para ver grupos que agregó otra persona).
  refrescarGrupos() {
    const nombre = (document.getElementById('clienteGlobal').value || '').trim();
    if (!this.clienteIDSeleccionado && !nombre) {
      Toast.show('Primero selecciona un cliente.', 'warn');
      return;
    }
    this.buscarGruposCliente({ force: true });
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
    const cont  = document.getElementById('grupoChips');
    const input = document.getElementById('grupoInput');
    const val   = (input.value || '');
    const arr   = FMT.dedupGrupos(val.split(','));
    if (arr.join(', ') !== val) input.value = arr.join(', ');
    VB.grupos = arr;
    this.actualizarResumenBatch();
    // Solo-catálogo: los grupos vienen del catálogo del cliente. El × solo los
    // quita de ESTE batch (no toca el catálogo). Para crear grupos nuevos se usa
    // Admin · Grupos.
    cont.innerHTML = arr.length
      ? arr.map((g, i) => `<span class="chip-x">${this._esc(g)} <button title="Quitar del batch" onclick="VB.quitarGrupo(${i})">×</button></span>`).join('')
      : '<span class="chips-empty">Selecciona un cliente para cargar sus grupos.</span>';
    this.scheduleAutosave();
  },

  quitarGrupo(index) {
    const input = document.getElementById('grupoInput');
    const arr   = FMT.dedupGrupos(input.value.split(','));
    const grupo = arr[index];
    arr.splice(index, 1);
    input.value = arr.join(', ');
    this.renderGrupoChips();
    // Quitar el grupo de las filas ya generadas SIN regenerar la tabla:
    // regenerarla borraría GPS/modelo/chips editados y las filas agregadas a mano.
    document.querySelectorAll('#cuerpoTabla .chip').forEach(c => { if (c.dataset.grupo === grupo) c.remove(); });
    this._renderBulkBar();
    this._refrescarEstados();
    this.scheduleAutosave();
  },

  // ---- Batch table ----
  generarTabla() {
    const cliente = document.getElementById('clienteGlobal').value.trim();
    if (/[\\/#[\]$]/.test(cliente)) {
      Toast.show('El nombre del cliente contiene caracteres no permitidos: / # [ ] $', 'bad');
      return;
    }
    const nombres = document.getElementById('serialesPaste').value.trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (!nombres.length) { Toast.show('Pega los nombres de los equipos (uno por línea) antes de generar la tabla.', 'warn'); return; }
    const cuerpoPrevio = document.getElementById('cuerpoTabla');
    if (cuerpoPrevio.children.length &&
        !confirm('La tabla ya tiene filas trabajadas; generarla de nuevo las reemplaza y se pierden los cambios. ¿Continuar?')) return;

    const input = document.getElementById('grupoInput').value;
    VB.grupos = input.split(',').map(g => g.trim()).filter(Boolean);

    document.getElementById('encabezadoTabla').innerHTML = `
      <th>Nombre del Radio</th>
      <th style="text-align:center;">GPS</th>
      <th>Grupos</th>
      <th>Modelo</th>
      <th></th>
    `;
    this._mostrarPasosTabla(true);
    this.actualizarResumenBatch();
    const cuerpo = document.getElementById('cuerpoTabla');
    cuerpo.innerHTML = '';
    nombres.forEach(n => this.agregarFila('', n));
    this._renderBulkBar();   // tras crear las filas (la barra depende de que existan)
    this._refrescarEstados();
    document.getElementById('vbStep3').scrollIntoView({ behavior: 'smooth' });
  },

  // Muestra/oculta los pasos 3 (Equipos) y 4 (Exportación) como una unidad.
  _mostrarPasosTabla(visible) {
    const s3 = document.getElementById('vbStep3');
    const s4 = document.getElementById('vbStep4');
    if (s3) s3.style.display = visible ? 'block' : 'none';
    if (s4) s4.style.display = visible ? 'block' : 'none';
  },

  _esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  // Renderiza los iconos lucide de filas/celdas añadidas dinámicamente. Debounce
  // con setTimeout(0) para coalescer las N llamadas del loop de generarTabla.
  _renderIcons() {
    clearTimeout(this._iconTimer);
    this._iconTimer = setTimeout(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); }, 0);
  },

  // Barra "Aplicar a todas las filas": GPS + un toggle por grupo (master).
  // Reemplaza el viejo marcar-toda-la-columna del encabezado de la matriz.
  // Barra de acciones en lote. Con casillas por fila, aplica MODELO / GPS / grupos
  // a las filas MARCADAS (o a todas si no hay ninguna marcada). Resuelve el caso
  // "el lote tiene varios modelos" sin cambiar fila por fila.
  _renderBulkBar() {
    const bar = document.getElementById('bulkBar');
    if (!bar) return;
    const hayFilas = document.querySelectorAll('#cuerpoTabla tr').length > 0;
    if (!hayFilas) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const modeloOpts = ['<option value="">— Modelo —</option>',
      ...this.modelosDisponibles.map(m => `<option value="${this._esc(m.id)}">${this._esc(m.label)}</option>`)
    ].join('');
    const togglesGrupos = VB.grupos.length
      ? `<span class="vb-bulk-sep"></span>` +
        `<label class="vb-bulk-item"><input type="checkbox" class="bulk-gps"> GPS</label>` +
        VB.grupos.map(g => `<label class="vb-bulk-item"><input type="checkbox" class="bulk-grupo" data-grupo="${this._esc(g)}"> ${this._esc(g)}</label>`).join('')
      : '';
    bar.innerHTML =
      `<label class="vb-bulk-item"><input type="checkbox" class="bulk-marcar-todas"> Marcar todas</label>` +
      `<span class="vb-bulk-count" id="bulkCount">ninguna marcada</span>` +
      `<span class="vb-bulk-sep"></span>` +
      `<span class="vb-bulk-label">Aplicar a las marcadas (o a todas):</span>` +
      `<select class="form-select vb-bulk-modelo" id="bulkModelo">${modeloOpts}</select>` +
      `<button type="button" class="btn btn-secondary btn-sm" onclick="VB.aplicarModeloAMarcadas()"><i data-lucide="check"></i> Aplicar modelo</button>` +
      togglesGrupos;
    const marcar = bar.querySelector('.bulk-marcar-todas');
    if (marcar) marcar.addEventListener('change', e => VB.marcarTodas(e.target.checked));
    const gps = bar.querySelector('.bulk-gps');
    if (gps) gps.addEventListener('change', e => { VB.toggleGPS(e.target); VB.scheduleAutosave(); });
    bar.querySelectorAll('.bulk-grupo').forEach(cb => {
      cb.addEventListener('change', e => { VB.aplicarGrupoATodas(e.target.dataset.grupo, e.target.checked); VB.scheduleAutosave(); });
    });
    this._actualizarSeleccion();
    this._renderIcons();
  },

  // Filas objetivo de las acciones en lote: las MARCADAS, o TODAS si no hay marca.
  _filasObjetivo() {
    const todas = Array.from(document.querySelectorAll('#cuerpoTabla tr'));
    const marcadas = todas.filter(tr => tr.querySelector('.rowsel')?.checked);
    return marcadas.length ? marcadas : todas;
  },

  // Actualiza el contador "N marcadas" y el estado del checkbox "Marcar todas".
  _actualizarSeleccion() {
    const all  = document.querySelectorAll('#cuerpoTabla .rowsel');
    const marc = document.querySelectorAll('#cuerpoTabla .rowsel:checked');
    const count = document.getElementById('bulkCount');
    if (count) count.textContent = marc.length ? `${marc.length} marcada(s)` : 'ninguna marcada';
    const master = document.querySelector('.bulk-marcar-todas');
    if (master) {
      master.checked = all.length > 0 && marc.length === all.length;
      master.indeterminate = marc.length > 0 && marc.length < all.length;
    }
    // Resalta las filas marcadas (borde izquierdo) para verlas de un vistazo.
    document.querySelectorAll('#cuerpoTabla tr').forEach(tr => {
      const cb = tr.querySelector('.rowsel');
      tr.classList.toggle('fila-marcada', !!(cb && cb.checked));
    });
  },

  marcarTodas(check) {
    document.querySelectorAll('#cuerpoTabla .rowsel').forEach(cb => { cb.checked = check; });
    this._actualizarSeleccion();
  },

  // Aplica el modelo elegido en la barra a las filas objetivo (marcadas o todas).
  aplicarModeloAMarcadas() {
    const modeloId = document.getElementById('bulkModelo')?.value || '';
    if (!modeloId) { Toast.show('Elige un modelo en la barra para aplicarlo.', 'warn'); return; }
    const filas = this._filasObjetivo();
    filas.forEach(tr => { const sel = tr.querySelector('.modelo'); if (sel) sel.value = modeloId; });
    this._refrescarEstados();
    this.scheduleAutosave();
    const nombre = this.modelosDisponibles.find(m => m.id === modeloId)?.label || 'modelo';
    const huboMarca = document.querySelectorAll('#cuerpoTabla .rowsel:checked').length > 0;
    Toast.show(`${nombre} aplicado a ${filas.length} equipo(s)${huboMarca ? ' marcados' : ' (todos)'}.`, 'ok');
  },

  agregarFila(_, nombreRadio = '') {
    const cliente      = document.getElementById('clienteGlobal').value;
    const modeloGlobal = document.getElementById('modeloGlobal').value;
    const grupos       = VB.grupos;
    const fila         = document.createElement('tr');
    const gruposChips = grupos.map(g =>
      `<button type="button" class="chip" data-grupo="${VB._esc(g)}" onclick="event.stopPropagation(); VB.toggleChipFila(this)">${VB._esc(g)}</button>`
    ).join('');
    // Celda de grupos: chips + contador de marcados + aviso "sin grupo" + acción
    // "a todo el modelo" (copia los grupos marcados a las filas del mismo modelo).
    const celdaGrupos = grupos.length
      ? `<div class="chips">${gruposChips}` +
          `<span class="gcount"></span>` +
          `<span class="sin-grupo-flag">— sin grupo —</span>` +
          `<button type="button" class="gaplicar" title="Copiar los grupos marcados a todas las filas del mismo modelo" onclick="VB.aplicarGruposModelo(this)">⎘ a todo el modelo</button></div>`
      : '<span class="chips-empty">—</span>';
    fila.innerHTML = `
      <td class="cell-nombre"><input type="checkbox" class="rowsel" title="Marcar esta fila" onchange="VB._actualizarSeleccion()"><span class="rowdot" title=""></span><input type="text" class="table-input nombre" value="${VB._esc(nombreRadio)}"></td>
      <td style="text-align:center;"><input type="checkbox" class="table-checkbox gps"></td>
      <td class="grupos-cell">${celdaGrupos}</td>
      <td>
        <select class="table-input table-select modelo">
          <option value="">— Selecciona modelo —</option>
          ${VB.modelosDisponibles.map(m => `<option value="${m.id}" ${m.id === modeloGlobal ? 'selected' : ''}>${VB._esc(m.label)}</option>`).join('')}
        </select>
      </td>
      <td><button class="btn btn-ghost btn-sm" title="Quitar fila" onclick="this.closest('tr').remove(); VB.actualizarResumenBatch(); VB._refrescarEstados(); VB._actualizarSeleccion(); VB.scheduleAutosave();"><i data-lucide="trash-2"></i></button></td>
    `;
    fila.dataset.cliente = cliente;
    document.getElementById('cuerpoTabla').appendChild(fila);
    this._mostrarPasosTabla(true);
    this.actualizarResumenBatch();
    this._refrescarEstados();
    // Asegura la barra en lote (primera fila) sin re-renderizarla si ya existe
    // (para no perder el modelo elegido en la barra); si ya está, solo el contador.
    const _bar = document.getElementById('bulkBar');
    if (_bar && !_bar.innerHTML) this._renderBulkBar(); else this._actualizarSeleccion();
    this.scheduleAutosave();
    this._renderIcons();
    // Sin atajo de teclado para borrar fila: la tecla Supr burbujeaba desde los
    // inputs y eliminaba la fila mientras se editaba texto. Solo el botón 🗑.
  },

  // Aplica (o quita) un grupo en TODAS las filas — desde la barra "Aplicar a todas".
  aplicarGrupoATodas(grupo, on) {
    this._filasObjetivo().forEach(tr => {
      tr.querySelectorAll('.chip').forEach(chip => {
        if (chip.dataset.grupo === grupo) chip.classList.toggle('active', !!on);
      });
    });
    this._refrescarEstados();
  },

  // Copia los grupos MARCADOS de una fila a todas las filas del MISMO modelo.
  // Los radios de un mismo modelo suelen compartir grupos: el vendedor marca uno
  // y lo replica de un clic (llena bloques que quedarían vacíos, como los PNC460).
  aplicarGruposModelo(btn) {
    const tr = btn && btn.closest('tr');
    if (!tr) return;
    const modelo = tr.querySelector('.modelo')?.value || '';
    if (!modelo) { Toast.show('Elige primero el modelo de esta fila para copiar sus grupos a las del mismo modelo.', 'warn'); return; }
    const activos = new Set(Array.from(tr.querySelectorAll('.chip.active')).map(c => c.dataset.grupo));
    let n = 0;
    document.querySelectorAll('#cuerpoTabla tr').forEach(row => {
      if ((row.querySelector('.modelo')?.value || '') !== modelo) return;
      row.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', activos.has(c.dataset.grupo)));
      n++;
    });
    this._refrescarEstados();
    this.scheduleAutosave();
    const nombreModelo = tr.querySelector('.modelo')?.selectedOptions?.[0]?.textContent?.trim() || 'ese modelo';
    Toast.show(`Grupos copiados a ${n} equipo(s) de ${nombreModelo}.`, 'ok');
  },

  // Toggle de un chip de grupo en una fila concreta.
  toggleChipFila(chip) {
    chip.classList.toggle('active');
    this._refrescarEstados();
    this.scheduleAutosave();
  },

  // Recalcula el estado de completitud de cada fila (nombre + modelo + ≥1 grupo),
  // pinta el punto verde/ámbar, resalta las incompletas, marca en rojo el modelo
  // faltante, actualiza el contador de grupos por fila y el resumen vivo de arriba.
  // Único punto de verdad visual; se llama tras cualquier cambio de la tabla.
  _refrescarEstados() {
    const filas = Array.from(document.querySelectorAll('#cuerpoTabla tr'));
    let completos = 0, sinModelo = 0, sinGrupos = 0;
    filas.forEach(tr => {
      const nombre  = (tr.querySelector('.nombre')?.value || '').trim();
      const modelo  = tr.querySelector('.modelo')?.value || '';
      const nAct    = tr.querySelectorAll('.chip.active').length;
      const faltaMod = !modelo;
      const faltaGrp = nAct === 0;
      const incompleta = !nombre || faltaMod || faltaGrp;
      tr.classList.toggle('row-incompleta', incompleta);
      const dot = tr.querySelector('.rowdot');
      if (dot) {
        dot.classList.toggle('ok', !incompleta);
        dot.classList.toggle('warn', incompleta);
        dot.title = incompleta
          ? [!nombre ? 'Sin nombre' : '', faltaMod ? 'Falta modelo' : '', faltaGrp ? 'Sin grupos' : ''].filter(Boolean).join(' · ')
          : 'Completo';
      }
      const sel = tr.querySelector('.modelo');
      if (sel) sel.classList.toggle('falta', faltaMod);
      const cnt = tr.querySelector('.gcount');
      if (cnt) cnt.textContent = nAct ? String(nAct) : '';
      const flag = tr.querySelector('.sin-grupo-flag');
      if (flag) flag.style.display = faltaGrp ? 'inline' : 'none';
      if (incompleta) { if (faltaMod) sinModelo++; if (faltaGrp) sinGrupos++; }
      else completos++;
    });
    const el = document.getElementById('vbResumenCompletitud');
    if (el) {
      el.innerHTML = filas.length ? [
        `<span class="vb-pill ok">● ${completos} completos</span>`,
        sinGrupos ? `<span class="vb-pill warn">▲ ${sinGrupos} sin grupos</span>` : '',
        sinModelo ? `<span class="vb-pill warn">▲ ${sinModelo} sin modelo</span>` : '',
      ].filter(Boolean).join('') : '';
    }
  },

  toggleGPS(master) {
    this._filasObjetivo().forEach(tr => { const g = tr.querySelector('.gps'); if (g) g.checked = master.checked; });
  },

  resetTablaEdicion() {
    const thead = document.querySelector('#tablaEquipos thead');
    const tbody = document.getElementById('cuerpoTabla');
    const table = document.getElementById('tablaEquipos');
    if (thead) {
      thead.innerHTML = `
        <tr id="encabezadoTabla">
          <th>Nombre del Radio</th>
          <th style="text-align:center;">GPS</th>
          <th>Grupos</th>
          <th>Modelo</th><th></th>
        </tr>`;
    }
    if (tbody) tbody.innerHTML = '';
    const bar = document.getElementById('bulkBar');
    if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
    this._mostrarPasosTabla(false);
    this.actualizarResumenBatch();
  },

  actualizarResumenBatch() {
    const resumenEl = document.getElementById('resumenBatch');
    if (!resumenEl) return;
    const filas      = document.querySelectorAll('#cuerpoTabla tr').length;
    const gruposArr  = (document.getElementById('grupoInput').value || '').split(',').map(g => g.trim()).filter(Boolean);
    const tooltip    = gruposArr.length ? gruposArr.join(', ') : 'Sin grupos';
    resumenEl.innerHTML = `<strong>${filas}</strong> filas · <span class="badge completo" title="${this._esc(tooltip)}">${gruposArr.length}</span>`;
    // Badge del paso 4: "Listo" cuando hay filas para exportar.
    const be = document.getElementById('badgeExport');
    if (be) { be.textContent = filas ? 'Listo' : 'Pendiente'; be.className = filas ? 'badge completo' : 'badge pending'; }
  },

  setStep(step) {
    // El stepper de la topbar se retiró (las secciones numeradas son el único
    // indicador de progreso). Si no existen los nodos, no-op.
    const p = document.getElementById('step-prep');
    const r = document.getElementById('step-rev');
    const e = document.getElementById('step-exp');
    if (!p || !r || !e) return;
    p.classList.toggle('active', step === 'prep');
    r.classList.toggle('active', step === 'rev');
    e.classList.toggle('active', step === 'exp');
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
    // "Limpiar todo" es intención explícita de empezar de cero: el borrador
    // guardado también se descarta, si no reaparece al recargar la página.
    this.clearDraft(true);
  },

  // ---- Export / review ----
  async generarJSON() {
    const filas      = document.querySelectorAll('#cuerpoTabla tr');
    const inputNombre = (document.getElementById('clienteGlobal').value || '').trim();
    let cid = this.clienteIDSeleccionado || null;
    let cn  = this.clienteNombreSeleccionado || inputNombre;
    if (!cn) { Toast.show('Escribe el nombre del cliente o selecciónalo de la lista.', 'bad'); return []; }
    if (!cid) {
      // Resolver el ID por nombre contra la lista completa (cargándola si hace
      // falta): un JSON sin cliente_id crea equipos colgantes que después hay
      // que sanear a mano en Admin · Clientes duplicados.
      if (!this.clientesCargados) { try { await this.cargarClientesCache(); } catch (_) {} }
      const needle = FMT.normalize(cn);
      const hit    = (this.clientesCache || []).find(c => c.norm === needle);
      if (hit) {
        cid = hit.id; cn = hit.nombre;
        this.clienteIDSeleccionado     = cid;
        this.clienteNombreSeleccionado = cn;
      } else {
        Toast.show('Cliente no encontrado en la lista: el archivo saldrá sin ID de cliente.', 'warn');
      }
    }
    const datos = [];
    filas.forEach(fila => {
      const nombre   = (fila.querySelector('.nombre')?.value || '').trim();
      const gps      = !!fila.querySelector('.gps')?.checked;
      const modeloId = (fila.querySelector('.modelo')?.value || '').trim();
      const gruposMarcados = Array.from(fila.querySelectorAll('.chip.active')).map(c => c.dataset.grupo);
      if (nombre) {
        const modeloSel = this.modelosDisponibles.find(m => m.id === modeloId);
        datos.push({ cliente_id: cid, cliente_nombre: cn, radio_name: nombre, gps, modelo_id: modeloId || null, modelo_label: modeloSel ? modeloSel.label : '', grupos: gruposMarcados });
      }
    });
    return datos;
  },

  async mostrarTablaResultado() {
    const datos  = await this.generarJSON();
    if (!datos.length) { Toast.show('No hay filas con nombre para revisar.', 'warn'); return; }
    const salida = document.getElementById('salida');
    salida.innerHTML = `
      <div class="table-wrap compact">
        <table>
          <thead><tr><th>Cliente</th><th>Nombre</th><th>GPS</th><th>Modelo</th><th class="col-grupos">Grupos</th></tr></thead>
          <tbody>
            ${datos.map(d => `
              <tr>
                <td>${this._esc(d.cliente_nombre)}</td>
                <td>${this._esc(d.radio_name)}</td>
                <td>${d.gps ? '✅' : ''}</td>
                <td>${this._esc(d.modelo_label || '')}</td>
                <td class="col-grupos">${this._esc((d.grupos || []).join(', '))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
    document.querySelector('#salida .table-wrap').scrollIntoView({ behavior: 'smooth' });
    this.setStep('rev');
  },

  async descargarExcel() {
    // SheetJS bajo demanda (js/core/xlsx-loader.js) — no se descarga al abrir.
    try {
      await cargarXLSX();
    } catch (_) {
      Toast.show('No se pudo cargar el componente de Excel. Revisa tu conexión e intenta de nuevo.', 'bad');
      return;
    }
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
      const selecc = new Set(Array.from(fila.querySelectorAll('.chip.active')).map(c => c.dataset.grupo));
      const row    = { Cliente: cliente, 'Nombre del Radio': nombre, GPS: gps, Modelo: modeloLabel };
      VB.grupos.forEach(g => { row[g] = selecc.has(g) ? '✅' : ''; });
      datos.push(row);
    });
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Equipos');
    XLSX.writeFile(wb, 'equipos-vendedores.xlsx');
    this.setStep('exp');
  },

  async descargarJSON() {
    const datos = await this.generarJSON();
    if (!datos.length) { Toast.show('No hay datos para descargar.', 'bad'); return; }

    // Validación en el origen: avisar de equipos incompletos antes de exportar,
    // para que a recepción le llegue limpio (previene el caso MIDES: modelos o
    // grupos faltantes que después había que corregir a mano).
    const sinModelo = datos.filter(d => !d.modelo_id).length;
    const sinGrupos = datos.filter(d => !(d.grupos || []).length).length;
    const nombresNorm = datos.map(d => (d.radio_name || '').trim().toLowerCase());
    const dupSet = new Set(nombresNorm.filter((n, i) => n && nombresNorm.indexOf(n) !== i));
    if (sinModelo || sinGrupos || dupSet.size) {
      const partes = [];
      if (sinModelo)   partes.push(`${sinModelo} sin modelo`);
      if (sinGrupos)   partes.push(`${sinGrupos} sin grupos`);
      if (dupSet.size) partes.push(`${dupSet.size} nombre(s) duplicado(s)`);
      if (!confirm(`⚠ Hay pendientes en el lote:\n\n- ${partes.join('\n- ')}\n\nRecepción lo recibirá así. Revisa la tabla (los puntos ámbar) antes de enviar.\n\n¿Descargar de todos modos?`)) return;
    }

    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'equipos-vendedores.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    this.setStep('exp');
    // El JSON para recepción es el final del flujo: el lote ya salió, así que
    // el borrador deja de ser trabajo pendiente y no debe restaurarse después.
    this.clearDraft(true);
  },

  // ---- Draft autosave ----
  _collectDraft() {
    return {
      clienteId: this.clienteIDSeleccionado || null,
      cliente: document.getElementById('clienteGlobal').value || '',
      modelo:  document.getElementById('modeloGlobal').value  || '',
      grupos:  document.getElementById('grupoInput').value    || '',
      lista:   document.getElementById('serialesPaste').value || '',
      tabla: Array.from(document.querySelectorAll('#cuerpoTabla tr')).map(tr => ({
        nombre: tr.querySelector('.nombre')?.value || '',
        gps:    !!tr.querySelector('.gps')?.checked,
        modelo: tr.querySelector('.modelo')?.value || '',
        grupos: Array.from(tr.querySelectorAll('.chip')).map(c => c.classList.contains('active'))
      }))
    };
  },
  _writeDraft(draft) {
    if (!this._draftKey) return;
    localStorage.setItem(this._draftKey, JSON.stringify({ ...draft, ts: Date.now() }));
  },
  _setAutosaveStatus(state) {
    const el = document.getElementById('autosaveStatus');
    if (!el) return;
    if (state === 'idle')   { el.textContent = ''; return; }
    if (state === 'saving') { el.textContent = '· Guardando…'; return; }
    const t = new Date().toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `· Borrador guardado ✓ ${t}`;
  },
  // Autoguardado con debounce — se dispara al editar campos o la tabla, para
  // que el vendedor no pierda el trabajo si cierra la pestaña.
  scheduleAutosave() {
    if (!this._draftKey) return;
    this._setAutosaveStatus('saving');
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => this.autoSaveDraft(), 1500);
  },
  autoSaveDraft() {
    if (!this._draftKey) return;
    const draft = this._collectDraft();
    // No sobreescribir un borrador previo con uno vacío (p.ej. tras "Limpiar").
    const vacio = !draft.cliente && !draft.grupos && !draft.lista && !(draft.tabla || []).length;
    if (vacio) { this._setAutosaveStatus('idle'); return; }
    try { this._writeDraft(draft); this._setAutosaveStatus('saved'); }
    catch (e) { console.warn('Autoguardado falló:', e); }
  },
  saveDraft() {
    if (!this._draftKey) return;
    this._writeDraft(this._collectDraft());
    Toast.show('Borrador guardado', 'ok');
    this._setAutosaveStatus('saved');
  },

  restoreDraft() {
    if (!this._draftKey) return;
    try {
      const raw = localStorage.getItem(this._draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      // Borradores sin timestamp (formato viejo) o con más de 3 días se descartan:
      // un lote a medias tan antiguo ya no es trabajo en curso, es basura que confunde.
      if (!d.ts || Date.now() - d.ts > this.DRAFT_TTL_MS) {
        localStorage.removeItem(this._draftKey);
        return;
      }
      document.getElementById('clienteGlobal').value  = d.cliente || '';
      document.getElementById('modeloGlobal').value   = d.modelo  || '';
      document.getElementById('grupoInput').value     = d.grupos  || '';
      document.getElementById('serialesPaste').value  = d.lista   || '';
      // Restaurar también la selección de cliente: sin esto el JSON exportado
      // desde un borrador salía con cliente_id null (equipos colgantes).
      if (d.clienteId) {
        this.clienteIDSeleccionado     = d.clienteId;
        this.clienteNombreSeleccionado = d.cliente || '';
      }
      this.renderGrupoChips();
      if ((d.tabla || []).length) {
        VB.grupos = (d.grupos || '').split(',').map(s => s.trim()).filter(Boolean);
        document.getElementById('encabezadoTabla').innerHTML = `
          <th>Nombre del Radio</th>
          <th style="text-align:center;">GPS</th>
          <th>Grupos</th>
          <th>Modelo</th><th></th>`;
        this._mostrarPasosTabla(true);
        const tbody = document.getElementById('cuerpoTabla');
        tbody.innerHTML = '';
        d.tabla.forEach(r => {
          this.agregarFila('', r.nombre);
          const tr = tbody.lastElementChild;
          tr.querySelector('.gps').checked = !!r.gps;
          const sel = tr.querySelector('.modelo');
          if (sel) sel.value = r.modelo || '';
          tr.querySelectorAll('.chip').forEach((c, idx) => { c.classList.toggle('active', !!(r.grupos || [])[idx]); });
        });
        this._renderBulkBar();
        this.actualizarResumenBatch();
        this._refrescarEstados();
        Toast.show('Borrador restaurado', 'ok');
      }
      this.updateStepBadges();
    } catch (e) { console.warn('No se pudo restaurar borrador', e); }
  },

  clearDraft(silencioso = false) {
    if (!this._draftKey) return;
    clearTimeout(this._autosaveTimer);
    localStorage.removeItem(this._draftKey);
    this._setAutosaveStatus('idle');
    if (!silencioso) Toast.show('Borrador eliminado', 'warn');
  },

  // ---- Step badges ----
  updateStepBadges() {
    const cliente = (document.getElementById('clienteGlobal').value || '').trim();
    const grupos  = (document.getElementById('grupoInput').value || '').trim();
    const lista   = (document.getElementById('serialesPaste').value || '').trim();
    const b1 = document.getElementById('badgeCliente');
    const b2 = document.getElementById('badgeLote');
    if (b1) { b1.textContent = cliente ? 'Listo' : 'Pendiente'; b1.className = cliente ? 'badge completo' : 'badge pending'; }
    if (b2) { b2.textContent = (grupos && lista) ? 'Listo' : 'Pendiente'; b2.className = (grupos && lista) ? 'badge completo' : 'badge pending'; }
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

    ['clienteGlobal','serialesPaste'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { VB.updateStepBadges(); VB.scheduleAutosave(); });
    });
    const modeloEl = document.getElementById('modeloGlobal');
    if (modeloEl) modeloEl.addEventListener('change', () => VB.scheduleAutosave());

    // Carga automática de grupos al salir del campo cliente (pequeño retraso
    // para que un clic en una sugerencia gane la selección primero).
    const clienteEl = document.getElementById('clienteGlobal');
    if (clienteEl) clienteEl.addEventListener('blur', () => setTimeout(() => VB.intentarCargarGruposAuto(), 200));

    // Navegación con teclado en las sugerencias de cliente: ↑/↓ mueven el
    // resaltado, Enter selecciona, Esc cierra la lista.
    if (clienteEl) clienteEl.addEventListener('keydown', e => {
      const box   = document.getElementById('sugerenciasClientes');
      const items = box ? Array.from(box.querySelectorAll('.suggest-item')) : [];
      if (!items.length) return;
      const idx = items.findIndex(li => li.classList.contains('active'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        items.forEach((li, i) => li.classList.toggle('active', i === next));
        items[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault();
        items[idx].click();
      } else if (e.key === 'Escape') {
        box.innerHTML = '';
      }
    });

    // Autoguardado al editar cualquier celda de la tabla (delegación).
    const cuerpo = document.getElementById('cuerpoTabla');
    if (cuerpo) {
      cuerpo.addEventListener('input',  () => { VB._refrescarEstados(); VB.scheduleAutosave(); });
      cuerpo.addEventListener('change', () => { VB._refrescarEstados(); VB.scheduleAutosave(); });
    }

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
    // Mensaje "crear grupo" según el rol: el vendedor NO entra a Administrar
    // grupos (es solo admin/recepción), así que se le indica pedírselo a recepción.
    const hint = document.getElementById('grupoHintVB');
    if (hint) {
      hint.innerHTML = (rol === ROLES.VENDEDOR)
        ? 'Para crear un grupo nuevo, <strong>pídele a recepción</strong> que lo agregue.'
        : 'Para crear un grupo nuevo, ve a <strong>Administrar grupos</strong> (menú “Más” en POC).';
    }
    VB._draftKey = 'vend_batch_draft_' + user.uid;
    VB.restoreDraft();
    setTimeout(() => document.getElementById('clienteGlobal')?.focus(), 100);
  } catch (error) {
    console.error('Error al verificar el rol o cargar modelos:', error);
    window.location.href = '../index.html';
  }
});
