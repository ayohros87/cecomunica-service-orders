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

  // Filtros persistidos por usuario (localStorage).
  // Default de primera visita (N4, auditoría 2026-08-04): **Bodega, sin filtro
  // de propiedad**. Antes se abría en "En cliente" con propiedad=cecomunica —
  // o sea, en la lista más grande (3,279 unidades que están bien) y con un
  // filtro que el usuario nunca escogió. Bodega es lo accionable: lo que se
  // puede asignar hoy. Los usuarios que ya tienen preferencia guardada la
  // conservan (el merge de abajo respeta lo almacenado).
  FILTROS_KEY: 'eqpool_filtros_v1',
  FILTROS_DEFAULT: { tab: 'en_bodega', propiedad: '', modelo: '',
                     sinVerificar: false, compartidos: false, sinCliente: false },

  // Colas de la fila "Pendientes" → a qué estado de la página corresponden.
  // Reutilizan `_tab` (y el toggle sinVerificar) en vez de introducir un estado
  // nuevo: son otra puerta de entrada al mismo filtro, no otro modo.
  COLAS: {
    por_clasificar:    { tab: 'por_clasificar' },
    devuelto_revision: { tab: 'devuelto_revision' },
    conflictos:        { tab: 'conflictos' },
    sin_verificar:     { tab: 'todos', chk: 'chkSinVerificar' },
  },

  // Pestaña "Baja / Venta": estados que sacaron la unidad de la flota.
  // devuelto_revision ya tiene pestaña propia ("Por inspeccionar").
  ESTADOS_OTROS: ['baja', 'vendido'],

  // Etiquetas humanas del origen de la ficha (el valor crudo queda en title).
  ORIGEN_LABELS: {
    bodega: 'Recibido en bodega',
    toma_fisica: 'Toma física',
    import_excel: 'Importado de Excel',
    migracion_contrato: 'Migración · contrato',
    migracion_orden: 'Migración · orden',
    migracion_poc: 'Migración · POC',
    venta: 'Venta directa',
  },

  PROP_LABELS: { cecomunica: 'Flota', cliente: 'Cliente', desconocida: '?' },

  puedeEscribir() {
    return this._rol === ROLES.ADMIN || this._rol === ROLES.INVENTARIO;
  },

  // ── Carga ────────────────────────────────────────────────────────────
  async cargar() {
    try {
      this._equipos = await EquiposPoolService.listar();
      this.render();
      // Sub-estado derivado "listo para entrega" (P4a auditoría 2026-07-24):
      // "En taller" mezclaba radios en trabajo con radios TERMINADOS esperando
      // que alguien registre la entrega. Se consulta el estado real de la
      // orden de cada unidad en taller (async, la tabla ya está pintada).
      await this._cargarEstadosOrdenTaller();
      this.render();
    } catch (e) {
      console.error('Error al cargar equipos:', e);
      Toast.show('Error al cargar el pool: ' + (e.message || e), 'bad');
    }
  },

  _ordenEstados: new Map(), // orden_actual_id → estado_reparacion

  async _cargarEstadosOrdenTaller() {
    const ids = [...new Set(this._equipos
      .filter(e => e.estado === 'en_taller' && e.orden_actual_id)
      .map(e => e.orden_actual_id))];
    if (!ids.length) { this._ordenEstados = new Map(); return; }
    const db = firebase.firestore();
    const out = new Map();
    try {
      for (let i = 0; i < ids.length; i += 10) {
        const snap = await db.collection('ordenes_de_servicio')
          .where(firebase.firestore.FieldPath.documentId(), 'in', ids.slice(i, i + 10)).get();
        snap.docs.forEach(d => out.set(d.id, (d.data().estado_reparacion || '').trim().toUpperCase()));
      }
    } catch (e) { /* best-effort: sin sub-estado */ }
    this._ordenEstados = out;
  },

  _listoParaEntrega(eq) {
    return eq.estado === 'en_taller' && eq.orden_actual_id
      && this._ordenEstados.get(eq.orden_actual_id) === 'COMPLETADO (EN OFICINA)';
  },

  async cargarModelos() {
    try {
      const todos = await ModelosService.getModelos();
      this._modelos = (todos || [])
        .filter(m => m.activo !== false)
        // `estado` (N/R) se conserva: es lo que determina la condición de la
        // unidad — ver _condicionDeModelo.
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim(),
                     estado: (m.estado || '').toUpperCase() }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('No se pudo cargar el catálogo de modelos:', e);
      this._modelos = [];
    }
    // Modales (editar/import): fila EXACTA del catálogo (N y R aparte). El de
    // recibir vive en js/ui/asistente-recibir.js y carga su propio catálogo.
    const opts = this._modelos
      .map(m => `<option value="${FMT.esc(m.id)}">${FMT.esc(m.label)}</option>`).join('');
    ['editModelo', 'impModelo'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = (sel.options[0]?.outerHTML || '') + opts;
    });
    // La condición se deriva del modelo, así que sigue al selector.
    document.getElementById('editModelo')?.addEventListener('change', () =>
      this._sincronizarCondicion('editModelo', 'editCondicion', 'editCondicionHint',
        this._condicionOriginal));
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

  // La condición NO se escoge: la determina la fila del catálogo. El catálogo
  // modela nuevo y reuso como filas distintas ("PNC360S" / "PNC360S-R") porque
  // `inventario_actual` cuenta por fila y cada una lleva su propio `minimo`.
  // Dejar elegir modelo y condición por separado permitía guardar fichas que se
  // contradicen (etiqueta sin -R con condición reuso), que es lo que hubo que
  // corregir en 70 fichas el 2026-07-28. Mismo criterio que el servidor
  // (functions/src/domain/equiposPool.js) y que fix-condicion-modelo.js: manda
  // `estado`, y si falta se cae al sufijo del nombre.
  // Devuelve null si el modelo no está en el catálogo (fichas de migración con
  // modelo suelto, o "Sin modelo"): ahí NO hay de dónde derivar, así que el
  // llamador conserva la condición que ya tenía en vez de degradarla a 'nuevo'.
  _condicionDeModelo(modeloId) {
    const m = this._modelos.find(x => x.id === modeloId);
    if (!m) return null;
    if (m.estado === 'R') return 'reuso';
    if (m.estado === 'N') return 'nuevo';
    return /[\s-]r$/i.test(m.label || '') ? 'reuso' : 'nuevo';
  },

  // Refleja en el select deshabilitado la condición que impone el modelo. Si la
  // ficha traía otra (dato viejo), lo dice en vez de cambiarlo en silencio.
  _sincronizarCondicion(idModelo, idCondicion, idHint, condicionGuardada) {
    const selModelo = document.getElementById(idModelo);
    const selCond   = document.getElementById(idCondicion);
    const hint      = document.getElementById(idHint);
    if (!selModelo || !selCond) return;
    const modeloId = selModelo.value;
    const derivada = this._condicionDeModelo(modeloId);
    // Sin modelo en el catálogo se respeta lo que ya tenía la ficha.
    const cond = derivada || condicionGuardada || 'nuevo';
    selCond.value = cond;
    if (!hint) return;
    const etiqueta = (c) => (c === 'reuso' ? 'Refurbished' : 'Nuevo');
    if (!modeloId) {
      hint.textContent = 'La define el modelo escogido.';
      hint.style.color = 'var(--fg-3)';
    } else if (!derivada) {
      hint.textContent = `Modelo fuera del catálogo: se conserva «${etiqueta(cond)}» de la ficha.`;
      hint.style.color = 'var(--fg-3)';
    } else if (condicionGuardada && condicionGuardada !== cond) {
      hint.textContent = `La ficha decía «${etiqueta(condicionGuardada)}». Al guardar quedará `
        + `«${etiqueta(cond)}» según el modelo. Si es refurbished, escoge la fila con sufijo -R.`;
      hint.style.color = '#b45309';
    } else {
      hint.textContent = cond === 'reuso'
        ? 'Refurbished: el modelo lleva sufijo -R.'
        : 'Nuevo: el modelo no lleva sufijo -R.';
      hint.style.color = 'var(--fg-3)';
    }
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
    this._tab = f.tab || this.FILTROS_DEFAULT.tab;
    this._pintarSeleccion();
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
    // Escoger una ubicación sale de cualquier cola (incluida "Sin verificar",
    // que no es una pestaña sino un toggle).
    const chk = document.getElementById('chkSinVerificar');
    if (chk) chk.checked = false;
    this._pintarSeleccion();
    this.render();
  },

  // Tarjetas de "Pendientes". Volver a pulsar la cola activa la apaga y
  // devuelve a la ubicación por defecto — la tarjeta es un interruptor, no un
  // callejón: si no, el usuario queda dentro de una cola sin saber cómo salir.
  setCola(nombre) {
    const cola = this.COLAS[nombre];
    if (!cola) return;
    if (this._colaActiva() === nombre) { this.setTab(this.FILTROS_DEFAULT.tab); return; }
    const chk = document.getElementById('chkSinVerificar');
    if (chk) chk.checked = !!cola.chk;
    this._tab = cola.tab;
    this._pintarSeleccion();
    this.render();
  },

  // Qué cola está activa ahora mismo (o null). "Sin verificar" manda sobre la
  // pestaña porque es un toggle que se puede combinar con `todos`.
  _colaActiva() {
    if (document.getElementById('chkSinVerificar')?.checked) return 'sin_verificar';
    for (const [nombre, c] of Object.entries(this.COLAS)) {
      if (!c.chk && c.tab === this._tab) return nombre;
    }
    return null;
  },

  // Un solo lugar que pinta qué está seleccionado (pestaña o tarjeta), para que
  // las dos filas no puedan contradecirse.
  _pintarSeleccion() {
    const cola = this._colaActiva();
    document.querySelectorAll('.eq-tab').forEach(b =>
      b.classList.toggle('is-active', !cola && b.dataset.tab === this._tab));
    document.querySelectorAll('.eq-cola').forEach(b =>
      b.classList.toggle('is-active', b.dataset.cola === cola));
  },

  _enTab(eq, tab) {
    if (tab === 'todos') return true;
    if (tab === 'otros') return this.ESTADOS_OTROS.includes(eq.estado);
    if (tab === 'conflictos') return false; // esa pestaña pinta GRUPOS, no filas
    return eq.estado === tab;
  },

  // ── Conflictos de modelo: mismo serial con 2+ fichas ─────────────────
  // El failsafe de colisión crea una ficha sufijada cuando las fuentes traen
  // el modelo distinto (contrato vs POC vs bodega). Casi siempre es el MISMO
  // radio físico con el dato desparejo — esta cola los resuelve: fusionar en
  // la ficha real, o marcar que son radios distintos (colisión real Kenwood).
  _gruposConflicto() {
    const porNorm = new Map();
    for (const eq of this._equipos) {
      const k = eq.serial_norm || (eq.id || '').split('__')[0];
      if (!porNorm.has(k)) porNorm.set(k, []);
      porNorm.get(k).push(eq);
    }
    const grupos = [];
    for (const [norm, docs] of porNorm) {
      if (docs.length < 2) continue;
      if (docs.every(d => d.conflicto_revisado === true)) continue; // ya revisado
      grupos.push({ norm, docs });
    }
    return grupos.sort((a, b) => a.norm.localeCompare(b.norm));
  },

  renderConflictos(tbody, q = '') {
    const esc = FMT.esc;
    const puede = this.puedeEscribir();
    let grupos = this._gruposConflicto();
    if (q) grupos = grupos.filter(g => g.norm.toLowerCase().includes(q));
    if (!grupos.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--fg-3); padding:var(--sp-6); line-height:1.6;">
        No hay seriales con fichas en conflicto pendientes de revisar.<br>
        Aparecen aquí cuando el mismo serial se registró con modelos distintos desde fuentes distintas (contrato, POC, bodega).</td></tr>`;
      return;
    }
    tbody.innerHTML = grupos.map(({ norm, docs }) => {
      const cards = docs.map(d => `
        <label style="display:block; border:1px solid var(--border); border-radius:8px; padding:8px 10px; cursor:${puede ? 'pointer' : 'default'}; font-size:12.5px;">
          ${puede ? `<input type="radio" name="confl_${esc(norm)}" value="${esc(d.id)}" style="margin-right:6px;">` : ''}
          <strong>${esc(d.modelo_label || d.modelo_id || 'sin modelo')}</strong>
          ${EquiposPoolService.chipEstadoHtml(d.estado)}
          ${d.conflicto_revisado ? '<span class="eqpool-chip" style="background:#f1f5f9;color:#64748b;">revisado</span>' : ''}
          <div style="color:var(--fg-3); margin-top:3px;">
            ${esc(d.asignacion?.cliente_nombre || 'sin asignación')}${d.asignacion?.contrato_id ? ` · ${esc(d.asignacion.contrato_id)}` : ''}
            · origen ${esc((d.origen || '—').replace(/_/g, ' '))}
            · <span style="font-family:var(--font-mono, monospace); font-size:11px;">${esc(d.id)}</span>
          </div>
        </label>`).join('');
      return `<tr><td colspan="9" style="padding:12px 14px;">
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
          <span style="font-family:var(--font-mono, monospace); font-weight:600; font-size:14px;">${esc(norm)}</span>
          <span style="color:var(--fg-3); font-size:12px;">${docs.length} fichas — ¿cuál es el radio real?</span>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:8px;">${cards}</div>
        ${puede ? `<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
          <button class="btn btn-ghost btn-sm" onclick="EquiposPool.marcarDistintos('${esc(norm)}')"
                  title="Colisión real (dos radios físicos comparten serial, tipo Kenwood NX420 y NX920) — se conservan ambas fichas y el grupo sale de esta cola">
            Son radios distintos — mantener</button>
          <button class="btn btn-primary btn-sm" onclick="EquiposPool.fusionarGrupo('${esc(norm)}')"
                  title="Fusiona las demás fichas en la seleccionada: conserva su historia (kardex) y elimina los duplicados">
            Fusionar en la seleccionada</button>
        </div>` : ''}
      </td></tr>`;
    }).join('');
  },

  async fusionarGrupo(norm) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden fusionar fichas.', 'bad'); return; }
    const sel = document.querySelector(`input[name="confl_${norm}"]:checked`);
    if (!sel) { Toast.show('Selecciona primero la ficha que se conserva (el radio real).', 'warn'); return; }
    const grupo = this._gruposConflicto().find(g => g.norm === norm);
    if (!grupo) return;
    const keeperId = sel.value;
    const absorbidos = grupo.docs.filter(d => d.id !== keeperId).map(d => d.id);
    const ok = await Modal.confirm({
      title: 'Fusionar fichas',
      message: `Se fusionarán ${absorbidos.length} ficha(s) del serial ${norm} en la seleccionada. `
        + 'Su historia (kardex) se conserva dentro de la ficha final. Esta acción no se deshace.',
      confirmLabel: 'Fusionar', danger: true,
    });
    if (!ok) return;
    try {
      const fn = firebase.functions().httpsCallable('fusionarPoolFicha');
      const res = await fn({ keeperId, absorbidosIds: absorbidos });
      Toast.show(`Fusión lista: ${res.data.fusionados} ficha(s) absorbida(s).`, 'ok');
      await this.cargar();
    } catch (e) {
      Toast.show('No se pudo fusionar: ' + (e.message || e), 'bad');
    }
  },

  async marcarDistintos(norm) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden revisar conflictos.', 'bad'); return; }
    const grupo = this._gruposConflicto().find(g => g.norm === norm);
    if (!grupo) return;
    const ok = await Modal.confirm({
      title: 'Confirmar radios distintos',
      message: `Las ${grupo.docs.length} fichas del serial ${norm} quedarán marcadas como radios FÍSICOS distintos `
        + '(colisión real de serial entre modelos). Salen de esta cola pero conservan el aviso "2+ MODELOS".',
      confirmLabel: 'Son distintos',
    });
    if (!ok) return;
    try {
      const db = firebase.firestore();
      const batch = db.batch();
      grupo.docs.forEach(d => batch.set(db.collection('equipos_pool').doc(d.id),
        { conflicto_revisado: true }, { merge: true }));
      await batch.commit();
      grupo.docs.forEach(d => { d.conflicto_revisado = true; });
      Toast.show('Grupo marcado como radios distintos.', 'ok');
      this.render();
    } catch (e) {
      Toast.show('No se pudo marcar: ' + (e.message || e), 'bad');
    }
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
      listos: !!document.getElementById('chkListos')?.checked,
    };
  },

  _pasaFiltrosSecundarios(eq, f) {
    if (f.mod && !this._enFamilia(eq, f.mod)) return false;
    if (f.prop && (eq.propiedad || 'desconocida') !== f.prop) return false;
    if (f.sinVerificar && eq.verificado !== false) return false;
    if (f.compartidos && !eq.serial_compartido) return false;
    if (f.sinCliente && !this._sinCliente(eq)) return false;
    if (f.listos && !this._listoParaEntrega(eq)) return false;
    if (f.q) {
      const blob = [eq.serial, eq.serial_norm, eq.modelo_label,
        eq.asignacion?.cliente_nombre, eq.asignacion?.contrato_id, eq.notas]
        .map(x => (x || '').toString().toLowerCase()).join(' ');
      if (!blob.includes(f.q)) return false;
    }
    return true;
  },

  // Con búsqueda activa la pestaña NO restringe (N1, auditoría 2026-08-04).
  // Antes `_filtrados` exigía `_enTab && filtros`, y como la página abre en una
  // ubicación concreta, buscar un serial que estuviera en otra devolvía "Sin
  // resultados" — la pregunta más frecuente de la página fallaba en silencio.
  // Ahora la búsqueda barre el pool entero y la barra "Viendo:" lo dice.
  _buscando() {
    return !!(document.getElementById('eqBusqueda')?.value || '').trim();
  },

  _filtrados() {
    const f = this._filtrosActivos();
    const global = !!f.q;
    return this._equipos.filter(eq =>
      (global || this._enTab(eq, this._tab)) && this._pasaFiltrosSecundarios(eq, f));
  },

  // ── Chips de filtros activos ─────────────────────────────────────────
  PROP_FILTRO_LABELS: { cecomunica: 'Flota Cecomunica', cliente: 'De cliente', desconocida: 'Desconocida' },

  quitarFiltro(tipo) {
    const el = {
      modelo: 'eqFiltroModelo', propiedad: 'eqFiltroPropiedad', busqueda: 'eqBusqueda',
      sinVerificar: 'chkSinVerificar', compartidos: 'chkCompartidos', sinCliente: 'chkSinCliente',
      listos: 'chkListos',
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
    ['chkSinVerificar', 'chkCompartidos', 'chkSinCliente', 'chkListos'].forEach(id => {
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
    if (f.listos) chips.push(chip('listos', 'Solo listos para entrega'));
    if (f.q) chips.push(chip('busqueda', `Búsqueda: "${f.q}"`));
    if (!chips.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = '';
    // Buscando, la pestaña deja de restringir: hay que DECIRLO, o el usuario
    // cree que está viendo sólo la ubicación que tiene seleccionada.
    const nota = f.q
      ? '<span style="color:#92400e;">· buscando en <b>todo el pool</b>, no sólo en la pestaña</span>'
      : `<span style="color:var(--fg-3);">· ${nOcultos} equipos ocultos por estos filtros</span>`;
    bar.innerHTML = `<i data-lucide="filter" style="width:14px;height:14px;flex:none;color:#92400e;"></i>
      <span style="color:#92400e;">Viendo:</span> ${chips.join(' ')}
      ${nota}
      <span style="flex:1;"></span>
      <button class="btn btn-ghost btn-sm" onclick="EquiposPool.limpiarFiltros()">Limpiar todo</button>`;
  },

  render() {
    const tbody = document.getElementById('eqTabla');
    if (!tbody) return;
    const lista = this._filtrados();
    const esc = FMT.esc;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const fmt = (v) => v.toLocaleString('es-PA');

    // Tarjetas de "Pendientes": conteos GLOBALES del pool (no los toca ningún
    // filtro). Es una bandeja de trabajo — tiene que decir cuánto falta de
    // verdad, no cuánto falta dentro de lo que estés mirando ahora.
    const nPorClasificar = this._equipos.filter(e => e.estado === 'por_clasificar').length;
    const nPorInspeccionar = this._equipos.filter(e => e.estado === 'devuelto_revision').length;
    const nConflictos = this._gruposConflicto().length;
    const nSinVerificar = this._equipos.filter(e => e.verificado === false).length;
    set('colaPorClasificar', fmt(nPorClasificar));
    set('colaPorInspeccionar', fmt(nPorInspeccionar));
    set('colaConflictos', fmt(nConflictos));
    set('colaSinVerificar', fmt(nSinVerificar));
    const apagar = (cola, n) => document.querySelector(`.eq-cola[data-cola="${cola}"]`)
      ?.classList.toggle('is-vacia', n === 0);
    apagar('por_clasificar', nPorClasificar);
    apagar('devuelto_revision', nPorInspeccionar);
    apagar('conflictos', nConflictos);
    apagar('sin_verificar', nSinVerificar);

    // Contadores de pestañas: respetan los filtros activos (modelo/propiedad/
    // toggles/búsqueda) para que el número de la pestaña calce con la tabla.
    // Con búsqueda activa se vuelven "cuántos resultados hay en cada ubicación",
    // que es exactamente lo que uno quiere saber al buscar un serial.
    const fAct = this._filtrosActivos();
    const filtrables = this._equipos.filter(e => this._pasaFiltrosSecundarios(e, fAct));
    const n = estado => filtrables.filter(e => e.estado === estado).length;
    set('countBodega', `(${fmt(n('en_bodega'))})`);
    set('countAsignados', `(${fmt(n('asignado_contrato'))})`);
    set('countCliente', `(${fmt(n('en_cliente'))})`);
    set('countTaller', `(${fmt(n('en_taller'))})`);
    set('countOtros', `(${fmt(filtrables.filter(e => this.ESTADOS_OTROS.includes(e.estado)).length)})`);
    set('countTodos', `(${fmt(filtrables.length)})`);
    this._pintarSeleccion();

    // La vista de Conflictos pinta GRUPOS, no filas. Cede ante una búsqueda:
    // si el usuario teclea un serial, quiere resultados del pool entero —
    // dejarlo dentro de la cola sería reponer la trampa que N1 vino a quitar.
    if (this._tab === 'conflictos' && !fAct.q) {
      this._renderFiltrosActivos(fAct, 0, 0);
      // Conflictos pinta GRUPOS, no filas seleccionables: la selección que
      // viniera de otra vista se descarta aquí para que la barra de lote no
      // quede flotando sobre unidades que ya no están en pantalla.
      this._sel.clear();
      this._renderBarraLote();
      this.renderConflictos(tbody, fAct.q);
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    // Barra "Viendo: …" — hace obvios los filtros activos sin abrir dropdowns.
    // Con búsqueda el universo es el pool entero, no la pestaña.
    const universo = fAct.q
      ? this._equipos.length
      : this._equipos.filter(e => this._enTab(e, this._tab)).length;
    this._renderFiltrosActivos(fAct, lista.length, universo - lista.length);

    if (!lista.length) {
      // Estado vacío que EXPLICA la pestaña: qué cae aquí y cuál es el paso
      // que la alimenta/vacía — la página enseña el ciclo sola.
      const VACIO_POR_TAB = {
        en_bodega: 'No hay equipos disponibles en bodega. Entran con "Recibir equipos" / "Importar Excel", o cuando una entrada pasa la inspección.',
        asignado_contrato: 'No hay unidades reservadas por contrato. Se asignan desde la página de Seriales del contrato (picker "Tomar del pool") y salen al confirmarse la entrega.',
        en_cliente: 'No hay unidades en clientes. Llegan aquí cuando la orden de programación se marca "Entregado al cliente".',
        en_taller: 'No hay unidades en taller. Entran al agregarse con serial a una orden de servicio y salen al entregarse.',
        devuelto_revision: 'No hay radios pendientes de inspección. Los que el cliente devolvió (cierre de enmienda, anulación de contrato o cambio por defectuoso) caen aquí al recibirse por una orden de ENTRADA; con "Inspección OK" regresan a bodega como Refurbished, o se dan de baja.',
        por_clasificar: 'No hay unidades por clasificar. Aquí caen las que el sistema tenía en un cliente sin nada que lo respalde (ni contrato ni orden de servicio). No es una ubicación física: hay que encontrar el radio — si aparece en bodega se registra con "Corregir estado"; si lo tiene un cliente, se asigna en Seriales de su contrato.',
        otros: 'No hay unidades dadas de baja ni vendidas. Las ventas directas (facturadas en QuickBooks) se registran con "Registrar venta" para descontarlas de bodega; una baja hecha por error se revierte con "Revivir equipo".',
      };
      const hayOtrosFiltros = !!(fAct.mod || fAct.prop || fAct.sinVerificar || fAct.compartidos || fAct.sinCliente || fAct.listos);
      // Buscar y no encontrar nada ya NO significa "está en otra pestaña" — la
      // búsqueda barre el pool entero. Así que el mensaje dice lo que de verdad
      // pasa: ese serial no existe en el inventario, o lo tapa otro filtro.
      const msgBusqueda = hayOtrosFiltros
        ? `Ningún equipo del pool coincide con "${esc(fAct.q)}" y los demás filtros activos. Prueba a limpiarlos.`
        : `Ningún equipo del pool coincide con "${esc(fAct.q)}". Revisa que el serial esté bien escrito — si el equipo es real y nunca pasó por aquí, se dará de alta solo la próxima vez que toque un contrato, una orden o bodega.`;
      const msg = !this._equipos.length
        ? 'No hay equipos en el pool. Usa "Recibir equipos" o "Importar Excel".'
        : fAct.q ? msgBusqueda
        : (hayOtrosFiltros ? 'Sin resultados con el filtro actual.' : (VACIO_POR_TAB[this._tab] || 'Sin resultados.'));
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--fg-3); padding:var(--sp-6); line-height:1.6;">${msg}</td></tr>`;
    } else {
      const puede = this.puedeEscribir();
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
        // POC es plataforma, no ubicación: la membresía se muestra como
        // atributo (tag), nunca como estado.
        const tagPoc = eq.poc_device_id
          ? `<span class="eq-sub" title="Registrado en la plataforma POC (device ${esc(eq.poc_device_id)})">POC</span>` : '';
        const asignadoA = (linkCliente + linkContrato + linkOrden + tagPoc) || '—';
        const compartido = eq.serial_compartido
          ? `<span class="eqpool-compartido" title="Este serial existe en más de un modelo — verifica el modelo antes de operar. Se resuelve en la pestaña Conflictos.">2+ modelos</span>` : '';
        const noVerif = eq.verificado === false
          ? `<span class="eqpool-noverif" title="Creado por migración automática — pendiente de confirmación">Sin verificar</span>` : '';
        const prop = eq.propiedad || 'desconocida';
        const casilla = puede
          ? `<input type="checkbox" class="eq-sel" value="${esc(eq.id)}" ${this._sel.has(eq.id) ? 'checked' : ''}
                    onchange="EquiposPool.toggleSel('${esc(eq.id)}', this.checked)"
                    aria-label="Seleccionar ${esc(eq.serial || eq.serial_norm)}">` : '';
        return `<tr>
          <td class="eq-td-sel">${casilla}</td>
          <td class="td-mono">${esc(eq.serial || eq.serial_norm)}${compartido}${noVerif}</td>
          <td>${esc(eq.modelo_label || '—')}</td>
          <td>${eq.condicion === 'reuso' ? 'Refurbished' : 'Nuevo'}</td>
          <td><span class="eqpool-prop eqpool-prop-${esc(prop)}" title="${prop === 'cecomunica' ? 'Flota propia de Cecomunica' : prop === 'cliente' ? 'Equipo propiedad del cliente' : 'Propiedad sin clasificar'}">${esc(this.PROP_LABELS[prop] || prop)}</span></td>
          <td><span class="eqpool-chip eqpool-chip-lg eqpool-chip-${esc(EquiposPoolService.ESTADO_LABELS[eq.estado] ? eq.estado : 'desconocido')}">${esc(EquiposPoolService.ESTADO_LABELS[eq.estado] || eq.estado)}</span>${this._listoParaEntrega(eq) ? `<span class="eqpool-chip" style="background:#e9f7f0;color:#067647;display:inline-block;margin-top:3px;" title="La orden ya está COMPLETADO (EN OFICINA) — el radio está terminado; falta registrar la entrega al cliente">→ listo para entrega</span>` : ''}${EquiposPoolService.chipPendienteDevolucionHtml(eq)}${eq.reemplaza_a ? `<span class="eq-sub" title="Linaje: esta unidad sustituyó a la anterior en una renovación/reemplazo">reemplaza a ${esc(eq.reemplaza_a)}</span>` : ''}</td>
          <td>${asignadoA}</td>
          <td style="font-size:12px; color:var(--fg-3);" title="${esc(eq.origen || '')}">${esc(this.ORIGEN_LABELS[eq.origen] || eq.origen || '—')}</td>
          <td>${this._accionesHtml(eq, puede)}</td>
        </tr>`;
      }).join('');
    }

    // Poda de la selección: sólo sobrevive lo que sigue VISIBLE. Si un filtro,
    // una pestaña o una búsqueda esconde una fila, sale del lote — actuar sobre
    // filas que el usuario ya no ve es exactamente el accidente que hay que
    // impedir en una acción masiva.
    const visibles = new Set(lista.map(e => e.id));
    [...this._sel].forEach(id => { if (!visibles.has(id)) this._sel.delete(id); });
    this._renderBarraLote();
    this._sincronizarSelAll();

    const resumen = document.getElementById('eqResumen');
    if (resumen) resumen.innerHTML =
      `<strong>${lista.length}</strong> <span style="color:var(--muted);font-size:12px;">equipos mostrados</span>`;
    this._guardarFiltros();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  // ── Selección múltiple + acciones en lote ────────────────────────────
  // Las dos bandejas grandes del pool (1,578 por clasificar y 5,378 sin
  // verificar, censo 2026-08-04) no se pueden resolver de a una: no es un flujo,
  // es una condena. Esto agrega selección y acción en lote.
  //
  // Dos reglas de diseño que NO se negocian:
  //   1) El lote maneja las MISMAS funciones de servicio que la acción de una
  //      fila (verificar / liberar / corregirABodega). Nunca una copia de la
  //      escritura: este repo ya sufre la normalización duplicada front/back, y
  //      dos caminos de escritura divergen siempre. Cuesta una transacción por
  //      unidad —más lento— pero conserva el guard de estado y el kardex.
  //   2) Sólo se puede actuar sobre lo que se VE. En cada render la selección se
  //      poda a las filas visibles; si un filtro las esconde, salen del lote.
  //      Un lote que incluye filas invisibles es una escopeta.
  _sel: new Set(),

  // Qué puede hacerse a cada unidad. Se usa para ofrecer sólo las acciones
  // aplicables y para contar cuántas de la selección aplican.
  LOTE_ACCIONES: {
    verificar: {
      label: 'Marcar verificados',
      icono: 'badge-check',
      aplica: (eq) => eq.verificado === false,
      titulo: 'Marcar como verificados',
      // Cuerpo del confirm; `n` es cuántas unidades aplican.
      cuerpo: (n) => `Se marcarán <b>${n}</b> ficha(s) como verificadas: confirmas que el dato de la migración `
        + 'es correcto porque tienes el equipo a la vista.<br><br>'
        + 'Queda registrado quién y cuándo en cada ficha. <b>No hay deshacer en lote.</b>',
      pideMotivo: false,
      correr: (eq) => EquiposPoolService.verificar(eq.id, firebase.auth().currentUser),
    },
    inspeccion: {
      label: 'Inspección OK → bodega',
      icono: 'check-circle-2',
      aplica: (eq) => eq.estado === 'devuelto_revision',
      titulo: 'Inspección OK en lote',
      cuerpo: (n) => `<b>${n}</b> unidad(es) pasan inspección y vuelven a bodega como disponibles `
        + '(condición Refurbished).<br><br>Cada una deja su movimiento en el kardex.',
      pideMotivo: false,
      correr: (eq) => EquiposPoolService.liberar(eq.id,
        { notas: 'Inspección OK tras devolución (lote)' }, firebase.auth().currentUser),
    },
    corregir: {
      label: 'Corregir estado → bodega',
      icono: 'pencil-ruler',
      aplica: (eq) => eq.estado === 'por_clasificar'
        || ((eq.origen || '').startsWith('migracion')
            && ['asignado_contrato', 'en_cliente', 'en_taller'].includes(eq.estado)),
      titulo: 'Corregir estado en lote',
      // Este es el lote delicado: mover algo a "En bodega" es AFIRMAR que está
      // físicamente ahí. El texto lo dice sin rodeos — el flujo legítimo es
      // "conté este estante y estos son los seriales", no "seleccionar todo".
      cuerpo: (n) => `<b>${n}</b> unidad(es) pasarán a <b>En bodega</b>.<br><br>`
        + 'Al confirmar estás <b>afirmando que están físicamente en bodega</b> — normalmente '
        + 'porque acabas de contarlas. No lo uses para “limpiar la lista”: si un radio está con '
        + 'un cliente y lo marcas aquí, el inventario queda mintiendo.<br><br>'
        + 'Se limpian sus vínculos (contrato, orden, device POC) y cada una deja movimiento en el kardex.',
      pideMotivo: true,
      motivoPlaceholder: 'p. ej. conteo físico del 4-ago, estante A2',
      correr: (eq, motivo) => EquiposPoolService.corregirABodega(eq.id, motivo, firebase.auth().currentUser),
    },
  },

  _seleccionados() {
    return this._equipos.filter(e => this._sel.has(e.id));
  },

  toggleSel(id, on) {
    if (on) this._sel.add(id); else this._sel.delete(id);
    this._renderBarraLote();
    this._sincronizarSelAll();
  },

  toggleTodos(on) {
    const visibles = this._filtrados();
    visibles.forEach(e => { if (on) this._sel.add(e.id); else this._sel.delete(e.id); });
    document.querySelectorAll('.eq-sel').forEach(c => { c.checked = on; });
    this._renderBarraLote();
  },

  limpiarSeleccion() {
    this._sel.clear();
    document.querySelectorAll('.eq-sel').forEach(c => { c.checked = false; });
    this._renderBarraLote();
    this._sincronizarSelAll();
  },

  _sincronizarSelAll() {
    const all = document.getElementById('eqSelAll');
    if (!all) return;
    const visibles = this._filtrados();
    const marcados = visibles.filter(e => this._sel.has(e.id)).length;
    all.checked = marcados > 0 && marcados === visibles.length;
    all.indeterminate = marcados > 0 && marcados < visibles.length;
  },

  _renderBarraLote() {
    const bar = document.getElementById('eqBarraLote');
    if (!bar) return;
    const sel = this._seleccionados();
    if (!sel.length || !this.puedeEscribir()) {
      bar.style.display = 'none'; bar.innerHTML = ''; return;
    }
    const botones = Object.entries(this.LOTE_ACCIONES).map(([clave, a]) => {
      const n = sel.filter(a.aplica).length;
      if (!n) return '';
      // Si la selección es mixta, el botón dice a cuántas aplica de verdad —
      // nunca se actúa en silencio sobre un subconjunto.
      const etiqueta = n === sel.length ? `${a.label} (${n})` : `${a.label} (${n} de ${sel.length})`;
      return `<button class="btn btn-sm" onclick="EquiposPool.abrirLote('${clave}')">
        <i data-lucide="${a.icono}" style="width:14px;height:14px;"></i> ${FMT.esc(etiqueta)}</button>`;
    }).filter(Boolean).join('');

    bar.style.display = '';
    bar.innerHTML = `
      <span style="font-weight:600;">${sel.length} seleccionado(s)</span>
      ${botones || '<span style="color:var(--fg-3);">Ninguna acción en lote aplica a esta selección.</span>'}
      <span style="flex:1;"></span>
      <button class="btn btn-ghost btn-sm" onclick="EquiposPool.limpiarSeleccion()">Quitar selección</button>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  // ── Ejecución del lote ───────────────────────────────────────────────
  _loteCancelado: false,

  abrirLote(clave) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden hacer cambios.', 'bad'); return; }
    const a = this.LOTE_ACCIONES[clave];
    if (!a) return;
    const aplican = this._seleccionados().filter(a.aplica);
    if (!aplican.length) { Toast.show('Ninguna unidad de la selección aplica a esa acción.', 'warn'); return; }

    const esc = FMT.esc;
    const muestra = aplican.slice(0, 8).map(e => esc(e.serial || e.serial_norm)).join(', ');
    const resto = aplican.length > 8 ? ` … y ${aplican.length - 8} más` : '';
    document.getElementById('loteTitulo').textContent = a.titulo;
    document.getElementById('loteCuerpo').innerHTML = `
      <p style="margin:0 0 10px; font-size:13.5px; line-height:1.55;">${a.cuerpo(aplican.length)}</p>
      <div style="font-size:12px; color:var(--fg-3); font-family:var(--font-mono, monospace);
                  background:var(--surface-sunken); border-radius:8px; padding:8px 10px; line-height:1.5;">
        ${muestra}${resto}</div>
      ${a.pideMotivo ? `
        <div class="form-field" style="margin-top:12px;">
          <label class="form-label" for="loteMotivo">Motivo (queda en el kardex de cada unidad)</label>
          <input class="form-input" id="loteMotivo" type="text" placeholder="${esc(a.motivoPlaceholder || '')}">
        </div>` : ''}`;
    document.getElementById('loteProgreso').style.display = 'none';
    document.getElementById('loteBotones').style.display = '';
    const btn = document.getElementById('btnLoteConfirmar');
    btn.disabled = false;
    btn.textContent = `Confirmar (${aplican.length})`;
    btn.onclick = () => this.correrLote(clave);
    // Sin cierre por ESC: una vez arrancado el lote, un escape accidental
    // escondería el progreso mientras las escrituras siguen corriendo. Para
    // salir están Cancelar (antes) y Detener (durante), que son explícitos.
    Modal.open('eqLoteModal', { onEscape: false });
  },

  async correrLote(clave) {
    const a = this.LOTE_ACCIONES[clave];
    const aplican = this._seleccionados().filter(a.aplica);
    if (!aplican.length) return;

    let motivo = '';
    if (a.pideMotivo) {
      motivo = (document.getElementById('loteMotivo')?.value || '').trim();
      if (!motivo) { Toast.show('Esta acción requiere un motivo.', 'bad'); return; }
    }

    this._loteCancelado = false;
    document.getElementById('loteBotones').style.display = 'none';
    const prog = document.getElementById('loteProgreso');
    prog.style.display = '';
    const barra = document.getElementById('loteBarra');
    const texto = document.getElementById('loteTexto');
    const pintar = (hechos, total) => {
      barra.style.width = `${Math.round((hechos / total) * 100)}%`;
      texto.textContent = `${hechos} de ${total}…`;
    };
    pintar(0, aplican.length);

    // Concurrencia acotada: cada unidad es su propia transacción (guard de
    // estado + kardex), así que se lanzan de a 6 en vez de 1,578 de golpe.
    const resultados = await this._enTandas(aplican, (eq) => a.correr(eq, motivo), {
      concurrencia: 6,
      onProgreso: pintar,
      cancelado: () => this._loteCancelado,
    });

    const ok = resultados.filter(r => r.ok);
    const fallidos = resultados.filter(r => !r.ok);
    const noIntentados = aplican.length - resultados.length;
    Modal.close('eqLoteModal');
    this._sel.clear();
    await this.cargar();
    this._reporteLote({ accion: a, ok: ok.length, fallidos, noIntentados });
  },

  cancelarLote() { this._loteCancelado = true; },

  // Corre `fn` sobre `items` con concurrencia acotada. Nunca lanza: cada unidad
  // devuelve {ok} o {ok:false, error} para poder reportar el fallo parcial —
  // en un lote de cientos, "algo falló" sin decir qué es inservible.
  async _enTandas(items, fn, { concurrencia = 6, onProgreso, cancelado } = {}) {
    const res = [];
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        if (cancelado && cancelado()) return;
        const it = items[i++];
        try { await fn(it); res.push({ it, ok: true }); }
        catch (e) { res.push({ it, ok: false, error: (e && e.message) || String(e) }); }
        if (onProgreso) onProgreso(res.length, items.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, worker));
    return res;
  },

  _reporteLote({ accion, ok, fallidos, noIntentados }) {
    if (!fallidos.length && !noIntentados) {
      Toast.show(`${accion.label}: ${ok} unidad(es) listas.`, 'ok');
      return;
    }
    const esc = FMT.esc;
    // Los fallos se agrupan por motivo: 300 errores iguales son UN problema, y
    // listarlos uno por uno esconde el que sí es distinto.
    const porError = new Map();
    fallidos.forEach(f => {
      if (!porError.has(f.error)) porError.set(f.error, []);
      porError.get(f.error).push(f.it.serial || f.it.serial_norm);
    });
    const grupos = [...porError.entries()].sort((a, b) => b[1].length - a[1].length).map(([err, seriales]) => `
      <div style="margin-bottom:10px;">
        <div style="font-size:13px; font-weight:600; color:#b91c1c;">${esc(err)} — ${seriales.length}</div>
        <div style="font-size:11.5px; color:var(--fg-3); font-family:var(--font-mono, monospace); line-height:1.5; word-break:break-all;">
          ${esc(seriales.join(', '))}</div>
      </div>`).join('');

    document.getElementById('loteRepCuerpo').innerHTML = `
      <p style="margin:0 0 12px; font-size:13.5px;">
        <b style="color:#067647;">${ok}</b> unidad(es) listas ·
        <b style="color:#b91c1c;">${fallidos.length}</b> con error
        ${noIntentados ? ` · <b>${noIntentados}</b> sin intentar (cancelado)` : ''}
      </p>
      ${fallidos.length ? `<div style="max-height:300px; overflow-y:auto;">${grupos}</div>
        <p style="margin:10px 0 0; font-size:12px; color:var(--fg-3);">
          Las que fallaron no se tocaron: puedes volver a seleccionarlas y reintentar.</p>` : ''}`;
    document.getElementById('btnLoteRepCopiar').onclick = () => {
      const txt = fallidos.map(f => `${f.it.serial || f.it.serial_norm}\t${f.error}`).join('\n');
      navigator.clipboard?.writeText(txt)
        .then(() => Toast.show('Lista de errores copiada.', 'ok'))
        .catch(() => Toast.show('No se pudo copiar.', 'bad'));
    };
    Modal.open('eqLoteReporteModal');
  },

  // ── Acciones de fila: 1 CTA contextual + menú ⋯ ──────────────────────
  // Auditoría 2026-08-04 (R1): antes eran hasta 7 botones SOLO-ICONO cuyo
  // conjunto cambiaba fila por fila — con dos pares de iconos casi gemelos y
  // semántica opuesta (pencil/pencil-ruler, archive-x/archive-restore). La
  // columna no se podía escanear: la 3ª posición significaba algo distinto en
  // cada fila. Se adopta el patrón ya probado en contratos (contratos-list.js):
  // el SIGUIENTE PASO de esta unidad sale con texto, y todo lo demás vive en un
  // menú con icono + etiqueta.
  //
  // Precedencia de la CTA. REGLA: la CTA sale SOLO si la unidad está en una
  // cola de trabajo real — algo que un humano tiene que decidir. Si no, la fila
  // es neutra (Historia) y todo lo aplicable vive en el menú.
  //   1) Devuelto por inspeccionar → Inspección OK   (124 fichas)
  //   2) Ubicación desconocida     → Corregir estado (1,578 — hay que buscarla)
  //   3) resto                     → Historia (neutra)
  //
  // Los dos descartes salen de MEDIR contra el pool real (censo 2026-08-04,
  // 6,735 fichas), no de intuición:
  //   · "origen migración + en cliente/taller" → 5,224 filas (78%). Una unidad
  //     migrada que está con su cliente y con contrato que lo respalda no tiene
  //     nada que corregir: es el estado NORMAL del pool tras la migración.
  //   · "verificado === false" → 5,378 filas (80%). Verificar es el residuo de
  //     la migración, no una cola: es la condición por defecto del dato, y una
  //     ficha sin verificar se usa igual. Además 5,378 confirmaciones de a una
  //     por menú no es un flujo — eso pide selección múltiple, no una CTA.
  // Ambas siguen disponibles en el menú. Regla para el futuro: si la condición
  // cubre más de ~1 de cada 3 filas, NO es CTA — es un filtro.
  _accionesHtml(eq, puede) {
    const esc = FMT.esc;
    const id = esc(eq.id);
    const esMigracionDudosa = (eq.origen || '').startsWith('migracion')
      && ['asignado_contrato', 'en_cliente', 'en_taller'].includes(eq.estado);
    const puedeCorregir = puede && (eq.estado === 'por_clasificar' || esMigracionDudosa);

    // white-space:nowrap — sin esto "Inspección OK" y "Corregir estado" parten
    // en dos líneas y la fila crece; la columna está dimensionada para una.
    const B = (icon, label, onclick, { css = '', title = '' } = {}) =>
      `<button class="btn btn-sm" style="white-space:nowrap; ${css}" onclick="${onclick}" title="${esc(title)}"><i data-lucide="${icon}" style="width:14px;height:14px;flex:none;"></i> ${esc(label)}</button>`;
    const ambar = 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;';
    const verde = 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;';

    let cta = '', kind = '';
    if (puede && eq.estado === 'devuelto_revision') {
      kind = 'inspeccion';
      cta = B('check-circle-2', 'Inspección OK', `EquiposPool.inspeccionOk('${id}')`,
        { css: verde, title: 'Pasó inspección: regresa a bodega como disponible (Refurbished)' });
    } else if (puede && eq.estado === 'por_clasificar') {
      kind = 'corregir';
      cta = B('pencil-ruler', 'Corregir estado', `EquiposPool.abrirCorregir('${id}')`,
        { css: ambar, title: 'Ubicación desconocida: si la encontraste en bodega, regístralo aquí' });
    } else {
      kind = 'historia';
      cta = B('history', 'Historia', `EquiposPool.abrirHistoria('${id}')`,
        { title: 'Kardex: todos los movimientos de esta unidad' });
    }

    const items = [];
    const I = (icon, label, onclick, cls = '') =>
      `<button class="overflow-menu-item ${cls}" onclick="${onclick}"><i data-lucide="${icon}"></i> ${esc(label)}</button>`;

    if (kind !== 'historia') items.push(I('history', 'Historia (kardex)', `EquiposPool.abrirHistoria('${id}')`));
    if (puede) items.push(I('pencil', 'Editar ficha (modelo, propiedad, notas)', `EquiposPool.abrirEdicion('${id}')`));
    if (puede && eq.verificado === false)
      items.push(I('badge-check', 'Marcar como verificado', `EquiposPool.verificar('${id}')`));
    if (puede && eq.estado === 'devuelto_revision' && kind !== 'inspeccion')
      items.push(I('check-circle-2', 'Inspección OK → a bodega', `EquiposPool.inspeccionOk('${id}')`));
    if (puedeCorregir && kind !== 'corregir')
      items.push(I('pencil-ruler', 'Corregir estado → En bodega', `EquiposPool.abrirCorregir('${id}')`));
    if (puede && eq.estado === 'en_bodega')
      items.push(I('banknote', 'Registrar venta de esta unidad', `EquiposPool.abrirVenta('${id}')`));
    // Revivir NO es CTA: una baja correcta es terminal, revertirla es la
    // excepción. Vive en el menú para que no compita con las colas reales.
    if (puede && eq.estado === 'baja')
      items.push(I('archive-restore', 'Revivir equipo → a bodega', `EquiposPool.revivir('${id}')`));
    if (puede && !['baja', 'vendido'].includes(eq.estado)) {
      items.push('<div class="overflow-menu-divider"></div>');
      items.push(I('archive-x', 'Dar de baja', `EquiposPool.darDeBaja('${id}')`, 'danger'));
    }

    const menu = items.length
      ? `<div class="overflow-menu">
           <button class="overflow-menu-btn" onclick="EquiposPool.toggleMenu('${id}')" title="Más acciones" aria-label="Más acciones" aria-haspopup="true">⋯</button>
           <div class="overflow-menu-dropdown" id="eq-menu-${id}">${items.join('')}</div>
         </div>`
      : '';
    return `<div style="display:flex; align-items:center; gap:4px;">${cta}${menu}</div>`;
  },

  toggleMenu(id) {
    const menu = document.getElementById(`eq-menu-${id}`);
    if (!menu) return;
    const abierto = menu.classList.contains('open');
    this.cerrarMenus();
    if (!abierto) menu.classList.add('open');
  },

  cerrarMenus() {
    document.querySelectorAll('.overflow-menu-dropdown.open[id^="eq-menu-"]')
      .forEach(m => m.classList.remove('open'));
  },

  // ── Recibir equipos ──────────────────────────────────────────────────
  // El asistente completo (formulario, colisiones y reubicación en fases)
  // vive en js/ui/asistente-recibir.js — componente compartido con el espacio
  // Almacén. Aquí solo se gatea el rol y se refresca la tabla al terminar.
  abrirRecibir() {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden recibir equipos.', 'bad'); return; }
    AsistenteRecibir.abrir({
      user: firebase.auth().currentUser,
      onDone: () => this.cargar(),
    });
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
    // La condición sale del modelo; si la ficha traía otra, el hint lo avisa.
    this._condicionOriginal = eq.condicion === 'reuso' ? 'reuso' : 'nuevo';
    this._sincronizarCondicion('editModelo', 'editCondicion', 'editCondicionHint',
      this._condicionOriginal);
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
        // Modelo fuera del catálogo (o sin modelo): se conserva la de la ficha.
        condicion:    this._condicionDeModelo(modeloId) || this._condicionOriginal || 'nuevo',
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
      message: `El equipo ${eq?.serial || id} pasó inspección y regresa a bodega como disponible (condición: Refurbished). ¿Confirmar?`,
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
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden dar de baja equipos.', 'bad'); return; }
    const eq = this._equipos.find(x => x.id === id);
    const motivo = await Modal.prompt({
      title: 'Dar de baja',
      message: `Motivo de la baja de ${eq?.serial || id} (dañado, perdido, vendido…). El equipo sale del pool; si la baja resulta un error, administración o inventario pueden revivirlo desde la pestaña Baja / Venta.`,
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

  // Reversa de una baja por error — la unidad regresa a bodega como disponible.
  async revivir(id) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden revivir equipos.', 'bad'); return; }
    const eq = this._equipos.find(x => x.id === id);
    const motivo = await Modal.prompt({
      title: 'Revivir equipo',
      message: `Motivo de la reactivación de ${eq?.serial || id} (p. ej. baja registrada por error). El equipo regresa a bodega como disponible; si estaba asignado a un contrato u orden, hay que volver a asignarlo por el flujo normal.`,
    });
    if (motivo === null) return;
    if (!motivo.trim()) { Toast.show('La reactivación requiere un motivo.', 'bad'); return; }
    try {
      await EquiposPoolService.reactivar(id, motivo.trim(), firebase.auth().currentUser);
      Toast.show('Equipo reactivado — de vuelta en bodega.', 'ok');
      this.cargar();
    } catch (e) {
      Toast.show('Error: ' + (e.message || e), 'bad');
    }
  },

  // ── Corregir estado → En bodega ──────────────────────────────────────
  // Único destino: En bodega. La matriz de casos vive en el comentario de
  // EquiposPoolService.corregirABodega — todos los demás estados reales se
  // registran por su flujo normal (contrato/orden/POC), que arma los vínculos.
  // Dos entradas (misma corrección, motivo distinto): estado heredado de la
  // migración, y unidad "Por clasificar" que apareció físicamente en bodega.
  _corrigiendoId: null,
  _corrPocDevice: null,   // device POC vinculado YA verificado contra el serial

  abrirCorregir(id) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden corregir estados.', 'bad'); return; }
    const eq = this._equipos.find(x => x.id === id);
    if (!eq) return;
    this._corrigiendoId = id;
    const esc = FMT.esc;
    document.getElementById('corrSerialLabel').textContent = eq.serial || eq.serial_norm;
    document.getElementById('corrEstadoActual').innerHTML =
      EquiposPoolService.chipEstadoHtml(eq.estado);

    // El "por qué estás aquí" cambia según de dónde venga la unidad.
    const intro = document.getElementById('corrIntro');
    if (intro) {
      intro.innerHTML = eq.estado === 'por_clasificar'
        ? 'Esta unidad estaba <strong>Por clasificar</strong>: el sistema no tenía contrato ni orden que respaldara dónde estaba. '
          + 'Usa esta corrección solo si <strong>la encontraste físicamente en bodega</strong>.'
        : 'Para unidades que la migración dejó con un estado equivocado y que <strong>físicamente están en bodega</strong>.';
    }

    // Vínculos que la corrección va a limpiar — con link para arreglar también
    // la FUENTE: si sigue mintiendo (serial en el contrato/orden), una
    // reedición futura re-impondría el estado falso.
    const avisos = [];
    if (eq.asignacion && (eq.asignacion.contrato_id || eq.asignacion.contrato_doc_id)) {
      avisos.push(`El contrato <a class="eq-link" href="../contratos/index.html?buscar=${encodeURIComponent(eq.asignacion.contrato_id || '')}" target="_blank">${esc(eq.asignacion.contrato_id || eq.asignacion.contrato_doc_id)}</a> seguirá listando este serial: quítalo o corrígelo también en Seriales del contrato, o una edición futura de esos seriales re-asignaría la unidad.`);
    }
    if (eq.orden_actual_id) {
      avisos.push(`La <a class="eq-link" href="../ordenes/editar-orden.html?id=${encodeURIComponent(eq.orden_actual_id)}" target="_blank">orden en taller</a> seguirá listando este serial: remuévelo de la orden si sigue abierta.`);
    }
    const divAvisos = document.getElementById('corrAvisos');
    divAvisos.innerHTML = avisos.map(a => `<p style="margin:0 0 var(--sp-2);">${a}</p>`).join('');
    divAvisos.style.display = avisos.length ? '' : 'none';

    // Device POC vinculado → ofrecer desactivarlo (soft-delete): si queda
    // activo, la lista POC sigue mostrando un radio que está en bodega y una
    // reedición de su serial lo re-marcaría "En POC".
    // OJO: el vínculo puede estar RANCIO — si al device le cambiaron el serial
    // después de enlazarlo, `poc_device_id` apunta a un radio que ya es OTRO y
    // desactivarlo borra la programación de un tercero. Así desapareció el
    // RADIO 3 de ERICK REYES el 2026-07-31: se corrigió a bodega el serial
    // saliente y el borrado cayó sobre el device que 6 minutos antes había
    // pasado al serial entrante. El check se premarca solo tras verificarlo.
    const rowPoc = document.getElementById('corrPocRow');
    rowPoc.style.display = eq.poc_device_id ? '' : 'none';
    this._corrPocDevice = null;
    const chkPoc = document.getElementById('corrDesactivarPoc');
    chkPoc.checked = false;
    chkPoc.disabled = true;
    const detPoc = document.getElementById('corrPocDetalle');
    detPoc.style.color = 'var(--fg-2)';
    detPoc.textContent = eq.poc_device_id ? 'Verificando el device POC vinculado…' : '';
    if (eq.poc_device_id) {
      this._verificarPocVinculado(eq).catch(e => {
        console.error('No se pudo verificar el device POC:', e);
        detPoc.textContent = 'No se pudo leer el device POC vinculado — no se desactivará desde aquí.';
      });
    }

    document.getElementById('corrMotivo').value = '';
    Modal.open('eqCorregirModal');
  },

  // Contrasta el device POC enlazado con el serial de la ficha ANTES de ofrecer
  // el borrado: solo cuando el device sigue llevando este mismo serial se
  // habilita (y se premarca) el check.
  async _verificarPocVinculado(eq) {
    const dev = await PocService.getPocDevice(eq.poc_device_id, { source: 'server' });
    if (this._corrigiendoId !== eq.id) return;   // el modal ya cambió de unidad
    const esc = FMT.esc;
    const det = document.getElementById('corrPocDetalle');
    const chk = document.getElementById('corrDesactivarPoc');

    if (!dev || dev.deleted === true) {
      det.textContent = 'El device POC vinculado ya no está activo — no hay nada que desactivar.';
      return;
    }
    const serialFicha = EquiposPoolService.normalizarSerial(eq.serial || eq.serial_norm || '');
    const serialDev   = EquiposPoolService.normalizarSerial(dev.serial || '');
    const quien = `${esc(dev.radio_name || dev.unit_id || '—')}${
      (dev.cliente_nombre || dev.cliente) ? ' de ' + esc(dev.cliente_nombre || dev.cliente) : ''}`;

    if (serialDev !== serialFicha) {
      det.style.color = '#b91c1c';
      det.innerHTML = `<strong>Vínculo desactualizado:</strong> ese device hoy es <strong>${quien}</strong>`
        + ` con serial <span style="font-family:var(--font-mono);">${esc(dev.serial || '—')}</span>,`
        + ` no ${esc(eq.serial || eq.serial_norm || '')}. No se va a tocar: desactivarlo borraría la`
        + ` programación de otro radio. Si este serial quedó suelto en POC, elimínalo desde la página POC.`;
      return;
    }
    det.innerHTML = `Se desactivará <strong>${quien}</strong> (unit ${esc(dev.unit_id || '—')}${
      dev.sim_number ? ', SIM ' + esc(dev.sim_number) : ''}).`;
    chk.disabled = false;
    chk.checked = true;
    this._corrPocDevice = dev;
  },

  async guardarCorreccion() {
    const id = this._corrigiendoId;
    const eq = this._equipos.find(x => x.id === id);
    if (!eq) return;
    const motivo = document.getElementById('corrMotivo').value.trim();
    if (!motivo) { Toast.show('La corrección requiere un motivo.', 'bad'); return; }
    const btn = document.getElementById('btnGuardarCorreccion');
    btn.disabled = true;
    try {
      await EquiposPoolService.corregirABodega(id, motivo, firebase.auth().currentUser);
      let msg = 'Estado corregido — la unidad quedó en bodega.';
      if (this._corrPocDevice && document.getElementById('corrDesactivarPoc').checked) {
        try {
          // Relectura antes de borrar: entre abrir el modal y guardar, otra
          // sesión pudo cambiarle el serial al device (así nació el caso ERICK
          // REYES, con 6 minutos entre una cosa y la otra).
          const fresco = await PocService.getPocDevice(this._corrPocDevice.id, { source: 'server' });
          const sigueSiendoEste = fresco && fresco.deleted !== true
            && EquiposPoolService.normalizarSerial(fresco.serial)
               === EquiposPoolService.normalizarSerial(eq.serial || eq.serial_norm || '');
          if (!sigueSiendoEste) {
            msg += ' OJO: el device POC vinculado ya no corresponde a este serial — NO se desactivó.';
          } else {
            await PocService.softDeletePocDevice(fresco.id, {
              antes: fresco, user: firebase.auth().currentUser, origen: 'inventario-correccion',
            });
            msg += ' Device POC desactivado.';
          }
        } catch (e2) {
          console.error('No se pudo desactivar el device POC:', e2);
          msg += ' OJO: no se pudo desactivar el device POC — hazlo desde la página POC.';
        }
      }
      Modal.close('eqCorregirModal');
      this._corrigiendoId = null;
      this._corrPocDevice = null;
      Toast.show(msg, 'ok');
      this.cargar();
    } catch (e) {
      Toast.show('Error al corregir: ' + (e.message || e), 'bad');
    } finally {
      btn.disabled = false;
    }
  },

  // ── Registrar venta (venta directa facturada en QuickBooks) ──────────
  // El asistente completo (validación bodega/ajenos, autocompletado de
  // cliente, excepción, venta por unidad y CTA a la orden de PROGRAMACIÓN)
  // vive en js/ui/asistente-venta.js — componente compartido con el espacio
  // Almacén. `id` (fila) pre-llena ese serial y desambigua seriales
  // compartidos con 2+ unidades en bodega.
  abrirVenta(id = null) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden registrar ventas.', 'bad'); return; }
    const eq = id ? this._equipos.find(x => x.id === id) : null;
    AsistenteVenta.abrir({
      user: firebase.auth().currentUser,
      rol: this._rol,
      serialesPrefill: eq ? [eq.serial || eq.serial_norm] : [],
      desdeUnidadId: eq ? eq.id : null,
      onDone: () => this.cargar(),
    });
  },

  // ── Historia (kardex) ────────────────────────────────────────────────
  _MOV_ICONS: {
    ingreso_bodega: 'package-plus', asignacion_contrato: 'file-text',
    liberacion: 'undo-2', entrega: 'truck', ingreso_taller: 'wrench',
    salida_taller: 'log-out', prestamo_poc: 'radio-tower', devolucion: 'corner-down-left',
    inspeccion: 'search-check', baja: 'archive-x', reactivacion: 'archive-restore',
    venta: 'banknote', correccion_migracion: 'pencil-ruler',
    correccion_serial: 'pencil', orden_programacion: 'clipboard-list',
    migracion: 'database', cambio_estado: 'arrow-right-left',
    reasignacion: 'users', fusion_duplicado: 'merge',
  },

  async abrirHistoria(id) {
    const eq = this._equipos.find(x => x.id === id);
    if (!eq) return;
    const esc = FMT.esc;
    document.getElementById('histSerialLabel').textContent = eq.serial || eq.serial_norm;
    document.getElementById('histResumen').innerHTML = `
      ${EquiposPoolService.chipEstadoHtml(eq.estado)}
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
            <strong>${esc((window.EquipoFicha?.MOV_LABELS?.[m.tipo]) || (m.tipo || '').replace(/_/g, ' '))}</strong>${transicion}
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
  async descargarPlantilla() {
    await cargarXLSX();   // SheetJS bajo demanda
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
      await cargarXLSX();   // SheetJS bajo demanda
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
                       condicion: null, cond_csv: null,
                       proveedor: '', notas: '', problema: '' };
        if (!EquiposPoolService.esSerialValido(norm)) fila.problema = 'serial inválido';
        const modeloTxt = colModelo ? (f[colModelo] || '').toString().trim() : '';
        if (modeloTxt) {
          const m = porId.get(modeloTxt) || porLabel.get(EquiposPoolService._tightLabel(modeloTxt));
          if (m) { fila.modelo_id = m.id; fila.modelo_label = m.label; }
          else if (!fila.problema) fila.problema = `modelo "${modeloTxt}" no está en el catálogo`;
        }
        // La condición la impone el modelo, no el archivo — misma regla que los
        // modales. Si el archivo trae columna CONDICION y contradice al modelo,
        // se avisa en la vista previa pero manda el catálogo.
        if (fila.modelo_id) fila.condicion = this._condicionDeModelo(fila.modelo_id);
        if (colCond) {
          const c = FMT.normalize((f[colCond] || '').toString().trim());
          if (c) fila.cond_csv = (c.startsWith('r') || c === 'usado') ? 'reuso' : 'nuevo';
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
      const condChocan = validas.filter(f => f.cond_csv && f.condicion && f.cond_csv !== f.condicion).length;

      const esc = FMT.esc;
      const muestra = validas.slice(0, 8).map(f => `<tr>
        <td class="td-mono">${esc(f.norm)}</td>
        <td>${f.modelo_label ? esc(f.modelo_label) : '<span style="color:var(--fg-3);">(modelo del selector)</span>'}</td>
        <td>${f.condicion
          ? (f.condicion === 'reuso' ? 'Refurbished' : 'Nuevo')
          : '<span style="color:var(--fg-3);">(del selector)</span>'}</td>
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
          ${condChocan ? `<span class="import-stat" style="color:#92400e;"><strong>${condChocan}</strong> con CONDICION distinta a la del modelo (manda el modelo)</span>` : ''}
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
        // Las filas sin MODELO heredan el del selector, así que su condición
        // solo se puede resolver aquí, ya elegido el default.
        const condicion = this._condicionDeModelo(modelo_id) || 'nuevo';
        const key = JSON.stringify([modelo_id, condicion, f.proveedor, f.notas]);
        const g = grupos.get(key) || { seriales: [], meta: {
          modelo_id, modelo_label, condicion,
          proveedor: f.proveedor, notas: f.notas, origen: 'import_excel',
        } };
        g.seriales.push(f.serial);
        grupos.set(key, g);
      }
      const user = firebase.auth().currentUser;
      const res = { nuevos: 0, existentes: 0, colisiones: 0, invalidos: 0 };
      // Las colisiones de modelo no se crean solas: se juntan las de todos los
      // grupos y se preguntan una vez, como en la recepción manual.
      const porGrupo = [];
      for (const g of grupos.values()) {
        const r = await EquiposPoolService.recibir(g.seriales, g.meta, user);
        for (const k of Object.keys(res)) res[k] += r[k];
        if ((r.colisiones_pendientes || []).length) {
          porGrupo.push({ meta: g.meta, pendientes: r.colisiones_pendientes });
        }
      }
      const pendientes = porGrupo.flatMap(x => x.pendientes);
      let sinImportar = 0;
      if (pendientes.length) {
        const confirmado = await Modal.confirm({
          title: 'Seriales que ya existen con otro modelo',
          danger: true,
          confirmLabel: `Sí, son ${pendientes.length === 1 ? 'otro equipo' : 'otros equipos'}`,
          cancelLabel: 'No, no los importes',
          message: AsistenteRecibir.mensajeColisiones(pendientes, null),
        });
        if (confirmado) {
          for (const g of porGrupo) {
            const r2 = await EquiposPoolService.recibir(
              g.pendientes.map(c => c.serial), { ...g.meta, confirmarColisiones: true }, user);
            for (const k of Object.keys(res)) res[k] += r2[k];
          }
        } else {
          sinImportar = pendientes.length;
        }
      }
      Toast.show(`Import completado: ${res.nuevos} nuevos, ${res.existentes} ya existían, ${res.colisiones} colisiones de serial, ${res.invalidos} inválidos.`
        + (sinImportar ? ` ${sinImportar} sin importar por modelo distinto — corrige el archivo.` : ''),
        (res.colisiones || sinImportar) ? 'warn' : 'ok');
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

      // Join único conteo ↔ pool (StockAgg, mismo casado por id/label y misma
      // convención de signo que el tablero de Inventario: dif = pool − conteo).
      const poolMap = StockAgg.agruparPool(this._equipos.filter(e => e.estado === 'en_bodega'));
      const rows = StockAgg.join({ conteos, poolMap, labelDeModelo: id => this._modeloLabel(id) })
        .map(f => ({
          label: f.label,
          conteo: f.conteo ?? 0,
          pool: f.seriales,
          diff: f.dif == null ? f.seriales : f.dif,
        }))
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
          <thead><tr><th>Modelo</th><th style="text-align:right;">Pool (bodega)</th><th style="text-align:right;">Conteo manual</th><th style="text-align:right;">Dif. (pool − conteo)</th></tr></thead>
          <tbody>
            ${rows.map(f => `<tr>
              <td>${esc(f.label)}</td>
              <td style="text-align:right;">${f.pool}</td>
              <td style="text-align:right;">${f.conteo}</td>
              <td style="text-align:right; font-weight:600; color:${f.diff === 0 ? '#15803d' : '#b91c1c'};">${f.diff > 0 ? '+' + f.diff : f.diff}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <p style="font-size:12px; color:var(--fg-3); margin:var(--sp-2) 0 0;">
          Dif. positiva = el pool tiene unidades que el conteo no vio (posible doble registro
          o conteo desactualizado). Negativa = el conteo vio unidades que faltan en el pool —
          captúralas con "Recibir equipos" en modo toma física.
        </p>`;
    } catch (e) {
      cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">Error: ${FMT.esc(e.message || e)}</p>`;
    }
  },

  // ── Export ───────────────────────────────────────────────────────────
  async exportarExcel() {
    await cargarXLSX();   // SheetJS bajo demanda
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
      // Sin permiso de escritura las filas no llevan casilla, así que el
      // "seleccionar todo" de la cabecera sería un control muerto.
      document.getElementById('eqSelAll')?.remove();
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
    // Los deep-links siguen aceptando ?tab=devuelto_revision / por_clasificar /
    // conflictos (las señales del home apuntan ahí). Ya no son pestañas, así que
    // lo que se enciende es su TARJETA de Pendientes — _pintarSeleccion resuelve
    // cuál de las dos filas marcar.
    const setTabUI = (tab) => {
      EquiposPool._tab = tab;
      EquiposPool._pintarSeleccion();
    };
    const limpiarSecundarios = () => {
      ['eqFiltroModelo', 'eqFiltroPropiedad'].forEach(id => {
        const n = document.getElementById(id); if (n) n.value = '';
      });
      ['chkSinVerificar', 'chkCompartidos', 'chkSinCliente', 'chkListos'].forEach(id => {
        const n = document.getElementById(id); if (n) n.checked = false;
      });
    };
    const TABS_VALIDAS = ['en_bodega', 'asignado_contrato', 'en_cliente', 'en_taller', 'devuelto_revision', 'por_clasificar', 'otros', 'conflictos', 'todos'];
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

    // Cierre del menú ⋯ de fila: al pulsar un item (tras ejecutar su acción),
    // al hacer click fuera de cualquier menú, o con ESC. Mismo comportamiento
    // que el menú de acciones de contratos.
    document.addEventListener('click', (e) => {
      if (e.target.closest('.overflow-menu-item')) { EquiposPool.cerrarMenus(); return; }
      if (!e.target.closest('.overflow-menu')) EquiposPool.cerrarMenus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') EquiposPool.cerrarMenus();
    });

    await EquiposPool.cargar();

    // ?accion=recibir|vender — CTAs del espacio Almacén (propuesta 2026-08):
    // el botón vive allá, el asistente probado sigue viviendo aquí. Solo para
    // roles con escritura (a los demás ya se les quitaron los botones).
    const accionParam = qp.get('accion');
    if (accionParam && EquiposPool.puedeEscribir()) {
      if (accionParam === 'recibir') EquiposPool.abrirRecibir();
      else if (accionParam === 'vender') EquiposPool.abrirVenta();
    }
  });
});
