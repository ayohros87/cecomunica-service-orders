// @ts-nocheck
// Almacén · Por serial — la lista avanzada del pool de equipos (filtros finos,
// selección y lotes, edición de proveedor/notas, corregir estado con POC,
// exportar Excel completo). Plan: docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md.
//
// Auditoría UX 2026-09-28, P2 #14 ("una sola casa"): esto era
// inventario/equipos.html, la segunda casa del inventario. Ahora vive como la
// sección #tab-serial de almacen/index.html y equipos.html solo redirige. Se
// quedó aquí solo lo que Almacén no tenía; salieron las copias:
//   · Conflictos → Almacén · Hoy (la cola) y la ficha (reabrir un resuelto).
//   · Conciliación contra conteo → Existencias (columna Dif.).
//   · Importador de Excel con plantilla → "Importar hoja" (AsistenteImportar).
//   · Historia en modal propio → la ficha del equipo (EquipoFicha).
//   · Runner de lotes propio → AsistenteLote (el mismo de Existencias).
// El archivo conserva su nombre y window.EquiposPool porque las pruebas y los
// onclick de la sección lo nombran así.
window.EquiposPool = {
  _equipos: [],
  // Carga por pestaña (auditoría de consumo 2026-09-24): abrir esta página
  // barría el pool ENTERO (~7,650 fichas) en cada carga fría — el 38% de las
  // lecturas de Firestore de un día normal. Ahora, si lo que se mira es UNA
  // ubicación sin búsqueda ni filtros, se carga solo esa ubicación y los
  // conteos globales salen del resumen (`agregados_pool`). Todo lo que
  // necesita el pool entero —la búsqueda, Todos, Otros, cualquier
  // filtro— lo sigue teniendo: render() lo pide ANTES de pintar (_datosListos).
  _completo: false,       // _equipos es el pool entero
  _cargadoEstado: null,   // qué ubicación hay en _equipos cuando NO es completo
  _conteos: null,         // conteos GLOBALES para tarjetas y pestañas (modo por pestaña)
  _pidiendo: null,        // carga en vuelo — una sola a la vez
  _errorCarga: null,      // la última carga falló: se muestra, no se reintenta en bucle
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
    // Radios DEL CLIENTE que quedaron listos y nadie vino a buscar (la orden
    // cerró CERRADA (SIN RETIRAR)). Es una cola de DECISIÓN, no de trabajo:
    // se retiran, vuelven a bodega si eran nuestros, o se dan por abandonados.
    no_retirado:       { tab: 'no_retirado' },
    // Conflictos (1 serial, 2+ modelos) ya no es tarjeta aquí: la cola vive
    // en Almacén · Hoy y un resuelto se reabre desde la ficha.
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
    // Radio que el cliente tenía y el sistema no conocía: lo declaró el
    // vendedor en un anexo de regularización o en una solicitud de reemplazo
    // (2026-09-09). Nace sin verificar, como toda ficha que nadie tocó.
    declarado_vendedor: 'Declarado por el vendedor',
  },


  puedeEscribir() {
    return this._rol === ROLES.ADMIN || this._rol === ROLES.INVENTARIO;
  },

  // ── Carga ────────────────────────────────────────────────────────────
  // Recarga "pesada": la de entrada, tras recibir/importar, o cuando el
  // refresco puntual no alcanza. Conserva el modo — si ya se tenía el pool
  // entero se relee entero, para no dejar a quien estaba buscando con media
  // lista.
  async cargar() {
    const eraCompleto = this._completo;
    this._completo = false;
    this._cargadoEstado = null;
    this._busquedaServidor = null;
    this._conteos = null;
    this._errorCarga = null;
    try {
      await this._asegurarDatos({ forzarCompleto: eraCompleto });
      this.render();
      // Sub-estado derivado "listo para entrega" (P4a auditoría 2026-07-24):
      // "En taller" mezclaba radios en trabajo con radios TERMINADOS esperando
      // que alguien registre la entrega. Se consulta el estado real de la
      // orden de cada unidad en taller (async, la tabla ya está pintada).
      await this._cargarEstadosOrdenTaller();
      this.render();
    } catch (e) {
      console.error('Error al cargar equipos:', e);
      Toast.show('Error al cargar el inventario de equipos: ' + (e.message || e), 'bad');
      this.render();
    }
  },

  // Pestañas que son UNA ubicación: las únicas que se sirven cargando solo
  // esa ubicación. Todos y Otros (baja+vendido) cruzan el pool.
  TABS_DE_UN_ESTADO: ['en_bodega', 'asignado_contrato', 'en_cliente', 'en_taller',
    'devuelto_revision', 'por_clasificar', 'no_retirado'],

  // ¿Alcanza con la pestaña? Solo si NADA de lo que hay en pantalla mira fuera
  // de ella. La búsqueda barre el pool entero (N1, auditoría 2026-08-04) y los
  // contadores de pestaña respetan los filtros secundarios: con cualquiera de
  // los dos hace falta el pool completo.
  _bastaParcial() {
    if (!this.TABS_DE_UN_ESTADO.includes(this._tab)) return false;
    const f = this._filtrosActivos();
    return !(f.q || f.mod || f.prop || f.sinVerificar || f.compartidos || f.sinCliente || f.listos);
  },

  // ¿Lo que hay en memoria sirve para pintar lo que se pide ahora? Una vez que
  // se cargó el pool entero no se vuelve atrás: sirve para todo.
  _datosListos() {
    if (this._completo) return true;
    const f = this._filtrosActivos();
    if (f.q && this._busquedaServidor && this._busquedaServidor === this._claveBusqueda(f.q) && !!this._conteos) return true;
    return this._bastaParcial() && this._cargadoEstado === this._tab && !!this._conteos;
  },

  // Búsqueda por serial CONTRA EL SERVIDOR (auditoría de módulos 2026-09-30,
  // L1): buscar un serial bajaba el pool completo (7,834 docs, 5.1 s) para
  // filtrar en el navegador. Si lo tecleado parece serial (3+ alfanuméricos
  // con un dígito) se consulta por prefijo de serial_norm y se pintan esos
  // resultados; `_busquedaServidor` recuerda para qué texto sirven. Si el
  // prefijo no encuentra nada, se cae al pool completo como antes: la
  // búsqueda por modelo, cliente o nota sigue funcionando igual.
  _busquedaServidor: null,
  _claveBusqueda(q) {
    // Sin el servicio (o sin Serial) no hay búsqueda por servidor: se busca
    // en memoria como siempre, nunca se rompe el filtro.
    let n = '';
    try { n = (typeof EquiposPoolService !== 'undefined' && EquiposPoolService.normalizarSerial(q)) || ''; }
    catch (_) { n = ''; }
    return (n.length >= 3 && /\d/.test(n)) ? n : '';
  },

  async _asegurarDatos({ forzarCompleto = false } = {}) {
    // Una carga a la vez. Si hay una en vuelo se espera y se vuelve a mirar:
    // al terminar puede que ya alcance, o que el usuario haya cambiado de
    // pestaña mientras tanto y haga falta otra.
    while (this._pidiendo) {
      try { await this._pidiendo; } catch (e) { /* la maneja quien la lanzó */ }
    }
    if (!forzarCompleto && this._datosListos()) return;
    const p = this._cargarDatos(forzarCompleto);
    this._pidiendo = p;
    try { await p; } finally { if (this._pidiendo === p) this._pidiendo = null; }
  },

  async _cargarDatos(forzarCompleto) {
    try {
      const f = this._filtrosActivos();
      const claveQ = (!forzarCompleto && f.q) ? this._claveBusqueda(f.q) : '';
      if (claveQ) {
        const [docs, conteos] = await Promise.all([
          EquiposPoolService.buscarPorPrefijoSerial(claveQ),
          this._conteos ? Promise.resolve(this._conteos) : this._cargarConteos(),
        ]);
        if (docs.length && conteos) {
          this._equipos = docs;
          this._conteos = conteos;
          this._busquedaServidor = claveQ;
          this._cargadoEstado = null;
          this._completo = false;
          this._errorCarga = null;
          return;
        }
        // Sin resultado por serial: se busca en todo (modelo, cliente, notas).
      }
      this._busquedaServidor = null;
      if (!forzarCompleto && this._bastaParcial()) {
        const tab = this._tab;
        const [lista, conteos] = await Promise.all([
          EquiposPoolService.listar({ estado: tab }),
          this._conteos ? Promise.resolve(this._conteos) : this._cargarConteos(),
        ]);
        // Sin resumen no hay de dónde sacar los conteos globales: en vez de
        // pintar tarjetas y pestañas en cero, se cae al pool entero como antes
        // — y se avisa, porque volver a barrerlo en silencio sería el error.
        if (!conteos) {
          console.warn('[Equipos] agregados_pool vacío — leyendo el pool completo');
          if (typeof Toast !== 'undefined') Toast.show('Resumen de inventario no disponible: se leyó el pool completo.', 'warn');
          this._equipos = await EquiposPoolService.listar();
          this._completo = true;
          this._cargadoEstado = null;
        } else {
          this._equipos = lista;
          this._cargadoEstado = tab;
          this._conteos = conteos;
        }
      } else {
        this._equipos = await EquiposPoolService.listar();
        this._completo = true;
        this._cargadoEstado = null;
      }
      this._errorCarga = null;
    } catch (e) {
      this._errorCarga = e;
      throw e;
    }
  },

  // Conteos GLOBALES para cuando _equipos es una sola pestaña: las tarjetas de
  // Pendientes y los contadores de pestaña dicen cuánto hay en TODO el pool.
  // Cada fuente se verificó contra el pool completo en producción (2026-09-25)
  // y coincide exacto: el resumen por estado, el count() de sin verificar
  // (4,396 = 4,396). Devuelve null si el resumen no existe.
  async _cargarConteos() {
    // Sin verificar, del pool ENTERO. Firebase 12 (npm) no traía Query.count()
    // en compat y el .count().get() reventaba ("count is not a function",
    // 2026-09-29); firebase-init lo restauró sobre getCountFromServer
    // (b5b3726), así que va primero por compat. FbAgg queda de respaldo; si
    // nada está disponible o falla, el contador queda en null.
    const contarSinVerif = () => {
      const q = firebase.firestore().collection('equipos_pool').where('verificado', '==', false);
      if (typeof q.count === 'function') return q.count().get().then(s => s.data().count);
      if (window.FbAgg && typeof FbAgg.count === 'function') return FbAgg.count('equipos_pool', [['verificado', '==', false]]);
      return Promise.resolve(null);
    };
    const [resumen, sinVerif] = await Promise.all([
      EquiposPoolService.resumenPorModelo(),
      Promise.resolve().then(contarSinVerif)
        .catch(e => { console.warn('[Equipos] sin verificar:', e?.code || e); return null; }),
    ]);
    if (!resumen.length) return null;
    const porEstado = {};
    for (const r of resumen) {
      for (const [e, n] of Object.entries(r.est || {})) porEstado[e] = (porEstado[e] || 0) + Number(n || 0);
    }
    return {
      porEstado,
      total: Object.values(porEstado).reduce((a, b) => a + b, 0),
      sinVerificar: sinVerif,
    };
  },

  // Corrige los conteos globales con el antes/después de UNA ficha, sin releer
  // el resumen: el trigger lo actualiza con un par de segundos de retraso, y
  // releerlo justo después de mutar devolvería el número viejo.
  _ajustarConteos(viejo, nuevo) {
    const C = this._conteos;
    if (!C) return;
    const mover = (eq, signo) => {
      if (!eq) return;
      const e = eq.estado || 'sin_estado';
      C.porEstado[e] = Math.max(0, (C.porEstado[e] || 0) + signo);
      C.total = Math.max(0, C.total + signo);
      if (eq.verificado === false && typeof C.sinVerificar === 'number') C.sinVerificar = Math.max(0, C.sinVerificar + signo);
    };
    mover(viejo, -1);
    mover(nuevo, +1);
  },

  _renderCargando(tbody) {
    // Buscando se dice que se está buscando en todo el pool: este mensaje no
    // puede confundirse nunca con "ningún equipo coincide".
    const q = (document.getElementById('eqBusqueda')?.value || '').trim();
    const msg = q ? `Buscando "${FMT.esc(q)}" en todo el inventario…` : 'Cargando equipos…';
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--fg-3); padding:var(--sp-6);">${msg}</td></tr>`;
  },

  _renderErrorCarga(tbody) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:var(--sp-6);">
      <span style="color:#991B1B;">No se pudo cargar el pool.</span>
      <button class="btn btn-sm" style="margin-left:8px;" onclick="EquiposPool.reintentarCarga()">Reintentar</button>
    </td></tr>`;
  },

  reintentarCarga() {
    this._errorCarga = null;
    this.render();
  },

  // Refresco quirúrgico (2026-09-02, factura de agosto): recargar el pool
  // COMPLETO (7,351 fichas) tras cada mutación era la 2ª fuente de lecturas
  // del proyecto (~3.2M/mes). Tras tocar una unidad basta re-leer ESA ficha
  // (1 lectura) y parchear la fila en memoria. Acepta varios ids: corregir un
  // serial cambia el doc ID (doc ID = serial_norm), así que se pasan el viejo
  // y el nuevo — el que ya no exista se quita del array. Con lotes grandes o
  // sin estado previo cae a la recarga completa.
  async refrescar(ids) {
    const lista = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))];
    if (!lista.length || !Array.isArray(this._equipos) || lista.length > 300) return this.cargar();
    try {
      const db = firebase.firestore();
      const snaps = await Promise.all(lista.map(id => db.collection('equipos_pool').doc(id).get()));
      for (const s of snaps) {
        const i = this._equipos.findIndex(e => e.id === s.id);
        const viejo = i >= 0 ? this._equipos[i] : null;
        const nuevo = s.exists ? { id: s.id, ...s.data() } : null;
        if (!this._completo) {
          // Modo por pestaña: _equipos es SOLO la ubicación cargada. Una ficha
          // que se fue a otra ubicación sale de la lista (y aparece en la suya
          // cuando se abra esa pestaña); los conteos globales se corrigen con
          // el delta. Una ficha que no estaba cargada entra como nueva: es un
          // alta, o el ID nuevo de un serial corregido (el viejo ya restó).
          this._ajustarConteos(viejo, nuevo);
          const queda = nuevo && nuevo.estado === this._cargadoEstado;
          if (queda) { if (i >= 0) this._equipos[i] = nuevo; else this._equipos.push(nuevo); }
          else if (i >= 0) this._equipos.splice(i, 1);
          continue;
        }
        if (nuevo) {
          if (i >= 0) this._equipos[i] = nuevo; else this._equipos.push(nuevo);
        } else if (i >= 0) {
          this._equipos.splice(i, 1);
        }
      }
      // Mismo orden que EquiposPoolService.listar(), por si cambió el modelo.
      this._equipos.sort((a, b) => (a.modelo_label || '').localeCompare(b.modelo_label || '')
        || (a.serial || '').localeCompare(b.serial || ''));
      this.render();
    } catch (e) {
      console.error('Refresco puntual falló, recarga completa:', e);
      return this.cargar();
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
    // Modal de editar: fila EXACTA del catálogo (N y R aparte). El de recibir
    // vive en js/ui/asistente-recibir.js y carga su propio catálogo.
    const opts = this._modelos
      .map(m => `<option value="${FMT.esc(m.id)}">${FMT.esc(m.label)}</option>`).join('');
    const selEdit = document.getElementById('editModelo');
    if (selEdit) selEdit.innerHTML = (selEdit.options[0]?.outerHTML || '') + opts;
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
    // Pedir otra pestaña es pedir otra carga: si la anterior falló, se reintenta.
    this._errorCarga = null;
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
    this._errorCarga = null;
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
      // "2261 0A39" (con espacio o guion) debe encontrar 22610A39…: el
      // serial se compara también normalizado, como lo busca el servidor.
      const nq = this._claveBusqueda(f.q);
      if (!blob.includes(f.q) && !(nq && String(eq.serial_norm || '').startsWith(nq))) return false;
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
      ? '<span style="color:#92400e;">· buscando en <b>todo el inventario</b>, no sólo en la pestaña</span>'
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
    // Si lo que se va a pintar necesita datos que no están en memoria (una
    // búsqueda estando en una sola pestaña, un filtro, Todos…), se
    // piden ANTES de pintar. Todo camino pasa por aquí —pestañas, tarjetas,
    // filtros, búsqueda, deep-links—, así que nada puede pintarse con medio
    // pool. Lo que NUNCA puede pasar es responder "ningún equipo coincide" con
    // media lista en memoria: esa respuesta falsa es justo la que N1 quitó.
    if (!this._datosListos()) {
      if (this._errorCarga) return this._renderErrorCarga(tbody);
      this._renderCargando(tbody);
      this._asegurarDatos()
        .then(async () => { this.render(); await this._cargarEstadosOrdenTaller(); this.render(); })
        .catch(e => { console.error('[Equipos] no se pudo cargar:', e); this.render(); });
      return;
    }
    const lista = this._filtrados();
    const esc = FMT.esc;
    // Pintado por TANDAS (2026-09-30): la pestaña Bodega son 2,861 filas y
    // pintarlas de una vez costaba ~2.6 s. Se pintan PAGINA y el resto se pide
    // con "Ver más"; la tanda se reinicia al cambiar pestaña, filtro o
    // búsqueda. Filtros, búsqueda, conteos y Excel siguen sobre la lista
    // COMPLETA; la fila del final y el resumen dicen cuántas faltan por pintar.
    const firma = JSON.stringify([this._tab, this._filtrosActivos()]);
    if (firma !== this._firmaVista) { this._firmaVista = firma; this._limite = this.PAGINA; }
    const mostrar = lista.slice(0, this._limite);

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const fmt = (v) => v.toLocaleString('es-PA');

    // Tarjetas de "Pendientes": conteos GLOBALES del pool (no los toca ningún
    // filtro). Es una bandeja de trabajo — tiene que decir cuánto falta de
    // verdad, no cuánto falta dentro de lo que estés mirando ahora.
    // Con el pool entero en memoria se cuentan como siempre; en modo por
    // pestaña salen de los conteos globales (_cargarConteos), porque contar lo
    // cargado diría cuánto falta dentro de una sola ubicación.
    const C = this._completo ? null : this._conteos;
    const cuenta = (estado) => C ? (C.porEstado[estado] || 0) : this._equipos.filter(e => e.estado === estado).length;
    const nPorClasificar = cuenta('por_clasificar');
    const nPorInspeccionar = cuenta('devuelto_revision');
    const nNoRetirado = cuenta('no_retirado');
    const nSinVerificar = (C && typeof C.sinVerificar === 'number') ? C.sinVerificar : this._equipos.filter(e => e.verificado === false).length;
    set('colaPorClasificar', fmt(nPorClasificar));
    set('colaPorInspeccionar', fmt(nPorInspeccionar));
    set('colaNoRetirado', fmt(nNoRetirado));
    set('colaSinVerificar', fmt(nSinVerificar));
    const apagar = (cola, n) => document.querySelector(`.eq-cola[data-cola="${cola}"]`)
      ?.classList.toggle('is-vacia', n === 0);
    apagar('por_clasificar', nPorClasificar);
    apagar('devuelto_revision', nPorInspeccionar);
    apagar('no_retirado', nNoRetirado);
    apagar('sin_verificar', nSinVerificar);

    // Contadores de pestañas: respetan los filtros activos (modelo/propiedad/
    // toggles/búsqueda) para que el número de la pestaña calce con la tabla.
    // Con búsqueda activa se vuelven "cuántos resultados hay en cada ubicación",
    // que es exactamente lo que uno quiere saber al buscar un serial.
    const fAct = this._filtrosActivos();
    if (C) {
      // Modo por pestaña: por construcción no hay búsqueda ni filtros
      // secundarios (_bastaParcial), así que el número de cada pestaña es su
      // total global — el mismo que daría contarlo con el pool entero.
      const pe = C.porEstado;
      set('countBodega', `(${fmt(pe.en_bodega || 0)})`);
      set('countAsignados', `(${fmt(pe.asignado_contrato || 0)})`);
      set('countCliente', `(${fmt(pe.en_cliente || 0)})`);
      set('countTaller', `(${fmt(pe.en_taller || 0)})`);
      set('countOtros', `(${fmt(this.ESTADOS_OTROS.reduce((s, e) => s + (pe[e] || 0), 0))})`);
      set('countTodos', `(${fmt(C.total)})`);
    } else {
      const filtrables = this._equipos.filter(e => this._pasaFiltrosSecundarios(e, fAct));
      const n = estado => filtrables.filter(e => e.estado === estado).length;
      set('countBodega', `(${fmt(n('en_bodega'))})`);
      set('countAsignados', `(${fmt(n('asignado_contrato'))})`);
      set('countCliente', `(${fmt(n('en_cliente'))})`);
      set('countTaller', `(${fmt(n('en_taller'))})`);
      set('countOtros', `(${fmt(filtrables.filter(e => this.ESTADOS_OTROS.includes(e.estado)).length)})`);
      set('countTodos', `(${fmt(filtrables.length)})`);
    }
    this._pintarSeleccion();

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
        en_bodega: 'No hay equipos disponibles en bodega. Entran con "Recibir equipos" / "Importar hoja", o cuando una entrada pasa la inspección.',
        asignado_contrato: 'No hay unidades reservadas por contrato. Se asignan en Almacén · Asignar y salen al confirmarse la entrega.',
        en_cliente: 'No hay unidades en clientes. Llegan aquí cuando la orden de programación se marca "Entregado al cliente".',
        en_taller: 'No hay unidades en taller. Entran al agregarse con serial a una orden de servicio y salen al entregarse.',
        devuelto_revision: 'No hay radios pendientes de inspección. Los que el cliente devolvió (cierre de enmienda, anulación de contrato o cambio por defectuoso) caen aquí al recibirse por una orden de ENTRADA; con "Inspección OK" regresan a bodega como Refurbished, o se dan de baja.',
        por_clasificar: 'No hay unidades por clasificar. Aquí caen las que el sistema tenía en un cliente sin nada que lo respalde (ni contrato ni orden de servicio). No es una ubicación física: hay que encontrar el radio — si aparece en bodega se registra con "Corregir estado"; si lo tiene un cliente, se asigna en Seriales de su contrato.',
        no_retirado: 'No hay radios sin retirar. Aquí caen los equipos DEL CLIENTE que quedaron listos y nadie vino a buscar: llegan cuando una reparación se cierra como "sin retirar" (menú ⋯ → Casos viejos, en Órdenes). Salen por una de tres puertas: el cliente los retira, vuelven a bodega si eran nuestros, o se dan por abandonados.',
        otros: 'No hay unidades dadas de baja ni vendidas. Las ventas directas (facturadas en QuickBooks) se registran con "Registrar venta" para descontarlas de bodega; una baja hecha por error se revierte con "Reactivar equipo".',
      };
      const hayOtrosFiltros = !!(fAct.mod || fAct.prop || fAct.sinVerificar || fAct.compartidos || fAct.sinCliente || fAct.listos);
      // Buscar y no encontrar nada ya NO significa "está en otra pestaña" — la
      // búsqueda barre el pool entero. Así que el mensaje dice lo que de verdad
      // pasa: ese serial no existe en el inventario, o lo tapa otro filtro.
      const msgBusqueda = hayOtrosFiltros
        ? `Ningún equipo coincide con "${esc(fAct.q)}" y los demás filtros activos. Prueba a limpiarlos.`
        : `Ningún equipo coincide con "${esc(fAct.q)}". Revisa que el serial esté bien escrito — si el equipo es real y nunca pasó por aquí, se dará de alta solo la próxima vez que toque un contrato, una orden o bodega.`;
      // En modo por pestaña una ubicación vacía NO es un pool vacío: se mira
      // el total global, o la página diría "no hay equipos" con 7,600 fichas.
      const poolVacio = C ? C.total === 0 : !this._equipos.length;
      const msg = poolVacio
        ? 'No hay equipos registrados. Usa "Recibir equipos" o "Importar hoja".'
        : fAct.q ? msgBusqueda
        : (hayOtrosFiltros ? 'Sin resultados con el filtro actual.' : (VACIO_POR_TAB[this._tab] || 'Sin resultados.'));
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--fg-3); padding:var(--sp-6); line-height:1.6;">${msg}</td></tr>`;
    } else {
      const puede = this.puedeEscribir();
      tbody.innerHTML = mostrar.map(eq => {
        // "Asignado a" navegable: cliente → ficha, contrato → lista con búsqueda
        // precargada (?buscar=), orden → la bandeja con ?ids=. Puede haber asignación Y
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
          ? `<a class="eq-sub eq-link" href="../ordenes/index.html?ids=${encodeURIComponent(eq.orden_actual_id)}" title="Abrir la orden de servicio">orden en taller</a>`
          : '';
        // POC es plataforma, no ubicación: la membresía se muestra como
        // atributo (tag), nunca como estado.
        const tagPoc = eq.poc_device_id
          ? `<span class="eq-sub" title="Registrado en la plataforma POC (device ${esc(eq.poc_device_id)})">POC</span>` : '';
        const asignadoA = (linkCliente + linkContrato + linkOrden + tagPoc) || '—';
        // El chip cambia de tono según haya decisión o no: rojo mientras el
        // conflicto está abierto, ámbar cuando ya se confirmó que son radios
        // distintos. Antes ambos casos mandaban a la cola de Conflictos, donde
        // el resuelto no aparece — y parecía que el sistema perdió el dato.
        // Hoy la cola está en Almacén · Hoy y el resuelto se reabre en la ficha.
        const compartido = eq.serial_compartido
          ? (eq.conflicto_revisado === true
              ? `<span class="eqpool-compartido" style="background:#fef3c7;color:#92400e;" title="Confirmado: dos radios físicos distintos comparten esta numeración (típico Kenwood NX-420 / NX-920). Verifica el modelo antes de operar. Si la decisión fue equivocada, se reabre desde la ficha (Historia).">2+ modelos · confirmado</span>`
              : `<span class="eqpool-compartido" title="Este serial existe en más de un modelo y nadie lo ha revisado — verifica el modelo antes de operar. Se resuelve en la cola de Conflictos de Almacén · Hoy.">2+ modelos</span>`)
          : '';
        const noVerif = eq.verificado === false
          ? `<span class="eqpool-noverif" title="Creado por migración automática — pendiente de confirmación">Sin verificar</span>` : '';
        const casilla = puede
          ? `<input type="checkbox" class="eq-sel" value="${esc(eq.id)}" ${this._sel.has(eq.id) ? 'checked' : ''}
                    onchange="EquiposPool.toggleSel('${esc(eq.id)}', this.checked)"
                    aria-label="Seleccionar ${esc(eq.serial || eq.serial_norm)}">` : '';
        return `<tr>
          <td class="eq-td-sel">${casilla}</td>
          <td class="td-mono">${esc(eq.serial || eq.serial_norm)}${compartido}${noVerif}</td>
          <td>${esc(eq.modelo_label || '—')}</td>
          <td>${eq.condicion === 'reuso' ? 'Refurbished' : 'Nuevo'}</td>
          <td>${EquiposPoolService.chipPropiedadHtml(eq)}</td>
          <td><span class="eqpool-chip eqpool-chip-lg eqpool-chip-${esc(EquiposPoolService.ESTADO_LABELS[eq.estado] ? eq.estado : 'desconocido')}">${esc(EquiposPoolService.ESTADO_LABELS[eq.estado] || eq.estado)}</span>${this._listoParaEntrega(eq) ? `<span class="eqpool-chip" style="background:#e9f7f0;color:#067647;display:inline-block;margin-top:3px;" title="La orden ya está COMPLETADO (EN OFICINA) — el radio está terminado; falta registrar la entrega al cliente">→ listo para entrega</span>` : ''}${EquiposPoolService.chipPendienteDevolucionHtml(eq)}${eq.reemplaza_a ? `<span class="eq-sub" title="Linaje: esta unidad sustituyó a la anterior en una renovación/reemplazo">reemplaza a ${esc(eq.reemplaza_a)}</span>` : ''}</td>
          <td>${asignadoA}</td>
          <td style="font-size:12px; color:var(--fg-3);" title="${esc(eq.origen || '')}">${esc(this.ORIGEN_LABELS[eq.origen] || eq.origen || '—')}</td>
          <td>${this._accionesHtml(eq, puede)}</td>
        </tr>`;
      }).join('') + (mostrar.length < lista.length ? this._filaVerMasHtml(mostrar.length, lista.length) : '');
    }

    // Poda de la selección: sólo sobrevive lo que sigue VISIBLE. Si un filtro,
    // una pestaña o una búsqueda esconde una fila, sale del lote — actuar sobre
    // filas que el usuario ya no ve es exactamente el accidente que hay que
    // impedir en una acción masiva.
    const visibles = new Set(mostrar.map(e => e.id));
    [...this._sel].forEach(id => { if (!visibles.has(id)) this._sel.delete(id); });
    this._renderBarraLote();
    this._sincronizarSelAll();

    const resumen = document.getElementById('eqResumen');
    if (resumen) resumen.innerHTML = mostrar.length < lista.length
      ? `<strong>${fmt(mostrar.length)}</strong> de <strong>${fmt(lista.length)}</strong> <span style="color:var(--muted);font-size:12px;">equipos pintados · faltan ${fmt(lista.length - mostrar.length)} (Ver más, al final de la tabla)</span>`
      : `<strong>${fmt(lista.length)}</strong> <span style="color:var(--muted);font-size:12px;">equipos mostrados</span>`;
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

  // Pintado por tandas (ver render()). "Seleccionar todo" y la poda del lote
  // actúan sobre lo PINTADO: una acción masiva nunca toca filas que no se ven.
  PAGINA: 200,
  _limite: 200,
  _firmaVista: '',
  _visibles() { return this._filtrados().slice(0, this._limite); },
  verMas(todos = false) {
    this._limite = todos ? Infinity : this._limite + this.PAGINA;
    this.render();
  },
  _filaVerMasHtml(n, total) {
    const fmt = (v) => v.toLocaleString('es-PA');
    const mas = Math.min(this.PAGINA, total - n);
    return `<tr class="eq-ver-mas"><td colspan="9" style="text-align:center; padding:var(--sp-4); color:var(--fg-2); line-height:1.6;">
      Se muestran <b>${fmt(n)}</b> de <b>${fmt(total)}</b>. Los otros <b>${fmt(total - n)}</b> también cumplen el filtro:
      solo falta pintarlos. La búsqueda y el Excel ya los incluyen.
      <div style="margin-top:8px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="EquiposPool.verMas()">Ver ${fmt(mas)} más</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="EquiposPool.verMas(true)">Ver todos (${fmt(total)})</button>
      </div></td></tr>`;
  },

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
      // Sin ENTRADA de taller abierta y con el estado re-verificado en la
      // transacción — mismo criterio que Existencias y Hoy (auditoría UX 2026-09-28).
      aplica: (eq) => eq.estado === 'devuelto_revision' && !eq.orden_actual_id,
      titulo: 'Inspección OK en lote',
      cuerpo: (n) => `<b>${n}</b> unidad(es) pasan inspección y vuelven a bodega como disponibles `
        + '(tipo Refurbished). Las que tienen ENTRADA de taller abierta no se incluyen.<br><br>Cada una deja su movimiento en el kardex.',
      pideMotivo: false,
      correr: (eq) => EquiposPoolService.liberar(eq.id,
        { notas: 'Inspección OK tras devolución (lote)', esperado: EquiposPoolService.ESTADOS.DEVUELTO }, firebase.auth().currentUser),
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
      correr: (eq, motivo) => EquiposPoolService.corregirABodega(eq.id, motivo, firebase.auth().currentUser, { esperado: eq.estado || null }),
    },
    // ── Salidas de "Listo · el cliente no lo retiró" ────────────────────
    // Radios ajenos que quedaron en nuestro estante al cerrar una reparación
    // que el cliente nunca vino a buscar (CERRADA (SIN RETIRAR)). Las tres
    // puertas piden motivo: si sacar algo de aquí fuera un clic sin explicar,
    // esto se volvería otra gaveta donde "limpiar la lista".
    retirado: {
      label: 'El cliente lo retiró',
      icono: 'package-check',
      aplica: (eq) => eq.estado === 'no_retirado',
      titulo: 'El cliente vino a retirar',
      cuerpo: (n) => `<b>${n}</b> unidad(es) pasan a <b>En cliente</b>: el dueño apareció y se las llevó.`
        + '<br><br>Aquí <b>no se captura firma</b> — la orden que amparaba estos equipos ya está cerrada, '
        + 'así que el rastro es el motivo que escribas más tu nombre en el kardex. '
        + 'Si necesitas un papel firmado, no uses esta acción: abre una entrega.',
      pideMotivo: true,
      motivoPlaceholder: 'p. ej. retirados el 9-sep por Luis Pérez, cédula 8-888-8888',
      correr: (eq, motivo) => EquiposPoolService.retiradoPorCliente(eq.id, motivo, firebase.auth().currentUser),
    },
    noRetiradoBodega: {
      label: 'Sin retirar → bodega',
      icono: 'warehouse',
      aplica: (eq) => eq.estado === 'no_retirado',
      titulo: 'Vuelve a bodega',
      cuerpo: (n) => `<b>${n}</b> unidad(es) vuelven a <b>En bodega</b>.`
        + '<br><br>Úsalo solo cuando el equipo <b>es nuestro</b> (flota de alquiler que el cliente '
        + 'dejó de usar). Si es del cliente, mandarlo a bodega dice que es nuestro y queda '
        + 'disponible para alquilarlo a otro.<br><br>Entran a la cola de verificar.',
      pideMotivo: true,
      motivoPlaceholder: 'p. ej. flota de alquiler del contrato ALQ-2025-14, terminado',
      correr: (eq, motivo) => EquiposPoolService.noRetiradoABodega(eq.id, motivo, firebase.auth().currentUser),
    },
    abandonado: {
      label: 'Darlo por abandonado',
      icono: 'trash-2',
      // Solo admin: es la puerta que hace desaparecer equipo ajeno.
      aplica: (eq) => eq.estado === 'no_retirado'
        && EquiposPool._rol === ROLES.ADMIN,
      titulo: 'Dar por abandonado',
      cuerpo: (n) => `<b>${n}</b> unidad(es) pasan a <b>Baja</b>.`
        + '<br><br>Es equipo <b>del cliente</b> que llevamos guardando y que se declara abandonado. '
        + 'La baja no se deshace sola (hay reactivación, pero deja las dos vueltas en el kardex), '
        + 'y el motivo es lo único que va a explicar esto dentro de dos años. '
        + 'Escribe la fecha del último contacto.',
      pideMotivo: true,
      motivoPlaceholder: 'p. ej. abandonado — sin respuesta desde 12-mar, avisado por correo 3 veces',
      correr: (eq, motivo) => EquiposPoolService.darDeBaja(eq.id, motivo, firebase.auth().currentUser, { esperado: eq.estado || null }),
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
    const visibles = this._visibles();
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
    const visibles = this._visibles();
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
  // El runner (barra, Detener, reporte por motivo) es AsistenteLote, el mismo
  // de Existencias: antes cada pantalla tenía el suyo y el de Existencias ni
  // siquiera se podía parar.
  async abrirLote(clave) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden hacer cambios.', 'bad'); return; }
    const a = this.LOTE_ACCIONES[clave];
    if (!a) return;
    const aplican = this._seleccionados().filter(a.aplica);
    if (!aplican.length) { Toast.show('Ninguna unidad de la selección aplica a esa acción.', 'warn'); return; }
    const r = await AsistenteLote.correr({
      titulo: a.titulo, icono: a.icono, cuerpoHtml: a.cuerpo(aplican.length),
      items: aplican, etiqueta: (eq) => eq.serial || eq.serial_norm,
      pideMotivo: a.pideMotivo, motivoPlaceholder: a.motivoPlaceholder || '',
      correr: (eq, motivo) => a.correr(eq, motivo), labelOk: a.label,
    });
    if (!r) return;
    this._sel.clear();
    await this.refrescar(aplican.map(e => e.id));
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
    // Corregir serial (auditoría 2026-08-13): un typo no colisiona (es un
    // serial_norm distinto) → no cae en la cola de Conflictos y la ficha fantasma
    // convive con la real hasta que el Dif la delate. El remedio era baja +
    // alta, que partía el kardex en dos fichas. Ahora es una corrección con
    // rastro (movimiento correccion_serial) que conserva la historia.
    if (puede) items.push(I('scan-line', 'Corregir serial…', `EquiposPool.corregirSerial('${id}')`));
    if (puede && eq.verificado === false)
      items.push(I('badge-check', 'Marcar como verificado', `EquiposPool.verificar('${id}')`));
    if (puede && eq.estado === 'devuelto_revision' && kind !== 'inspeccion')
      items.push(I('check-circle-2', 'Inspección OK → a bodega', `EquiposPool.inspeccionOk('${id}')`));
    if (puedeCorregir && kind !== 'corregir')
      items.push(I('pencil-ruler', 'Corregir estado → En bodega', `EquiposPool.abrirCorregir('${id}')`));
    // Corregir ubicación (2026-10-07): el radio está donde el sistema no dice
    // (en la calle, en revisión, en taller). "A bodega" era el único destino.
    if (puede && !['baja', 'vendido'].includes(eq.estado) && window.EquipoFicha?._corregirUbicacion)
      items.push(I('map-pin', 'Corregir ubicación…', `EquiposPool.corregirUbicacion('${id}')`));
    if (puede && eq.estado === 'en_bodega')
      items.push(I('banknote', 'Registrar venta de esta unidad', `EquiposPool.abrirVenta('${id}')`));
    // Revivir NO es CTA: una baja correcta es terminal, revertirla es la
    // excepción. Vive en el menú para que no compita con las colas reales.
    if (puede && eq.estado === 'baja')
      items.push(I('archive-restore', 'Reactivar equipo → a bodega', `EquiposPool.revivir('${id}')`));
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

  // Búsqueda con debounce de 250 ms (auditoría UX 2026-09-28): render() filtra
  // y repinta el registro entero; por tecla, con 7,000+ fichas, se trababa.
  _buscarTimer: null,
  buscarDiferido() {
    clearTimeout(this._buscarTimer);
    this._buscarTimer = setTimeout(() => this.render(), 250);
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
    const mot = document.getElementById('editMotivo'); if (mot) mot.value = '';
    Modal.open('eqEditModal');
  },

  // Auditoría UX 2026-09-28: cambiar el MODELO o la PROPIEDAD cambia qué es la
  // unidad o de quién es — va por reclasificarModelo / corregirPropiedad, que
  // dejan movimiento en el kardex con el motivo. Proveedor y notas siguen por
  // `actualizar` (datos de captura, sin kardex).
  async guardarEdicion(btn) {
    if (!this._editandoId) return;
    if (btn && window.withBusy?.esta?.(btn)) return;   // doble clic: sigue el primero
    const eq = this._equipos.find(x => x.id === this._editandoId);
    if (!eq) return;
    const modeloId = document.getElementById('editModelo').value || null;
    const propiedad = document.getElementById('editPropiedad').value;
    const motivo = (document.getElementById('editMotivo')?.value || '').trim();
    const cambiaModelo = (modeloId || null) !== (eq.modelo_id || null);
    const cambiaPropiedad = propiedad !== (eq.propiedad || 'desconocida');
    if ((cambiaModelo || cambiaPropiedad) && !motivo) {
      Toast.show('Escribe el motivo: cambiar modelo o propiedad queda en el kardex.', 'warn');
      document.getElementById('editMotivo')?.focus();
      return;
    }
    const user = firebase.auth().currentUser;
    const correr = async () => {
      if (cambiaModelo) {
        await EquiposPoolService.reclasificarModelo(eq.id, {
          modelo_id: modeloId,
          modelo_label: modeloId ? this._modeloLabel(modeloId) : '',
          // Modelo fuera del catálogo (o sin modelo): se conserva la de la ficha.
          condicion: this._condicionDeModelo(modeloId) || this._condicionOriginal || 'nuevo',
          estadoActual: eq.estado || null,
          antes: `${eq.modelo_label || '(sin modelo)'} / ${eq.condicion || '?'}`,
        }, `${motivo} (Editar ficha, Equipos por serial)`, user);
      }
      if (cambiaPropiedad) {
        await EquiposPoolService.corregirPropiedad(eq.id, propiedad,
          { estadoActual: eq.estado || null, antes: eq.propiedad || '' },
          `${motivo} (Editar ficha, Equipos por serial)`, user);
      }
      const proveedor = document.getElementById('editProveedor').value;
      const notas = document.getElementById('editNotas').value;
      if (proveedor !== (eq.proveedor || '') || notas !== (eq.notas || '')) {
        await EquiposPoolService.actualizar(eq.id, { proveedor, notas }, user);
      }
    };
    try {
      if (window.withBusy && btn) await withBusy(btn, correr, { label: 'Guardando…', silencioso: true });
      else await correr();
      Modal.close('eqEditModal');
      const editadoId = this._editandoId;
      this._editandoId = null;
      Toast.show('Equipo actualizado.', 'ok');
      this.refrescar(editadoId);
    } catch (e) {
      Toast.show('Error al actualizar: ' + (e.message || e), 'bad');
    }
  },

  // ── Acciones de estado ───────────────────────────────────────────────
  async verificar(id) {
    try {
      await EquiposPoolService.verificar(id, firebase.auth().currentUser);
      Toast.show('Equipo verificado.', 'ok');
      this.refrescar(id);
    } catch (e) {
      Toast.show('Error: ' + (e.message || e), 'bad');
    }
  },

  // Corrección de serial con kardex — ver nota en _accionesHtml. El servicio
  // valida colisión (un serial ya existente en otra ficha es un duplicado a
  // fusionar, no un typo) y escribe serial + serial_norm en la misma tanda.
  // Misma hoja que la ficha (EquipoFicha._corregirUbicacion): un solo
  // formulario y un solo servicio para las dos pantallas.
  async corregirUbicacion(id) {
    const eq = this._equipos.find(x => x.id === id);
    if (!eq) return;
    try {
      const r = await EquipoFicha._corregirUbicacion(eq, firebase.auth().currentUser);
      if (!r) return;
      Toast.show(r.mensaje, 'ok');
      this.refrescar([id]);
    } catch (e) {
      Toast.show(e.message || String(e), 'bad');
    }
  },

  async corregirSerial(id) {
    const eq = this._equipos.find(x => x.id === id);
    if (!eq) return;
    const nuevo = await Modal.prompt({
      title: 'Corregir serial',
      message: `Serial actual: ${eq.serial || '¿?'} (${eq.modelo_label || 'modelo ?'}). Escribe el serial CORRECTO tal como aparece en la etiqueta del equipo. La corrección queda en el kardex.`,
      defaultValue: eq.serial || '',
      placeholder: 'Serial correcto',
      confirmLabel: 'Revisar',
    });
    if (nuevo == null) return;
    const limpio = nuevo.trim();
    if (!limpio) { Toast.show('Serial vacío.', 'warn'); return; }
    if (EquiposPoolService.normalizarSerial(limpio) === EquiposPoolService.normalizarSerial(eq.serial || '')) {
      Toast.show('Es el mismo serial (solo cambia formato). Nada que corregir.', 'warn'); return;
    }
    const ok = await Modal.confirm({
      title: 'Confirmar corrección',
      message: `${eq.serial || '¿?'} → ${limpio}. La ficha conserva su historia y el movimiento queda en el kardex. Si el serial figura en un contrato vigente, corrígelo también en Seriales del contrato. ¿Aplicar?`,
      confirmLabel: 'Corregir serial',
    });
    if (!ok) return;
    try {
      await EquiposPoolService.corregirSerial(id, limpio, 'Corregido desde Equipos por serial.', firebase.auth().currentUser);
      Toast.show(`Serial corregido: ${limpio}`, 'ok');
      this.refrescar([id, EquiposPoolService.normalizarSerial(limpio)]);
    } catch (e) {
      Toast.show('No se pudo corregir: ' + (e.message || e), 'bad');
    }
  },

  async inspeccionOk(id) {
    const eq = this._equipos.find(x => x.id === id);
    if (!await Modal.confirm({
      message: `El equipo ${eq?.serial || id} pasó inspección y regresa a bodega como disponible (tipo: Refurbished). ¿Confirmar?`,
    })) return;
    try {
      await EquiposPoolService.liberar(id, { notas: 'Inspección OK tras devolución' }, firebase.auth().currentUser);
      Toast.show('Equipo devuelto a bodega.', 'ok');
      this.refrescar(id);
    } catch (e) {
      Toast.show('Error: ' + (e.message || e), 'bad');
    }
  },

  async darDeBaja(id) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden dar de baja equipos.', 'bad'); return; }
    const eq = this._equipos.find(x => x.id === id);
    const motivo = await Modal.prompt({
      title: 'Dar de baja',
      message: `Motivo de la baja de ${eq?.serial || id} (dañado, perdido, vendido…). El equipo sale de la flota; si la baja resulta un error, administración o inventario pueden reactivarlo desde la pestaña Baja / Venta.`,
    });
    if (motivo === null) return;
    if (!motivo.trim()) { Toast.show('La baja requiere un motivo.', 'bad'); return; }
    try {
      await EquiposPoolService.darDeBaja(id, motivo.trim(), firebase.auth().currentUser, { esperado: eq?.estado || null });
      Toast.show('Equipo dado de baja.', 'ok');
      this.refrescar(id);
    } catch (e) {
      Toast.show('Error: ' + (e.message || e), 'bad');
    }
  },

  // Reversa de una baja por error — la unidad regresa a bodega como disponible.
  async revivir(id) {
    if (!this.puedeEscribir()) { Toast.show('Solo administración o inventario pueden reactivar equipos.', 'bad'); return; }
    const eq = this._equipos.find(x => x.id === id);
    const motivo = await Modal.prompt({
      title: 'Reactivar equipo',
      message: `Motivo de la reactivación de ${eq?.serial || id} (p. ej. baja registrada por error). El equipo regresa a bodega como disponible; si estaba asignado a un contrato u orden, hay que volver a asignarlo por el flujo normal.`,
    });
    if (motivo === null) return;
    if (!motivo.trim()) { Toast.show('La reactivación requiere un motivo.', 'bad'); return; }
    try {
      await EquiposPoolService.reactivar(id, motivo.trim(), firebase.auth().currentUser);
      Toast.show('Equipo reactivado — de vuelta en bodega.', 'ok');
      this.refrescar(id);
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
      avisos.push(`La <a class="eq-link" href="../ordenes/index.html?ids=${encodeURIComponent(eq.orden_actual_id)}" target="_blank">orden en taller</a> seguirá listando este serial: remuévelo de la orden si sigue abierta.`);
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
      const res = await EquiposPoolService.corregirABodega(id, motivo, firebase.auth().currentUser, { esperado: eq.estado || null });
      let msg = res?.a_revision
        ? `Estado corregido — la unidad quedó POR REVISAR, no en bodega: la sustituyó ${res.entrante} en un reemplazo.`
        : 'Estado corregido — la unidad quedó en bodega.';
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
      this.refrescar(id);
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
  // La ficha del equipo ES el kardex (con sus acciones): antes había aquí un
  // modal propio que repetía la misma historia con otro formato.
  abrirHistoria(id) {
    if (window.EquipoFicha) EquipoFicha.abrirPorId(id);
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
  // ── Arranque dentro de Almacén ───────────────────────────────────────
  // Lo llama AlmacenPage.setTab('serial') la primera vez (y el init de Hoy
  // cuando la página abre con ?tab=serial). `params` son los deep-links que
  // antes recibía equipos.html y que su stub traduce:
  //   estado  (en_bodega, devuelto_revision, por_clasificar, otros, todos…)
  //   verificar=1 · modelo=<id de catálogo o familia> · serial=<texto>
  // En todos los casos se limpian los filtros secundarios para que lo pedido
  // se vea sí o sí (la búsqueda no se persiste entre visitas).
  _activo: false,
  _arrancando: null,
  TABS_VALIDAS: ['en_bodega', 'asignado_contrato', 'en_cliente', 'en_taller', 'devuelto_revision', 'por_clasificar', 'no_retirado', 'otros', 'todos'],

  async activar(params = {}) {
    if (this._arrancando) await this._arrancando;
    if (!this._activo) {
      this._arrancando = this._arrancar();
      try { await this._arrancando; } finally { this._arrancando = null; }
      if (!this._activo) return;           // rol sin acceso: la sección ya lo dice
      this._aplicarParams(params);
      await this.cargar();
      return;
    }
    if (params && Object.keys(params).some(k => params[k])) { this._aplicarParams(params); this.render(); }
  },

  async _arrancar() {
    this._rol = window.userRole || this._rol || ROLES.VISTA;
    // Lectura: admin/inventario/gerente. Escritura: admin/inventario. A
    // Almacén también entran recepción/vendedor (asignar seriales): para ellos
    // la lista avanzada no existe, igual que antes no podían abrir equipos.html.
    const permitidos = [ROLES.ADMIN, ROLES.INVENTARIO, ROLES.GERENTE];
    if (!permitidos.includes(this._rol)) {
      const sec = document.getElementById('tab-serial');
      if (sec) sec.innerHTML = '<div class="ds-card ds-card-padded" style="text-align:center; color:var(--fg-3);">La lista por serial es de administración, inventario y gerencia.</div>';
      return;
    }
    if (!this.puedeEscribir()) {
      // Sin permiso de escritura las filas no llevan casilla, así que el
      // "seleccionar todo" de la cabecera sería un control muerto.
      document.getElementById('eqSelAll')?.remove();
    }
    await this.cargarModelos();
    this._restaurarFiltros();
    // Cierre del menú ⋯ de fila: al pulsar un item (tras ejecutar su acción),
    // al hacer click fuera de cualquier menú, o con ESC.
    document.addEventListener('click', (e) => {
      if (e.target.closest('.overflow-menu-item')) { this.cerrarMenus(); return; }
      if (!e.target.closest('.overflow-menu')) this.cerrarMenus();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.cerrarMenus(); });
    this._activo = true;
  },

  _aplicarParams({ estado = '', verificar = false, modelo = '', serial = '' } = {}) {
    if (!(estado || verificar || modelo || serial)) return;
    ['eqFiltroModelo', 'eqFiltroPropiedad'].forEach(id => {
      const n = document.getElementById(id); if (n) n.value = '';
    });
    ['chkSinVerificar', 'chkCompartidos', 'chkSinCliente', 'chkListos'].forEach(id => {
      const n = document.getElementById(id); if (n) n.checked = false;
    });
    const q = document.getElementById('eqBusqueda');
    if (q) q.value = serial || '';
    this._tab = serial ? 'todos' : (this.TABS_VALIDAS.includes(estado) ? estado : 'todos');
    this._errorCarga = null;
    if (verificar) {
      const chk = document.getElementById('chkSinVerificar');
      if (chk) chk.checked = true;
    }
    // ?modelo=<id de catálogo>: el select de filtro usa claves de FAMILIA (no
    // ids), así que primero se resuelve el id a su familia; si ya viene como
    // clave de familia, también sirve.
    if (modelo) {
      const sel = document.getElementById('eqFiltroModelo');
      let famKey = '';
      for (const [key, fam] of (this._familias || new Map()).entries()) {
        if (key === modelo || fam.ids.has(modelo)) { famKey = key; break; }
      }
      if (sel && famKey && [...sel.options].some(o => o.value === famKey)) sel.value = famKey;
    }
    this._pintarSeleccion();
  },
};
