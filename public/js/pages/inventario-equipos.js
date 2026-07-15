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

  ESTADOS_OTROS: ['devuelto_revision', 'baja'],

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
    const opts = this._modelos
      .map(m => `<option value="${FMT.esc(m.id)}">${FMT.esc(m.label)}</option>`).join('');
    ['eqFiltroModelo', 'recModelo', 'editModelo', 'impModelo'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = (sel.options[0]?.outerHTML || '') + opts;
    });
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

  _filtrados() {
    const q = (document.getElementById('eqBusqueda')?.value || '').trim().toLowerCase();
    const mod = document.getElementById('eqFiltroModelo')?.value || '';
    const prop = document.getElementById('eqFiltroPropiedad')?.value || '';
    const soloSinVerificar = document.getElementById('chkSinVerificar')?.checked;
    const soloCompartidos = document.getElementById('chkCompartidos')?.checked;
    const soloSinCliente = document.getElementById('chkSinCliente')?.checked;
    return this._equipos.filter(eq => {
      if (!this._enTab(eq, this._tab)) return false;
      if (mod && eq.modelo_id !== mod) return false;
      if (prop && (eq.propiedad || 'desconocida') !== prop) return false;
      if (soloSinVerificar && eq.verificado !== false) return false;
      if (soloCompartidos && !eq.serial_compartido) return false;
      if (soloSinCliente && !this._sinCliente(eq)) return false;
      if (q) {
        const blob = [eq.serial, eq.serial_norm, eq.modelo_label,
          eq.asignacion?.cliente_nombre, eq.asignacion?.contrato_id, eq.notas]
          .map(x => (x || '').toString().toLowerCase()).join(' ');
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  },

  render() {
    const tbody = document.getElementById('eqTabla');
    if (!tbody) return;
    const lista = this._filtrados();
    const esc = FMT.esc;

    // KPIs + contadores de tabs (sobre el total, no sobre el filtro)
    const n = estado => this._equipos.filter(e => e.estado === estado).length;
    const nVerificar = this._equipos.filter(e => e.verificado === false).length;
    const nOtros = this._equipos.filter(e => this.ESTADOS_OTROS.includes(e.estado)).length;
    const flotaCampo = this._equipos.filter(e => e.propiedad === 'cecomunica'
      && ['asignado_contrato', 'en_cliente', 'en_poc'].includes(e.estado)).length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiBodega', n('en_bodega'));
    set('kpiFlotaCampo', flotaCampo);
    set('kpiTaller', n('en_taller'));
    set('kpiVerificar', nVerificar);
    set('countBodega', `(${n('en_bodega')})`);
    set('countAsignados', `(${n('asignado_contrato')})`);
    set('countCliente', `(${n('en_cliente')})`);
    set('countTaller', `(${n('en_taller')})`);
    set('countPoc', `(${n('en_poc')})`);
    set('countOtros', `(${nOtros})`);
    set('countTodos', `(${this._equipos.length})`);

    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--fg-3); padding:var(--sp-6);">
        ${this._equipos.length ? 'Sin resultados con el filtro actual.' : 'No hay equipos en el pool. Usa "Recibir equipos" o "Importar Excel".'}
      </td></tr>`;
    } else {
      const puede = this.puedeEscribir();
      const esAdmin = this._rol === ROLES.ADMIN;
      tbody.innerHTML = lista.map(eq => {
        const asignadoA = eq.asignacion
          ? `${esc(eq.asignacion.cliente_nombre || '—')}<span class="eq-sub">${esc(eq.asignacion.contrato_id || '')}</span>`
          : (eq.orden_actual_id ? `<span class="eq-sub">orden en taller</span>` : '—');
        const compartido = eq.serial_compartido
          ? `<span class="eq-compartido" title="Este serial existe en más de un modelo — verifica el modelo antes de operar">2+ MODELOS</span>` : '';
        const noVerif = eq.verificado === false
          ? `<span class="eq-noverif" title="Creado por migración automática — pendiente de confirmación">SIN VERIFICAR</span>` : '';
        const acciones = [
          `<button class="btn btn-ghost btn-icon btn-sm" title="Historia (kardex)" onclick="EquiposPool.abrirHistoria('${esc(eq.id)}')"><i data-lucide="history"></i></button>`,
          (puede && eq.verificado === false) ? `<button class="btn btn-ghost btn-icon btn-sm" title="Marcar como verificado" onclick="EquiposPool.verificar('${esc(eq.id)}')"><i data-lucide="badge-check"></i></button>` : '',
          puede ? `<button class="btn btn-ghost btn-icon btn-sm" title="Editar" onclick="EquiposPool.abrirEdicion('${esc(eq.id)}')"><i data-lucide="pencil"></i></button>` : '',
          (puede && eq.estado === 'devuelto_revision') ? `<button class="btn btn-ghost btn-icon btn-sm" title="Inspección OK → regresa a bodega" onclick="EquiposPool.inspeccionOk('${esc(eq.id)}')"><i data-lucide="check-circle-2"></i></button>` : '',
          (esAdmin && eq.estado !== 'baja') ? `<button class="btn btn-danger btn-icon btn-sm" title="Dar de baja" onclick="EquiposPool.darDeBaja('${esc(eq.id)}')"><i data-lucide="archive-x"></i></button>` : '',
        ].join('');
        const prop = eq.propiedad || 'desconocida';
        return `<tr>
          <td class="td-mono">${esc(eq.serial || eq.serial_norm)}${compartido}${noVerif}</td>
          <td>${esc(eq.modelo_label || '—')}</td>
          <td>${eq.condicion === 'reuso' ? 'Reuso' : 'Nuevo'}</td>
          <td><span class="eq-prop eq-prop-${esc(prop)}" title="${prop === 'cecomunica' ? 'Flota propia de Cecomunica' : prop === 'cliente' ? 'Equipo propiedad del cliente' : 'Propiedad sin clasificar'}">${esc(this.PROP_LABELS[prop] || prop)}</span></td>
          <td><span class="eq-badge eq-badge-${esc(eq.estado)}">${esc(EquiposPoolService.ESTADO_LABELS[eq.estado] || eq.estado)}</span></td>
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

  // ── Historia (kardex) ────────────────────────────────────────────────
  _MOV_ICONS: {
    ingreso_bodega: 'package-plus', asignacion_contrato: 'file-text',
    liberacion: 'undo-2', entrega: 'truck', ingreso_taller: 'wrench',
    salida_taller: 'log-out', prestamo_poc: 'radio-tower', devolucion: 'corner-down-left',
    inspeccion: 'search-check', baja: 'archive-x', correccion_serial: 'pencil',
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

  descargarPlantilla() {
    const ws = XLSX.utils.json_to_sheet([{ SERIAL: 'B12345678' }]);
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
      const colSerial = headers.find(h => FMT.normalize(h).includes('serial'))
        || headers.find(h => FMT.normalize(h).includes('serie'));
      if (!colSerial) {
        preview.innerHTML = '<p style="color:#b91c1c;">No se encontró la columna del serial. Se espera un header <code>SERIAL</code>.</p>';
        return;
      }

      const seriales = jsonData.map(f => (f[colSerial] || '').toString().trim()).filter(Boolean);
      const validos = seriales.filter(s => EquiposPoolService.esSerialValido(EquiposPoolService.normalizarSerial(s)));
      this._importRows = seriales;

      const esc = FMT.esc;
      const muestra = validos.slice(0, 8).map(s => `<tr><td class="td-mono">${esc(EquiposPoolService.normalizarSerial(s))}</td></tr>`).join('');
      preview.innerHTML = `
        <div style="margin-bottom:var(--sp-2);">
          <span class="import-stat"><strong>${seriales.length}</strong> filas</span>
          <span class="import-stat" style="color:#15803d;"><strong>${validos.length}</strong> válidas</span>
          <span class="import-stat" style="color:#b91c1c;"><strong>${seriales.length - validos.length}</strong> inválidas</span>
        </div>
        <div class="app-table-wrap" style="max-height:220px; overflow:auto;">
          <table class="app-table compact">
            <thead><tr><th>Serial</th></tr></thead>
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
    const modeloId = document.getElementById('impModelo').value;
    if (!modeloId) { Toast.show('Selecciona el modelo del archivo.', 'bad'); return; }
    const btn = document.getElementById('btnConfirmarImport');
    btn.disabled = true;
    btn.innerHTML = 'Importando…';
    try {
      const res = await EquiposPoolService.recibir(this._importRows, {
        modelo_id: modeloId,
        modelo_label: this._modeloLabel(modeloId),
        origen: 'import_excel',
      }, firebase.auth().currentUser);
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
      document.getElementById('btnImportar')?.remove();
      document.getElementById('btnPlantilla')?.remove();
    }
    await EquiposPool.cargarModelos();
    EquiposPool._restaurarFiltros();
    await EquiposPool.cargar();
  });
});
