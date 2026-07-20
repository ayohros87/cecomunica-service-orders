// @ts-nocheck
// Pool de equipos serializados — listado, recepción en bodega, import Excel,
// historia (kardex) y acciones de inspección/baja/verificación.
// Plan: docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md. Servicio: equiposPoolService.js.
function cerrarSesion() {
  firebase.auth().signOut()
    .then(() => { window.location.href = '/login.html'; })
    .catch(() => { window.location.href = '/login.html'; });
}

window.EquiposPool = {
  _equipos: [],
  _modelos: [],
  _tab: 'en_cliente',
  _rol: null,
  _editandoId: null,
  _importRows: null,

  // Filtros persistidos por usuario (localStorage). Default de primera visita:
  // la flota de Cecomunica que está con clientes.
  FILTROS_KEY: 'eqpool_filtros_v1',
  FILTROS_DEFAULT: { tab: 'en_cliente', propiedad: 'cecomunica', modelo: '',
                     sinVerificar: false, compartidos: false, sinCliente: false },

  // Pestaña "Baja / Venta": estados que sacaron la unidad de la flota.
  // devuelto_revision ya tiene pestaña propia ("Entradas").
  ESTADOS_OTROS: ['baja', 'vendido'],

  PROP_LABELS: { cecomunica: 'Flota', cliente: 'Cliente', desconocida: '?' },

  puedeEscribir() {
    return this._rol === ROLES.ADMIN || this._rol === ROLES.INVENTARIO;
  },

  // ── Carga ────────────────────────────────────────────────────────────
  async cargar() {
    try {
      this._equipos = await EquiposPoolService.listar();
      this.render();
    } catch (e) {
      console.error('Error al cargar equipos:', e);
      Toast.show('Error al cargar el pool: ' + (e.message || e), 'bad');
    }
  },

  async cargarModelos() {
    try {
      const todos = await ModelosService.getModelos();
      this._modelos = (todos || [])
        .filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim() }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('No se pudo cargar el catálogo de modelos:', e);
      this._modelos = [];
    }
    // Modales (recibir/editar/import): fila EXACTA del catálogo (N y R aparte).
    const opts = this._modelos
      .map(m => `<option value="${FMT.esc(m.id)}">${FMT.esc(m.label)}</option>`).join('');
    ['recModelo', 'editModelo', 'impModelo'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = (sel.options[0]?.outerHTML || '') + opts;
    });
    // Filtro: por FAMILIA de modelo — el catálogo no tiene FK nuevo↔reuso, la
    // conexión es la convención del sufijo -R, así que "PNC360S" y "PNC360S-R"
    // se agrupan en una sola opción (la condición N/R se ve por columna).
    this._familias = new Map(); // key → { label, ids: Set }
    for (const m of this._modelos) {
      const key = EquiposPoolService._tightLabel(m.label).replace(/r$/, '');
      if (!key) continue;
      const fam = this._familias.get(key) || { label: m.label, ids: new Set() };
      fam.ids.add(m.id);
      // Prefiere como etiqueta la variante SIN sufijo -R (la base).
      if (m.label.length < fam.label.length) fam.label = m.label;
      this._familias.set(key, fam);
    }
    const selFam = document.getElementById('eqFiltroModelo');
    if (selFam) {
      selFam.innerHTML = (selFam.options[0]?.outerHTML || '') +
        [...this._familias.entries()]
          .sort((a, b) => a[1].label.localeCompare(b[1].label))
          .map(([key, f]) => `<option value="${FMT.esc(key)}">${FMT.esc(f.label)}</option>`).join('');
    }
  },

  // ¿La unidad pertenece a la familia de modelo seleccionada en el filtro?
  _enFamilia(eq, famKey) {
    const fam = this._familias?.get(famKey);
    if (!fam) return true;
    if (eq.modelo_id && fam.ids.has(eq.modelo_id)) return true;
    return EquiposPoolService._mismoModelo(eq, null, fam.label);
  },

  _modeloLabel(modeloId) {
    return this._modelos.find(m => m.id === modeloId)?.label || '';
  },

  // ── Filtros persistidos ──────────────────────────────────────────────
  _restaurarFiltros() {
    let f = this.FILTROS_DEFAULT;
    try {
      const raw = localStorage.getItem(this.FILTROS_KEY);
      if (raw) f = { ...this.FILTROS_DEFAULT, ...JSON.parse(raw) };
    } catch (e) { /* localStorage bloqueado → defaults */ }
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    setVal('eqFiltroModelo', f.modelo || '');
    setVal('eqFiltroPropiedad', f.propiedad || '');
    setChk('chkSinVerificar', f.sinVerificar);
    setChk('chkCompartidos', f.compartidos);
    setChk('chkSinCliente', f.sinCliente);
    this._tab = f.tab || 'en_cliente';
    document.querySelectorAll('.eq-tab').forEach(b =>
      b.classList.toggle('is-active', b.dataset.tab === this._tab));
  },

  _guardarFiltros() {
    try {
      localStorage.setItem(this.FILTROS_KEY, JSON.stringify({
        tab: this._tab,
        modelo: document.getElementById('eqFiltroModelo')?.value || '',
        propiedad: document.getElementById('eqFiltroPropiedad')?.value || '',
        sinVerificar: !!document.getElementById('chkSinVerificar')?.checked,
        compartidos: !!document.getElementById('chkCompartidos')?.checked,
        sinCliente: !!document.getElementById('chkSinCliente')?.checked,
      }));
    } catch (e) { /* localStorage bloqueado → sin persistencia */ }
  },

  // ── Render ───────────────────────────────────────────────────────────
  setTab(tab) {
    this._tab = tab;
    document.querySelectorAll('.eq-tab').forEach(b =>
      b.classList.toggle('is-active', b.dataset.tab === tab));
    this.render();
  },

  _enTab(eq, tab) {
    if (tab === 'todos') return true;
    if (tab === 'otros') return this.ESTADOS_OTROS.includes(eq.estado);
    return eq.estado === tab;
  },

  _sinCliente(eq) {
    return !(eq.asignacion?.cliente_nombre || eq.asignacion?.cliente_id);
  },

  // Filtros secundarios (todo menos la pestaña de estado) — se leen UNA vez
  // por render y se usan también para los contadores de las pestañas.
  _filtrosActivos() {
    return {
      q: (document.getElementById('eqBusqueda')?.value || '').trim().toLowerCase(),
      mod: document.getElementById('eqFiltroModelo')?.value || '',
      prop: document.getElementById('eqFiltroPropiedad')?.value || '',
      sinVerificar: !!document.getElementById('chkSinVerificar')?.checked,
      compartidos: !!document.getElementById('chkCompartidos')?.checked,
      sinCliente: !!document.getElementById('chkSinCliente')?.checked,
    };
  },

  _pasaFiltrosSecundarios(eq, f) {
    if (f.mod && !this._enFamilia(eq, f.mod)) return false;
    if (f.prop && (eq.propiedad || 'desconocida') !== f.prop) return false;
    if (f.sinVerificar && eq.verificado !== false) return false;
    if (f.compartidos && !eq.serial_compartido) return false;
    if (f.sinCliente && !this._sinCliente(eq)) return false;
    if (f.q) {
      const blob = [eq.serial, eq.serial_norm, eq.modelo_label,
        eq.asignacion?.cliente_nombre, eq.asignacion?.contrato_id, eq.notas]
        .map(x => (x || '').toString().toLowerCase()).join(' ');
      if (!blob.includes(f.q)) return false;
    }
    return true;
  },

  _filtrados() {
    const f = this._filtrosActivos();
    return this._equipos.filter(eq => this._enTab(eq, this._tab) && this._pasaFiltrosSecundarios(eq, f));
  },

  // ── Chips de filtros activos ─────────────────────────────────────────
  PROP_FILTRO_LABELS: { cecomunica: 'Flota Cecomunica', cliente: 'De cliente', desconocida: 'Desconocida' },

  quitarFiltro(tipo) {
    const el = {
      modelo: 'eqFiltroModelo', propiedad: 'eqFiltroPropiedad', busqueda: 'eqBusqueda',
      sinVerificar: 'chkSinVerificar', compartidos: 'chkCompartidos', sinCliente: 'chkSinCliente',
    }[tipo];
    const node = document.getElementById(el);
    if (!node) return;
    if (node.type === 'checkbox') node.checked = false;
    else node.value = '';
    this.render();
  },

  limpiarFiltros() {
    ['eqFiltroModelo', 'eqFiltroPropiedad', 'eqBusqueda'].forEach(id => {
      const n = document.getElementById(id); if (n) n.value = '';
    });
    ['chkSinVerificar', 'chkCompartidos', 'chkSinCliente'].forEach(id => {
      const n = document.getElementById(id); if (n) n.checked = false;
    });
    this.render();
  },

  _renderFiltrosActivos(f, nMostrados, nOcultos) {
    const bar = document.getElementById('eqFiltrosActivos');
    if (!bar) return;
    const esc = FMT.esc;
    const chips = [];
    const chip = (tipo, texto) =>
      `<span class="eq-chip">${esc(texto)}<button title="Quitar este filtro" onclick="EquiposPool.quitarFiltro('${tipo}')">✕</button></span>`;
    if (f.prop) chips.push(chip('propiedad', `Propiedad: ${this.PROP_FILTRO_LABELS[f.prop] || f.prop}`));
    if (f.mod) chips.push(chip('modelo', `Modelo: ${this._familias?.get(f.mod)?.label || f.mod}`));
    if (f.sinVerificar) chips.push(chip('sinVerificar', 'Solo sin verificar'));
    if (f.compartidos) chips.push(chip('compartidos', 'Solo 2+ modelos'));
    if (f.sinCliente) chips.push(chip('sinCliente', 'Solo sin cliente'));
    if (f.q) chips.push(chip('busqueda', `Búsqueda: "${f.q}"`));
    if (!chips.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = '';
    bar.innerHTML = `<i data-lucide="filter" style="width:14px;height:14px;flex:none;color:#92400e;"></i>
      <span style="color:#92400e;">Viendo:</span> ${chips.join(' ')}
      <span style="color:var(--fg-3);">· ${nOcultos} equipos ocultos por estos filtros</span>
      <span style="flex:1;"></span>
      <button class="btn btn-ghost btn-sm" onclick="EquiposPool.limpiarFiltros()">Limpiar todo</button>`;
  },

  render() {
    const tbody = document.getElementById('eqTabla');
    if (!tbody) return;
    const lista = this._filtrados();
    const esc = FMT.esc;

    // KPIs: métricas GLOBALES del pool (no cambian con los filtros).
    const nVerificar = this._equipos.filter(e => e.verificado === false).length;
    const flotaCampo = this._equipos.filter(e => e.propiedad === 'cecomunica'
      && ['asignado_contrato', 'en_cliente', 'en_poc'].includes(e.estado)).length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiBodega', this._equipos.filter(e => e.estado === 'en_bodega').length);
    set('kpiFlotaCampo', flotaCampo);
    set('kpiTaller', this._equipos.filter(e => e.estado === 'en_taller').length);
    set('kpiVerificar', nVerificar);

    // Contadores de pestañas: respetan los filtros activos (modelo/propiedad/
    // toggles/búsqueda) para que el número de la pestaña calce con la tabla.
    const fAct = this._filtrosActivos();
    const filtrables = this._equipos.filter(e => this._pasaFiltrosSecundarios(e, fAct));
    const n = estado => filtrables.filter(e => e.estado === estado).length;
    set('countBodega', `(${n('en_bodega')})`);
    set('countAsignados', `(${n('asignado_contrato')})`);
    set('countCliente', `(${n('en_cliente')})`);
    set('countTaller', `(${n('en_taller')})`);
    set('countPoc', `(${n('en_poc')})`);
    set('countEntradas', `(${n('devuelto_revision')})`);
    set('countOtros', `(${filtrables.filter(e => this.ESTADOS_OTROS.includes(e.estado)).length})`);
    set('countTodos', `(${filtrables.length})`);

    // Barra "Viendo: …" — hace obvios los filtros activos sin abrir dropdowns.
    const enTabTotal = this._equipos.filter(e => this._enTab(e, this._tab)).length;
    this._renderFiltrosActivos(fAct, lista.length, enTabTotal - lista.length);

    if (!lista.length) {
      // Estado vacío que EXPLICA la pestaña: qué cae aquí y cuál es el paso
      // que la alimenta/vacía — la página enseña el ciclo sola.
      const VACIO_POR_TAB = {
        en_bodega: 'No hay equipos disponibles en bodega. Entran con "Recibir equipos" / "Importar Excel", o cuando una entrada pasa la inspección.',
        asignado_contrato: 'No hay unidades reservadas por contrato. Se asignan desde la página de Seriales del contrato (picker "Tomar del pool") y salen al confirmarse la entrega.',
        en_cliente: 'No hay unidades en clientes. Llegan aquí cuando la orden de programación se marca "Entregado al cliente".',
        en_taller: 'No hay unidades en taller. Entran al agregarse con serial a una orden de servicio y salen al entregarse.',
        en_poc: 'No hay unidades en préstamo POC.',
        devuelto_revision: 'No hay entradas pendientes de inspección. Las devoluciones de clientes (cierre de enmienda, anulación de contrato o cambio por defectuoso) caen aquí; con "Inspección OK" regresan a bodega como reuso, o se dan de baja.',
        otros: 'No hay unidades dadas de baja ni vendidas. Las ventas directas (facturadas en QuickBooks) se registran con "Registrar venta" para descontarlas de bodega.',
      };
      const hayFiltros = !!(fAct.q || fAct.mod || fAct.prop || fAct.sinVerificar || fAct.compartidos || fAct.sinCliente);
      const msg = !this._equipos.length
        ? 'No hay equipos en el pool. Usa "Recibir equipos" o "Importar Excel".'
        : (hayFiltros ? 'Sin resultados con el filtro actual.' : (VACIO_POR_TAB[this._tab] || 'Sin resultados.'));
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--fg-3); padding:var(--sp-6); line-height:1.6;">${msg}</td></tr>`;
    } else {
      const puede = this.puedeEscribir();
      const esAdmin = this._rol === ROLES.ADMIN;
      tbody.innerHTML = lista.map(eq => {
        // "Asignado a" navegable: cliente → ficha, contrato → lista con búsqueda
        // precargada (?buscar=), orden → editar-orden. Puede haber asignación Y
        // orden a la vez (unidad de contrato que está en taller): se muestran ambas.
        const linkCliente = eq.asignacion
          ? (eq.asignacion.cliente_id
              ? `<a class="eq-link" href="../clientes/editar.html?id=${encodeURIComponent(eq.asignacion.cliente_id)}" title="Abrir ficha del cliente">${esc(eq.asignacion.cliente_nombre || '—')}</a>`
              : esc(eq.asignacion.cliente_nombre || '—'))
          : '';
        const linkContrato = (eq.asignacion && eq.asignacion.contrato_id)
          ? `<a class="eq-sub eq-link" href="../contratos/index.html?buscar=${encodeURIComponent(eq.asignacion.contrato_id)}" title="Buscar el contrato en la lista">${esc(eq.asignacion.contrato_id)}</a>`
          : '';
        const linkOrden = eq.orden_actual_id
          ? `<a class="eq-sub eq-link" href="../ordenes/editar-orden.html?id=${encodeURIComponent(eq.orden_actual_id)}" title="Abrir la orden de servicio">orden en taller</a>`
          : '';
        const asignadoA = (linkCliente + linkContrato + linkOrden) || '—';
        const compartido = eq.serial_compartido
          ? `<span class="eq-compartido" title="Este serial existe en más de un modelo — verifica el modelo antes de operar">2+ MODELOS</span>` : '';
        const noVerif = eq.verificado === false
          ? `<span class="eq-noverif" title="Creado por migración automática — pendiente de confirmación">SIN VERIFICAR</span>` : '';
        const acciones = [
          `<button class="btn btn-ghost btn-icon btn-sm" title="Historia (kardex)" onclick="EquiposPool.abrirHistoria('${esc(eq.id)}')"><i data-lucide="history"></i></button>`,
          (puede && eq.verificado === false) ? `<button class="btn btn-ghost btn-icon btn-sm" title="Marcar como verificado" onclick="EquiposPool.verificar('${esc(eq.id)}')"><i data-lucide="badge-check"></i></button>` : '',
          puede ? `<button class="btn btn-ghost btn-icon btn-sm" title="Editar" onclick="EquiposPool.abrirEdicion('${esc(eq.id)}')"><i data-lucide="pencil"></i></button>` : '',
          (puede && eq.estado === 'devuelto_revision') ? `<button class="btn btn-ghost btn-icon btn-sm" title="Inspección OK → regresa a bodega" onclick="EquiposPool.inspeccionOk('${esc(eq.id)}')"><i data-lucide="check-circle-2"></i></button>` : '',
          (puede && eq.estado === 'en_bodega') ? `<button class="btn btn-ghost btn-icon btn-sm" title="Registrar venta (facturada en QuickBooks)" onclick="EquiposPool.abrirVenta('${esc(eq.id)}')"><i data-lucide="banknote"></i></button>` : '',
          (esAdmin && !['baja', 'vendido'].includes(eq.estado)) ? `<button class="btn btn-danger btn-icon btn-sm" title="Dar de baja" onclick="EquiposPool.darDeBaja('${esc(eq.id)}')"><i data-lucide="archive-x"></i></button>` : '',
        ].join('');
        const prop = eq.propiedad || 'desconocida';
        return `<tr>
          <td class="td-mono">${esc(eq.serial || eq.serial_norm)}${compartido}${noVerif}</td>
          <td>${esc(eq.modelo_label || '—')}</td>
          <td>${eq.condicion === 'reuso' ? 'Reuso' : 'Nuevo'}</td>
          <td><span class="eq-prop eq-prop-${esc(prop)}" title="${prop === 'cecomunica' ? 'Flota propia de Cecomunica' : prop === 'cliente' ? 'Equipo propiedad del cliente' : 'Propiedad sin clasificar'}">${esc(this.PROP_LABELS[prop] || prop)}</span></td>
          <td><span class="eq-badge eq-badge-${esc(eq.estado)}">${esc(EquiposPoolService.ESTADO_LABELS[eq.estado] || eq.estado)}</span>${EquiposPoolService.chipPendienteDevolucionHtml(eq)}${eq.reemplaza_a ? `<span class="eq-sub" title="Linaje: esta unidad sustituyó a la anterior en una renovación/reemplazo">reemplaza a ${esc(eq.reemplaza_a)}</span>` : ''}</td>
          <td>${asignadoA}</td>
          <td style="font-size:12px; color:var(--fg-3);">${esc(eq.origen || '—')}</td>
          <td>${acciones}</td>
        </tr>`;
      }).join('');
    }

    const resumen = document.getElementById('eqResumen');
    if (resumen) resumen.innerHTML =
      `<strong>${lista.length}</strong> <span style="color:var(--muted);font-size:12px;">equipos mostrados</span>`;
    this._guardarFiltros();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  // ── Recibir equipos ──────────────────────────────────────────────────
  abrirRecibir() {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden recibir equipos.', 'bad'); return; }
    document.getElementById('recSeriales').value = '';
    document.getElementById('recProveedor').value = '';
    document.getElementById('recNotas').value = '';
    document.getElementById('recTomaFisica').checked = false;
    Modal.open('eqRecibirModal');
  },

  async guardarRecibir() {
    const modeloId = document.getElementById('recModelo').value;
    if (!modeloId) { Toast.show('Selecciona el modelo de los equipos.', 'bad'); return; }
    const seriales = document.getElementById('recSeriales').value
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!seriales.length) { Toast.show('Pega o escanea al menos un serial.', 'bad'); return; }

    const btn = document.getElementById('btnGuardarRecibir');
    btn.disabled = true;
    try {
      const res = await EquiposPoolService.recibir(seriales, {
        modelo_id:    modeloId,
        modelo_label: this._modeloLabel(modeloId),
        condicion:    document.getElementById('recCondicion').value,
        proveedor:    document.getElementById('recProveedor').value,
        notas:        document.getElementById('recNotas').value,
        origen:       document.getElementById('recTomaFisica').checked ? 'toma_fisica' : 'bodega',
      }, firebase.auth().currentUser);
      Modal.close('eqRecibirModal');
      let msg = `${res.nuevos} equipos recibidos en bodega.`;
      if (res.existentes) msg += ` ${res.existentes} ya existían.`;
      if (res.colisiones) msg += ` ${res.colisiones} con serial compartido entre modelos (revisar).`;
      if (res.invalidos)  msg += ` ${res.invalidos} seriales inválidos.`;
      Toast.show(msg, res.colisiones ? 'warn' : 'ok');
      this.cargar();
    } catch (e) {
      console.error('Error al recibir equipos:', e);
      Toast.show('Error al recibir: ' + (e.message || e), 'bad');
    } finally {
      btn.disabled = false;
    }
  },

  // ── Edición ──────────────────────────────────────────────────────────
  abrirEdicion(id) {
    const eq = this._equipos.find(x => x.id === id);
    if (!eq) return;
    this._editandoId = id;
    document.getElementById('editSerialLabel').textContent = eq.serial || eq.serial_norm;
    const sel = document.getElementById('editModelo');
    // Modelo fuera del catálogo (migración): mostrarlo igual.
    if (eq.modelo_id && ![...sel.options].some(o => o.value === eq.modelo_id)) {
      sel.insertAdjacentHTML('beforeend', `<option value="${FMT.esc(eq.modelo_id)}">${FMT.esc(eq.modelo_label || eq.modelo_id)}</option>`);
    }
    sel.value = eq.modelo_id || '';
    document.getElementById('editCondicion').value = eq.condicion === 'reuso' ? 'reuso' : 'nuevo';
    document.getElementById('editPropiedad').value = eq.propiedad || 'desconocida';
    document.getElementById('editProveedor').value = eq.proveedor || '';
    document.getElementById('editNotas').value = eq.notas || '';
    Modal.open('eqEditModal');
  },

  async guardarEdicion() {
    if (!this._editandoId) return;
    const modeloId = document.getElementById('editModelo').value || null;
    try {
      await EquiposPoolService.actualizar(this._editandoId, {
        modelo_id:    modeloId,
        modelo_label: modeloId ? this._modeloLabel(modeloId) : '',
        condicion:    document.getElementById('editCondicion').value,
        propiedad:    document.getElementById('editPropiedad').value,
        proveedor:    document.getElementById('editProveedor').value,
        notas:        document.getElementById('editNotas').value,
      }, firebase.auth().currentUser);
      Modal.close('eqEditModal');
      this._editandoId = null;
      Toast.show('Equipo actualizado.', 'ok');
      this.cargar();
    } catch (e) {
      Toast.show('Error al actualizar: ' + (e.message || e), 'bad');
    }
  },

  // ── Acciones de estado ───────────────────────────────────────────────
  async verificar(id) {
    try {
      await EquiposPoolService.verificar(id, firebase.auth().currentUser);
      Toast.show('Equipo verificado.', 'ok');
      this.cargar();
    } catch (e) {
      Toast.show('Error: ' + (e.message || e), 'bad');
    }
  },

  async inspeccionOk(id) {
    const eq = this._equipos.find(x => x.id === id);
    if (!await Modal.confirm({
      message: `El equipo ${eq?.serial || id} pasó inspección y regresa a bodega como disponible (condición: reuso). ¿Confirmar?`,
    })) return;
    try {
      await EquiposPoolService.liberar(id, { notas: 'Inspección OK tras devolución' }, firebase.auth().currentUser);
      Toast.show('Equipo devuelto a bodega.', 'ok');
      this.cargar();
    } catch (e) {
      Toast.show('Error: ' + (e.message || e), 'bad');
    }
  },

  async darDeBaja(id) {
    const eq = this._equipos.find(x => x.id === id);
    const motivo = await Modal.prompt({
      title: 'Dar de baja',
      message: `Motivo de la baja de ${eq?.serial || id} (dañado, perdido, vendido…). El equipo sale del pool de forma permanente.`,
    });
    if (motivo === null) return;
    if (!motivo.trim()) { Toast.show('La baja requiere un motivo.', 'bad'); return; }
    try {
      await EquiposPoolService.darDeBaja(id, motivo.trim(), firebase.auth().currentUser);
      Toast.show('Equipo dado de baja.', 'ok');
      this.cargar();
    } catch (e) {
      Toast.show('Error: ' + (e.message || e), 'bad');
    }
  },

  // ── Registrar venta (venta directa facturada en QuickBooks) ──────────
  // La factura ya existe en QBO; aquí solo se descuenta la unidad de bodega
  // (estado vendido, propiedad cliente) con el vínculo a esa factura.
  abrirVenta(id = null) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden registrar ventas.', 'bad'); return; }
    this._ventaDesdeId = id;
    const eq = id ? this._equipos.find(x => x.id === id) : null;
    document.getElementById('ventaSeriales').value = eq ? (eq.serial || eq.serial_norm) : '';
    document.getElementById('ventaCliente').value = '';
    document.getElementById('ventaFactura').value = '';
    document.getElementById('ventaNotas').value = '';
    this._ventaClienteSel = null;
    document.getElementById('ventaClienteSugs').innerHTML = '';
    this._cargarClientesCache().catch(e => console.error('Error al precargar clientes:', e));
    Modal.open('eqVentaModal');
  },

  // ── Autocompletado de cliente en la venta ────────────────────────────
  // Mismo patrón que POC/vendedores-batch: caché local de clientes (6h,
  // misma clave 'cache_clientes_v1') + sugerencias por subcadena normalizada.
  // La venta debe quedar ligada a un cliente existente de la app; un nombre
  // libre solo pasa como excepción confirmada (ver guardarVenta).
  _clientesCache: null,
  _ventaClienteSel: null,
  _ventaCliTimer: null,

  async _cargarClientesCache() {
    if (this._clientesCache) return this._clientesCache;
    try {
      const raw = localStorage.getItem('cache_clientes_v1');
      if (raw) {
        const { exp, data } = JSON.parse(raw);
        if (exp && Date.now() < exp && Array.isArray(data) && data.length) {
          this._clientesCache = data;
          return data;
        }
      }
    } catch (_) { /* caché ilegible: se reconstruye */ }
    const clientes = await ClientesService.getAllClientes();
    this._clientesCache = clientes.map(c => {
      const nombre = (c.nombre || '').toString();
      return { id: c.id, nombre, norm: FMT.normalize(nombre) };
    });
    try {
      localStorage.setItem('cache_clientes_v1',
        JSON.stringify({ exp: Date.now() + 6 * 60 * 60 * 1000, data: this._clientesCache }));
    } catch (_) { /* localStorage lleno: seguimos solo en memoria */ }
    return this._clientesCache;
  },

  sugerirClienteVenta() {
    this._ventaClienteSel = null; // editar el texto invalida la selección previa
    const cont  = document.getElementById('ventaClienteSugs');
    const input = document.getElementById('ventaCliente');
    cont.innerHTML = '';
    const texto = (input.value || '').trim();
    if (texto.length < 2) return;
    clearTimeout(this._ventaCliTimer);
    this._ventaCliTimer = setTimeout(async () => {
      try { await this._cargarClientesCache(); } catch (e) { console.error('Error al cargar clientes:', e); return; }
      const needle  = FMT.normalize(texto);
      const matches = this._clientesCache
        .filter(c => c.norm.includes(needle))
        .map(c => ({ ...c, pos: c.norm.indexOf(needle) }))
        .sort((a, b) => a.pos !== b.pos ? a.pos - b.pos
          : a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
        .slice(0, 30);
      cont.innerHTML = '';
      if (!matches.length) return;
      const ul = document.createElement('ul');
      ul.className = 'suggest-list';
      matches.forEach(m => {
        const li = document.createElement('li');
        li.className = 'suggest-item';
        li.textContent = m.nombre;
        li.onclick = () => {
          input.value = m.nombre;
          this._ventaClienteSel = { id: m.id, nombre: m.nombre };
          cont.innerHTML = '';
        };
        ul.appendChild(li);
      });
      cont.appendChild(ul);
    }, 200);
  },

  async guardarVenta() {
    const cliente = document.getElementById('ventaCliente').value.trim();
    const factura = document.getElementById('ventaFactura').value.trim();
    const notas   = document.getElementById('ventaNotas').value.trim();
    const seriales = document.getElementById('ventaSeriales').value
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!seriales.length) { Toast.show('Pega o escanea al menos un serial.', 'bad'); return; }
    if (!cliente) { Toast.show('Indica a quién se vendió (el cliente de la factura).', 'bad'); return; }

    // El cliente debe existir en la app: o se eligió de las sugerencias, o el
    // texto coincide exacto con uno del caché. Un nombre libre solo pasa como
    // excepción confirmada y la venta queda marcada (cliente_excepcion).
    let clienteSel = (this._ventaClienteSel && this._ventaClienteSel.nombre === cliente)
      ? this._ventaClienteSel : null;
    let clienteExcepcion = false;
    if (!clienteSel) {
      try { await this._cargarClientesCache(); } catch (e) { console.error('Error al cargar clientes:', e); }
      const needle = FMT.normalize(cliente);
      const hit = (this._clientesCache || []).find(c => c.norm === needle);
      if (hit) {
        clienteSel = { id: hit.id, nombre: hit.nombre };
      } else {
        if (!await Modal.confirm({
          title: 'Cliente no registrado',
          message: `<strong>${FMT.esc(cliente)}</strong> no existe como cliente en la app.<br><br>
            Lo normal es elegirlo de las sugerencias al escribir. ¿Registrar la venta
            <strong>por excepción</strong> con este nombre tal cual? Quedará marcada como
            venta a cliente no registrado.`,
          confirmLabel: 'Registrar por excepción',
        })) return;
        clienteSel = { id: '', nombre: cliente };
        clienteExcepcion = true;
      }
    }

    const btn = document.getElementById('btnGuardarVenta');
    btn.disabled = true;
    try {
      const esc = FMT.esc;
      // Validación previa: solo se venden unidades EN BODEGA. Lo demás se
      // reporta (no está en el pool / otro estado / colisión ambigua) y la
      // venta puede seguir con las válidas.
      const vendibles = [], problemas = [];
      const vistos = new Set();
      for (const s of seriales) {
        const norm = EquiposPoolService.normalizarSerial(s);
        if (!EquiposPoolService.esSerialValido(norm)) { problemas.push(`${esc(s)}: serial inválido`); continue; }
        if (vistos.has(norm)) continue;
        vistos.add(norm);
        const docs = await EquiposPoolService.findBySerial(s);
        if (!docs.length) { problemas.push(`${esc(norm)}: no está en el pool`); continue; }
        const enBodega = docs.filter(d => d.estado === 'en_bodega');
        if (!enBodega.length) {
          const estados = docs.map(d => EquiposPoolService.ESTADO_LABELS[d.estado] || d.estado).join(', ');
          problemas.push(`${esc(norm)}: no está en bodega (${esc(estados)})`);
          continue;
        }
        // Serial compartido con 2+ unidades en bodega: solo es inequívoco si la
        // venta se abrió desde la fila de una unidad concreta.
        const unidad = enBodega.length === 1 ? enBodega[0]
          : enBodega.find(d => d.id === this._ventaDesdeId);
        if (!unidad) { problemas.push(`${esc(norm)}: serial en 2+ modelos en bodega — regístralo desde el botón de venta de su fila`); continue; }
        vendibles.push(unidad);
      }

      if (!vendibles.length) {
        Toast.show('Ningún serial se puede vender: ' + problemas.join(' · ').replace(/<[^>]*>/g, ''), 'bad');
        return;
      }
      const detalle = vendibles.map(u =>
        `<span style="font-family:var(--font-mono);">${esc(u.serial || u.serial_norm)}</span> (${esc(u.modelo_label || 'sin modelo')})`).join('<br>');
      const avisos = problemas.length
        ? `<br><br><strong>${problemas.length} serial(es) NO se venderán:</strong><br>${problemas.join('<br>')}` : '';
      if (!await Modal.confirm({
        title: 'Registrar venta',
        message: `Venta a <strong>${esc(clienteSel.nombre)}</strong>${clienteExcepcion ? ' <em>(por excepción — no registrado en la app)</em>' : ''}${factura ? ` — factura QBO <strong>${esc(factura)}</strong>` : ''}.<br>
          Salen de bodega de forma permanente:<br><br>${detalle}${avisos}`,
        confirmLabel: `Vender ${vendibles.length} equipo(s)`,
      })) return;

      let ok = 0; const errores = [];
      for (const u of vendibles) {
        try {
          await EquiposPoolService.vender(u.id, {
            factura, notas,
            cliente_id: clienteSel.id, cliente_nombre: clienteSel.nombre,
            cliente_excepcion: clienteExcepcion,
          }, firebase.auth().currentUser);
          ok++;
        } catch (e) {
          errores.push(`${u.serial || u.id}: ${e.message || e}`);
        }
      }
      Modal.close('eqVentaModal');
      let msg = `${ok} equipo(s) registrados como vendidos.`;
      if (errores.length) msg += ` ${errores.length} fallaron: ${errores.join(' · ')}`;
      Toast.show(msg, errores.length ? 'warn' : 'ok');
      this.cargar();
    } catch (e) {
      console.error('Error al registrar la venta:', e);
      Toast.show('Error al registrar la venta: ' + (e.message || e), 'bad');
    } finally {
      btn.disabled = false;
    }
  },

  // ── Historia (kardex) ────────────────────────────────────────────────
  _MOV_ICONS: {
    ingreso_bodega: 'package-plus', asignacion_contrato: 'file-text',
    liberacion: 'undo-2', entrega: 'truck', ingreso_taller: 'wrench',
    salida_taller: 'log-out', prestamo_poc: 'radio-tower', devolucion: 'corner-down-left',
    inspeccion: 'search-check', baja: 'archive-x', venta: 'banknote',
    correccion_serial: 'pencil',
    migracion: 'database', cambio_estado: 'arrow-right-left',
  },

  async abrirHistoria(id) {
    const eq = this._equipos.find(x => x.id === id);
    if (!eq) return;
    const esc = FMT.esc;
    document.getElementById('histSerialLabel').textContent = eq.serial || eq.serial_norm;
    document.getElementById('histResumen').innerHTML = `
      <span class="eq-badge eq-badge-${esc(eq.estado)}">${esc(EquiposPoolService.ESTADO_LABELS[eq.estado] || eq.estado)}</span>
      <span style="font-size:13px; color:var(--fg-2); margin-left:8px;">${esc(eq.modelo_label || 'sin modelo')}</span>
      ${eq.asignacion ? `<span class="eq-sub" style="display:inline; margin-left:8px;">${esc(eq.asignacion.cliente_nombre || '')} · ${esc(eq.asignacion.contrato_id || '')}</span>` : ''}`;
    const cont = document.getElementById('histMovimientos');
    cont.innerHTML = 'Cargando…';
    Modal.open('eqHistoriaModal');
    try {
      const movs = await EquiposPoolService.getMovimientos(id);
      if (!movs.length) { cont.innerHTML = '<p style="color:var(--fg-3); font-size:13px;">Sin movimientos registrados.</p>'; return; }
      cont.innerHTML = movs.map(m => {
        const fecha = m.at?.toDate ? FMT.datetime(m.at.toDate()) : '—';
        const transicion = (m.de_estado || m.a_estado)
          ? ` <span style="color:var(--fg-3);">${esc(EquiposPoolService.ESTADO_LABELS[m.de_estado] || m.de_estado || '·')} → ${esc(EquiposPoolService.ESTADO_LABELS[m.a_estado] || m.a_estado || '·')}</span>` : '';
        const ref = m.ref ? ` · <span style="color:var(--fg-3);">${esc(m.ref.tipo)}: ${esc(m.ref.label || m.ref.id || '')}</span>` : '';
        return `<div class="mov-item">
          <div class="mov-icon"><i data-lucide="${this._MOV_ICONS[m.tipo] || 'circle'}"></i></div>
          <div class="mov-body">
            <strong>${esc((m.tipo || '').replace(/_/g, ' '))}</strong>${transicion}
            ${m.notas ? `<div>${esc(m.notas)}</div>` : ''}
            <div class="mov-meta">${esc(fecha)}${ref}${m.por_email ? ` · ${esc(m.por_email)}` : (m.por === 'system' ? ' · sistema' : '')}</div>
          </div>
        </div>`;
      }).join('');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">Error al cargar movimientos: ${FMT.esc(e.message || e)}</p>`;
    }
  },

  // ── Import Excel ─────────────────────────────────────────────────────
  abrirImport() {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden importar equipos.', 'bad'); return; }
    this._importRows = null;
    document.getElementById('eqImportFile').value = '';
    document.getElementById('eqImportPreview').innerHTML = '';
    document.getElementById('btnConfirmarImport').disabled = true;
    Modal.open('eqImportModal');
  },

  cerrarImport() {
    Modal.close('eqImportModal');
    this._importRows = null;
  },

  // Solo SERIAL es obligatoria. MODELO debe calzar con el catálogo (como se ve
  // en el filtro/exportación); CONDICION acepta nuevo/reuso. Filas sin MODELO
  // usan el modelo por defecto del selector del modal.
  descargarPlantilla() {
    const ws = XLSX.utils.json_to_sheet([{
      SERIAL:    'B12345678',
      MODELO:    'HYTERA PNC360S',
      CONDICION: 'nuevo',
      PROVEEDOR: 'Proveedor S.A.',
      NOTAS:     'Compra factura 123',
    }]);
    ws['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 20 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'EQUIPOS');
    XLSX.writeFile(wb, 'plantilla-equipos-serial.xlsx');
  },

  async previsualizarImport(input) {
    const archivo = input.files?.[0];
    if (!archivo) return;
    const preview = document.getElementById('eqImportPreview');
    try {
      const data = await archivo.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!jsonData.length) { preview.innerHTML = '<p style="color:var(--fg-3);">El archivo no tiene filas.</p>'; return; }

      const headers = Object.keys(jsonData[0]);
      const col = (...alias) => headers.find(h => alias.some(a => FMT.normalize(h).includes(a)));
      const colSerial = col('serial', 'serie');
      if (!colSerial) {
        preview.innerHTML = '<p style="color:#b91c1c;">No se encontró la columna del serial. Se espera un header <code>SERIAL</code>.</p>';
        return;
      }
      const colModelo = col('modelo');
      const colCond   = col('condicion');
      const colProv   = col('proveedor');
      const colNotas  = col('nota');

      // Índice del catálogo para resolver la columna MODELO fila por fila:
      // por id exacto o por label compacto (mismo criterio que _tightLabel —
      // "HYTERA PNC360S" ≡ "Hytera PNC-360S"; N y R siguen siendo filas aparte).
      const porId = new Map(this._modelos.map(m => [m.id, m]));
      const porLabel = new Map();
      for (const m of this._modelos) {
        const k = EquiposPoolService._tightLabel(m.label);
        if (k && !porLabel.has(k)) porLabel.set(k, m);
      }

      const vistos = new Set();
      const filas = [];
      for (const f of jsonData) {
        const serial = (f[colSerial] || '').toString().trim();
        if (!serial) continue; // fila vacía del Excel
        const norm = EquiposPoolService.normalizarSerial(serial);
        const fila = { serial, norm, modelo_id: null, modelo_label: '',
                       condicion: 'nuevo', proveedor: '', notas: '', problema: '' };
        if (!EquiposPoolService.esSerialValido(norm)) fila.problema = 'serial inválido';
        const modeloTxt = colModelo ? (f[colModelo] || '').toString().trim() : '';
        if (modeloTxt) {
          const m = porId.get(modeloTxt) || porLabel.get(EquiposPoolService._tightLabel(modeloTxt));
          if (m) { fila.modelo_id = m.id; fila.modelo_label = m.label; }
          else if (!fila.problema) fila.problema = `modelo "${modeloTxt}" no está en el catálogo`;
        }
        if (colCond) {
          const c = FMT.normalize((f[colCond] || '').toString().trim());
          if (c) fila.condicion = (c.startsWith('r') || c === 'usado') ? 'reuso' : 'nuevo';
        }
        if (colProv)  fila.proveedor = (f[colProv] || '').toString().trim();
        if (colNotas) fila.notas = (f[colNotas] || '').toString().trim();
        const dupKey = `${norm}|${fila.modelo_id || ''}`;
        if (!fila.problema && vistos.has(dupKey)) fila.problema = 'duplicado en el archivo';
        vistos.add(dupKey);
        filas.push(fila);
      }
      this._importRows = filas;

      const validas = filas.filter(f => !f.problema);
      const problemas = filas.filter(f => f.problema);
      const sinModelo = validas.filter(f => !f.modelo_id).length;

      const esc = FMT.esc;
      const muestra = validas.slice(0, 8).map(f => `<tr>
        <td class="td-mono">${esc(f.norm)}</td>
        <td>${f.modelo_label ? esc(f.modelo_label) : '<span style="color:var(--fg-3);">(modelo del selector)</span>'}</td>
        <td>${f.condicion === 'reuso' ? 'Reuso' : 'Nuevo'}</td>
        <td>${esc(f.proveedor || '—')}</td>
      </tr>`).join('');
      const listaProblemas = problemas.slice(0, 6)
        .map(f => `<li><span class="td-mono">${esc(f.serial)}</span>: ${esc(f.problema)}</li>`).join('');
      preview.innerHTML = `
        <div style="margin-bottom:var(--sp-2);">
          <span class="import-stat"><strong>${filas.length}</strong> filas</span>
          <span class="import-stat" style="color:#15803d;"><strong>${validas.length}</strong> válidas</span>
          <span class="import-stat" style="color:#b91c1c;"><strong>${problemas.length}</strong> con problema</span>
          ${sinModelo ? `<span class="import-stat" style="color:#92400e;"><strong>${sinModelo}</strong> sin MODELO (usarán el del selector)</span>` : ''}
        </div>
        <div class="app-table-wrap" style="max-height:220px; overflow:auto;">
          <table class="app-table compact">
            <thead><tr><th>Serial</th><th>Modelo</th><th>Condición</th><th>Proveedor</th></tr></thead>
            <tbody>${muestra}</tbody>
          </table>
        </div>
        ${validas.length > 8 ? `<p style="font-size:12px; color:var(--fg-3); margin:var(--sp-2) 0 0;">Mostrando 8 de ${validas.length} filas válidas.</p>` : ''}
        ${problemas.length ? `<div style="font-size:12px; color:#b91c1c; margin-top:var(--sp-2);">Filas que NO se importarán:<ul style="margin:4px 0 0; padding-left:18px;">${listaProblemas}</ul>${problemas.length > 6 ? `<span>…y ${problemas.length - 6} más.</span>` : ''}</div>` : ''}`;
      document.getElementById('btnConfirmarImport').disabled = validas.length === 0;
    } catch (e) {
      console.error('Error al leer el archivo:', e);
      preview.innerHTML = '<p style="color:#b91c1c;">No se pudo leer el archivo. ¿Es un Excel válido?</p>';
    }
  },

  async confirmarImport() {
    if (!this._importRows) return;
    const validas = this._importRows.filter(f => !f.problema);
    if (!validas.length) return;
    const defaultId = document.getElementById('impModelo').value;
    if (validas.some(f => !f.modelo_id) && !defaultId) {
      Toast.show('Hay filas sin columna MODELO: selecciona el modelo por defecto.', 'bad');
      return;
    }
    const btn = document.getElementById('btnConfirmarImport');
    btn.disabled = true;
    btn.innerHTML = 'Importando…';
    try {
      // Agrupa filas con metadatos idénticos y llama recibir() por grupo — se
      // conservan los batches, el dedup por chunks y el failsafe de colisión.
      const grupos = new Map();
      for (const f of validas) {
        const modelo_id = f.modelo_id || defaultId;
        const modelo_label = f.modelo_id ? f.modelo_label : this._modeloLabel(defaultId);
        const key = JSON.stringify([modelo_id, f.condicion, f.proveedor, f.notas]);
        const g = grupos.get(key) || { seriales: [], meta: {
          modelo_id, modelo_label, condicion: f.condicion,
          proveedor: f.proveedor, notas: f.notas, origen: 'import_excel',
        } };
        g.seriales.push(f.serial);
        grupos.set(key, g);
      }
      const res = { nuevos: 0, existentes: 0, colisiones: 0, invalidos: 0 };
      for (const g of grupos.values()) {
        const r = await EquiposPoolService.recibir(g.seriales, g.meta, firebase.auth().currentUser);
        for (const k of Object.keys(res)) res[k] += r[k];
      }
      Toast.show(`Import completado: ${res.nuevos} nuevos, ${res.existentes} ya existían, ${res.colisiones} colisiones de serial, ${res.invalidos} inválidos.`, res.colisiones ? 'warn' : 'ok');
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

  // ── Conciliación pool vs conteo manual ───────────────────────────────
  async abrirConciliacion() {
    const cont = document.getElementById('concilTabla');
    cont.innerHTML = 'Cargando…';
    Modal.open('eqConcilModal');
    try {
      const conteos = await InventarioService.getInventarioActual();
      const esc = FMT.esc;

      // Pool en_bodega agrupado por modelo (sobre lo ya cargado en memoria).
      const pool = new Map();
      for (const eq of this._equipos.filter(e => e.estado === 'en_bodega')) {
        const key = eq.modelo_id || EquiposPoolService.modeloKey(null, eq.modelo_label);
        const cur = pool.get(key) || { label: eq.modelo_label, n: 0 };
        cur.n++;
        pool.set(key, cur);
      }

      // Unión de modelos con conteo manual o con unidades en el pool.
      const filas = new Map();
      for (const c of conteos) {
        filas.set(c.id, {
          label: this._modeloLabel(c.id) || c.id,
          conteo: c.cantidad ?? 0,
          pool: pool.get(c.id)?.n ?? 0,
        });
        pool.delete(c.id);
      }
      for (const [key, p] of pool) {
        filas.set(key, { label: p.label || key, conteo: 0, pool: p.n });
      }

      const rows = [...filas.values()]
        .map(f => ({ ...f, diff: f.conteo - f.pool }))
        .filter(f => f.conteo || f.pool)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.label.localeCompare(b.label));

      if (!rows.length) {
        cont.innerHTML = '<p style="color:var(--fg-3); font-size:13px;">Sin datos: no hay conteo manual ni unidades en bodega todavía.</p>';
        return;
      }
      const cuadrados = rows.filter(f => f.diff === 0).length;
      cont.innerHTML = `
        <div style="margin-bottom:var(--sp-2); font-size:13px;">
          <strong>${cuadrados}/${rows.length}</strong> modelos cuadrados
        </div>
        <table class="app-table compact">
          <thead><tr><th>Modelo</th><th style="text-align:right;">Conteo manual</th><th style="text-align:right;">Pool (bodega)</th><th style="text-align:right;">Diferencia</th></tr></thead>
          <tbody>
            ${rows.map(f => `<tr>
              <td>${esc(f.label)}</td>
              <td style="text-align:right;">${f.conteo}</td>
              <td style="text-align:right;">${f.pool}</td>
              <td style="text-align:right; font-weight:600; color:${f.diff === 0 ? '#15803d' : '#b91c1c'};">${f.diff > 0 ? '+' + f.diff : f.diff}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <p style="font-size:12px; color:var(--fg-3); margin:var(--sp-2) 0 0;">
          Diferencia positiva = unidades contadas que aún no están en el pool (captúralas con
          "Recibir equipos" en modo toma física). Negativa = el pool tiene más que el conteo
          (posible doble registro o conteo desactualizado).
        </p>`;
    } catch (e) {
      cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">Error: ${FMT.esc(e.message || e)}</p>`;
    }
  },

  // ── Export ───────────────────────────────────────────────────────────
  exportarExcel() {
    const rows = this._filtrados().map(eq => ({
      SERIAL:    eq.serial || eq.serial_norm,
      MODELO:    eq.modelo_label || '',
      CONDICION: eq.condicion || '',
      PROPIEDAD: eq.propiedad === 'cecomunica' ? 'Flota Cecomunica' : eq.propiedad === 'cliente' ? 'De cliente' : 'Desconocida',
      ESTADO:    EquiposPoolService.ESTADO_LABELS[eq.estado] || eq.estado,
      CLIENTE:   eq.asignacion?.cliente_nombre || '',
      CONTRATO:  eq.asignacion?.contrato_id || '',
      ORIGEN:    eq.origen || '',
      VERIFICADO: eq.verificado === false ? 'NO' : 'SI',
      NOTAS:     eq.notas || '',
    }));
    if (!rows.length) { Toast.show('Nada que exportar con el filtro actual.', 'warn'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'EQUIPOS');
    XLSX.writeFile(wb, `equipos-pool-${new Date().toISOString().slice(0, 10)}.xlsx`);
  },
};

document.addEventListener('DOMContentLoaded', () => {
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '/login.html'; return; }
    const userDoc = await UsuariosService.getUsuario(user.uid);
    EquiposPool._rol = userDoc?.rol || ROLES.VISTA;

    // Lectura: admin/inventario/gerente. Escritura: admin/inventario.
    const permitidos = [ROLES.ADMIN, ROLES.INVENTARIO, ROLES.GERENTE];
    if (!permitidos.includes(EquiposPool._rol)) {
      Toast.show('No autorizado. Tu rol no tiene acceso a este módulo.', 'bad');
      window.location.href = '/index.html';
      return;
    }
    if (!EquiposPool.puedeEscribir()) {
      document.getElementById('btnRecibir')?.remove();
      document.getElementById('btnVenta')?.remove();
      document.getElementById('btnImportar')?.remove();
      document.getElementById('btnPlantilla')?.remove();
    }
    await EquiposPool.cargarModelos();
    EquiposPool._restaurarFiltros();

    // Deep-links de entrada al pool:
    //   ?serial=  (desde contrato/cliente/orden) → pestaña "todos" + búsqueda
    //   ?tab=     (señales del home)             → abre esa pestaña de estado
    //   ?verificar=1 (señal "por verificar")     → toggle "solo sin verificar"
    // En todos los casos se limpian los filtros secundarios para que lo pedido
    // se vea sí o sí (la búsqueda no se persiste entre visitas).
    const qp = new URLSearchParams(location.search);
    const serialParam = qp.get('serial');
    const tabParam = qp.get('tab');
    const verifParam = qp.get('verificar');
    const modeloParam = qp.get('modelo'); // id de catálogo — desde Inventario de Radios
    const setTabUI = (tab) => {
      EquiposPool._tab = tab;
      document.querySelectorAll('.eq-tab').forEach(b =>
        b.classList.toggle('is-active', b.dataset.tab === tab));
    };
    const limpiarSecundarios = () => {
      ['eqFiltroModelo', 'eqFiltroPropiedad'].forEach(id => {
        const n = document.getElementById(id); if (n) n.value = '';
      });
      ['chkSinVerificar', 'chkCompartidos', 'chkSinCliente'].forEach(id => {
        const n = document.getElementById(id); if (n) n.checked = false;
      });
    };
    const TABS_VALIDAS = ['en_bodega', 'asignado_contrato', 'en_cliente', 'en_taller', 'en_poc', 'devuelto_revision', 'otros', 'todos'];
    if (serialParam) {
      setTabUI('todos');
      limpiarSecundarios();
      const q = document.getElementById('eqBusqueda');
      if (q) q.value = serialParam;
    } else if (tabParam || verifParam || modeloParam) {
      limpiarSecundarios();
      setTabUI(TABS_VALIDAS.includes(tabParam) ? tabParam : 'todos');
      if (verifParam) {
        const chk = document.getElementById('chkSinVerificar');
        if (chk) chk.checked = true;
      }
      // ?modelo=<id de catálogo> (clic en "Unidades (seriales)" de Inventario
      // de Radios): el select de filtro usa claves de FAMILIA (no ids), así
      // que primero se resuelve el id a su familia; si el param ya viene como
      // clave de familia, también sirve.
      if (modeloParam) {
        const sel = document.getElementById('eqFiltroModelo');
        let famKey = '';
        for (const [key, fam] of (EquiposPool._familias || new Map()).entries()) {
          if (key === modeloParam || fam.ids.has(modeloParam)) { famKey = key; break; }
        }
        if (sel && famKey && [...sel.options].some(o => o.value === famKey)) sel.value = famKey;
      }
    }

    await EquiposPool.cargar();
  });
});
