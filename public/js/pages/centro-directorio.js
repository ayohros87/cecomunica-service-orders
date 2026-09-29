// @ts-nocheck
// Centro de gestión de clientes — Directorio.
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Directorio ═════════ */

  esVendedor() { return this.rol === ROLES.VENDEDOR; },

  setCartera(v) {
    if (this.esVendedor()) return;   // el vendedor no sale de su cartera
    this.cartera = v;
    this.cargarLista(true);
  },

  setSoloActivos(on) {
    this.soloActivos = !!on;
    this._carteraCache = null;
    try { localStorage.setItem('cg_solo_activos', on ? '1' : '0'); } catch (e) { /* sin persistencia */ }
    this.cargarLista(true);
  },

  // ── Filtro "Cuentas por regularizar" (?filtro=regularizacion) ──
  // Mismo criterio que la señal REGV/REGG del home (SenalesService.
  // listCuentasPorRegularizar): puntos > 0, vivas y activas, sin las de "solo
  // por clasificar" (cola de bodega) y sin las pospuestas — así el número de
  // la tarjeta y las filas que aparecen aquí son las mismas.
  quitarFiltroReg() {
    this.filtroReg = false;
    history.replaceState({}, '', location.pathname);
    this.cargarLista(true);
  },
  async _cargarPorRegularizar() {
    const cont = document.getElementById('cgLista');
    const resumen = document.getElementById('cgResumen');
    document.getElementById('btnMas').classList.add('hidden');
    if (!cont.querySelector('.cg-row')) cont.innerHTML = '<div class="cg-empty">Cargando cuentas por regularizar…</div>';
    const soloMias = this.esVendedor() || this.cartera === 'mios';
    let docs = [];
    try {
      if (soloMias) {
        docs = await ClientesService.listClientesPorVendedor(this.uid, { onlyActive: true });
      } else {
        const snap = await firebase.firestore().collection('clientes')
          .where('regularizacion.puntos', '>', 0).limit(400).get();
        docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    } catch (e) {
      console.error('[centro] cuentas por regularizar:', e);
      cont.innerHTML = `<div class="cg-empty">No se pudieron cargar las cuentas por regularizar.
        <div class="cta"><button class="btn btn-ghost cg-act" onclick="Centro.cargarLista(true)">Reintentar</button></div></div>`;
      return;
    }
    const pospuesta = (c) => !!(window.PendientesDomain?.estaPospuesto && PendientesDomain.estaPospuesto(c, new Date()));
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const words = norm(this.term).split(/\s+/).filter(Boolean);
    const lista = docs
      .filter(c => !c.deleted && c.activo !== false && c.regularizacion?.puntos > 0
        && !c.regularizacion.solo_bodega && !pospuesta(c))
      .filter(c => !words.length || words.every(w =>
        norm([c.nombre, c.rucdv_norm, c.ruc, c.telefono, c.email].filter(Boolean).join(' ')).includes(w)))
      // Sin vendedor primero (nadie más las ve), luego por deuda — como REGG.
      .sort((a, b) => (a.vendedor_asignado ? 1 : 0) - (b.vendedor_asignado ? 1 : 0)
        || (b.regularizacion.puntos || 0) - (a.regularizacion.puntos || 0));
    cont.innerHTML = lista.length
      ? lista.map(c => this._filaCliente(c)).join('')
      : `<div class="cg-empty">${this.term ? 'Ninguna cuenta por regularizar coincide con la búsqueda.'
          : soloMias ? 'Tu cartera está al día: ninguna cuenta por regularizar.' : 'Ninguna cuenta con deuda de regularización.'}</div>`;
    const n = lista.length;
    resumen.innerHTML = `<b>${n} cuenta${n === 1 ? '' : 's'} por regularizar</b>${soloMias ? ' en tu cartera' : ''}
      · <a href="${location.pathname}" onclick="event.preventDefault(); Centro.quitarFiltroReg()">Ver todo el directorio</a>`;
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // "Mi cartera" desde el servidor (auditoría UX 2026-09-28, P0 #15): antes
  // se filtraba en el navegador sobre páginas de 30 clientes de toda la base
  // y la vista principal del vendedor podía salir en blanco.
  async _cargarCartera() {
    const clave = this.soloActivos ? 'act' : 'todos';
    // Caché corta: la búsqueda filtra aquí sin volver a pedir la cartera por tecla.
    if (!this._carteraCache || this._carteraCache.clave !== clave || Date.now() - this._carteraCache.at > 60000) {
      const docs = await ClientesService.listClientesPorVendedor(this.uid, { onlyActive: this.soloActivos });
      this._carteraCache = { clave, docs, at: Date.now() };
    }
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const words = norm(this.term).split(/\s+/).filter(Boolean);
    const visibles = words.length
      ? this._carteraCache.docs.filter(c => {
          const txt = norm([c.nombre, c.rucdv_norm, c.ruc, c.telefono, c.email].filter(Boolean).join(' '));
          return words.every(w => txt.includes(w));
        })
      : this._carteraCache.docs;
    const cont = document.getElementById('cgLista');
    cont.innerHTML = visibles.length
      ? visibles.map(c => this._filaCliente(c)).join('')
      : `<div class="cg-empty">${this.term ? 'Ningún cliente de tu cartera coincide con la búsqueda.' : 'No tienes clientes asignados todavía.'}</div>`;
    document.getElementById('btnMas').classList.add('hidden');
    const n = visibles.length;
    document.getElementById('cgResumen').textContent =
      `${n} cliente${n === 1 ? '' : 's'}${this.soloActivos ? ' activos' : ''} en tu cartera`;
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  async cargarLista(reset) {
    if (reset) { this.cursor = null; document.getElementById('cgLista').innerHTML = ''; }
    document.getElementById('segMios').classList.toggle('is-on', this.cartera === 'mios');
    document.getElementById('segTodos').classList.toggle('is-on', this.cartera === 'todos');
    if (this.filtroReg) { await this._cargarPorRegularizar(); return; }
    if (this.cartera === 'mios' && typeof ClientesService.listClientesPorVendedor === 'function') {
      try { await this._cargarCartera(); return; }
      catch (e) { console.warn('[centro] cartera desde el servidor no disponible, se pagina:', e?.message || e); }
    }
    try {
      // "Solo activos" filtra EN EL SERVIDOR con la misma semántica del módulo
      // de clientes (where activo == true): antes se filtraba en cliente con
      // `activo !== false`, así que los docs SIN el campo pasaban como activos
      // y la página traída encogía al filtrar (bug reportado 2026-08-28).
      const args = { term: this.term, cursorDoc: this.cursor, limit: 30, onlyActive: this.soloActivos };
      // Primera página sin término: pintar YA desde la caché local de Firestore
      // (lo que esta persona vio la última vez) mientras llega el servidor,
      // que repinta encima (2026-09-29). Si no hay caché, viene vacío y se
      // espera al servidor como siempre.
      if (reset && !this.term) {
        try {
          const cache = await ClientesService.listClientesPage({ ...args, source: 'cache' });
          if (cache.docs.length) this._pintarPagina(cache, { reset: true, provisional: true });
        } catch { /* sin caché: camino normal */ }
      }
      const pagina = await ClientesService.listClientesPage(args);
      if (reset) document.getElementById('cgLista').innerHTML = '';
      this._pintarPagina(pagina, { reset });
    } catch (e) { console.error(e); Toast.show('No se pudo cargar la lista de clientes', 'bad'); }
  },

  _pintarPagina({ docs, lastDoc }, { reset, provisional = false } = {}) {
    {
      if (!provisional) this.cursor = lastDoc;
      // "Mi cartera" filtra en cliente sobre la página traída: con carteras de
      // decenas de clientes es suficiente; el scoping por reglas llega después.
      const visibles = this.cartera === 'mios'
        ? docs.filter(c => c.vendedor_asignado === this.uid)
        : docs;
      const cont = document.getElementById('cgLista');
      cont.querySelector('.cg-empty')?.remove();
      if (reset && !visibles.length && !lastDoc) {
        cont.innerHTML = `<div class="cg-empty">${this.term
          ? 'Ningún cliente coincide con la búsqueda.'
          : (this.cartera === 'mios' ? 'No tienes clientes asignados todavía.' : 'Sin clientes registrados.')}</div>`;
      } else {
        cont.insertAdjacentHTML('beforeend', visibles.map(c => this._filaCliente(c)).join(''));
        // Página sin clientes de la cartera pero con más por traer: se dice,
        // en vez de dejar el directorio en blanco (auditoría UX 2026-09-28).
        if (!cont.querySelector('.cg-row') && lastDoc) {
          cont.innerHTML = `<div class="cg-empty">Todavía no aparecen clientes de tu cartera en lo cargado.
            <div class="cta"><button class="btn btn-ghost cg-act" onclick="Centro.cargarLista(false)">Cargar más</button></div></div>`;
        }
      }
      document.getElementById('btnMas').classList.toggle('hidden', !lastDoc);
      const n = cont.querySelectorAll('.cg-row').length;
      document.getElementById('cgResumen').textContent =
        `${n} cliente${n === 1 ? '' : 's'}${this.soloActivos ? ' activos' : ''}${this.cartera === 'mios' ? ' en tu cartera' : ''}${lastDoc ? ' (hay más)' : ''}`;
      if (window.lucide?.createIcons) lucide.createIcons();
    }
  },

  _iniciales(nombre) {
    return (nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  },

  // Tarjeta del directorio (2026-09-28): el estado de la cuenta a la vista con
  // lo que el doc de cliente YA trae (activo, regularizacion, vendedor). No
  // hay conteo cacheado de contratos/gestiones en el doc: no se pinta ninguno.
  _filaCliente(c) {
    const sub = [c.rucdv_norm ? `RUC ${c.rucdv_norm}` : null, c.telefono || null].filter(Boolean);
    const r = c.regularizacion;
    const nivel = r?.puntos > 0 ? ((window.Regularizacion?.NIVEL_LABEL || {})[r.nivel] || r.nivel || '') : '';
    // Con el filtro de regularización, la fila dice además el nivel de la deuda.
    if (this.filtroReg && nivel) sub.unshift(nivel);
    const inactivo = c.activo === false;
    const vendedor = c.vendedor_email ? c.vendedor_email.split('@')[0] : '';
    const chips = [];
    if (r?.puntos > 0) {
      chips.push(`<span class="cg-chip cg-chip--warn" title="${this.esc(`${nivel ? nivel + ' · ' : ''}${r.puntos} punto${r.puntos === 1 ? '' : 's'} por regularizar`)}">Por regularizar · ${Number(r.puntos)}</span>`);
    }
    if (!c.vendedor_asignado && !c.vendedor_email) chips.push(`<span class="cg-chip cg-chip--warn" title="Nadie la atiende: asígnale un vendedor">Sin vendedor</span>`);
    if (inactivo) chips.push(`<span class="cg-chip cg-chip--muted">Inactivo</span>`);
    const lado = (vendedor ? `<span class="cg-vend" title="Vendedor: ${this.esc(c.vendedor_email)}">${this.esc(vendedor)}</span>` : '') + chips.join('');
    return `<a class="cg-row cg-row--cli${inactivo ? ' cg-tenue' : ''}" href="?id=${encodeURIComponent(c.id)}"
      onclick="event.preventDefault(); Centro.abrir('${this.esc(c.id)}')">
      <div class="cg-av${inactivo ? ' cg-av--off' : ''}">${this.esc(this._iniciales(c.nombre))}</div>
      <div class="cg-main"><div class="n">${this.esc(c.nombre || '(sin nombre)')}</div>
        <div class="s">${this.esc(sub.join(' · ') || '—')}</div></div>
      <div class="cg-side">${lado}</div>
      <span class="arr">›</span></a>`;
  },
});
