// @ts-nocheck
// Centro de gestión de clientes — Inicio (directorio v2, 2026-10-09).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
//
// Pedido de Alberto (2026-10-08): "que sea más navegable y más amigable, mejor
// a la vista, que sea un disfrute estar en esa página". Lo que había: una
// barra con seis controles, la bandeja gris de aprobaciones, y la lista de
// 30 en 30 con "Cargar más" (ocho clics hasta la Z) con el chip "Por
// regularizar" en 165 de 249 cuentas.
//
// Lo que hay ahora, en este orden:
//   1. Buscador protagonista (saludo, fecha, atajo "/"): al teclear salen
//      Clientes · Seriales · Contratos agrupados sin salir de la página.
//   2. Señales con número (por aprobar, sin firmar, por vencer, por
//      regularizar): tocarlas FILTRA la lista; no son el criterio de
//      agrupación (regla de Alberto 2026-08-25: la lista completa es la
//      navegación principal).
//   3. Recientes: las últimas cuentas que esta persona abrió (localStorage).
//   4. Directorio por letra con índice A–Z. El directorio entero se trae UNA
//      vez (caché local primero, servidor después): 249 activas pesan menos
//      que la consulta de regularización que ya se hacía (límite 400), y con
//      todo en memoria la búsqueda es instantánea y tolerante a guiones
//      (auditoría 2026-09-30, R1) y los filtros no cuestan lecturas.
//   5. Una cartera chica (≤ 12) no es una lista vacía: tarjetas con el
//      estado en una frase, "Tu semana" y "Tus cotizaciones".
Object.assign(window.Centro, {
  /* ═════════ Inicio ═════════ */

  esVendedor() { return this.rol === ROLES.VENDEDOR; },

  CARTERA_TARJETAS: 12,   // hasta aquí la cartera se ve en tarjetas; más, lista por letra
  filtro: null,           // 'aprobar' | 'firma' | 'vencen' | 'regularizar' | 'sin_vendedor' | null
  vendedorFiltro: null,   // uid (admin/gerencia/recepción)
  _dir: null,             // { clave, docs, at, provisional }
  _senales: null,         // { firma, reg, vencen, at }
  _vendedores: null,
  _busq: { term: '', idx: -1, items: [], pool: [], contratos: [], seq: 0 },
  _tarjetas: null,        // { clave, datos: Map(clienteId → info), cotizaciones, at }

  setCartera(v) {
    if (this.esVendedor()) return;   // el vendedor no sale de su cartera
    this.cartera = v;
    this.vendedorFiltro = null;
    this.cargarLista(true);
  },

  setSoloActivos(on) {
    this.soloActivos = !!on;
    try { localStorage.setItem('cg_solo_activos', on ? '1' : '0'); } catch (e) { /* sin persistencia */ }
    this.cargarLista(true);
  },

  setFiltro(f) {
    this.filtro = (this.filtro === f || !f) ? null : f;
    this._syncUrl();
    this.pintarInicio();
    if (this.filtro === 'aprobar') setTimeout(() => document.getElementById('cgAprobaciones')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  },
  setVendedorFiltro(uid) {
    this.vendedorFiltro = uid || null;
    this.pintarInicio();
  },
  // Compat: la bandeja de regularización y los correos viejos llaman esto.
  quitarFiltroReg() { this.filtroReg = false; this.setFiltro(null); },
  _syncUrl() {
    const url = new URL(location.href);
    url.searchParams.delete('filtro'); url.searchParams.delete('aprobaciones');
    if (this.filtro === 'regularizar') url.searchParams.set('filtro', 'regularizacion');
    if (this.filtro === 'aprobar' && window.CentroAprobaciones?.filtro) url.searchParams.set('aprobaciones', window.CentroAprobaciones.filtro);
    history.replaceState({}, '', url);
  },

  // ── Carga: el directorio entero + las señales ──
  async cargarLista(reset) {
    // Deep-links que llegan como banderas (correos, bandejas).
    if (this.filtroReg) { this.filtroReg = false; this.filtro = 'regularizar'; }
    await this._cargarDirectorio(reset);
    this.pintarInicio();
    this._cargarSenales();
  },

  async _cargarDirectorio(reset) {
    const soloMias = this.esVendedor() || this.cartera === 'mios';
    const clave = `${soloMias ? 'mios' : 'todos'}:${this.soloActivos ? 'act' : 'todos'}`;
    if (!reset && this._dir && this._dir.clave === clave && !this._dir.provisional && Date.now() - this._dir.at < 60000) return;
    const leer = (source) => soloMias
      ? ClientesService.listClientesPorVendedor(this.uid, { onlyActive: this.soloActivos, source })
      : ClientesService.listClientesTodos({ onlyActive: this.soloActivos, source });
    const orden = (docs) => docs.slice().sort((a, b) => this._dirNorm(a.nombre).localeCompare(this._dirNorm(b.nombre)));
    // Pintado provisional desde la caché local de Firestore: lo que esta
    // persona vio la última vez sale al instante y el servidor corrige encima.
    if (!this._dir || this._dir.clave !== clave) {
      this._dir = null;
      try {
        const enCache = await leer('cache');
        if (enCache.length) { this._dir = { clave, docs: orden(enCache), at: 0, provisional: true }; this.pintarInicio(); }
      } catch { /* sin caché: camino normal */ }
    }
    try {
      const docs = await leer(null);
      this._dir = { clave, docs: orden(docs), at: Date.now() };
    } catch (e) {
      console.error('[centro] directorio:', e);
      if (!this._dir) this._dir = { clave, docs: [], at: Date.now(), error: true };
      Toast.show('No se pudo cargar la lista de clientes', 'bad');
    }
  },

  async _cargarSenales() {
    const uid = this.esVendedor() ? this.uid : null;
    const S = window.SenalesService;
    const [firma, reg, vencen] = await Promise.all([
      S?.listContratosPorFirmar ? S.listContratosPorFirmar({ uid }).catch(e => { console.warn('[centro] firma:', e?.message || e); return []; }) : [],
      S?.listCuentasPorRegularizar ? S.listCuentasPorRegularizar({ uid }).catch(e => { console.warn('[centro] regularizar:', e?.message || e); return []; }) : [],
      S?.listContratosPorVencer ? S.listContratosPorVencer({ dias: 60 }).catch(e => { console.warn('[centro] vencen:', e?.message || e); return []; }) : [],
    ]);
    // La vendedora solo ve lo de SU cartera: la consulta de vencimientos es
    // global (índice estado + fecha), así que se recorta a sus clientes.
    const mios = this.esVendedor() ? new Set((this._dir?.docs || []).map(c => c.id)) : null;
    this._senales = { firma, reg, vencen: mios ? vencen.filter(x => mios.has(x.cliente_id)) : vencen, at: Date.now() };
    this.pintarInicio();
  },
  // ── Recientes (por usuario, en este navegador) ──
  _recientesKey() { return `cg_recientes:${this.uid || 'anon'}`; },
  _recientes() {
    try { const xs = JSON.parse(localStorage.getItem(this._recientesKey()) || '[]'); return Array.isArray(xs) ? xs : []; } catch { return []; }
  },
  _recordarReciente(c) {
    if (!c?.id) return;
    try {
      const xs = this._recientes().filter(x => x.id !== c.id);
      xs.unshift({ id: c.id, nombre: c.nombre || '', at: Date.now() });
      localStorage.setItem(this._recientesKey(), JSON.stringify(xs.slice(0, 8)));
    } catch { /* sin persistencia */ }
  },

  // ── Normalización para buscar y ordenar: la de todo el Centro (_norm) ──
  _dirNorm(s) { return this._norm(s); },
  _dirCompacto(s) { return this._norm(s).replace(/ /g, ''); },
  _coincide(c, words) {
    if (!words.length) return true;
    const hay = this._dirCompacto([c.nombre, c.cuenta_alias, c.ruc, c.rucdv_norm, c.representante, c.email, c.telefono].filter(Boolean).join(' '));
    return words.every(w => hay.includes(w));
  },
  _palabrasBusq() { return this._dirNorm(this.term).split(' ').filter(Boolean).map(w => w.replace(/ /g, '')); },

  // ── Lo que se sabe de cada cuenta en el inicio (del doc + señales) ──
  _infoCliente(c) {
    const S = this._senales || {};
    const r = c.regularizacion;
    const puntos = window.Regularizacion?.puntosCuenta ? Regularizacion.puntosCuenta(r) : Number(r?.puntos || 0);
    const firma = (S.firma || []).filter(x => x.cliente_id === c.id);
    const vencen = (S.vencen || []).filter(x => x.cliente_id === c.id);
    let vence = null;
    for (const x of vencen) { const d = x.fecha_vencimiento?.toDate ? x.fecha_vencimiento.toDate() : null; if (d && (!vence || d < vence)) vence = d; }
    const diasVence = vence ? Math.ceil((vence - Date.now()) / 86400000) : null;
    const inactivo = c.activo === false;
    const sinVendedor = !c.vendedor_asignado && !c.vendedor_email;
    const critica = puntos > 0 && r?.nivel === 'critica';
    // UN chip por fila, el que más pesa. "Al día" en verde suave solo para
    // cuentas con algo registrado; el resto queda sin chip (menos ruido).
    let chip = null;
    if (inactivo) chip = { cls: 'cg-chip--muted', txt: 'Inactiva' };
    // Rojo SOLO para "excede el margen": la escalera de gestiones puntuales
    // (3) o de días (90) ya se agotó y la cuenta sigue sin regularizar. Es
    // lo raro de verdad (0 cuentas el 2026-10-09). Las demás críticas van en
    // ámbar con su CAUSA: 54 de 67 lo son por no tener ningún contrato
    // vigente (casi todas con 1–8 radios), no por el umbral de 20 — subirlo
    // no cambiaba nada (medido con el export del emulador).
    else if (r?.excede_margen) chip = { cls: 'cg-chip--bad', txt: `Excede el margen · ${puntos}`, title: 'Agotó las gestiones puntuales o los días de margen sin regularizar: le toca a gerencia' };
    else if (critica && r?.sin_contrato_vigente) chip = { cls: 'cg-chip--warn', txt: `Sin contrato · ${r.d1 || puntos} radio${(r.d1 || puntos) === 1 ? '' : 's'}`, title: 'Radios en campo y ningún contrato vigente que los ampare: hace falta un contrato nuevo' };
    else if (critica) chip = { cls: 'cg-chip--warn', txt: `Sin regularizar · ${puntos}`, title: 'Cuenta crítica: 20 o más radios en campo sin contrato' };
    else if (firma.length) chip = { cls: 'cg-chip--warn', txt: firma.length === 1 ? 'Firma pendiente' : `${firma.length} firmas pendientes`, title: firma.map(f => `${f.contrato} · ${f.dias} d`).join(' · ') };
    else if (diasVence != null) chip = { cls: 'cg-chip--warn', txt: `Vence en ${diasVence} d`, title: vencen.map(x => x.contrato_id || x.id).join(' · ') };
    else if (puntos > 0) chip = { cls: 'cg-chip--warn', txt: `Por regularizar · ${puntos}`, title: `${(window.Regularizacion?.NIVEL_LABEL || {})[r?.nivel] || ''} ${puntos} punto(s)`.trim() };
    else if (sinVendedor) chip = { cls: 'cg-chip--warn', txt: 'Sin vendedor', title: 'Nadie la atiende: asígnale un vendedor' };
    else if (c.regularizacion) chip = { cls: 'cg-chip--ok', txt: 'Al día' };
    return { puntos, critica, firma, vencen, vence, diasVence, inactivo, sinVendedor, chip, bodega: Number(r?.d7 || 0) };
  },
  _vendedorCorto(c) {
    const u = String(c.vendedor_email || '').split('@')[0];
    if (!u) return { ini: '—', nombre: '' };
    const partes = u.split(/[._-]/).filter(Boolean);
    const nombre = partes[0] ? partes[0][0].toUpperCase() + partes[0].slice(1) : u;
    const ini = partes.slice(0, 2).map(p => p[0].toUpperCase()).join('') || u.slice(0, 2).toUpperCase();
    return { ini, nombre, email: c.vendedor_email };
  },

  // ── Qué cuentas se ven: cartera + vendedor + filtro + búsqueda ──
  _docsFiltrados() {
    let docs = (this._dir?.docs || []);
    if (this.vendedorFiltro) docs = docs.filter(c => c.vendedor_asignado === this.vendedorFiltro);
    const S = this._senales || {};
    const ids = (xs) => new Set((xs || []).map(x => x.cliente_id || x.id));
    if (this.filtro === 'regularizar') {
      const set = ids((S.reg || []).filter(x => !x.pospuesto));
      docs = docs.filter(c => S.reg ? set.has(c.id) : (c.regularizacion?.puntos > 0));
    } else if (this.filtro === 'sin_vendedor') docs = docs.filter(c => !c.vendedor_asignado && !c.vendedor_email);
    else if (this.filtro === 'vencen') { const set = ids(S.vencen); docs = docs.filter(c => set.has(c.id)); }
    else if (this.filtro === 'firma') { const set = ids(S.firma); docs = docs.filter(c => set.has(c.id)); }
    else if (this.filtro === 'aprobar') { const set = new Set((window.CentroAprobaciones?._items || []).map(x => x.cliente_id).filter(Boolean)); docs = docs.filter(c => set.has(c.id)); }
    const words = this._palabrasBusq();
    if (words.length) docs = docs.filter(c => this._coincide(c, words));
    return docs;
  },
  _modoTarjetas() {
    const n = this._dir?.docs?.length || 0;
    return this.esVendedor() && !this.term && !this.filtro && n > 0 && n <= this.CARTERA_TARJETAS;
  },

  // ═════════ Pintado ═════════
  pintarInicio() {
    if (!document.getElementById('vistaLista')) return;
    this._pintarHero();
    this._pintarSenales();
    this._pintarRecientes();
    const docs = this._docsFiltrados();
    this._pintarFiltros(docs);
    if (this._modoTarjetas()) this._pintarTarjetas(docs); else this._pintarLetras(docs);
    const ap = document.getElementById('cgAprobaciones');
    if (ap) ap.classList.toggle('hidden', this.filtro !== 'aprobar' || !window.CentroAprobaciones?.mount);
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  _saludo() {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  },
  _fechaLarga() {
    const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const d = new Date();
    return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  },
  _pintarHero() {
    const sal = document.getElementById('cgSaludo');
    const fecha = document.getElementById('cgFecha');
    const btns = document.getElementById('cgHeroBtns');
    const nombre = String(this.nombreUsuario || this.email || '').split(/[\s@]/)[0];
    if (sal) sal.textContent = `${this._saludo()}${nombre ? `, ${nombre[0].toUpperCase() + nombre.slice(1)}` : ''}`;
    const n = this._dir?.docs?.length || 0;
    const S = this._senales;
    const partes = [this._fechaLarga()];
    if (this._dir) partes.push(this.esVendedor() ? `tu cartera: ${n} cuenta${n === 1 ? '' : 's'}` : `${n} cuenta${n === 1 ? '' : 's'} ${this.soloActivos ? 'activa' : 'registrada'}${n === 1 ? '' : 's'}${this.cartera === 'mios' ? ' en tu cartera' : ''}`);
    const ap = window.CentroAprobaciones?._items?.length || 0;
    if (ap && ['administrador', 'gerente'].includes(this.rol)) partes.push(`${ap} pendiente${ap === 1 ? '' : 's'} por aprobar`);
    else if (S) { const esperan = (S.firma || []).length + (S.vencen || []).length; if (esperan) partes.push(`${esperan} cosa${esperan === 1 ? ' espera' : 's esperan'} algo`); }
    if (fecha) fecha.textContent = partes.join(' · ');
    if (btns && !btns.dataset.listo) {
      btns.dataset.listo = '1';
      btns.innerHTML = this._puedeCrearCliente()
        ? `<a class="btn btn-primary" href="./ficha.html?nuevo=1&from=centro"><i data-lucide="user-plus"></i> Nuevo cliente</a>` : '';
      const dock = document.getElementById('cgDockLista');
      if (dock) dock.innerHTML = this._puedeCrearCliente() ? `<span aria-hidden="true"></span><a class="btn btn-primary" href="./ficha.html?nuevo=1&from=centro"><i data-lucide="user-plus"></i> Nuevo cliente</a>` : '';
    }
  },

  _pintarSenales() {
    const cont = document.getElementById('cgSenales');
    if (!cont) return;
    const S = this._senales;
    const esc = (v) => this.esc(v);
    const T = ({ id, lbl, n, t, s, tono }) => `<button type="button" class="cg-senal ${tono}${this.filtro === id ? ' is-on' : ''}" aria-pressed="${this.filtro === id}"
        onclick="Centro.setFiltro('${id}')"><span class="lbl">${esc(lbl)}</span><span class="v">${n == null ? '…' : n}</span><span class="t">${esc(t)}</span><span class="s">${esc(s)}</span></button>`;
    const tiles = [];
    if (['administrador', 'gerente'].includes(this.rol)) {
      const A = window.CentroAprobaciones;
      const items = A?._items || [];
      const dias = items.length ? Math.max(...items.map(x => x.at ? Math.floor((Date.now() - x.at) / 86400000) : 0)) : 0;
      const nG = items.filter(x => x.tipo === 'gestiones').length, nC = items.length - nG;
      tiles.push(T({ id: 'aprobar', lbl: 'Te toca a ti', n: A && A._cargando && !items.length ? null : items.length, t: 'Pendientes por aprobar', tono: items.length ? 'bad' : 'ok',
        s: items.length ? [nC ? `${nC} contrato${nC === 1 ? '' : 's'}` : '', nG ? `${nG} gestión${nG === 1 ? '' : 'es'}` : '', dias ? `el más viejo lleva ${dias} d` : ''].filter(Boolean).join(' · ') : 'todo al día' }));
    }
    const firma = S?.firma;
    const viejas = (firma || []).filter(x => x.dias > 30).length;
    tiles.push(T({ id: 'firma', lbl: 'Esperando al cliente', n: firma ? firma.length : null, t: 'Contratos sin firmar', tono: firma?.length ? 'warn' : 'ok',
      s: firma?.length ? `enlace enviado${viejas ? ` · ${viejas} lleva${viejas === 1 ? '' : 'n'} más de 30 días` : ''}` : 'ninguno esperando firma' }));
    const vencen = S?.vencen;
    const primero = vencen?.length ? vencen[0] : null;
    const nCli = vencen ? new Set(vencen.map(x => x.cliente_id)).size : null;
    tiles.push(T({ id: 'vencen', lbl: 'Próximos 60 días', n: vencen ? vencen.length : null, t: 'Contratos por vencer', tono: vencen?.length ? 'warn' : 'ok',
      s: primero ? `el primero el ${this._fmtFecha(primero.fecha_vencimiento)}${nCli > 1 ? ` · ${nCli} cuentas` : ''}` : 'nada vence pronto' }));
    const reg = S?.reg ? S.reg.filter(x => !x.pospuesto) : null;
    // El pie dice la CAUSA, no "n críticas": sin contrato vigente (la
    // mayoría), las que exceden el margen (gerencia) y las sin vendedor.
    const regIds = new Set((reg || []).map(x => x.id));
    const docsReg = (this._dir?.docs || []).filter(c => regIds.has(c.id));
    const sinContrato = docsReg.filter(c => c.regularizacion?.sin_contrato_vigente).length;
    const excede = (reg || []).filter(x => x.excede).length, sinV = (reg || []).filter(x => !x.vendedor).length;
    tiles.push(T({ id: 'regularizar', lbl: this.esVendedor() ? 'Tu cartera' : 'Cartera', n: reg ? reg.length : null, t: 'Cuentas por regularizar', tono: excede ? 'bad' : reg?.length ? 'info' : 'ok',
      s: reg?.length ? [sinContrato ? `${sinContrato} sin contrato vigente` : '', excede ? `${excede} excede${excede === 1 ? '' : 'n'} el margen` : '', sinV ? `${sinV} sin vendedor` : ''].filter(Boolean).join(' · ') || 'equipos en campo sin contrato' : 'ninguna con deuda' }));
    cont.innerHTML = tiles.join('');
    cont.style.gridTemplateColumns = `repeat(${tiles.length}, minmax(0,1fr))`;
  },
  // CentroAprobaciones avisa cuando su cola cambia.
  _senalAprobar() { if (!document.getElementById('vistaFicha') || document.getElementById('vistaFicha').classList.contains('hidden')) this.pintarInicio(); },

  _pintarRecientes() {
    const cont = document.getElementById('cgRecientes');
    if (!cont) return;
    const xs = this._recientes().slice(0, 6);
    if (!xs.length) { cont.innerHTML = ''; cont.classList.add('hidden'); return; }
    cont.classList.remove('hidden');
    const docs = new Map((this._dir?.docs || []).map(c => [c.id, c]));
    const hace = (t) => { const m = Math.floor((Date.now() - t) / 60000); if (m < 1) return 'ahora'; if (m < 60) return `hace ${m} min`; const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`; const d = Math.floor(h / 24); return d === 1 ? 'ayer' : `hace ${d} d`; };
    cont.innerHTML = `<div class="cg-sechd"><h2 class="cg-h2">Recientes</h2><span class="sub">las últimas cuentas que abriste</span></div>
      <div class="cg-recgrid">${xs.map(x => {
        const c = docs.get(x.id);
        const info = c ? this._infoCliente(c) : null;
        const est = info?.chip ? info.chip.txt.toLowerCase() : '';
        return `<a class="cg-rec" href="?id=${encodeURIComponent(x.id)}" onclick="event.preventDefault(); Centro.abrir('${this.esc(x.id)}')">
          <span class="av">${this.esc(this._iniciales(x.nombre))}</span>
          <span style="min-width:0;"><span class="n">${this.esc(x.nombre || '(sin nombre)')}</span><span class="s">${this.esc(hace(x.at))}${est ? ` · ${this.esc(est)}` : ''}</span></span></a>`;
      }).join('')}</div>`;
  },

  _pintarFiltros(docs) {
    const cont = document.getElementById('cgFiltros');
    if (!cont) return;
    const esc = (v) => this.esc(v);
    const todos = this._dir?.docs || [];
    const S = this._senales || {};
    const n = (f) => {
      if (f === 'regularizar') return S.reg ? S.reg.filter(x => !x.pospuesto).length : todos.filter(c => c.regularizacion?.puntos > 0).length;
      if (f === 'sin_vendedor') return todos.filter(c => !c.vendedor_asignado && !c.vendedor_email).length;
      if (f === 'vencen') return S.vencen ? new Set(S.vencen.map(x => x.cliente_id)).size : null;
      if (f === 'firma') return S.firma ? new Set(S.firma.map(x => x.cliente_id)).size : null;
      return null;
    };
    // Chips y "Mías" del kit de bandeja (2026-10-09): el mismo chip y el mismo
    // interruptor que Órdenes, Cotizaciones, Facturación y Contratos.
    const chip = (f, label) => { const k = n(f); return `<button type="button" class="bj-filtro${this.filtro === f ? ' active' : ''}" aria-pressed="${this.filtro === f}" onclick="Centro.setFiltro('${f}')">${esc(label)}${k != null ? ` <span class="cnt">${k}</span>` : ''}</button>`; };
    const seg = this.esVendedor() ? '' : `<label class="bj-filtro bj-mias${this.cartera === 'mios' ? ' active' : ''}" for="cgMias" title="Solo mi cartera">
        <input type="checkbox" id="cgMias"${this.cartera === 'mios' ? ' checked' : ''} onchange="Centro.setCartera(this.checked ? 'mios' : 'todos')">Mías</label>`;
    const vend = (!this.esVendedor() && this.cartera === 'todos') ? `<select class="bj-filtro bj-filtro--sel${this.vendedorFiltro ? ' active' : ''}" aria-label="Filtrar por vendedor" onchange="Centro.setVendedorFiltro(this.value)">
        <option value="">Vendedor: todos</option>
        ${(this._vendedores || []).map(u => `<option value="${esc(u.id)}"${this.vendedorFiltro === u.id ? ' selected' : ''}>${esc(u.nombre || u.displayName || String(u.email || '').split('@')[0])}</option>`).join('')}</select>` : '';
    if (!this.esVendedor() && !this._vendedores && window.UsuariosService?.getVendedores) {
      this._vendedores = [];
      UsuariosService.getVendedores().then(xs => { this._vendedores = xs.filter(u => u.activo !== false).sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))); this._pintarFiltros(this._docsFiltrados()); }).catch(() => {});
    }
    const titulo = this.esVendedor() ? 'Tu cartera' : 'Todas las cuentas';
    const resumen = this.term
      ? `${docs.length} coincide${docs.length === 1 ? '' : 'n'} con “${esc(this.term)}”`
      : this.filtro
        ? `${docs.length} cuenta${docs.length === 1 ? '' : 's'} · <a href="#" onclick="event.preventDefault(); Centro.setFiltro(null)">ver todas</a>`
        : `${docs.length} cuenta${docs.length === 1 ? '' : 's'}${this._dir?.provisional ? ' · actualizando…' : ''}`;
    const extra = this.filtro === 'regularizar' && [ROLES.ADMIN, 'admin', ROLES.GERENTE, ROLES.RECEPCION].includes(this.rol)
      ? ` · <a href="./regularizacion.html">bandeja completa ›</a>` : '';
    // Orden canónico de la barra (2026-10-09): chips · Mías · secundarios.
    cont.innerHTML = `<h2 class="cg-h2" style="margin-right:6px;">${titulo}</h2>
      ${chip('regularizar', 'Por regularizar')}${this.esVendedor() ? '' : chip('sin_vendedor', 'Sin vendedor')}${chip('vencen', 'Vencen pronto')}${chip('firma', 'Firma pendiente')}${seg}${vend}
      <label class="cg-switch" style="margin-left:auto;" title="Ocultar clientes marcados como inactivos"><input type="checkbox" ${this.soloActivos ? 'checked' : ''} onchange="Centro.setSoloActivos(this.checked)"><span class="trk" aria-hidden="true"></span> Solo activas</label>
      <span class="cg-resumen" id="cgResumen">${resumen}${extra}</span>`;
  },

  _iniciales(nombre) {
    return (nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  },

  // ── Lista por letra con índice A–Z ──
  _letraDe(c) {
    const l = this._dirNorm(c.nombre)[0] || '#';
    return /[a-z]/.test(l) ? l.toUpperCase() : '#';
  },
  _pintarLetras(docs) {
    const cont = document.getElementById('cgLista');
    const az = document.getElementById('cgAZ');
    if (!cont) return;
    cont.classList.remove('cg-lista--tarjetas');
    if (!this._dir) { cont.innerHTML = '<div class="cg-empty">Cargando el directorio…</div>'; if (az) az.innerHTML = ''; return; }
    if (!docs.length) {
      cont.innerHTML = `<div class="cg-empty">${this.term ? 'Ninguna cuenta coincide con la búsqueda.'
        : this.filtro ? 'Ninguna cuenta con ese filtro.' : this._dir.error ? 'No se pudo cargar el directorio.'
        : this.esVendedor() ? 'No tienes clientes asignados todavía.' : 'Sin clientes registrados.'}
        ${this._dir.error ? `<div class="cta"><button class="btn btn-ghost cg-act" onclick="Centro.cargarLista(true)">Reintentar</button></div>` : ''}</div>`;
      if (az) az.innerHTML = '';
      return;
    }
    const grupos = new Map();
    for (const c of docs) { const l = this._letraDe(c); if (!grupos.has(l)) grupos.set(l, []); grupos.get(l).push(c); }
    const letras = [...grupos.keys()];
    const html = letras.map(l => `
      <div class="cg-letra" id="cgL-${l === '#' ? 'num' : l}"><b>${l}</b><span></span><em>${grupos.get(l).length} cuenta${grupos.get(l).length === 1 ? '' : 's'}</em></div>
      <div class="cg-grupo">${grupos.get(l).map(c => this._filaCliente(c)).join('')}</div>`).join('');
    cont.innerHTML = html;
    if (az) {
      const todas = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#'];
      az.innerHTML = todas.map(l => grupos.has(l)
        ? `<a href="#cgL-${l === '#' ? 'num' : l}" onclick="event.preventDefault(); Centro.irALetra('${l}')">${l}</a>`
        : `<span class="mute">${l}</span>`).join('');
      az.classList.toggle('hidden', letras.length < 4);
    }
  },
  irALetra(l) {
    const el = document.getElementById(`cgL-${l === '#' ? 'num' : l}`);
    if (!el) return;
    // Salto directo, como el índice de contactos del teléfono: con 250 filas
    // el desplazamiento suave tarda y desorienta.
    const y = el.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: y, behavior: 'auto' });
    document.querySelectorAll('#cgAZ a').forEach(a => a.classList.toggle('is-on', a.textContent === l));
  },

  // Fila del directorio: nombre + RUC · alias / representante · vendedor con
  // iniciales · UN chip de estado · flecha. 52 px, sin avatar.
  _filaCliente(c) {
    const esc = (v) => this.esc(v);
    const info = this._infoCliente(c);
    const v = this._vendedorCorto(c);
    const sub = [c.cuenta_alias ? `alias ${c.cuenta_alias}` : '', c.representante || ''].filter(Boolean).join(' · ');
    const chip = info.chip ? `<span class="cg-chip ${info.chip.cls}" title="${esc(info.chip.title || '')}">${esc(info.chip.txt)}</span>` : '';
    const bodega = info.bodega ? `<span class="cg-chip cg-chip--muted" title="${info.bodega} radio(s) por clasificar: los revisa bodega, no cuentan como deuda de la cuenta">Bodega · ${info.bodega}</span>` : '';
    return `<a class="cg-fila${info.inactivo ? ' off' : ''}" href="?id=${encodeURIComponent(c.id)}" onclick="event.preventDefault(); Centro.abrir('${esc(c.id)}')">
      <span style="min-width:0;"><span class="n">${esc(c.nombre || '(sin nombre)')}</span><span class="r">${esc(this._rucLegible(c) || '—')}</span></span>
      <span class="r">${esc(sub)}</span>
      <span class="v" title="${esc(v.email || 'Sin vendedor asignado')}"><i${v.nombre ? '' : ' class="off"'}>${esc(v.ini)}</i>${esc(v.nombre || 'Sin vendedor')}</span>
      <span class="chips">${chip}${bodega}</span>
      <span class="arr">›</span></a>`;
  },

  // ── Cartera chica: tarjetas + "Tu semana" + "Tus cotizaciones" ──
  _pintarTarjetas(docs) {
    const cont = document.getElementById('cgLista');
    const az = document.getElementById('cgAZ');
    if (!cont) return;
    if (az) { az.innerHTML = ''; az.classList.add('hidden'); }
    cont.classList.add('cg-lista--tarjetas');
    const esc = (v) => this.esc(v);
    const clave = docs.map(c => c.id).join(',');
    if (!this._tarjetas || this._tarjetas.clave !== clave || Date.now() - this._tarjetas.at > 120000) this._cargarTarjetas(docs, clave);
    const D = this._tarjetas?.clave === clave ? this._tarjetas.datos : null;
    const tarjeta = (c) => {
      const info = this._infoCliente(c);
      const d = D?.get(c.id);
      const id = esc(c.id);
      let est;
      if (!d) est = `<p class="est info"><span class="cg-skel" style="height:14px; width:70%;"></span></p>`;
      else {
        const partes = [];
        if (d.firma.length) partes.push(`${d.firma.length === 1 ? 'un contrato espera' : `${d.firma.length} contratos esperan`} la firma del cliente`);
        if (d.vence && d.diasVence <= 60) partes.push(`${d.vencenN === 1 ? 'un contrato vence' : `${d.vencenN} contratos vencen`} en ${d.diasVence} día${d.diasVence === 1 ? '' : 's'}`);
        if (info.puntos > 0) partes.push(`${info.puntos} punto${info.puntos === 1 ? '' : 's'} por regularizar`);
        if (d.demo) partes.push(`un demo en curso${d.demoFin ? ` hasta el ${this._fmtFecha(d.demoFin)}` : ''}`);
        if (partes.length) est = `<p class="est ${info.critica || (d.vence && d.diasVence <= 15) ? 'bad' : 'warn'}"><i data-lucide="alert-circle"></i><span><b>Pide atención:</b> ${esc(partes.join(' · '))}.</span></p>`;
        else if (!d.vigentes.length) est = `<p class="est info"><i data-lucide="info"></i><span><b>Cuenta nueva.</b> Sin contratos todavía: el primer paso es un contrato nuevo o un demo.</span></p>`;
        else est = `<p class="est ok"><i data-lucide="check-circle-2"></i><span><b>Al día.</b> Nada espera una acción${d.vence ? `; el contrato se renueva el ${this._fmtFecha(d.vence)}` : ''}.</span></p>`;
      }
      const nums = d ? `<div class="nums"><span><b>${d.vigentes.length}</b> contrato${d.vigentes.length === 1 ? '' : 's'}</span>${d.unidades ? `<span><b>${d.unidades}</b> radio${d.unidades === 1 ? '' : 's'} en contrato</span>` : ''}${d.vence ? `<span>vence <b>${esc(this._fmtFecha(d.vence))}</b></span>` : ''}</div>` : '';
      const sug = d && !d.vigentes.length && !d.demo ? `<a class="btn btn-sm btn-primary" href="?id=${id}&accion=contrato" onclick="event.preventDefault(); Centro.abrir('${id}', {accion:'contrato'})">Nuevo contrato</a>`
        : d && d.firma.length ? `<a class="btn btn-sm btn-primary" href="?id=${id}&contrato=${esc(d.firma[0].id)}" onclick="event.preventDefault(); Centro.cSel='${esc(d.firma[0].id)}'; Centro.abrir('${id}')">Ver contrato por firmar</a>`
        : d && d.vence && d.diasVence <= 60 ? `<a class="btn btn-sm btn-primary" href="?id=${id}&accion=renovar" onclick="event.preventDefault(); Centro.abrir('${id}', {accion:'renovar'})">Renovar cuenta</a>` : '';
      return `<article class="cg-tarjeta">
        <div style="display:flex; gap:12px; align-items:center;">
          <span class="av">${esc(this._iniciales(c.nombre))}</span>
          <div style="min-width:0;"><a class="n" href="?id=${id}" onclick="event.preventDefault(); Centro.abrir('${id}')">${esc(c.nombre || '(sin nombre)')}</a>
            <div class="r">${esc([this._rucLegible(c), c.cuenta_alias ? `alias ${c.cuenta_alias}` : ''].filter(Boolean).join(' · ') || '—')}</div></div>
        </div>
        ${est}${nums}
        <div class="acts">
          ${sug}
          ${this._puedeCotizar() ? `<a class="btn btn-sm" href="../cotizaciones/nueva-cotizacion.html?cliente_id=${id}&from=centro">Cotizar</a>` : ''}
          <a class="btn btn-sm" href="?id=${id}&accion=menu" onclick="event.preventDefault(); Centro.abrir('${id}', {accion:'menu'})">Nueva gestión</a>
          <a class="btn btn-sm btn-ghost" style="margin-left:auto;" href="?id=${id}" onclick="event.preventDefault(); Centro.abrir('${id}')">Abrir ficha ›</a>
        </div></article>`;
    };
    // Lo que más urge primero: firma, vencimiento, deuda; al día al final.
    const peso = (c) => { const d = D?.get(c.id); const i = this._infoCliente(c); return (d?.firma?.length ? 0 : 3) + (d?.vence && d.diasVence <= 60 ? 0 : 2) + (i.puntos > 0 ? 0 : 1); };
    const orden = docs.slice().sort((a, b) => peso(a) - peso(b) || this._dirNorm(a.nombre).localeCompare(this._dirNorm(b.nombre)));
    const nuevo = this._puedeCrearCliente() ? `<a class="cg-tarjeta cg-tarjeta--nueva" href="./ficha.html?nuevo=1&from=centro"><i data-lucide="plus"></i>Dar de alta un cliente nuevo<span>nace en tu cartera</span></a>` : '';
    cont.innerHTML = `<div class="cg-tarjetas"><div class="cg-tarjetas-grid">${orden.map(tarjeta).join('')}${nuevo}</div>${this._semanaHtml(docs, D)}</div>`;
  },
  async _cargarTarjetas(docs, clave) {
    this._tarjetas = { clave, datos: null, cotizaciones: null, at: Date.now() };
    const datos = new Map();
    await Promise.all(docs.map(async (c) => {
      try {
        const cs = await ContratosService.listContratosPorCliente(c.id);
        const lleva = (x) => (window.ContratoFirma ? ContratoFirma.lleva(x) : !['REEMP', 'DEMO'].includes(this._codigoTipo(x)));
        const vigentes = cs.filter(x => x.estado === 'activo');
        const firma = cs.filter(x => x.estado === 'aprobado' && !x.firmado && lleva(x) && !x.dormido && x.seriales_estado === 'asignados');
        let vence = null, vencenN = 0;
        for (const x of vigentes) {
          if (!this._aplicaVenc(x) || !x.fecha_vencimiento) continue;
          const d = x.fecha_vencimiento.toDate ? x.fecha_vencimiento.toDate() : new Date(x.fecha_vencimiento);
          if (isNaN(d) || d < new Date()) continue;
          if (!vence || d < vence) vence = d;
          if ((d - Date.now()) / 86400000 <= 60) vencenN++;
        }
        const demoC = vigentes.find(x => ['DEMO', 'TEMP'].includes(this._codigoTipo(x)));
        const demoFin = demoC?.fecha_vencimiento?.toDate ? demoC.fecha_vencimiento.toDate() : null;
        const unidades = vigentes.filter(x => this._aplicaVenc(x)).reduce((s, x) => s + this._unidadesActivas(x), 0);
        datos.set(c.id, { vigentes, firma, vence, diasVence: vence ? Math.ceil((vence - Date.now()) / 86400000) : null, vencenN, demo: !!demoC, demoFin, unidades });
      } catch (e) { console.warn('[centro] tarjeta', c.id, e?.message || e); }
    }));
    let cotizaciones = null;
    try {
      if (window.CotizacionesService?.listCotizaciones) {
        const r = await CotizacionesService.listCotizaciones({ creadoPorUid: this.uid, limit: 8 });
        cotizaciones = (r?.docs || r || []).filter(q => !q.deleted && !['facturada', 'descartada', 'rechazada', 'vencida', 'cerrada'].includes(String(q.estado || '').toLowerCase())).slice(0, 4);
      }
    } catch (e) { console.warn('[centro] cotizaciones:', e?.message || e); }
    if (this._tarjetas?.clave !== clave) return;
    this._tarjetas = { clave, datos, cotizaciones, at: Date.now() };
    if (this._modoTarjetas()) { this._pintarTarjetas(this._docsFiltrados()); if (window.lucide?.createIcons) lucide.createIcons(); }
  },
  _semanaHtml(docs, D) {
    const esc = (v) => this.esc(v);
    const filas = [];
    if (D) {
      for (const c of docs) {
        const d = D.get(c.id); if (!d) continue;
        for (const f of d.firma) filas.push({ peso: 0, dot: '#E0A93A', t: 'Firma del cliente pendiente', s: `${c.nombre} · ${f.contrato_id || f.id}`, cta: `<a class="btn btn-sm" href="?id=${esc(c.id)}" onclick="event.preventDefault(); Centro.cSel='${esc(f.id)}'; Centro.abrir('${esc(c.id)}')">Ver</a>` });
        if (d.vence && d.diasVence <= 60) filas.push({ peso: 1, dot: '#E0A93A', t: `Renovación en ${d.diasVence} día${d.diasVence === 1 ? '' : 's'}`, s: `${c.nombre} · ${d.unidades} radio${d.unidades === 1 ? '' : 's'}`, cta: `<a class="btn btn-sm" href="?id=${esc(c.id)}" onclick="event.preventDefault(); Centro.abrir('${esc(c.id)}', {accion:'renovar'})">Renovar</a>` });
        if (d.demo) filas.push({ peso: 2, dot: '#66BCE7', t: d.demoFin ? `Demo termina el ${this._fmtFecha(d.demoFin)}` : 'Demo en curso', s: `${c.nombre} · ¿contrato o devolución?`, cta: `<a class="btn btn-sm btn-ghost" href="?id=${esc(c.id)}" onclick="event.preventDefault(); Centro.abrir('${esc(c.id)}')">Ver</a>` });
      }
    }
    filas.sort((a, b) => a.peso - b.peso);
    const semana = `<section class="cg-card"><div class="cg-cardhd"><h2 class="cg-h2">Tu semana</h2>${filas.length ? `<span class="cg-chip cg-chip--warn">${filas.length}</span>` : ''}</div>
      ${!D ? `<div class="cg-vacio">Revisando tu cartera…</div>` : filas.length ? filas.map(f => `<div class="cg-sem"><span class="dot" style="background:${f.dot};"></span><span><span class="t">${esc(f.t)}</span><span class="s">${esc(f.s)}</span></span>${f.cta}</div>`).join('')
        : `<div class="cg-vacio" style="color:var(--cg-ok-deep, #17714B);">Nada espera algo esta semana.</div>`}</section>`;
    const cots = this._tarjetas?.cotizaciones;
    const cotHtml = cots === null || cots === undefined ? '' : `<section class="cg-card" style="padding-bottom:12px;"><div class="cg-cardhd"><h2 class="cg-h2">Tus cotizaciones</h2><a class="mas" href="../cotizaciones/index.html">Todas ›</a></div>
      ${cots.length ? cots.map(q => `<div style="padding:6px 16px; font-size:13.5px; line-height:1.45;"><a class="cg-mono" href="../cotizaciones/index.html?buscar=${encodeURIComponent(q.numero || q.id)}">${esc(q.numero || q.id)}</a> · ${esc(q.cliente_nombre || q.clienteNombre || '')} <span style="color:var(--fg-3);">· ${esc(String(q.estado || '').replace(/_/g, ' '))}</span></div>`).join('')
        : `<div class="cg-vacio">Sin cotizaciones abiertas.</div>`}</section>`;
    return `<aside class="cg-semana">${semana}${cotHtml}</aside>`;
  },

  // ═════════ Buscador: Clientes · Seriales · Contratos ═════════
  _wireInicio() {
    const inp = document.getElementById('cgBuscar');
    if (!inp) return;
    inp.addEventListener('input', () => {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => { this.term = inp.value.trim(); this.pintarInicio(); this._buscarRemoto(); this._pintarBusqueda(); }, 180);
    });
    inp.addEventListener('keydown', (e) => {
      const B = this._busq;
      if (e.key === 'Escape') { inp.value = ''; this.term = ''; this._cerrarBusqueda(); this.pintarInicio(); inp.blur(); return; }
      if (!B.items.length) { if (e.key === 'Enter' && this.term) { const d = this._docsFiltrados(); if (d.length === 1) this.abrir(d[0].id); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); B.idx = (B.idx + 1) % B.items.length; this._pintarBusqueda(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); B.idx = (B.idx - 1 + B.items.length) % B.items.length; this._pintarBusqueda(); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = B.items[Math.max(0, B.idx)]; if (it) this._abrirResultado(it); }
    });
    inp.addEventListener('focus', () => { if (this.term.length >= 2) this._pintarBusqueda(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.cg-busq')) this._cerrarBusqueda(); });
    // "/" enfoca el buscador desde cualquier parte del inicio (no dentro de un campo).
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.getElementById('vistaLista')?.classList.contains('hidden')) return;
      e.preventDefault(); inp.focus(); inp.select();
    });
  },
  _cerrarBusqueda() {
    const res = document.getElementById('cgBusqRes');
    if (res) { res.classList.add('hidden'); res.innerHTML = ''; }
    this._busq.items = []; this._busq.idx = -1;
    document.querySelector('.cg-busq')?.classList.remove('is-abierta');
  },
  // Seriales y contratos viven en otras colecciones: una consulta corta
  // cada una, solo cuando el término lo amerita (un serial lleva dígito).
  async _buscarRemoto() {
    const term = this.term;
    const seq = ++this._busq.seq;
    this._busq.pool = []; this._busq.contratos = [];
    if (term.length < 3) return;
    const norm = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const tareas = [];
    // Un serial lleva dígito; con ≥ 4 caracteres el prefijo ya acota (mismo
    // método que Almacén · Avanzado y el palette).
    if (norm.length >= 4 && /\d/.test(norm) && window.EquiposPoolService?.buscarPorPrefijoSerial) {
      tareas.push(EquiposPoolService.buscarPorPrefijoSerial(norm, { limite: 6 })
        .then(xs => { if (seq === this._busq.seq) this._busq.pool = xs; })
        .catch(e => console.warn('[centro] buscar seriales:', e?.message || e)));
    }
    // Contratos por token (prefijo del nombre del cliente o el número completo).
    if (window.ContratosService?.searchByToken) {
      tareas.push(ContratosService.searchByToken(term, { limit: 6 })
        .then(xs => { if (seq === this._busq.seq) this._busq.contratos = xs.filter(c => !c.deleted); })
        .catch(e => console.warn('[centro] buscar contratos:', e?.message || e)));
    }
    if (!tareas.length) return;
    await Promise.all(tareas);
    if (seq === this._busq.seq) this._pintarBusqueda();
  },
  _pintarBusqueda() {
    const res = document.getElementById('cgBusqRes');
    const inp = document.getElementById('cgBuscar');
    if (!res || !inp) return;
    if (this.term.length < 2) { this._cerrarBusqueda(); return; }
    const esc = (v) => this.esc(v);
    const B = this._busq;
    const words = this._palabrasBusq();
    const marcar = (txt) => {
      const t = String(txt || '');
      const w = this.term.trim();
      if (!w) return esc(t);
      const i = this._dirNorm(t).indexOf(this._dirNorm(w));
      if (i < 0) return esc(t);
      // Marcar sobre el texto original aproximando la posición por el normalizado.
      return esc(t.slice(0, i)) + `<mark>${esc(t.slice(i, i + w.length))}</mark>` + esc(t.slice(i + w.length));
    };
    const clientes = this._docsFiltrados().slice(0, 6);
    const items = [];
    const estado = (c) => { const i = this._infoCliente(c); return i.chip ? i.chip.txt.toLowerCase() : ''; };
    for (const c of clientes) items.push({ tipo: 'cliente', id: c.id, html: `<span class="box">${esc(this._iniciales(c.nombre))}</span><span><span class="t">${marcar(c.nombre)}</span><span class="s">${esc([this._rucLegible(c), this._vendedorCorto(c).nombre, estado(c)].filter(Boolean).join(' · '))}</span></span><span class="k">Abrir ficha</span>` });
    const L = (window.EquiposPoolService?.ESTADO_LABELS) || {};
    for (const u of B.pool) {
      const cid = u.asignacion?.cliente_id || null;
      const serial = u.serial || u.serial_norm || u.id;
      items.push({ tipo: 'serial', id: u.id, serial, clienteId: cid, html: `<span class="box"><i data-lucide="radio"></i></span><span><span class="t cg-mono">${marcar(serial)}</span><span class="s">${esc([u.modelo_label, L[u.estado] || u.estado, u.asignacion?.cliente_nombre].filter(Boolean).join(' · '))}</span></span><span class="k">${cid ? 'Ver en Equipos' : 'Ver en Almacén'}</span>` });
    }
    for (const c of B.contratos) {
      items.push({ tipo: 'contrato', id: c.id, clienteId: c.cliente_id || null, html: `<span class="box"><i data-lucide="file-text"></i></span><span><span class="t cg-mono">${marcar(c.contrato_id || c.id)}</span><span class="s">${esc([c.cliente_nombre, this._estadoLabel(c)].filter(Boolean).join(' · '))}</span></span><span class="k">${c.cliente_id ? 'Abrir en la ficha' : 'Abrir contrato'}</span>` });
    }
    B.items = items;
    if (B.idx >= items.length) B.idx = items.length ? 0 : -1;
    if (B.idx < 0 && items.length) B.idx = 0;
    const grupo = (titulo, nota, xs) => xs.length ? `<div class="grp"><h3>${titulo}</h3><span class="n">${esc(nota)}</span></div>${xs.map(it => {
      const i = items.indexOf(it);
      return `<a class="cg-res${i === B.idx ? ' on' : ''}" href="#" onmousedown="event.preventDefault()" onclick="event.preventDefault(); Centro._abrirResultado(Centro._busq.items[${i}])" onmouseenter="Centro._busq.idx=${i}">${it.html}</a>`;
    }).join('')}` : '';
    const total = this._docsFiltrados().length;
    res.innerHTML = `
      ${grupo('Clientes', `${total === 0 ? 'ninguno' : `${Math.min(6, total)} de ${total}`} · con guiones o sin ellos da igual`, items.filter(x => x.tipo === 'cliente'))}
      ${grupo('Seriales', 'abre la ficha en Equipos con la fila marcada', items.filter(x => x.tipo === 'serial'))}
      ${grupo('Contratos', '', items.filter(x => x.tipo === 'contrato'))}
      ${!items.length ? `<div class="cg-vacio">Nada coincide con “${esc(this.term)}”${this.term.length < 4 || !/\d/.test(this.term) ? '' : ' · los seriales se buscan por su inicio'}.</div>` : ''}
      <div class="pie"><span>${items.length} resultado${items.length === 1 ? '' : 's'} para <b>“${esc(this.term)}”</b></span><span style="margin-left:auto;"><kbd>↑↓</kbd> moverse · <kbd>↵</kbd> abrir · <kbd>esc</kbd> cerrar</span></div>`;
    res.classList.remove('hidden');
    document.querySelector('.cg-busq')?.classList.add('is-abierta');
    if (window.lucide?.createIcons) { try { lucide.createIcons({ root: res }); } catch (_) { lucide.createIcons(); } }
  },
  _abrirResultado(it) {
    if (!it) return;
    this._cerrarBusqueda();
    // El término no se queda pegado: al volver del cliente el directorio
    // sale completo, no filtrado por lo que se tecleó para llegar.
    const inp = document.getElementById('cgBuscar');
    if (inp) inp.value = '';
    this.term = '';
    if (it.tipo === 'cliente') { this.abrir(it.id); return; }
    if (it.tipo === 'serial') {
      if (it.clienteId) { this.abrir(it.clienteId, { serial: it.serial }); return; }
      location.href = `../almacen/index.html?tab=existencias&serial=${encodeURIComponent(it.serial)}`;
      return;
    }
    if (it.tipo === 'contrato') {
      if (it.clienteId) { this.cSel = it.id; this.abrir(it.clienteId); return; }
      location.href = `../contratos/index.html?buscar=${encodeURIComponent(it.id)}`;
    }
  },
});
