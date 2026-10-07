// "Venta facturada" — recepción le pide los seriales a bodega desde la
// plataforma (Brenda, 2026-10-07). Reemplaza el correo con la factura a
// bodega y el correo de vuelta pidiendo los seriales: el pedido queda en
// `pedidos_venta`, bodega lo ve en Almacén · Hoy, y al asignar el sistema
// crea la OS de programación y le escribe a recepción con los seriales.
//
// Módulo diferido: lo carga CargaDiferida.ventaFacturada() al primer uso
// (Órdenes → Más). Necesita Modal, Toast, ClientesService, ModelosService y
// EntityCombo (este último también lo trae CargaDiferida).
//
// Solo para el camino DIRECTO (radio vendido sin contrato de servicio). La
// venta con contrato de servicio va por el contrato (Propio/Servicio):
// bodega asigna ahí y los seriales salen en "Contrato APROBADO". Un radio
// hurtado/dañado de un contrato de ALQUILER que el cliente paga no es venta:
// es una gestión de reemplazo con reposición por daño, desde el Centro.
window.VentaFacturada = {

  _el: null, _api: null, _busy: false,
  _clientes: null, _clienteSel: null, _modelos: [],

  _esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, s =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  },
  _toast(msg, tipo) { if (window.Toast) Toast.show(msg, tipo); },

  async abrir({ user } = {}) {
    this._user = user || firebase.auth().currentUser;
    this._clienteSel = null;
    this._render();
    await Promise.all([this._cargarModelos(), this._montarCombo(), this._pintarPendientes()]);
  },

  async _cargarModelos() {
    try {
      const todos = await ModelosService.getModelos();
      this._modelos = (todos || [])
        .filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim() }))
        .filter(m => m.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('No se pudo cargar el catálogo de modelos:', e);
      this._modelos = [];
    }
    this._el?.querySelectorAll('select[data-f="modelo"]').forEach(s => this._llenarSelect(s));
  },

  _llenarSelect(sel) {
    const v = sel.value;
    sel.innerHTML = '<option value="">Modelo…</option>'
      + this._modelos.map(m => `<option value="${this._esc(m.id)}">${this._esc(m.label)}</option>`).join('');
    sel.value = v;
  },

  async _cargarClientes(fresh = false) {
    if (this._clientes && !fresh) return this._clientes;
    const cs = await ClientesService.getAllClientes({ fresh });
    this._clientes = cs.map(c => ({ id: c.id, nombre: (c.nombre || '').toString() }));
    return this._clientes;
  },

  async _montarCombo() {
    const input = this._el?.querySelector('#vfCliente');
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
        return '<div class="combo-empty">No hay un cliente con ese nombre. Créalo primero en Clientes.</div>';
      },
      onSelect: (id, c) => { this._clienteSel = c ? { id: c.id, nombre: c.nombre } : null; },
    });
  },

  _filaLinea() {
    const row = document.createElement('div');
    row.className = 'vf-linea';
    row.style.cssText = 'display:flex; gap:var(--sp-2); align-items:center; margin-bottom:6px;';
    row.innerHTML = `
      <select class="form-select" data-f="modelo" style="flex:1; min-width:0;"></select>
      <input class="form-input" data-f="cantidad" type="number" min="1" step="1" value="1" style="width:80px;" aria-label="Cantidad">
      <button type="button" class="btn btn-ghost btn-sm" data-action="quitar-linea" title="Quitar" aria-label="Quitar"><i data-lucide="x"></i></button>`;
    this._llenarSelect(row.querySelector('select'));
    return row;
  },

  _agregarLinea() {
    const cont = this._el?.querySelector('#vfLineas');
    if (!cont) return;
    cont.appendChild(this._filaLinea());
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [cont.lastElementChild] });
  },

  async _pintarPendientes() {
    const cont = this._el?.querySelector('#vfPendientes');
    if (!cont) return;
    let lista = [];
    try { lista = await PedidosVentaService.listarPendientes(); }
    catch (e) { console.warn('No se pudieron leer los pedidos pendientes:', e); cont.innerHTML = ''; return; }
    if (!lista.length) { cont.innerHTML = ''; return; }
    const esc = this._esc.bind(this);
    cont.innerHTML = `
      <div style="border-top:1px solid var(--border, #e5e7eb); margin-top:var(--sp-3); padding-top:var(--sp-3);">
        <div style="font-size:12.5px; font-weight:600; color:var(--fg-2); margin-bottom:6px;">Esperando seriales de bodega (${lista.length})</div>
        ${lista.map(p => `
          <div style="display:flex; gap:var(--sp-2); align-items:center; font-size:13px; padding:4px 0;">
            <span style="flex:1; min-width:0;"><b>${esc(p.cliente_nombre || '—')}</b> · factura ${esc(p.factura || '—')} —
              ${esc((p.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`).join(', '))}
              <span style="color:var(--fg-3);">${p.creado_at?.toDate ? '· ' + esc(p.creado_at.toDate().toLocaleDateString('es-PA')) : ''}</span></span>
            <button type="button" class="btn btn-ghost btn-sm" data-action="anular" data-id="${esc(p.id)}">Anular</button>
          </div>`).join('')}
      </div>`;
  },

  async _anular(id) {
    const motivo = await Modal.prompt({
      title: 'Anular el pedido',
      message: 'Bodega ya no lo verá. ¿Por qué se anula?',
      placeholder: 'Ej. factura anulada, cliente desistió',
      confirmLabel: 'Anular pedido',
    });
    if (motivo == null) return;
    if (!String(motivo).trim()) { this._toast('Escribe el motivo.', 'bad'); return; }
    try {
      await PedidosVentaService.anular(id, motivo, this._user);
      this._toast('Pedido anulado.', 'ok');
      this._pintarPendientes();
    } catch (e) {
      console.error('No se pudo anular el pedido:', e);
      this._toast(/permission/i.test(`${e?.code} ${e?.message}`)
        ? 'No se pudo anular: bodega ya asignó los seriales.' : 'No se pudo anular el pedido.', 'bad');
    }
  },

  async guardar() {
    const nombre = this._el.querySelector('#vfCliente').value.trim();
    const cli = (this._clienteSel && this._clienteSel.nombre === nombre) ? this._clienteSel
      : (this._clientes || []).find(c => EntityCombo.normBusq(c.nombre) === EntityCombo.normBusq(nombre)) || null;
    const factura = this._el.querySelector('#vfFactura').value.trim();
    const notas = this._el.querySelector('#vfNotas').value.trim();
    const programacion = this._el.querySelector('#vfProgramacion').checked;
    const lineas = [...this._el.querySelectorAll('.vf-linea')].map(r => {
      const id = r.querySelector('[data-f="modelo"]').value;
      return { modelo_id: id || null, modelo: this._modelos.find(m => m.id === id)?.label || '',
               cantidad: parseInt(r.querySelector('[data-f="cantidad"]').value, 10) || 0 };
    });
    if (!cli) { this._toast('Elige el cliente de la lista (tiene que existir en la app).', 'bad'); return; }
    if (!factura) { this._toast('Escribe el número de la factura.', 'bad'); return; }
    if (lineas.some(l => !l.modelo_id)) { this._toast('Elige el modelo en cada línea (o quita la línea vacía).', 'bad'); return; }
    if (!lineas.length || lineas.some(l => l.cantidad < 1)) { this._toast('Indica al menos un modelo con su cantidad.', 'bad'); return; }

    const btn = this._el.querySelector('#vfBtnGuardar');
    btn.disabled = true; this._busy = true;
    try {
      await PedidosVentaService.crear({
        cliente_id: cli.id, cliente_nombre: cli.nombre, factura, lineas,
        requiere_programacion: programacion, notas,
      }, this._user);
      this._toast('Listo: bodega recibió el pedido. Te llegará un correo con los seriales cuando los asigne.', 'ok');
      this._busy = false;
      this._cerrar();
    } catch (e) {
      console.error('No se pudo registrar la venta facturada:', e);
      this._toast(/permission/i.test(`${e?.code} ${e?.message}`)
        ? 'Tu usuario no puede registrar ventas facturadas (es de recepción y administración).'
        : 'No se pudo registrar: ' + (e.message || e), 'bad');
    } finally {
      this._busy = false;
      btn.disabled = false;
    }
  },

  _render() {
    this._cerrar();
    let overlay = null;
    Modal.sheet({
      title: 'Venta facturada: pedir seriales a bodega', icon: 'receipt', size: 'md',
      closable: () => !this._busy,
      html: `
          <p style="font-size:12.5px; color:var(--fg-3); margin:0 0 var(--sp-3);">
            Para radios <b>vendidos en modo directo, sin contrato de servicio</b>, con la factura ya fiscalizada.
            Bodega recibe el pedido y asigna los seriales; al hacerlo, el sistema crea la orden de programación y
            <b>te llega un correo con los seriales</b>.</p>
          <p style="font-size:12.5px; color:var(--fg-3); margin:0 0 var(--sp-3);">
            <b>No va aquí:</b> un radio que se asocia a un <b>contrato de servicio</b> (Propio o Servicio): bodega
            asigna sus seriales en el contrato y llegan en el correo "Contrato APROBADO". Tampoco un radio hurtado o
            dañado de un contrato de <b>alquiler</b>: es un reemplazo desde el Centro del cliente.</p>
          <div style="display:flex; gap:var(--sp-3); flex-wrap:wrap;">
            <div class="form-field" style="flex:2; min-width:200px;">
              <label class="form-label" for="vfCliente">Cliente (de la factura)</label>
              <input class="form-input" id="vfCliente" type="text" placeholder="Escribe para buscar el cliente…" autocomplete="off">
            </div>
            <div class="form-field" style="flex:1; min-width:140px;">
              <label class="form-label" for="vfFactura">N.º de factura</label>
              <input class="form-input" id="vfFactura" type="text" placeholder="11044">
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">Equipos vendidos</label>
            <div id="vfLineas"></div>
            <button type="button" class="btn btn-ghost btn-sm" data-action="agregar-linea"><i data-lucide="plus"></i> Otro modelo</button>
          </div>
          <label style="display:flex; gap:8px; align-items:center; font-size:13px; margin-bottom:var(--sp-3);">
            <input type="checkbox" id="vfProgramacion" checked> Lleva programación (el sistema crea la orden al asignar)
          </label>
          <div class="form-field">
            <label class="form-label" for="vfNotas">Notas para bodega <span class="optional">(opcional)</span></label>
            <input class="form-input" id="vfNotas" type="text" maxlength="200">
          </div>
          <div id="vfPendientes"></div>`,
      footerHtml: `
          <button class="btn btn-ghost" data-action="cerrar">Cancelar</button>
          <button class="btn btn-primary" id="vfBtnGuardar"><i data-lucide="send"></i> Enviar a bodega</button>`,
      onMount: (root, api) => {
        overlay = root;
        this._el = root; this._api = api;
        root.addEventListener('click', (e) => {
          const b = e.target.closest('[data-action]');
          if (!b) return;
          const a = b.getAttribute('data-action');
          if (a === 'cerrar') this._cerrar();
          else if (a === 'agregar-linea') this._agregarLinea();
          else if (a === 'quitar-linea') {
            if (root.querySelectorAll('.vf-linea').length > 1) b.closest('.vf-linea').remove();
          } else if (a === 'anular') this._anular(b.getAttribute('data-id'));
        });
        root.querySelector('#vfBtnGuardar').addEventListener('click', () => this.guardar());
        root.querySelector('#vfLineas').appendChild(this._filaLinea());
        if (typeof lucide !== 'undefined') lucide.createIcons();
        root.querySelector('#vfCliente').focus();
      },
    }).then(() => { if (this._el === overlay) { this._el = null; this._api = null; } });
  },

  _cerrar() {
    if (this._busy) return;
    const api = this._api;
    this._el = null; this._api = null;
    if (api) api.close(null);
  },
};
