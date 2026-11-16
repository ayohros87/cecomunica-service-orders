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
// bodega asigna ahí y los seriales salen en "Contrato APROBADO".
//
// REPOSICIÓN (Alberto, 2026-10-08, caso Goly factura 11076): un radio
// ALQUILADO robado o perdido que el cliente paga no es venta. Con la casilla
// marcada, recepción declara el serial perdido; el formulario verifica que es
// un radio alquilado de ese cliente y arma solo las líneas (mismo modelo).
// Bodega asigna como siempre y onPedidoVentaWrite (lib/reposicionAlquiler.js)
// deja el nuevo de CECOMUNICA en el contrato, da de baja el perdido y abre la
// gestión de reemplazo. Un radio dañado que vuelve sigue yendo por el Centro.
window.VentaFacturada = {

  _el: null, _api: null, _busy: false,
  _clientes: null, _clienteSel: null, _modelos: [],
  _perdidos: [],   // [{ serial, ok, motivo?, data? }] del bloque de reposición

  _esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, s =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  },
  _toast(msg, tipo) { if (window.Toast) Toast.show(msg, tipo); },

  async abrir({ user } = {}) {
    this._user = user || firebase.auth().currentUser;
    this._clienteSel = null;
    this._perdidos = [];
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
      onSelect: (id, c) => {
        this._clienteSel = c ? { id: c.id, nombre: c.nombre } : null;
        if (this._esReposicion()) this._verificarPerdidos();
        this._pintarAvisoContrato();
      },
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
            <span style="flex:1; min-width:0;"><b>${esc(p.cliente_nombre || '—')}</b> · factura ${esc(p.factura || '—')}${p.reposicion ? ` · <b>reposición</b> de ${esc((p.reposicion.items || []).map(i => i.serial_saliente).join(', '))}` : ''} —
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

  // VENTA PEDIDA POR LOS DOS CAMINOS (2026-11-16, SHIRLEY DE LA ROSA, factura
  // 11349): ventas hizo el SERV con línea propio y recepción pidió la misma
  // venta aquí. A bodega le salió dos veces en Asignar y la OS nació como
  // "venta directa" sin contrato, así que el feed pedía una segunda orden para
  // el SERV. Antes de pedir, se avisa si el cliente tiene un contrato vigente
  // con radios propios y SIN factura de venta: esa factura casi siempre va ahí.
  // Es un aviso y no un candado: una línea propio también puede ser de radios
  // que el cliente ya tenía, y puede haber una venta aparte.
  async _contratosConPropioSinFactura(clienteId) {
    if (!clienteId) return [];
    const VIGENTES = ['pendiente', 'pendiente_aprobacion', 'pendiente_firma', 'aprobado', 'activo'];
    const snap = await firebase.firestore().collection('contratos')
      .where('cliente_id', '==', clienteId).limit(60).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => !c.deleted && VIGENTES.includes(c.estado) && !c.factura_venta?.numero)
      .map(c => {
        const todoPropio = c.codigo_tipo === 'PROP' || /^propio$/i.test(c.tipo_contrato || '');
        const n = (c.equipos || [])
          .filter(e => todoPropio || String(e.modalidad || '').toLowerCase() === 'propio')
          .reduce((s, e) => s + Number(e.cantidad || 0), 0);
        return { id: c.id, contrato_id: c.contrato_id || c.id, n, estado: c.estado };
      })
      .filter(c => c.n > 0);
  },

  async _pintarAvisoContrato() {
    const cont = this._el?.querySelector('#vfAvisoContrato');
    if (!cont) return;
    const cli = this._clienteActual();
    this._avisoContratos = [];
    cont.innerHTML = '';
    if (!cli) return;
    try { this._avisoContratos = await this._contratosConPropioSinFactura(cli.id); }
    catch (e) { console.warn('No se pudieron revisar los contratos del cliente:', e); return; }
    if (this._clienteActual()?.id !== cli.id || !this._avisoContratos.length) return;
    const esc = this._esc.bind(this);
    cont.innerHTML = `
      <div style="border:1px solid var(--status-warn,#b45309); background:var(--status-warn-bg,#fffbeb); border-radius:8px; padding:var(--sp-2) var(--sp-3); font-size:12.5px; margin-bottom:var(--sp-3);">
        <b>Ojo: este cliente tiene ${this._avisoContratos.length === 1 ? 'un contrato' : 'contratos'} con radios propios sin factura de venta</b>
        (${this._avisoContratos.map(c => `${esc(c.contrato_id)}, ${c.n} radio(s)`).join('; ')}).
        Si la factura es de esos radios, no la pidas aquí: regístrala en el contrato (Contratos → Equipos → Registrar factura de venta). Bodega asigna los seriales en el contrato y la orden sale de ahí.
      </div>`;
  },

  _esReposicion() { return !!this._el?.querySelector('#vfReposicion')?.checked; },

  _clienteActual() {
    const nombre = this._el?.querySelector('#vfCliente')?.value.trim() || '';
    return (this._clienteSel && this._clienteSel.nombre === nombre) ? this._clienteSel
      : (this._clientes || []).find(c => EntityCombo.normBusq(c.nombre) === EntityCombo.normBusq(nombre)) || null;
  },

  _toggleReposicion() {
    const on = this._esReposicion();
    // style.display y no `hidden`: .form-field trae su propio display y le gana al atributo.
    this._el.querySelector('#vfBloqueRepo').style.display = on ? '' : 'none';
    this._el.querySelector('#vfBloqueLineas').style.display = on ? 'none' : '';
    if (on) this._verificarPerdidos();
  },

  // Cada serial perdido se busca en el pool (doc ID = serial normalizado) y se
  // valida con la misma regla que el servidor (reposicionAlquiler.validarPerdido):
  // alquilado, de este cliente, en un contrato. El servidor lo re-valida al asignar.
  async _verificarPerdidos() {
    const cont = this._el?.querySelector('#vfPerdidosRes');
    if (!cont) return;
    const seriales = [...new Set((this._el.querySelector('#vfPerdidos').value || '')
      .split(/[\s,;]+/).map(x => x.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean))];
    const cli = this._clienteActual();
    if (!seriales.length) { this._perdidos = []; cont.innerHTML = ''; return; }
    if (!cli) { this._perdidos = []; cont.innerHTML = '<div style="font-size:12.5px;color:var(--fg-3);">Elige primero el cliente.</div>'; return; }
    const esc = this._esc.bind(this);
    this._perdidos = await Promise.all(seriales.map(async (serial) => {
      try {
        const d = await firebase.firestore().collection('equipos_pool').doc(serial).get();
        const x = d.exists ? d.data() : null;
        const a = x?.asignacion || {};
        let motivo = null;
        if (!x) motivo = 'no está en el inventario';
        else if (x.propiedad === 'cliente') motivo = 'es del cliente (equipo propio): eso es una venta, desmarca la casilla';
        else if (!['en_cliente', 'asignado_contrato', 'en_taller'].includes(x.estado)) motivo = `está ${x.estado || 'sin estado'}, no con el cliente`;
        else if (a.cliente_id !== cli.id) motivo = a.cliente_nombre ? `está con ${a.cliente_nombre}` : 'no está asignado a este cliente';
        else if (!a.contrato_doc_id) motivo = 'no está en ningún contrato';
        return { serial: x?.serial || serial, ok: !motivo, motivo, data: x };
      } catch (e) {
        return { serial, ok: false, motivo: 'no se pudo leer el inventario' };
      }
    }));
    cont.innerHTML = this._perdidos.map(p => p.ok
      ? `<div style="font-size:12.5px;color:var(--status-ok,#047857);">✓ <b>${esc(p.serial)}</b> · ${esc(p.data.modelo_label || 'modelo sin registrar')} · contrato ${esc(p.data.asignacion.contrato_id || '—')}</div>`
      : `<div style="font-size:12.5px;color:var(--status-critical,#b42318);">✕ <b>${esc(p.serial)}</b>: ${esc(p.motivo)}</div>`).join('');
  },

  async guardar() {
    const cli = this._clienteActual();
    const factura = this._el.querySelector('#vfFactura').value.trim();
    const notas = this._el.querySelector('#vfNotas').value.trim();
    const programacion = this._el.querySelector('#vfProgramacion').checked;
    const repo = this._esReposicion();
    let lineas = [...this._el.querySelectorAll('.vf-linea')].map(r => {
      const id = r.querySelector('[data-f="modelo"]').value;
      return { modelo_id: id || null, modelo: this._modelos.find(m => m.id === id)?.label || '',
               cantidad: parseInt(r.querySelector('[data-f="cantidad"]').value, 10) || 0 };
    });
    if (!cli) { this._toast('Elige el cliente de la lista (tiene que existir en la app).', 'bad'); return; }
    if (!factura) { this._toast('Escribe el número de la factura.', 'bad'); return; }
    let reposicion = null;
    if (repo) {
      await this._verificarPerdidos();
      if (!this._perdidos.length) { this._toast('Escribe el serial del radio robado o perdido.', 'bad'); return; }
      const malos = this._perdidos.filter(p => !p.ok);
      if (malos.length) { this._toast(`Revisa ${malos.map(p => p.serial).join(', ')}: ${malos[0].motivo}.`, 'bad'); return; }
      if (this._perdidos.some(p => !p.data.modelo_id)) { this._toast('Un radio perdido no tiene modelo en el inventario: pídele a bodega que lo complete.', 'bad'); return; }
      // Las líneas salen de los perdidos: un radio del mismo modelo por cada uno.
      const porModelo = new Map();
      for (const p of this._perdidos) {
        const k = p.data.modelo_id;
        const l = porModelo.get(k) || { modelo_id: k, modelo: p.data.modelo_label || '', cantidad: 0 };
        l.cantidad++; porModelo.set(k, l);
      }
      lineas = [...porModelo.values()];
      reposicion = {
        motivo: this._el.querySelector('#vfMotivo').value === 'perdida' ? 'perdida' : 'robo',
        items: this._perdidos.map(p => ({
          serial_saliente: p.serial, modelo_id: p.data.modelo_id, modelo: p.data.modelo_label || '',
          contrato_doc_id: p.data.asignacion.contrato_doc_id, contrato_id: p.data.asignacion.contrato_id || '',
        })),
      };
    }
    if (lineas.some(l => !l.modelo_id)) { this._toast('Elige el modelo en cada línea (o quita la línea vacía).', 'bad'); return; }
    if (!lineas.length || lineas.some(l => l.cantidad < 1)) { this._toast('Indica al menos un modelo con su cantidad.', 'bad'); return; }

    if (!repo) {
      let conPropio = [];
      try { conPropio = await this._contratosConPropioSinFactura(cli.id); }
      catch (e) { console.warn('No se pudieron revisar los contratos del cliente:', e); }
      if (conPropio.length) {
        const esc = this._esc.bind(this);
        const lista = conPropio.map(c => `<b>${esc(c.contrato_id)}</b> (${c.n} radio(s) propio(s))`).join(', ');
        const seguir = await Modal.confirm({
          title: '¿Esta venta es la del contrato?',
          message: `${esc(cli.nombre)} tiene ${lista} sin factura de venta.<br><br>
            Si la factura <b>${esc(factura)}</b> es de esos radios, <b>no la pidas aquí</b>: regístrala en el contrato
            (Contratos → Equipos → Registrar factura de venta). Si la pides aquí también, bodega asigna dos veces y sale una orden de más.<br><br>
            Envíala solo si es <b>otra venta</b>, aparte del contrato.`,
          confirmLabel: 'Es otra venta: enviar',
          cancelLabel: 'No enviar',
        });
        if (!seguir) return;
      }
    }

    const btn = this._el.querySelector('#vfBtnGuardar');
    btn.disabled = true; this._busy = true;
    try {
      await PedidosVentaService.crear({
        cliente_id: cli.id, cliente_nombre: cli.nombre, factura, lineas,
        requiere_programacion: programacion, notas, reposicion,
      }, this._user);
      this._toast(reposicion
        ? 'Listo: bodega recibió la reposición. Al asignar, el radio nuevo queda en el contrato y el perdido se da de baja.'
        : 'Listo: bodega recibió el pedido. Te llegará un correo con los seriales cuando los asigne.', 'ok');
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
            asigna sus seriales en el contrato y llegan en el correo "Contrato APROBADO". Tampoco un radio
            <b>dañado</b> de un contrato de alquiler que vuelve al taller: es un reemplazo desde el Centro del cliente.</p>
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
          <div id="vfAvisoContrato"></div>
          <label style="display:flex; gap:8px; align-items:flex-start; font-size:13px; margin-bottom:var(--sp-3);">
            <input type="checkbox" id="vfReposicion" style="margin-top:3px;">
            <span>Es la <b>reposición de un radio alquilado robado o perdido</b> que el cliente pagó.
              <span style="color:var(--fg-3);">No es venta: el radio nuevo queda de CECOMUNICA en el mismo contrato y el perdido se da de baja.</span></span>
          </label>
          <div id="vfBloqueRepo" style="display:none; border:1px solid var(--border,#e5e7eb); border-radius:8px; padding:var(--sp-3); margin-bottom:var(--sp-3);">
            <div style="display:flex; gap:var(--sp-3); flex-wrap:wrap;">
              <div class="form-field" style="flex:2; min-width:200px; margin-bottom:0;">
                <label class="form-label" for="vfPerdidos">Serial del radio robado o perdido</label>
                <input class="form-input" id="vfPerdidos" type="text" placeholder="23905A0436 (si son varios, sepáralos con coma)" autocomplete="off">
              </div>
              <div class="form-field" style="flex:1; min-width:130px; margin-bottom:0;">
                <label class="form-label" for="vfMotivo">Motivo</label>
                <select class="form-select" id="vfMotivo"><option value="robo">Robo</option><option value="perdida">Pérdida</option></select>
              </div>
            </div>
            <div id="vfPerdidosRes" style="margin-top:6px;"></div>
            <div style="font-size:12px; color:var(--fg-3); margin-top:6px;">Bodega asigna un radio del mismo modelo por cada perdido.</div>
          </div>
          <div class="form-field" id="vfBloqueLineas">
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
        root.querySelector('#vfReposicion').addEventListener('change', () => this._toggleReposicion());
        root.querySelector('#vfPerdidos').addEventListener('change', () => this._verificarPerdidos());
        root.querySelector('#vfCliente').addEventListener('change', () => this._pintarAvisoContrato());
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
