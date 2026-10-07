// Asistente "Equipos del cliente" (2026-10-07) — radios que TRAE un cliente
// para meterlos en su contrato (línea "Del cliente"). Vive en Almacén · Más
// para no sumar otro botón a la barra: es un caso de vez en cuando.
//
// Bodega escoge el cliente (de la app, sin excepciones: el dueño tiene que
// existir), el modelo y escanea los seriales. Quedan EN BODEGA con
// `propiedad: 'cliente'` y `propietario` (EquiposPoolService.registrarDelCliente):
// el estante los ve, pero solo se asignan al contrato de ese cliente.
//
// API: AsistenteEquiposCliente.abrir({ user, onDone })
// Dependencias del host: firebase compat, EquiposPoolService, ModelosService,
// ClientesService, FilteredSelect, EntityCombo, Modal, FMT. Opcionales: Toast, lucide.
window.AsistenteEquiposCliente = {

  _opts: null,
  _el: null,
  _api: null,
  _busy: false,
  _modelos: [],
  _clientes: null,
  _clienteSel: null,
  _modeloFS: null,

  _esc(s) {
    if (window.FMT && typeof FMT.esc === 'function') return FMT.esc(s);
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[m]));
  },
  _toast(msg, tipo) { if (window.Toast) Toast.show(msg, tipo); },

  async abrir(opts = {}) {
    this._opts = opts || {};
    this._clienteSel = null;
    this._render();
    await Promise.all([this._cargarModelos(), this._montarCombo()]);
  },

  // Mismo catálogo y misma regla de condición que Recibir equipos
  // (AsistenteRecibir): la fila del catálogo decide Nuevo/Refurbished.
  async _cargarModelos() {
    try {
      const todos = await ModelosService.getModelos();
      this._modelos = (todos || [])
        .filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim(),
                     estado: (m.estado || '').toUpperCase() }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('No se pudo cargar el catálogo de modelos:', e);
      this._modelos = [];
    }
    const sel = this._el?.querySelector('#aecModelo');
    if (!sel) return;
    this._modeloFS = FilteredSelect.montar({ select: sel, filtro: this._el.querySelector('#aecModeloFiltro'),
      items: this._modelos, id: (m) => m.id, label: (m) => m.label, placeholder: 'Seleccione…' });
  },
  _condicionDeModelo(modeloId) {
    return window.AsistenteRecibir?._condicionDeModelo
      ? AsistenteRecibir._condicionDeModelo.call({ _modelos: this._modelos }, modeloId) || 'nuevo'
      : 'nuevo';
  },

  // Combo de cliente: misma caché que el asistente de venta
  // ('cache_clientes_v1', 6 h) y una relectura del servidor por apertura
  // antes de decir que el cliente no existe.
  async _cargarClientes(fresh = false) {
    if (this._clientes && !fresh) return this._clientes;
    if (window.AsistenteVenta?._cargarClientesCache) {
      this._clientes = await AsistenteVenta._cargarClientesCache(fresh);
      return this._clientes;
    }
    const cs = await ClientesService.getAllClientes({ fresh });
    this._clientes = cs.map(c => ({ id: c.id, nombre: (c.nombre || '').toString() }));
    return this._clientes;
  },
  async _montarCombo() {
    const input = this._el?.querySelector('#aecCliente');
    if (!input || typeof EntityCombo === 'undefined') return;
    try { await this._cargarClientes(); } catch (e) { console.error('Error al cargar clientes:', e); }
    let refrescado = false;
    const combo = EntityCombo.montar(null, {
      input, items: this._clientes || [],
      id: (c) => c.id, label: (c) => c.nombre, campos: (c) => [c.nombre], limite: 30,
      vacio: (q) => {
        if (!refrescado && q && q.trim().length >= 2) {
          refrescado = true;
          this._cargarClientes(true).then(() => combo.setItems(this._clientes || [])).catch(() => {});
          return '<div class="combo-empty">Buscando en el servidor…</div>';
        }
        return '<div class="combo-empty">No hay un cliente con ese nombre. Tiene que existir en la app (Clientes).</div>';
      },
      onSelect: (id, c) => { this._clienteSel = c ? { id: c.id, nombre: c.nombre } : null; },
    });
  },

  async guardar() {
    const esc = this._esc.bind(this);
    const nombre = this._el.querySelector('#aecCliente').value.trim();
    const cli = (this._clienteSel && this._clienteSel.nombre === nombre) ? this._clienteSel : null;
    if (!cli) { this._toast('Escoge el cliente de la lista: el dueño tiene que existir en la app.', 'bad'); return; }
    const modeloId = this._el.querySelector('#aecModelo').value;
    if (!modeloId) { this._toast('Selecciona el modelo de los equipos.', 'bad'); return; }
    const seriales = this._el.querySelector('#aecSeriales').value
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!seriales.length) { this._toast('Pega o escanea al menos un serial.', 'bad'); return; }
    const modeloLabel = this._modelos.find(m => m.id === modeloId)?.label || '';

    const ok = await Modal.confirm({ title: 'Registrar equipos del cliente', confirmLabel: 'Registrar',
      message: `${seriales.length} radio(s) <b>${esc(modeloLabel)}</b> quedan en bodega como propiedad de `
        + `<b>${esc(cli.nombre)}</b>.<br><br>Solo se podrán asignar a un contrato o gestión de ese cliente, `
        + `en una línea <b>"Del cliente"</b>, y no se venden ni se alquilan a nadie más.` });
    if (!ok) return;

    const btn = this._el.querySelector('#aecBtnGuardar');
    btn.disabled = true;
    this._busy = true;
    try {
      const user = this._opts.user || firebase.auth().currentUser;
      const res = await EquiposPoolService.registrarDelCliente(seriales, {
        modelo_id: modeloId, modelo_label: modeloLabel, condicion: this._condicionDeModelo(modeloId),
        cliente_id: cli.id, cliente_nombre: cli.nombre,
        notas: this._el.querySelector('#aecNotas').value.trim(),
      }, user);

      const hechos = res.nuevos + res.reclamados;
      let msg = `${hechos} equipo(s) de ${cli.nombre} en bodega.`;
      if (res.reclamados) msg += ` ${res.reclamados} ya tenían ficha y se trajeron a bodega a su nombre.`;
      if (res.existentes) msg += ` ${res.existentes} ya estaban registrados.`;
      if (res.repetidos_lista.length) msg += ` ${res.repetidos_lista.length} repetido(s) en la tanda.`;
      if (res.invalidos_lista.length) msg += ` ${res.invalidos_lista.length} no son seriales válidos (${res.invalidos_lista.slice(0, 5).join(', ')}).`;

      this._busy = false;
      this._cerrarForzado();
      this._toast(msg, (res.bloqueados.length || res.invalidos_lista.length) ? 'warn' : 'ok');
      if (res.bloqueados.length) {
        await Modal.alert({ title: `${res.bloqueados.length} serial(es) sin registrar`, icon: 'shield-alert',
          message: 'Estos no se tocaron — revísalos antes de meterlos al contrato:<br><br>'
            + res.bloqueados.slice(0, 15).map(b => `<b>${esc(b.serial)}</b> — ${esc(b.motivo)}`).join('<br>')
            + (res.bloqueados.length > 15 ? '<br>…' : '') });
      }
      if (typeof this._opts.onDone === 'function') {
        try { this._opts.onDone(res); } catch (e) { console.error('onDone falló:', e); }
      }
    } catch (e) {
      console.error('Error al registrar equipos del cliente:', e);
      this._toast(/permission.denied/i.test(`${e?.code || ''} ${e?.message || e || ''}`)
        ? 'No tienes permiso: registrar equipos es de bodega y administración.'
        : 'Error al registrar: ' + (e.message || e), 'bad');
    } finally {
      this._busy = false;
      if (btn) btn.disabled = false;
    }
  },

  _render() {
    this._cerrarForzado();
    let overlay = null;
    Modal.sheet({
      title: 'Equipos del cliente', icon: 'user-plus', size: 'md',
      closable: () => !this._busy,
      html: `
          <p style="font-size:12.5px; color:var(--fg-3); margin:0 0 var(--sp-3);">
            Radios que <b>trae el cliente</b> para su contrato. Quedan en bodega a su nombre: no son flota
            de Cecomunica, no se venden y solo se asignan a ese cliente, en una línea <b>"Del cliente"</b>.</p>
          <div class="form-field">
            <label class="form-label" for="aecCliente">Cliente (dueño de los equipos)</label>
            <input class="form-input" id="aecCliente" type="text" placeholder="Escribe para buscar el cliente…" autocomplete="off">
          </div>
          <div class="form-field">
            <label class="form-label" for="aecModelo">Modelo</label>
            <input class="form-input" id="aecModeloFiltro" type="search"
                   placeholder="Filtrar modelo… (ej. NX-410)" style="margin-bottom:4px;" autocomplete="off">
            <select class="form-select" id="aecModelo"><option value="">Seleccione…</option></select>
          </div>
          <div class="form-field">
            <label class="form-label" for="aecSeriales">Seriales <span class="optional">(uno por línea — acepta lector de código de barras)</span></label>
            <textarea class="form-input" id="aecSeriales" rows="6" placeholder="B12345678&#10;B12345679&#10;…" style="font-family:var(--font-mono);"></textarea>
          </div>
          <div class="form-field">
            <label class="form-label" for="aecNotas">Notas <span class="optional">(opcional — ej. estado en que llegan, accesorios)</span></label>
            <input class="form-input" id="aecNotas" type="text">
          </div>`,
      footerHtml: `
          <button class="btn btn-ghost" data-action="cerrar">Cancelar</button>
          <button class="btn btn-primary" id="aecBtnGuardar"><i data-lucide="check"></i> Registrar</button>`,
      onMount: (root, api) => {
        overlay = root; root.id = 'asistenteEquiposClienteOverlay';
        this._el = root; this._api = api;
        root.addEventListener('click', (e) => { if (e.target.closest('[data-action="cerrar"]')) this._cerrar(); });
        root.querySelector('#aecBtnGuardar').addEventListener('click', () => this.guardar());
        root.querySelector('#aecModelo').addEventListener('change', (e) => {
          if (e.target.value && document.activeElement !== root.querySelector('#aecModeloFiltro')) {
            root.querySelector('#aecSeriales').focus();
          }
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
        root.querySelector('#aecCliente').focus();
      },
    }).then(() => { if (this._el === overlay) { this._el = null; this._api = null; } });
  },

  _cerrar() {
    if (this._busy || !this._el) return;
    this._cerrarForzado();
  },
  _cerrarForzado() {
    const api = this._api;
    this._el = null; this._api = null;
    if (api) api.close(null);
  },
};
