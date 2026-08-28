// @ts-nocheck
// Centro de gestión de clientes (Ola 1, gestiones por cliente).
// La vista 360 del cliente para el vendedor: directorio con búsqueda como
// navegación principal (decisión 2026-08-25: el vendedor llega a INICIAR una
// gestión, con o sin pendientes — las señales son ayuda secundaria), y ficha
// con contratos, flota (equipos_pool por cliente), gestiones y señales.
// Los wizards de reemplazo/demo llegan con la Ola 2; mientras tanto el menú
// "Nueva gestión" enlaza los flujos existentes con el cliente a la mano.
window.Centro = {
  rol: null,
  uid: null,
  cartera: 'todos',        // 'mios' | 'todos'
  soloActivos: true,       // toggle "solo clientes activos" (persistido)
  term: '',
  cursor: null,
  cliente: null,           // doc del cliente abierto (ficha)
  equipos: [],             // flota cargada de la ficha
  contratos: [],
  _debounce: null,

  AVISO_DIAS: 60,          // espejo de functions/src/lib/vigencia.js (señal, no cálculo)

  esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return (window.location.href = '../login.html');
      try {
        const u = await UsuariosService.getUsuario(user.uid);
        this.rol = u ? u.rol : null;
        this.uid = user.uid;
        // inventario entra para ASIGNAR seriales a las gestiones (llega por el
        // correo de bodega con deep-link ?id=&g=); no crea gestiones.
        const permitido = [ROLES.ADMIN, ROLES.GERENTE, ROLES.VENDEDOR, ROLES.RECEPCION, ROLES.INVENTARIO];
        if (!u || !permitido.includes(this.rol)) {
          document.body.innerHTML = "<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>";
          return;
        }
        // REGLA (Alberto 2026-08-26): el vendedor SOLO ve su propia cartera.
        // No es un default — es un candado: sin toggle, lista filtrada y ficha
        // bloqueada para clientes ajenos. (El piso en firestore.rules llega con
        // el scoping de la Ola 2; hoy clientes es legible por toda la app.)
        this.cartera = this.esVendedor() ? 'mios' : 'todos';
        if (this.esVendedor()) {
          document.querySelector('.seg')?.classList.add('hidden');
        }
        // Toggle "solo activos": encendido por defecto, preferencia persistida.
        this.soloActivos = localStorage.getItem('cg_solo_activos') !== '0';
        const chk = document.getElementById('cgSoloActivos');
        if (chk) chk.checked = this.soloActivos;
        this._wire();
        const params = new URLSearchParams(location.search);
        const id = params.get('id');
        this.gSel = params.get('g') || null;   // deep-link al expediente (correos)
        if (id) await this.abrir(id, { push: false });
        else await this.cargarLista(true);
        this.cargarParaHoy();                  // franja de alertas del directorio
      } catch (e) { console.error(e); Toast.show('Error al iniciar', 'bad'); }
    });
    window.addEventListener('popstate', () => {
      const id = new URLSearchParams(location.search).get('id');
      if (id) this.abrir(id, { push: false });
      else this.volver({ push: false });
    });
  },

  _wire() {
    document.getElementById('cgBuscar')?.addEventListener('input', (e) => {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => { this.term = e.target.value.trim(); this.cargarLista(true); }, 250);
    });
    document.getElementById('btnMas')?.addEventListener('click', () => this.cargarLista(false));
    document.getElementById('fEqFiltro')?.addEventListener('input', () => this.pintarEquipos());
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('cgMenu');
      if (menu && !menu.classList.contains('hidden') && !e.target.closest('.cg-acts')) menu.classList.add('hidden');
    });
  },

  /* ═════════ Directorio ═════════ */

  esVendedor() { return this.rol === ROLES.VENDEDOR; },

  // Franja "Para hoy" del directorio (pedido 2026-08-26: el admin debe ver las
  // alertas en el home del Centro, no solo nombres). Contratos por vencer /
  // vencidos + gestiones abiertas; el vendedor solo ve los de SU cartera.
  // La lista de clientes sigue siendo la navegación principal — esto es la
  // capa secundaria de señales, como se decidió el 2026-08-25.
  async cargarParaHoy() {
    const cont = document.getElementById('cgParaHoy');
    if (!cont) return;
    try {
      const db = firebase.firestore();
      let misClientes = null;
      if (this.esVendedor()) {
        const s = await db.collection('clientes').where('vendedor_asignado', '==', this.uid).get();
        misClientes = new Set(s.docs.map(d => d.id));
      }
      const [venc, gest] = await Promise.all([
        db.collection('contratos').where('vencimiento_estado', 'in', ['vencido', 'por_vencer']).limit(300).get(),
        db.collection('gestiones').limit(150).get().catch(() => ({ docs: [] })),
      ]);

      // Regla 2026-08-27: cuentas con equipos SIN contrato formal ⇒ requieren
      // renovación/regularización. Se agrupa la custodia por cliente con caché
      // de sesión (10 min) para no barrer el pool en cada apertura.
      let custodia = null;
      try {
        const CK = 'cg_custodia_v1';
        const raw = sessionStorage.getItem(CK);
        if (raw) { const o = JSON.parse(raw); if (Date.now() - o.t < 10 * 60 * 1000) custodia = new Map(o.d); }
        if (!custodia) {
          const ps = await db.collection('equipos_pool').where('estado', '==', 'en_cliente').get();
          custodia = new Map();
          ps.forEach(d => {
            const u = d.data();
            const cid = u.asignacion?.cliente_id;
            if (!cid || u.asignacion?.contrato_doc_id) return;
            const cur = custodia.get(cid) || { n: 0, nombre: '' };
            cur.n++;
            if (!cur.nombre && u.asignacion?.cliente_nombre) cur.nombre = u.asignacion.cliente_nombre;
            custodia.set(cid, cur);
          });
          sessionStorage.setItem(CK, JSON.stringify({ t: Date.now(), d: [...custodia.entries()] }));
        }
      } catch (e) { custodia = new Map(); }
      const mapa = new Map();
      venc.docs.forEach(d => mapa.set(d.id, { id: d.id, ...d.data() }));

      const items = [];
      for (const c of mapa.values()) {
        if (c.deleted || !this._esVigente(c) || !this._aplicaVenc(c)) continue;
        if (misClientes && !misClientes.has(c.cliente_id)) continue;
        // Renovación REAL amarrada → sin señal (un REEMP como renovador no cuenta).
        let renovado = false;
        for (const rid of (c.renovado_por_ids || []).slice(0, 3)) {
          let r = mapa.get(rid);
          if (!r) { try { const s = await db.collection('contratos').doc(rid).get(); r = s.exists ? s.data() : null; } catch (e) { /* señal se queda */ } }
          if (r && this._esVigente(r) && this._codigoTipo(r) !== 'REEMP') { renovado = true; break; }
        }
        if (renovado) continue;
        const dias = this._diasA(c.fecha_vencimiento);
        if (dias === null) continue;
        items.push({
          tipo: dias < 0 ? 'bad' : 'warn', dias, cliente_id: c.cliente_id,
          txt: `${c.cliente_nombre || '—'} — ${c.contrato_id || c.id} ${dias < 0 ? `venció hace ${-dias} día${-dias === 1 ? '' : 's'}` : `vence en ${dias} día${dias === 1 ? '' : 's'}`}`,
        });
      }
      // Cuentas con custodia (equipos sin contrato) — entre los vencimientos
      // y las gestiones; a más equipos sueltos, más arriba.
      for (const [cid, info] of custodia) {
        if (misClientes && !misClientes.has(cid)) continue;
        items.push({
          tipo: 'warn', dias: 1000 + Math.max(0, 900 - info.n), cliente_id: cid,
          txt: `${info.nombre || '—'} — ${info.n} equipo(s) sin contrato formal: requiere renovación / regularización`,
        });
      }

      gest.docs.forEach(d => {
        const g = d.data();
        if (!GestionesService.ABIERTAS.includes(g.estado)) return;
        if (misClientes && !misClientes.has(g.cliente_id)) return;
        items.push({
          tipo: 'info', dias: 99999, cliente_id: g.cliente_id, g: d.id,
          txt: `${g.cliente_nombre || '—'} — ${GestionesService.tipoLabel(g.tipo)} ${d.id}: ${GestionesService.estadoLabel(g.estado)}`,
        });
      });
      items.sort((a, b) => a.dias - b.dias);
      if (!items.length) { cont.innerHTML = ''; return; }

      // Colapsable (pedido 2026-08-26); la preferencia sobrevive en localStorage.
      const MAX = 12;
      const colapsado = localStorage.getItem('cg_hoy_colapsado') === '1';
      cont.innerHTML = `<div class="ds-card" style="padding:0; margin-bottom:var(--sp-4); overflow:hidden;">
        <button type="button" onclick="Centro.toggleParaHoy()"
          style="width:100%; text-align:left; background:none; border:0; cursor:pointer; padding:10px 16px ${colapsado ? '10px' : '6px'};
                 font-size:11px; letter-spacing:.09em; text-transform:uppercase; font-weight:700; color:#8A6415;
                 display:flex; align-items:center; gap:7px;">
          <i data-lucide="alert-triangle" style="width:14px;height:14px;"></i> Para hoy · ${items.length}
          <span id="cgHoyCaret" style="margin-left:auto; color:var(--fg-4); font-size:14px;">${colapsado ? '▸' : '▾'}</span>
        </button>
        <div id="cgHoyBody" class="${colapsado ? 'hidden' : ''}">
        ${items.slice(0, MAX).map(i => `<button type="button" class="cg-hoy ${i.tipo}"
            onclick="${i.g ? `Centro.gSel='${this.esc(i.g)}';` : ''}Centro.abrir('${this.esc(i.cliente_id)}')">
            <span>${this.esc(i.txt)}</span><span style="margin-left:auto; color:var(--fg-4); font-weight:600;">›</span>
          </button>`).join('')}
        ${items.length > MAX ? `<div style="padding:6px 16px 10px; font-size:12px; color:var(--fg-4);">…y ${items.length - MAX} más</div>` : ''}
        </div>
      </div>`;
      if (window.lucide?.createIcons) lucide.createIcons();
    } catch (e) {
      console.warn('[centro] franja para-hoy no disponible:', e?.message || e);
      cont.innerHTML = '';
    }
  },

  toggleParaHoy() {
    const body = document.getElementById('cgHoyBody');
    const caret = document.getElementById('cgHoyCaret');
    if (!body) return;
    const colapsar = !body.classList.contains('hidden');
    body.classList.toggle('hidden', colapsar);
    if (caret) caret.textContent = colapsar ? '▸' : '▾';
    try { localStorage.setItem('cg_hoy_colapsado', colapsar ? '1' : '0'); } catch (e) { /* sin persistencia */ }
  },

  setCartera(v) {
    if (this.esVendedor()) return;   // el vendedor no sale de su cartera
    this.cartera = v;
    this.cargarLista(true);
  },

  setSoloActivos(on) {
    this.soloActivos = !!on;
    try { localStorage.setItem('cg_solo_activos', on ? '1' : '0'); } catch (e) { /* sin persistencia */ }
    this.cargarLista(true);
  },

  async cargarLista(reset) {
    if (reset) { this.cursor = null; document.getElementById('cgLista').innerHTML = ''; }
    document.getElementById('segMios').classList.toggle('is-on', this.cartera === 'mios');
    document.getElementById('segTodos').classList.toggle('is-on', this.cartera === 'todos');
    try {
      // "Solo activos" filtra EN EL SERVIDOR con la misma semántica del módulo
      // de clientes (where activo == true): antes se filtraba en cliente con
      // `activo !== false`, así que los docs SIN el campo pasaban como activos
      // y la página traída encogía al filtrar (bug reportado 2026-08-28).
      const { docs, lastDoc } = await ClientesService.listClientesPage({
        term: this.term, cursorDoc: this.cursor, limit: 30,
        onlyActive: this.soloActivos,
      });
      this.cursor = lastDoc;
      // "Mi cartera" filtra en cliente sobre la página traída: con carteras de
      // decenas de clientes es suficiente; el scoping por reglas llega después.
      const visibles = this.cartera === 'mios'
        ? docs.filter(c => c.vendedor_asignado === this.uid)
        : docs;
      const cont = document.getElementById('cgLista');
      if (reset && !visibles.length && !lastDoc) {
        cont.innerHTML = `<div class="cg-empty">${this.term
          ? 'Ningún cliente coincide con la búsqueda.'
          : (this.cartera === 'mios' ? 'No tienes clientes asignados todavía.' : 'Sin clientes registrados.')}</div>`;
      } else {
        cont.insertAdjacentHTML('beforeend', visibles.map(c => this._filaCliente(c)).join(''));
      }
      document.getElementById('btnMas').classList.toggle('hidden', !lastDoc);
      const n = cont.querySelectorAll('.cg-row').length;
      document.getElementById('cgResumen').textContent =
        `${n} cliente${n === 1 ? '' : 's'}${this.soloActivos ? ' activos' : ''}${this.cartera === 'mios' ? ' en tu cartera' : ''}${lastDoc ? ' (hay más)' : ''}`;
      if (window.lucide?.createIcons) lucide.createIcons();
    } catch (e) { console.error(e); Toast.show('No se pudo cargar la lista de clientes', 'bad'); }
  },

  _iniciales(nombre) {
    return (nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  },

  _filaCliente(c) {
    const sub = [c.rucdv_norm ? `RUC ${c.rucdv_norm}` : null, c.telefono || null,
                 c.vendedor_email ? `Vendedor: ${c.vendedor_email.split('@')[0]}` : null]
      .filter(Boolean).join(' · ');
    return `<a class="cg-row" href="?id=${encodeURIComponent(c.id)}"
      onclick="event.preventDefault(); Centro.abrir('${this.esc(c.id)}')">
      <div class="cg-av">${this.esc(this._iniciales(c.nombre))}</div>
      <div style="min-width:0;"><div class="n">${this.esc(c.nombre || '(sin nombre)')}</div>
        <div class="s">${this.esc(sub || '—')}</div></div>
      <span class="arr">›</span></a>`;
  },

  /* ═════════ Ficha 360 ═════════ */

  volver({ push = true } = {}) {
    this.cliente = null;
    document.getElementById('vistaFicha').classList.add('hidden');
    document.getElementById('vistaLista').classList.remove('hidden');
    if (push) history.pushState({}, '', location.pathname);
    if (!document.querySelector('#cgLista .cg-row')) this.cargarLista(true);
  },

  async abrir(clienteId, { push = true } = {}) {
    try {
      const c = await ClientesService.getCliente(clienteId);
      if (!c || c.deleted) { Toast.show('Cliente no encontrado', 'bad'); return; }
      // Candado de cartera: un vendedor no abre clientes ajenos ni por deep-link.
      if (this.esVendedor() && c.vendedor_asignado !== this.uid) {
        Toast.show('Este cliente no está en tu cartera', 'bad');
        this.volver({ push: true });
        return;
      }
      this.cliente = c;
      if (push) history.pushState({}, '', `?id=${encodeURIComponent(clienteId)}`);
      document.getElementById('vistaLista').classList.add('hidden');
      document.getElementById('vistaFicha').classList.remove('hidden');
      window.scrollTo(0, 0);

      document.getElementById('fAvatar').textContent = this._iniciales(c.nombre);
      document.getElementById('fNombre').textContent = c.nombre || '(sin nombre)';
      document.getElementById('fMeta').textContent = [
        c.rucdv_norm ? `RUC ${c.rucdv_norm}` : null, c.telefono || null, c.email || null,
        c.vendedor_email ? `Vendedor: ${c.vendedor_email}` : null,
      ].filter(Boolean).join(' · ') || '—';

      // Skeletons mientras cargan contratos/flota/gestiones (la ficha antes
      // aparecía a saltos, sección por sección).
      const skel = (n, h) => Array.from({ length: n }, () =>
        `<div class="cg-skel" style="height:${h}px; margin-bottom:8px;"></div>`).join('');
      document.getElementById('fKpis').innerHTML = skel(1, 64);
      document.getElementById('fSenales').innerHTML = '';
      document.getElementById('fContratos').innerHTML = skel(3, 38);
      document.getElementById('fEquipos').innerHTML = skel(3, 38);
      document.getElementById('fGestiones').innerHTML = skel(2, 46);

      // Carga en paralelo: contratos + flota + gestiones. Las gestiones NO
      // tumban la ficha si fallan (p. ej. reglas aún sin desplegar en un
      // entorno): el cliente completo vale más que esa sección.
      const db = firebase.firestore();
      const [conSnap, equipos, gestiones] = await Promise.all([
        db.collection('contratos').where('cliente_id', '==', clienteId).get(),
        EquiposPoolService.listarPorCliente(clienteId),
        GestionesService.listarPorCliente(clienteId).catch(e => {
          console.warn('[centro] gestiones no disponibles:', e?.message || e);
          return [];
        }),
      ]);
      this.contratos = conSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(x => !x.deleted)
        .sort((a, b) => (b.fecha_creacion?.toMillis?.() || 0) - (a.fecha_creacion?.toMillis?.() || 0));
      this.equipos = Array.isArray(equipos) ? equipos : [];
      this.gestiones = gestiones;

      this.pintarKpis();
      this.pintarSenales();
      this.pintarContratos();
      this.pintarEquipos();
      this.pintarGestiones();
      this.armarMenu();
      if (window.lucide?.createIcons) lucide.createIcons();
      // Deep-link desde correo (?g=): aterrizar EN el expediente, no arriba
      // de la página (pedido 2026-08-27).
      if (this.gSel) {
        setTimeout(() => document.getElementById(`grow-${this.gSel}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
      }
    } catch (e) { console.error(e); Toast.show('No se pudo abrir el cliente', 'bad'); }
  },

  _diasA(fv) {
    const d = fv?.toDate ? fv.toDate() : (fv ? new Date(fv) : null);
    if (!d || isNaN(d)) return null;
    return Math.ceil((d - new Date()) / 86400000);
  },
  _fmtFecha(fv) {
    const d = fv?.toDate ? fv.toDate() : (fv ? new Date(fv) : null);
    return d && !isNaN(d) ? d.toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  },
  _vencInfo(c) {
    // Preferir el estado estampado por el cron; derivar solo si aún no existe.
    const dias = this._diasA(c.fecha_vencimiento);
    if (dias == null) return null;
    const estado = c.vencimiento_estado ||
      (dias < 0 ? 'vencido' : (dias <= this.AVISO_DIAS ? 'por_vencer' : 'vigente'));
    return { dias, estado };
  },

  // 'aprobado' también opera (la mayoría del histórico nunca pasa a 'activo').
  _esVigente(c) { return ['activo', 'aprobado'].includes(c?.estado); },

  _codigoTipo(c) {
    if (c?.codigo_tipo) return c.codigo_tipo;
    const m = { 'Alquiler': 'ALQ', 'Propio': 'PROP', 'Reemplazo': 'REEMP', 'Demo': 'DEMO', 'Temporal': 'TEMP' };
    if (m[c?.tipo_contrato]) return m[c.tipo_contrato];
    const x = String(c?.contrato_id || '').match(/^[A-Z]+/);
    return x ? x[0] : null;
  },
  // Señal de vencimiento/renovación: solo ALQ/PROP/REEMP (DEMO/TEMP terminan).
  _aplicaVenc(c) { return ['ALQ', 'PROP', 'REEMP'].includes(this._codigoTipo(c)); },
  // Renovación REAL vigente que ya cubre a este contrato (un REEMP amarrado
  // como origen NO cuenta: solo sustituye equipos, no renueva el período).
  _renovadoPor(c) {
    for (const id of (c?.renovado_por_ids || [])) {
      const r = this.contratos.find(x => x.id === id);
      if (r && this._esVigente(r) && this._codigoTipo(r) !== 'REEMP') return r;
    }
    return null;
  },

  // Vida del contrato al estilo del prototipo: "vence en N días" con semáforo,
  // fecha, y barra de vida transcurrida (vigencia.fecha_inicio → vencimiento).
  _vidaHtml(c) {
    if (!this._esVigente(c)) return '—';
    if (!this._aplicaVenc(c)) {
      return `<span style="color:var(--fg-4);" title="Los DEMO y TEMP terminan por su propio flujo de devolución — no renuevan">n/a</span>`;
    }
    const renovador = this._renovadoPor(c);
    if (renovador) {
      return `<div class="cg-vida"><span class="cg-venc vigente">renovado ✓</span>
        <span class="sub">por <span class="cg-mono">${this.esc(renovador.contrato_id || renovador.id)}</span></span></div>`;
    }
    const dias = this._diasA(c.fecha_vencimiento);
    if (dias === null) {
      return this._codigoTipo(c) === 'REEMP'
        ? `<span class="cg-venc por_vencer" title="Un REEMP sin duración hereda la vigencia de su contrato de origen — falta amarrar el linaje">sin origen</span>`
        : `<span class="cg-venc por_vencer" title="Fija la duración del contrato para calcular su vencimiento">sin duración</span>`;
    }
    const ini = c.vigencia?.fecha_inicio;
    const iniD = ini?.toDate ? ini.toDate() : (ini ? new Date(ini) : null);
    const fv = c.fecha_vencimiento;
    const fvD = fv?.toDate ? fv.toDate() : new Date(fv);
    let pct = null;
    if (iniD && fvD && fvD > iniD) {
      pct = Math.min(100, Math.max(0, Math.round(((Date.now() - iniD.getTime()) / (fvD - iniD)) * 100)));
    }
    const estado = dias < 0 ? 'vencido' : (dias <= this.AVISO_DIAS ? 'por_vencer' : 'vigente');
    const color = estado === 'vencido' ? '#D24545' : estado === 'por_vencer' ? '#E0A93A' : '#1FA56B';
    const tcolor = estado === 'vencido' ? '#A03030' : estado === 'por_vencer' ? '#8A6415' : '#17714B';
    const label = dias < 0 ? `vencido hace ${-dias} día${-dias === 1 ? '' : 's'}` : `vence en ${dias} día${dias === 1 ? '' : 's'}`;
    return `<div class="cg-vida">
      <span class="lbl num" style="color:${tcolor};">${label}</span>
      <span class="sub num">${this._fmtFecha(c.fecha_vencimiento)}</span>
      ${pct !== null ? `<div class="bar"><i style="width:${pct}%;background:${color};"></i></div>` : ''}
    </div>`;
  },

  pintarKpis() {
    const activos = this.contratos.filter(c => this._esVigente(c) && !this._renovadoPor(c));
    const enTaller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado)).length;
    const abiertas = (this.gestiones || []).filter(g => GestionesService.ABIERTAS.includes(g.estado)).length;
    document.getElementById('fKpis').innerHTML = [
      [activos.length, 'Contratos vigentes'],
      [this.equipos.length, 'Equipos en campo'],
      [abiertas, 'Gestiones abiertas'],
      [enTaller, 'En taller / revisión'],
    ].map(([v, l]) => `<div class="cg-kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  },

  pintarSenales() {
    const out = [];
    for (const c of this.contratos) {
      if (!this._esVigente(c) || !this._aplicaVenc(c) || this._renovadoPor(c)) continue;
      const v = this._vencInfo(c);
      if (!v) continue;
      if (v.estado === 'vencido') {
        out.push({ tipo: 'bad', txt: `El contrato ${c.contrato_id || c.id} venció hace ${-v.dias} día(s) — coordinar renovación o terminación.` });
      } else if (v.estado === 'por_vencer') {
        out.push({ tipo: 'warn', txt: `El contrato ${c.contrato_id || c.id} vence en ${v.dias} día(s) — iniciar renovación.` });
      }
    }
    // Regla 2026-08-27: una cuenta con equipos FUERA de contrato formal ya
    // requiere renovación/regularización (el documento marco los formaliza).
    const sinContrato = this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id).length;
    if (sinContrato) out.unshift({
      tipo: 'warn',
      txt: `${sinContrato} equipo(s) sin contrato formal — la cuenta requiere renovación / regularización.`,
      extra: this.puedeCrearGestion()
        ? `<button class="btn btn-primary cg-act cg-senal-cta"
             onclick="Centro.wizContrato({renovarCuenta:true})">Renovar cuenta</button>` : '',
    });
    const pendDev = this.equipos.filter(e => e.pendiente_devolucion).length;
    if (pendDev) out.push({ tipo: 'warn', txt: `${pendDev} equipo(s) pendiente(s) de devolución.` });
    const enTaller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado)).length;
    if (enTaller) out.push({ tipo: 'info', txt: `${enTaller} equipo(s) en taller o en revisión.` });
    for (const g of (this.gestiones || [])) {
      if (GestionesService.ABIERTAS.includes(g.estado)) {
        out.push({ tipo: 'info', txt: `Gestión ${g.id} (${GestionesService.tipoLabel(g.tipo)}) — ${GestionesService.estadoLabel(g.estado)}.` });
      }
    }
    document.getElementById('fSenales').innerHTML = out.length
      ? out.map(s => `<div class="cg-senal ${s.tipo}"><i data-lucide="${s.tipo === 'info' ? 'info' : 'alert-triangle'}"
          style="width:15px;height:15px;flex:none;margin-top:2px;"></i><span>${this.esc(s.txt)}</span>${s.extra || ''}</div>`).join('')
      : '';
  },

  _unidadesActivas(c) {
    const total = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    return Math.max(0, total - Number(c.baja_cancelado_total || 0));
  },

  // Fila estándar de un contrato operativo (la comparten la tabla principal
  // y el pliegue de "menores"). SIN acciones por contrato (decisión
  // 2026-08-28): renovar/aumentar/terminar son actos de la CUENTA y viven en
  // el encabezado y el menú — la fila solo informa (el semáforo es la señal).
  // "Ver" abre la vista previa EN LA PÁGINA (regla 2026-08-28: no sacar a la
  // persona de donde está — el salto a la página del contrato es un link
  // explícito dentro del modal).
  _filaContrato(c) {
    return `<tr>
      <td class="cg-mono"><a href="#" onclick="Centro.verContrato('${this.esc(c.id)}'); return false;">${this.esc(c.contrato_id || c.id)}</a></td>
      <td>${this.esc(c.tipo_contrato || c.codigo_tipo || '—')}</td>
      <td>${this.esc(c.estado || '—')}</td>
      <td style="text-align:right;">${this._unidadesActivas(c)}</td>
      <td>${this._vidaHtml(c)}</td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-ghost cg-act" onclick="Centro.verContrato('${this.esc(c.id)}')">Ver</button></td></tr>`;
  },

  // Vista previa del contrato en un modal: todo lo esencial sin navegar.
  verContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    this._cerrarModal();
    const t = (window.ContractTotals?.fromDoc) ? ContractTotals.fromDoc(c) : null;
    const enCampo = this.equipos.filter(e => e.asignacion?.contrato_doc_id === id);
    const renovador = this._renovadoPor(c);
    const dato = (l, v) => v ? `<div style="display:flex; gap:8px; font-size:13px; padding:2px 0;">
      <span style="color:var(--fg-3); min-width:120px;">${l}</span><span>${v}</span></div>` : '';
    const lineas = (c.equipos || []).map(l => `<tr>
      <td>${this.esc(l.modelo || '—')}</td>
      <td style="text-align:right;">${Number(l.cantidad || 0)}</td>
      <td style="text-align:right;" class="num">$${Number(l.precio || 0).toFixed(2)}</td>
      <td style="text-align:right;" class="num">$${(Number(l.cantidad || 0) * Number(l.precio || 0)).toFixed(2)}</td></tr>`).join('');
    const cargos = (c.cargos || []).map(x => `<tr>
      <td>${this.esc(x.concepto || '—')} <span style="color:var(--fg-4); font-size:11px;">${x.recurrente ? 'mensual' : 'único'}</span></td>
      <td style="text-align:right;">${Number(x.cantidad || 1)}</td>
      <td style="text-align:right;" class="num">$${Number(x.monto || 0).toFixed(2)}</td>
      <td style="text-align:right;" class="num">$${(Number(x.cantidad || 1) * Number(x.monto || 0)).toFixed(2)}</td></tr>`).join('');
    const serialesCampo = enCampo.slice(0, 8).map(e => `<span class="cg-mono">${this.esc(e.serial || e.id)}</span>`).join(', ');
    const reg = c.regularizacion;
    this._abrirModalA({
      titulo: `<span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>
        <span style="font-weight:400; color:var(--fg-3); font-size:13.5px;"> · ${this.esc(c.tipo_contrato || c.codigo_tipo || '')} · ${this.esc(c.estado || '')}</span>`,
      cuerpo: `
      <div style="margin:0 0 10px;">${this._vidaHtml(c)}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 24px; margin-bottom:10px;">
        ${dato('Acción', this.esc(c.accion || ''))}
        ${dato('Duración', this.esc(c.duracion || ''))}
        ${dato('Creado', this._fmtFecha(c.fecha_creacion))}
        ${dato('Aprobado', c.fecha_aprobacion ? this._fmtFecha(c.fecha_aprobacion) : '')}
        ${dato('Origen', (c.contrato_origen_refs || []).map(r => `<span class="cg-mono">${this.esc(r)}</span>`).join(', ')
          || (c.origen_legacy_ref ? `papel: ${this.esc(c.origen_legacy_ref)}` : ''))}
        ${dato('Renovado por', renovador ? `<span class="cg-mono">${this.esc(renovador.contrato_id || renovador.id)}</span>` : '')}
        ${dato('Firmado', c.firmado ? (c.firmado_tipo === 'digital' ? 'sí ✓ (firma digital)' : 'sí ✓') : '')}
        ${dato('Firma digital', c.firmado_pendiente_validacion
          ? '<span class="cg-venc por_vencer">recibida — validar firmante</span>'
          : (!c.firmado && c.firma_solicitud_estado === 'pendiente' ? 'enlace enviado — esperando firma' : ''))}
      </div>
      ${lineas || cargos ? `<div class="cg-twrap" style="max-height:30vh; overflow:auto;">
        <table class="cg-tabla"><thead><tr><th>Línea</th><th style="text-align:right;">Cant.</th>
          <th style="text-align:right;">Precio</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>${lineas}${cargos}</tbody></table></div>` : ''}
      ${t ? `<div style="display:flex; gap:18px; font-size:13.5px; margin-top:8px; flex-wrap:wrap;">
        <span>${this.esc(t.itbmsLabel || '')}</span>
        <span style="margin-left:auto;"><b>Mensual: <span class="num">$${Number(t.totalMensual || 0).toFixed(2)}</span></b></span>
        ${t.tieneCargosUnicos ? `<span><b>Primer pago: <span class="num">$${Number(t.primerPago || 0).toFixed(2)}</span></b></span>` : ''}
      </div>` : ''}
      ${enCampo.length ? `<p style="font-size:12.5px; color:var(--fg-3); margin:10px 0 0;">
        <b>${enCampo.length}</b> equipo(s) en campo bajo este contrato${serialesCampo ? `: ${serialesCampo}${enCampo.length > 8 ? ` … y ${enCampo.length - 8} más` : ''}` : ''}.</p>` : ''}
      ${reg?.amarradas ? `<p style="font-size:12.5px; color:var(--fg-3); margin:6px 0 0;">
        Regularización al activarse: ${reg.amarradas} radio(s) amarrados${reg.sin_cupo ? ` · ${reg.sin_cupo} sin cupo` : ''}${reg.sin_linea ? ` · ${reg.sin_linea} sin línea` : ''}.</p>` : ''}
      ${c.observaciones ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0; max-width:72ch;">${this.esc(c.observaciones)}</p>` : ''}`,
      footer: `
        <a href="../contratos/editar-contrato.html?id=${encodeURIComponent(c.id)}" class="btn-quiet">Abrir la página completa del contrato ›</a>
        <span class="sep"></span>
        ${c.firmado_pendiente_validacion && [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol)
          ? `<button class="btn btn-primary cg-act" onclick="Centro.aceptarFirmante('${this.esc(c.id)}')">Aceptar firmante…</button>` : ''}
        ${c.estado === 'aprobado' && !c.firmado && this.puedeCrearGestion()
          ? `<button class="btn btn-primary cg-act" onclick="Centro.enviarFirma('${this.esc(c.id)}')">Enviar para firma</button>` : ''}
        <button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal()">Cerrar</button>`,
    });
  },

  /* ═════════ Firma digital del contrato (2026-08-28) ═════════ */

  // Genera (o reusa) el enlace portador de firma y lo muestra: copiar para
  // WhatsApp o enviar por correo. El enlace se puede REENVIAR — quien debe
  // firmar es el representante legal, pero puede llegarle por el contacto.
  async enviarFirma(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || c.estado !== 'aprobado') { Toast.show('Solo contratos APROBADOS se envían a firma', 'warn'); return; }
    this._cerrarModal();
    let sid = (c.firma_solicitud_id && c.firma_solicitud_estado === 'pendiente') ? c.firma_solicitud_id : null;
    try {
      if (!sid) {
        const t = (window.ContractTotals?.fromDoc) ? ContractTotals.fromDoc(c) : {};
        const ref = await firebase.firestore().collection('firma_solicitudes').add({
          estado: 'pendiente',
          contrato_doc_id: c.id,
          contrato_id: c.contrato_id || c.id,
          cliente_id: c.cliente_id || this.cliente.id,
          cliente_nombre: c.cliente_nombre || this.cliente.nombre || '',
          representante: { nombre: c.representante || this.cliente.representante || '', cedula: c.representante_cedula || this.cliente.representante_cedula || '' },
          resumen: {
            tipo_contrato: c.tipo_contrato || '', duracion: c.duracion || '',
            equipos: (c.equipos || []).map(l => ({ modelo: l.modelo || '', cantidad: Number(l.cantidad || 0), precio: Number(l.precio || 0) })),
            cargos: (c.cargos || []).map(x => ({ concepto: x.concepto || '', cantidad: Number(x.cantidad || 1), monto: Number(x.monto || 0), recurrente: !!x.recurrente })),
            total_mensual: Number(t.totalMensual || c.total_mensual || 0),
            primer_pago: Number(t.primerPago || c.primer_pago || 0),
            itbms_label: t.itbmsLabel || '',
          },
          creado_por_uid: this.uid,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        sid = ref.id;
        await ContratosService.updateContrato(c.id, { firma_solicitud_id: sid, firma_solicitud_estado: 'pendiente' });
        c.firma_solicitud_id = sid; c.firma_solicitud_estado = 'pendiente';
      }
      const url = `${location.origin}/firmar/?s=${sid}`;
      const rep = c.representante || this.cliente.representante || '—';
      this._abrirModal(`
        <h3 style="margin:0 0 6px;">Enviar para firma — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span></h3>
        <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          El cliente abre este enlace en su celular, revisa el resumen y <b>firma con el dedo</b>.
          Debe firmarlo <b>${this.esc(rep)}</b> (representante legal) — el enlace se puede <b>reenviar</b>
          por WhatsApp si te lo recibe otro contacto. Si firma otra persona, la firma queda registrada
          y ventas valida al firmante antes de activar. Al coincidir, el contrato se <b>activa solo</b>.</p>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <input class="form-input" id="wfLink" value="${this.esc(url)}" readonly style="flex:1; font-size:12.5px;">
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('wfLink').value).then(()=>Toast.show('Enlace copiado — pégalo en WhatsApp','ok'))">Copiar</button>
        </div>
        <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
          <div class="form-field" style="margin:0; flex:1; min-width:220px;">
            <label class="form-label">Enviar por correo a</label>
            <input class="form-input" id="wfEmail" type="email" value="${this.esc(this.cliente.representante_email || this.cliente.email || '')}" placeholder="correo del cliente"></div>
          <button class="btn btn-ghost" onclick="Centro._enviarFirmaCorreo('${this.esc(c.id)}','${this.esc(sid)}')">Enviar correo</button>
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:14px;">
          <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>
        </div>`);
    } catch (e) { console.error(e); Toast.show('No se pudo generar el enlace de firma', 'bad'); }
  },

  async _enviarFirmaCorreo(contratoDocId, sid) {
    const email = (document.getElementById('wfEmail')?.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { Toast.show('Escribe un correo válido', 'warn'); return; }
    const c = this.contratos.find(x => x.id === contratoDocId);
    const url = `${location.origin}/firmar/?s=${sid}`;
    try {
      await MailService.enqueue({
        to: email,
        cc: firebase.auth().currentUser?.email || null,
        subject: `Contrato ${c?.contrato_id || ''} listo para su firma — C Comunica`,
        preheader: 'Firme su contrato desde el celular en un minuto',
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Su contrato está listo para firma</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Estimado cliente: el contrato <b>${FMT.esc(c?.contrato_id || '')}</b> de
            <b>${FMT.esc(c?.cliente_nombre || '')}</b> está listo. Ábralo con el botón, revise el resumen
            y firme con el dedo desde su celular. Debe firmarlo el <b>representante legal</b>
            (${FMT.esc(c?.representante || '—')}); si lo recibe otra persona, puede reenviarle este correo.</p>`,
        ctaUrl: url,
        ctaLabel: 'Revisar y firmar el contrato',
        meta: { created_at: firebase.firestore.FieldValue.serverTimestamp(), created_by: this.uid, source: 'firma-contrato', firma_solicitud: sid },
        status: 'queued',
      });
      Toast.show(`Enlace de firma enviado a ${email}`, 'ok');
    } catch (e) { console.error(e); Toast.show('No se pudo enviar el correo', 'bad'); }
  },

  // Ventas acepta a un firmante distinto del representante registrado.
  async aceptarFirmante(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c?.firma_solicitud_id) { Toast.show('El contrato no tiene solicitud de firma vinculada', 'warn'); return; }
    this._abrirValidacionFirma(c.firma_solicitud_id, c.contrato_id || c.id);
  },
  // Igual pero para el ANEXO de aumento (la solicitud vive en la gestión).
  aceptarFirmanteGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g?.firma_solicitud_id) { Toast.show('La gestión no tiene solicitud de firma vinculada', 'warn'); return; }
    this._abrirValidacionFirma(g.firma_solicitud_id, gid);
  },
  async _abrirValidacionFirma(sid, etiqueta) {
    this._cerrarModal();
    try {
      const snap = await firebase.firestore().collection('firma_solicitudes').doc(sid).get();
      const s = snap.exists ? snap.data() : null;
      if (!s || s.estado !== 'validacion') { Toast.show('La solicitud no está pendiente de validación', 'warn'); return; }
      const f = s.firma || {};
      this._abrirModal(`
        <h3 style="margin:0 0 6px;">Validar firmante — <span class="cg-mono">${this.esc(etiqueta)}</span></h3>
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          La firma quedó registrada con su rastro completo, pero el firmante no coincide con el
          representante legal registrado. Al aceptar, el documento <b>se aplica</b> (contrato → activo;
          anexo → las líneas entran y bodega asigna).</p>
        <table class="cg-tabla" style="margin-bottom:10px;"><thead><tr><th></th><th>Registrado</th><th>Firmó</th></tr></thead><tbody>
          <tr><td>Nombre</td><td>${this.esc(s.representante?.nombre || '—')}</td><td><b>${this.esc(f.nombre || '—')}</b></td></tr>
          <tr><td>Cédula</td><td class="cg-mono">${this.esc(s.representante?.cedula || '—')}</td><td class="cg-mono"><b>${this.esc(f.cedula || '—')}</b></td></tr>
          <tr><td>Cargo</td><td>representante legal</td><td>${this.esc(f.cargo || '—')}</td></tr>
        </tbody></table>
        ${f.png ? `<div style="border:1px solid var(--border-subtle); border-radius:10px; padding:6px; margin-bottom:10px; background:#fff;">
          <img src="${f.png}" alt="firma" style="max-height:110px; display:block; margin:0 auto;"></div>` : ''}
        ${f.cedula_path ? `
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1; text-align:center;"><div class="form-label" style="margin-bottom:4px;">Cédula del firmante</div>
            <img id="wvCed" style="max-width:100%; max-height:170px; border:1px solid var(--border-subtle); border-radius:8px;" alt="cargando…"></div>
          <div style="flex:1; text-align:center;"><div class="form-label" style="margin-bottom:4px;">Selfie</div>
            <img id="wvSelfie" style="max-width:100%; max-height:170px; border:1px solid var(--border-subtle); border-radius:8px;" alt="cargando…"></div>
        </div>
        <p style="font-size:11px; color:var(--fg-4); margin:0 0 10px;">Evidencia de identidad — dato sensible (Ley 81):
          cada vista queda auditada; los enlaces expiran en 5 minutos.</p>`
        : '<p style="font-size:12px; color:var(--fg-4); margin:0 0 10px;">Sin evidencia de identidad adjunta (firma anterior a la actualización).</p>'}
        <label class="cg-toggle" style="margin-bottom:12px;">
          <input type="checkbox" id="wfActualizar" checked>
          Actualizar la ficha del cliente con este representante (el directorio se corrige solo)
        </label>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="Centro._aceptarFirmanteConfirmar('${this.esc(sid)}')">Aceptar firmante y activar</button>
        </div>`);
      // Evidencia de identidad: URLs firmadas de 5 min vía callable (los
      // bytes viven con read:false — dato sensible, cada vista se audita).
      if (f.cedula_path && firebase.functions) {
        const fn = firebase.functions().httpsCallable('getFirmaIdentidadUrl');
        [['cedula', 'wvCed'], ['selfie', 'wvSelfie']].forEach(([cual, imgId]) => {
          fn({ sid, cual }).then(r => {
            const img = document.getElementById(imgId);
            if (img) { if (r.data?.url) img.src = r.data.url; else img.alt = 'no disponible'; }
          }).catch((e) => {
            console.warn('[centro] evidencia no disponible:', e?.message || e);
            const img = document.getElementById(imgId);
            if (img) img.alt = 'no disponible';
          });
        });
      }
    } catch (e) { console.error(e); Toast.show('No se pudo cargar la solicitud de firma', 'bad'); }
  },

  // Enlace de firma digital para el ANEXO de aumento (pendiente_firma): la
  // misma página /firmar/ y el mismo trigger; al firmar (y coincidir o ser
  // validado) el anexo pasa solo a pendiente_bodega — cero papel, cero fotos.
  async enviarFirmaAnexo(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || g.estado !== 'pendiente_firma') { Toast.show('El anexo debe estar aprobado y pendiente de firma', 'warn'); return; }
    const a = g.aumento || {};
    this._cerrarModal();
    let sid = (g.firma_solicitud_id && g.firma_solicitud_estado === 'pendiente') ? g.firma_solicitud_id : null;
    try {
      if (!sid) {
        const t = a.totales || {};
        const ref = await firebase.firestore().collection('firma_solicitudes').add({
          estado: 'pendiente',
          tipo: 'anexo_aumento',
          gestion_id: gid,
          contrato_doc_id: a.contrato_doc_id || '',
          contrato_id: a.contrato_id || '',
          cliente_id: g.cliente_id,
          cliente_nombre: g.cliente_nombre || '',
          titulo: `Anexo de aumento ${gid} — contrato ${a.contrato_id || ''}`,
          declaracion: `Declaro que he leído el anexo de aumento ${gid} al contrato ${a.contrato_id || ''} y acepto sus términos y condiciones en nombre de ${g.cliente_nombre || 'la empresa'}.`,
          representante: { nombre: this.cliente.representante || '', cedula: this.cliente.representante_cedula || '' },
          resumen: {
            tipo_contrato: 'Anexo de aumento',
            duracion: `${a.duracion_meses || '?'} meses (tramo del anexo, desde la entrega)`,
            equipos: (a.lineas || []).map(l => ({ modelo: l.modelo || '', cantidad: Number(l.cantidad || 0), precio: Number(l.precio || 0) })),
            cargos: (a.cargos || []).map(x => ({ concepto: x.concepto || '', cantidad: Number(x.cantidad || 1), monto: Number(x.monto || 0), recurrente: !!x.recurrente })),
            total_mensual: Number(t.total_mensual || 0),
            primer_pago: Number(t.primer_pago || 0),
            itbms_label: t.itbms_aplica ? `ITBMS (${Math.round((t.itbms_porcentaje || 0.07) * 100)}%)` : 'ITBMS EXENTO',
          },
          creado_por_uid: this.uid,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        sid = ref.id;
        await firebase.firestore().collection('gestiones').doc(gid).update({
          firma_solicitud_id: sid, firma_solicitud_estado: 'pendiente',
        });
        g.firma_solicitud_id = sid; g.firma_solicitud_estado = 'pendiente';
      }
      const url = `${location.origin}/firmar/?s=${sid}`;
      const rep = this.cliente.representante || '—';
      this._abrirModal(`
        <h3 style="margin:0 0 6px;">Enviar anexo para firma — <span class="cg-mono">${this.esc(gid)}</span></h3>
        <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          El cliente abre el enlace en su celular, revisa el anexo (${this.esc(String((a.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`).join(', ')))})
          y <b>firma con el dedo</b>. Debe firmarlo <b>${this.esc(rep)}</b> (representante legal) — el enlace se puede
          <b>reenviar</b>. Al firmar, las líneas entran al contrato y bodega recibe la asignación, todo solo.</p>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <input class="form-input" id="wfLink" value="${this.esc(url)}" readonly style="flex:1; font-size:12.5px;">
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('wfLink').value).then(()=>Toast.show('Enlace copiado — pégalo en WhatsApp','ok'))">Copiar</button>
        </div>
        <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
          <div class="form-field" style="margin:0; flex:1; min-width:220px;">
            <label class="form-label">Enviar por correo a</label>
            <input class="form-input" id="wfEmail" type="email" value="${this.esc(this.cliente.representante_email || this.cliente.email || '')}" placeholder="correo del cliente"></div>
          <button class="btn btn-ghost" onclick="Centro._enviarFirmaAnexoCorreo('${this.esc(gid)}','${this.esc(sid)}')">Enviar correo</button>
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:14px;">
          <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>
        </div>`);
    } catch (e) { console.error(e); Toast.show('No se pudo generar el enlace de firma del anexo', 'bad'); }
  },

  async _enviarFirmaAnexoCorreo(gid, sid) {
    const email = (document.getElementById('wfEmail')?.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { Toast.show('Escribe un correo válido', 'warn'); return; }
    const g = (this.gestiones || []).find(x => x.id === gid);
    const a = g?.aumento || {};
    const url = `${location.origin}/firmar/?s=${sid}`;
    try {
      await MailService.enqueue({
        to: email,
        cc: firebase.auth().currentUser?.email || null,
        subject: `Anexo de aumento al contrato ${a.contrato_id || ''} listo para su firma — C Comunica`,
        preheader: 'Firme el anexo desde su celular en un minuto',
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Anexo de aumento listo para firma</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Estimado cliente: el anexo de aumento al contrato <b>${FMT.esc(a.contrato_id || '')}</b> de
            <b>${FMT.esc(g?.cliente_nombre || '')}</b> está listo
            (${FMT.esc((a.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`).join(', '))}).
            Ábralo con el botón, revise el detalle y firme con el dedo desde su celular. Debe firmarlo el
            <b>representante legal</b>; si lo recibe otra persona, puede reenviarle este correo.</p>`,
        ctaUrl: url,
        ctaLabel: 'Revisar y firmar el anexo',
        meta: { created_at: firebase.firestore.FieldValue.serverTimestamp(), created_by: this.uid, source: 'firma-anexo', firma_solicitud: sid },
        status: 'queued',
      });
      Toast.show(`Enlace de firma del anexo enviado a ${email}`, 'ok');
    } catch (e) { console.error(e); Toast.show('No se pudo enviar el correo', 'bad'); }
  },

  async _aceptarFirmanteConfirmar(sid) {
    try {
      await firebase.firestore().collection('firma_solicitudes').doc(sid).update({
        estado: 'aceptado',
        validado_por_uid: this.uid,
        validado_at: firebase.firestore.Timestamp.now(),
        actualizar_ficha: document.getElementById('wfActualizar')?.checked === true,
      });
      this._cerrarModal();
      Toast.show('Firmante aceptado — el contrato se activa en segundos', 'ok');
      setTimeout(() => this.abrir(this.cliente.id, { push: false }), 1800);
    } catch (e) { console.error(e); Toast.show('No se pudo aceptar al firmante', 'bad'); }
  },

  pintarContratos() {
    const cont = document.getElementById('fContratos');
    if (!this.contratos.length) { cont.innerHTML = '<div class="cg-empty">Sin contratos registrados.</div>'; return; }
    // El overhang (caso SEPROSA, 2026-08-28) en dos capas: (1) lo NO operativo
    // (renovado/vencido/anulado) se pliega en "Histórico"; (2) de lo operativo,
    // los contratos MENORES — sin facturación y sin urgencia (REEMPs de 1 radio,
    // adiciones $0) — se pliegan en su propia línea. La función manda, no el
    // tamaño: un $0 que entra en ventana de vencimiento sube solo.
    const operativos = this.contratos.filter(c => this._esVigente(c) && !this._renovadoPor(c));
    const historico = this.contratos.filter(c => !operativos.includes(c));
    const mensualDe = (c) => Number(c.total_mensual ?? c.total_con_itbms ?? 0);
    const esMenor = (c) => mensualDe(c) <= 0 && !this._wcEnVentana(c);
    const principales = operativos.filter(c => !esMenor(c));
    const menores = operativos.filter(esMenor);

    // Encabezado de cuenta: el resumen que le da sentido al botón consolidador.
    const enCampo = this.equipos.filter(e => ['en_cliente', 'asignado_contrato'].includes(e.estado)).length;
    const mensualTot = operativos.reduce((s, c) => s + mensualDe(c), 0);
    // Vencimiento de la cuenta: si algo YA venció se dice como tal (decir
    // "próximo vencimiento" con una fecha pasada confunde); el "próximo" solo
    // considera fechas futuras.
    const hoy = new Date();
    let vencidos = 0, masViejo = null, proxima = null;
    for (const c of operativos) {
      if (!this._aplicaVenc(c) || !c.fecha_vencimiento) continue;
      const d = c.fecha_vencimiento.toDate ? c.fecha_vencimiento.toDate() : new Date(c.fecha_vencimiento);
      if (isNaN(d)) continue;
      if (d < hoy) { vencidos++; if (!masViejo || d < masViejo) masViejo = d; }
      else if (!proxima || d < proxima) proxima = d;
    }
    const vencHtml = vencidos
      ? `<span>·</span><span class="cg-venc vencido">${vencidos} vencido${vencidos === 1 ? '' : 's'} — desde ${this._fmtFecha(masViejo)}</span>`
      : proxima ? `<span>·</span><span>próximo vencimiento <b>${this._fmtFecha(proxima)}</b></span>` : '';
    const cuenta = operativos.length ? `
      <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap; padding:9px 13px; margin-bottom:10px;
                  background:var(--surface-sunken, #EEF2F6); border-radius:10px; font-size:13px; color:var(--fg-2);">
        <span><b>${operativos.length}</b> contrato${operativos.length === 1 ? '' : 's'}</span>
        <span>·</span><span><b>${enCampo}</b> radio${enCampo === 1 ? '' : 's'} en campo</span>
        <span>·</span><span class="num"><b>$${mensualTot.toFixed(2)}</b>/mes</span>
        ${vencHtml}
        ${this.puedeCrearGestion() && (operativos.length > 1 || this._wcCustodia().length)
          ? `<button class="btn btn-primary" style="margin-left:auto; padding:4px 12px; font-size:12.5px;"
               title="Consolida los contratos de la cuenta en uno solo"
               onclick="Centro.wizContrato({renovarCuenta:true})">Renovar cuenta</button>` : ''}
      </div>` : '';

    const filas = principales.map(c => this._filaContrato(c)).join('');
    const nReemp = menores.filter(c => this._codigoTipo(c) === 'REEMP').length;
    const nOtros = menores.length - nReemp;
    const menoresLabel = [
      nReemp ? `${nReemp} reemplazo${nReemp === 1 ? '' : 's'} de equipo` : '',
      nOtros ? `${nOtros} sin facturación` : '',
    ].filter(Boolean).join(' y ');
    const menoresUnid = menores.reduce((s, c) => s + this._unidadesActivas(c), 0);
    const histFilas = historico.map(c => {
      const renovador = this._renovadoPor(c);
      const estadoTxt = renovador
        ? `renovado por <span class="cg-mono">${this.esc(renovador.contrato_id || renovador.id)}</span>`
        : this.esc(c.estado || '—');
      return `<tr style="color:var(--fg-3);">
        <td class="cg-mono"><a href="#" onclick="Centro.verContrato('${this.esc(c.id)}'); return false;">${this.esc(c.contrato_id || c.id)}</a></td>
        <td>${this.esc(c.tipo_contrato || c.codigo_tipo || '—')}</td>
        <td>${estadoTxt}</td>
        <td style="text-align:right;">${this._unidadesActivas(c)}</td></tr>`;
    }).join('');
    const THEAD = `<thead><tr>
      <th>Contrato</th><th>Tipo</th><th>Estado</th><th style="text-align:right;">Unid.</th><th>Vence</th><th></th>
      </tr></thead>`;
    cont.innerHTML = `
      ${cuenta}
      ${principales.length ? `<table class="cg-tabla">${THEAD}<tbody>${filas}</tbody></table>`
        : operativos.length ? '' : '<div class="cg-empty">Sin contratos operativos.</div>'}
      ${menores.length ? `<details style="margin-top:10px;">
        <summary style="cursor:pointer; font-size:13px; color:var(--fg-3); font-weight:600;">Contratos menores (${menores.length}) — ${menoresLabel} · ${menoresUnid} unid.</summary>
        <table class="cg-tabla" style="margin-top:8px;">${THEAD}<tbody>${menores.map(c => this._filaContrato(c)).join('')}</tbody></table>
      </details>` : ''}
      ${historico.length ? `<details style="margin-top:10px;">
        <summary style="cursor:pointer; font-size:13px; color:var(--fg-3); font-weight:600;">Histórico (${historico.length}) — renovados, vencidos, anulados</summary>
        <table class="cg-tabla" style="margin-top:8px;"><thead><tr>
          <th>Contrato</th><th>Tipo</th><th>Estado</th><th style="text-align:right;">Unid.</th>
          </tr></thead><tbody>${histFilas}</tbody></table>
      </details>` : ''}`;
  },

  // Chip de vencimiento POR EQUIPO (mismo semáforo): usa el tramo que le
  // aplica — la línea del aumento (vigencia propia) si su modelo la tiene,
  // si no el vencimiento del contrato. DEMO/TEMP y custodia sin contrato: —.
  _vencChipEquipo(e) {
    const c = this.contratos.find(x => x.id === e.asignacion?.contrato_doc_id);
    if (!c || !this._esVigente(c) || !this._aplicaVenc(c)) {
      // Custodia con vigencia propia estampada desde la evidencia de órdenes
      // (asigna-custodia-por-ordenes, 2026-08-28): el semáforo corre aunque no
      // haya contrato — la salida es la renovación/regularización de la cuenta.
      const fvU = e.vigencia?.fecha_vencimiento;
      if (fvU) {
        const dias = this._diasA(fvU);
        if (dias !== null) {
          const cls = dias < 0 ? 'vencido' : (dias <= this.AVISO_DIAS ? 'por_vencer' : 'vigente');
          const label = dias < 0 ? `vencido ${-dias} d` : `${dias} d`;
          return `<span class="cg-venc ${cls} num" title="Vence ${this._fmtFecha(fvU)} · período estampado desde la orden de entrega — sin contrato formal (regularizar al renovar)">${label} *</span>`;
        }
      }
      return '<span style="color:var(--fg-4);">—</span>';
    }
    if (this._renovadoPor(c)) return '<span class="cg-venc vigente">renovado</span>';
    const linea = (c.equipos || []).find(l => l?.vigencia?.fecha_vencimiento && this._mismoModeloLinea(l, e));
    const fv = linea?.vigencia?.fecha_vencimiento || c.fecha_vencimiento;
    const dias = this._diasA(fv);
    if (dias === null) return '<span class="cg-venc por_vencer" title="El contrato no tiene duración fijada">sin duración</span>';
    const cls = dias < 0 ? 'vencido' : (dias <= this.AVISO_DIAS ? 'por_vencer' : 'vigente');
    const label = dias < 0 ? `vencido ${-dias} d` : `${dias} d`;
    return `<span class="cg-venc ${cls} num" title="Vence ${this._fmtFecha(fv)}${linea ? ' · tramo del aumento' : ''}">${label}</span>`;
  },

  // Matching tolerante de modelo (caso Feduro 2026-08-27): la línea del
  // contrato dice "PNC360S" con un modelo_id del catálogo y la ficha del pool
  // dice "HYTERA PNC360S" (marca incluida) con OTRO id — id exacto y label
  // exacto fallaban. Se normaliza a alfanumérico y se acepta contención por
  // sufijo/prefijo (marca por delante, "-R" por detrás).
  _normModelo(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },
  _mismoModeloLinea(l, e) {
    if (l.modelo_id && e.modelo_id && l.modelo_id === e.modelo_id) return true;
    const a = this._normModelo(l.modelo), b = this._normModelo(e.modelo_label);
    if (!a || !b) return false;
    return a === b || a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a);
  },

  // Línea del contrato que le corresponde a la unidad — la que define su
  // tarifa y su tramo.
  _lineaDeEquipo(e, c) {
    return (c?.equipos || []).find(l => this._mismoModeloLinea(l, e));
  },

  // Tarifa mensual del equipo según la línea de su contrato.
  _tarifaEquipo(e) {
    const c = this.contratos.find(x => x.id === e.asignacion?.contrato_doc_id);
    if (!c) return '<span style="color:var(--fg-4);">—</span>';
    const p = Number(this._lineaDeEquipo(e, c)?.precio || 0);
    return p > 0
      ? `<span class="num">$${p.toFixed(2)}<span style="font-size:11px;color:var(--fg-4);">/mes</span></span>`
      : '<span style="color:var(--fg-4);" title="La línea del contrato no tiene precio">—</span>';
  },

  pintarEquipos() {
    const cont = document.getElementById('fEquipos');
    const q = (document.getElementById('fEqFiltro')?.value || '').trim().toUpperCase();
    const lista = this.equipos.filter(e => !q ||
      `${e.serial || ''} ${e.modelo_label || ''} ${e.asignacion?.contrato_id || ''}`.toUpperCase().includes(q));
    if (!lista.length) {
      cont.innerHTML = `<div class="cg-empty">${this.equipos.length ? 'Ningún equipo coincide con el filtro.' : 'Sin equipos asignados en el inventario.'}</div>`;
      return;
    }
    const chip = (e) => (window.EquiposPoolService?.chipEstadoHtml)
      ? EquiposPoolService.chipEstadoHtml(e.estado)
      : this.esc(e.estado || '—');
    const filas = lista.map(e => `<tr>
      <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
      <td>${this.esc(e.modelo_label || '—')}</td>
      <td>${chip(e)}${e.pendiente_devolucion ? ' <span class="cg-venc por_vencer">pend. devolución</span>' : ''}</td>
      <td class="cg-mono" style="font-size:12px;">${this.esc(e.asignacion?.contrato_id || '—')}</td>
      <td style="text-align:right;">${this._tarifaEquipo(e)}</td>
      <td>${this._vencChipEquipo(e)}</td>
      <td style="text-align:right;"><button class="btn btn-ghost cg-act"
        title="Historia completa de esta unidad" onclick="Centro.verKardex('${this.esc(e.id)}')">Kardex ›</button></td></tr>`).join('');
    cont.innerHTML = `<table class="cg-tabla"><thead><tr>
      <th>Serial</th><th>Modelo</th><th>Situación</th><th>Contrato</th><th style="text-align:right;">Tarifa</th><th>Vence</th><th></th>
      </tr></thead><tbody>${filas}</tbody></table>`;
  },

  // Kardex en un modal (pedido 2026-08-28): la historia de la unidad se ve
  // AQUÍ mismo — igual que en la página de equipos — y el salto a Seriales
  // queda como link al pie, no como destino del botón.
  async verKardex(id) {
    const e = this.equipos.find(x => x.id === id);
    const serial = e?.serial || id;
    const urlSeriales = `../inventario/equipos.html?serial=${encodeURIComponent(serial)}`;
    this._abrirModal(`
      <h3 style="margin:0 0 2px;">Historia — <span class="cg-mono">${this.esc(serial)}</span></h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3);">
        ${this.esc(e?.modelo_label || '')} · ${this.esc((window.EquiposPoolService?.ESTADO_LABELS || {})[e?.estado] || e?.estado || '')}
        ${e?.asignacion?.contrato_id ? ` · <span class="cg-mono">${this.esc(e.asignacion.contrato_id)}</span>` : ''}</p>
      <div id="wkMovs" style="max-height:55vh; overflow:auto;">
        <p style="color:var(--fg-3); font-size:13px;">Cargando movimientos…</p></div>
      <div style="display:flex; gap:8px; align-items:center; margin-top:12px;">
        <a href="${urlSeriales}" style="font-size:12.5px;">Abrir en Seriales (pool de equipos) ›</a>
        <button class="btn btn-ghost" style="margin-left:auto;" onclick="Centro._cerrarModal()">Cerrar</button>
      </div>`);
    try {
      const movs = await EquiposPoolService.getMovimientos(id);
      const cont = document.getElementById('wkMovs');
      if (!cont) return;
      if (!movs.length) { cont.innerHTML = '<p style="color:var(--fg-3); font-size:13px;">Sin movimientos registrados.</p>'; return; }
      const L = (window.EquiposPoolService?.ESTADO_LABELS) || {};
      cont.innerHTML = movs.map(m => {
        const fecha = m.at?.toDate ? (window.FMT?.datetime ? FMT.datetime(m.at.toDate()) : m.at.toDate().toLocaleString()) : '—';
        const trans = (m.de_estado || m.a_estado)
          ? ` <span style="color:var(--fg-3);">${this.esc(L[m.de_estado] || m.de_estado || '·')} → ${this.esc(L[m.a_estado] || m.a_estado || '·')}</span>` : '';
        const ref = m.ref ? ` · <span style="color:var(--fg-3);">${this.esc(m.ref.tipo || '')}: ${this.esc(m.ref.label || m.ref.id || '')}</span>` : '';
        return `<div style="display:flex; gap:10px; padding:8px 2px; border-bottom:1px solid var(--border-subtle);">
          <div style="flex:none; width:8px; height:8px; border-radius:50%; background:var(--accent); margin-top:6px;"></div>
          <div style="font-size:13px; line-height:1.45;">
            <strong>${this.esc((m.tipo || '').replace(/_/g, ' '))}</strong>${trans}
            ${m.notas ? `<div>${this.esc(m.notas)}</div>` : ''}
            <div style="font-size:12px; color:var(--fg-4);">${this.esc(fecha)}${ref}${m.por_email ? ` · ${this.esc(m.por_email)}` : (m.por === 'system' ? ' · sistema' : '')}</div>
          </div></div>`;
      }).join('');
    } catch (err) {
      const cont = document.getElementById('wkMovs');
      if (cont) cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">Error al cargar la historia: ${this.esc(err?.message || err)}</p>`;
    }
  },

  /* ═════════ Gestiones: lista + expediente ═════════ */

  CIERRE_DEFS: {
    reemplazo: [
      ['asignacion', 'Asignación del nuevo serial', 'Bodega elige la unidad que sustituye'],
      ['programacion', 'Programación del nuevo equipo', 'Referencia: la configuración del radio reemplazado'],
      ['entrega', 'Entrega / sustitución', 'Se registra sola al entregar la OS'],
      ['entrada', 'Entrada del radio reemplazado', 'Vía orden de devolución — avanza sin el equipo físico'],
    ],
    demo: [
      ['asignacion', 'Asignación de seriales', 'Bodega asigna (stock nuevo o refurbished)'],
      ['programacion', 'Programación de los equipos', 'OS de programación confirmada'],
      ['entrega', 'Entrega al cliente', 'Se registra sola al entregar la OS'],
      ['entrada', 'Retorno y recepción', 'Check-in del retorno; inspección antes de Disponible'],
    ],
    baja: [
      ['aprobacion', 'Aprobación de la baja', 'Una sola aprobación, con desglose por contrato'],
      ['derivacion', 'Fin de facturación registrado', 'Placeholder: la facturación aún no corre en la plataforma — no bloquea el cierre'],
      ['entrada', 'Entrada de los equipos', 'Check-in de la devolución (los propios del cliente no se recuperan)'],
    ],
    aumento: [
      ['aprobacion', 'Aprobación comercial', 'Administración / gerencia'],
      ['firma', 'Anexo firmado por el cliente', 'El período propio del equipo nuevo queda explícito'],
      ['derivacion', 'Líneas aplicadas al contrato', 'Con vigencia propia del tramo (corre desde la entrega)'],
      ['asignacion', 'Asignación de seriales', 'Bodega'],
      ['programacion', 'Programación', 'OS de programación confirmada'],
      ['entrega', 'Entrega al cliente', 'Arranca el tramo: inicio y vencimiento propios'],
    ],
  },

  puedeAsignar() { return [ROLES.ADMIN, ROLES.INVENTARIO].includes(this.rol); },
  puedeAprobar() { return this.rol === ROLES.ADMIN; },
  puedeAprobarBaja() { return [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol); },
  puedeCrearGestion() { return [ROLES.ADMIN, ROLES.GERENTE, ROLES.VENDEDOR, ROLES.RECEPCION].includes(this.rol); },

  async recargarGestiones() {
    this.gestiones = await GestionesService.listarPorCliente(this.cliente.id).catch(() => this.gestiones || []);
    this.pintarKpis();
    this.pintarSenales();
    this.pintarGestiones();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  toggleGestion(gid) {
    this.gSel = this.gSel === gid ? null : gid;
    this.pintarGestiones();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  pintarGestiones() {
    const cont = document.getElementById('fGestiones');
    if (!(this.gestiones || []).length) {
      cont.innerHTML = `<div class="cg-empty">Sin gestiones registradas todavía.
        ${this.puedeCrearGestion() ? `<div class="cta"><button class="btn btn-primary cg-act"
          onclick="document.getElementById('btnGestion')?.click()">Nueva gestión</button></div>` : ''}</div>`;
      return;
    }
    cont.innerHTML = this.gestiones.map(g => {
      const done = ['asignacion', 'programacion', 'entrega', 'entrada']
        .filter(k => g.cierre?.[k] === true).length;
      const fecha = g.fecha_solicitud?.toDate ? g.fecha_solicitud.toDate().toLocaleDateString('es-PA') : '—';
      const abierta = this.gSel === g.id;
      return `
      <div class="cg-row" id="grow-${this.esc(g.id)}" role="button" tabindex="0" onclick="Centro.toggleGestion('${this.esc(g.id)}')"
           onkeydown="if(event.key==='Enter')this.click()" style="${abierta ? 'border-color:var(--accent);' : ''}">
        <div style="min-width:0;"><div class="n cg-mono" style="font-size:13px;">${this.esc(g.id)}</div>
          <div class="s">${this.esc(GestionesService.tipoLabel(g.tipo))} · ${g.tipo === 'demo'
            ? this.esc((g.demo?.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`).join(', ') || '—')
            : `${(g.items || []).length} serial(es)`} · ${fecha}</div></div>
        <span class="num" style="margin-left:auto; font-size:12px; color:var(--fg-3);">${done}/4</span>
        <span class="cg-chip cg-chip--estado-${this.esc(g.estado)}">${this.esc(GestionesService.estadoLabel(g.estado))}</span>
        <span class="arr">${abierta ? '▾' : '›'}</span>
      </div>
      ${abierta ? this._detalleGestion(g) : ''}`;
    }).join('');
    this._decorarAsignacion();
  },

  // Inputs de asignación de bodega al nivel del resto del sistema (pedido
  // 2026-08-28: "tiene que venir de un serial existente, mira los otros
  // contratos"): cada input se decora con SerialField (chips de estado del
  // pool, descartados, conflictos, modelo distinto — el MISMO componente de
  // contratos/seriales y órdenes) y gana un datalist con los seriales
  // DISPONIBLES EN BODEGA de su modelo, para elegir de existentes en vez de
  // teclear a ciegas. La validación dura al guardar (_validarSerialBodega)
  // se mantiene como candado final.
  _bodegaCache: null,
  async _bodegaDisponibles() {
    if (this._bodegaCache && Date.now() - this._bodegaCache.t < 5 * 60 * 1000) return this._bodegaCache.d;
    const snap = await firebase.firestore().collection('equipos_pool')
      .where('estado', '==', 'en_bodega').limit(3000).get();
    const d = snap.docs.map(x => ({ id: x.id, ...x.data() }));
    this._bodegaCache = { t: Date.now(), d };
    return d;
  },
  _slotsDeLineas(lineas) {
    const slots = [];
    (lineas || []).forEach(l => {
      for (let i = 0; i < Number(l.cantidad || 0); i++) slots.push({ id: l.modelo_id || '', label: l.modelo || '' });
    });
    return slots;
  },
  async _decorarAsignacion() {
    const inputs = [...document.querySelectorAll('input[data-gaum], input[data-gdemo], input[data-gitem]')];
    if (!inputs.length) return;
    // SerialField: chips del pool (si el componente está cargado).
    if (window.SerialField) {
      inputs.forEach(inp => SerialField.adjuntar(inp, {
        modelo: () => ({ modelo_id: inp.dataset.modeloId || null, modelo_label: inp.dataset.modeloLabel || '' }),
      }));
    }
    // A11y: los inputs eran placeholder-only — el lector de pantalla no tenía
    // nombre para el campo.
    inputs.forEach(inp => { if (!inp.getAttribute('aria-label')) inp.setAttribute('aria-label', inp.placeholder || 'Serial'); });
    // Datalist de disponibles en bodega por modelo esperado.
    try {
      const bodega = await this._bodegaDisponibles();
      const porClave = new Map();
      for (const inp of inputs) {
        const clave = inp.dataset.modeloId || this._normModelo(inp.dataset.modeloLabel || '');
        if (!clave) continue;
        if (!porClave.has(clave)) {
          const dlId = `cg-dl-${clave.replace(/[^A-Za-z0-9_-]/g, '')}`;
          let dl = document.getElementById(dlId);
          if (!dl) {
            dl = document.createElement('datalist');
            dl.id = dlId;
            const compatibles = bodega.filter(u => (window.EquiposPoolService?._mismoModelo)
              ? EquiposPoolService._mismoModelo(u, inp.dataset.modeloId || null, inp.dataset.modeloLabel || '')
              : this._mismoModeloLinea({ modelo_id: inp.dataset.modeloId, modelo: inp.dataset.modeloLabel }, u));
            dl.innerHTML = compatibles.slice(0, 300).map(u =>
              `<option value="${this.esc(u.serial || u.id)}">${this.esc(u.modelo_label || '')}${u.condicion ? ` · ${this.esc(u.condicion)}` : ''}</option>`).join('');
            document.body.appendChild(dl);
          }
          porClave.set(clave, dl.id);
        }
        inp.setAttribute('list', porClave.get(clave));
        inp.setAttribute('autocomplete', 'off');
      }
    } catch (e) { console.warn('[centro] datalist de bodega no disponible:', e?.message || e); }
  },

  _detalleGestion(g) {
    // Checklist como timeline del kit: done = completado; next = el paso que
    // sigue (todos los anteriores completos) — el ojo sabe dónde está parado.
    const defs = this.CIERRE_DEFS[g.tipo] || this.CIERRE_DEFS.reemplazo;
    const check = `<div class="cg-tl">` + defs.map(([k, t, s], i) => {
      const done = g.cierre?.[k] === true;
      const next = !done && defs.slice(0, i).every(([kk]) => g.cierre?.[kk] === true);
      return `<div class="cg-tl-item${done ? ' done' : next ? ' next' : ''}">
        <span class="cg-tl-dot">${done ? '✓' : ''}</span>
        <span class="cg-tl-t"><b>${t}</b><span class="s">${s}</span></span>
      </div>`;
    }).join('') + `</div>`;

    const ordenes = [
      ...((g.ordenes?.programacion_ids || (g.ordenes?.programacion_id ? [g.ordenes.programacion_id] : []))
        .map(id => ({ id, tipo: 'PROGRAMACIÓN' }))),
      ...(g.ordenes?.devolucion_id ? [{ id: g.ordenes.devolucion_id, tipo: 'DEVOLUCIÓN' }] : []),
      ...(g.ordenes?.entrada_id ? [{ id: g.ordenes.entrada_id, tipo: 'ENTRADA' }] : []),
    ];
    const osHtml = ordenes.length
      ? `<div class="cg-os">${ordenes.map(o =>
          `<a href="../ordenes/editar-orden.html?id=${encodeURIComponent(o.id)}">
             <b>${o.tipo}</b>&nbsp;<span class="cg-mono">${this.esc(o.id)}</span></a>`).join('')}</div>`
      : '';

    let cuerpo = '';
    if (g.tipo === 'aumento') {
      const a = g.aumento || {};
      const total = (a.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      const asignados = a.seriales_asignados || [];
      const asignando = this.puedeAsignar() && g.estado === 'pendiente_bodega' && g.cierre?.derivacion;
      cuerpo = `
        <p style="font-size:13px; margin:0 0 8px;"><b>Contrato destino:</b>
          <span class="cg-mono">${this.esc(a.contrato_id || '—')}</span> ·
          <b>Vigencia del tramo:</b> ${this.esc(String(a.duracion_meses || '?'))} meses desde la entrega</p>
        <div class="cg-twrap"><table class="cg-tabla"><thead><tr>
          <th>Cant.</th><th>Modelo</th><th>Precio/mes</th></tr></thead><tbody>
          ${(a.lineas || []).map(l => `<tr><td class="num">${Number(l.cantidad || 0)}</td>
            <td>${this.esc(l.modelo || '—')}</td><td class="num">$${Number(l.precio || 0).toFixed(2)}</td></tr>`).join('')}
          ${(a.cargos || []).map(c => `<tr><td class="num">${Number(c.cantidad || 0)}</td>
            <td style="color:var(--fg-3);">${this.esc(c.concepto || '—')} <span class="cg-venc ${c.recurrente ? 'vigente' : 'por_vencer'}" style="font-size:10.5px;">${c.recurrente ? 'mensual' : 'único'}</span></td>
            <td class="num">$${Number(c.monto || 0).toFixed(2)}</td></tr>`).join('')}
        </tbody></table></div>
        ${a.totales ? `<p style="font-size:13px; margin:8px 0 0;">
          <b>Total mensual:</b> <span class="num">$${Number(a.totales.total_mensual || 0).toFixed(2)}</span>
          ${a.totales.itbms_aplica ? `<span style="color:var(--fg-4);">(inc. ITBMS ${(a.totales.itbms_porcentaje * 100).toFixed(0)}%)</span>` : '<span style="color:var(--fg-4);">(ITBMS exento)</span>'}
          ${a.totales.cargos_uni ? ` · <b>Primer pago:</b> <span class="num">$${Number(a.totales.primer_pago || 0).toFixed(2)}</span>` : ''}</p>` : ''}
        ${g.anexo_firmado_path ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:8px 0 0;">✓ Anexo firmado registrado (${this.esc(g.anexo_firmado_por || '')})
          <button class="btn btn-ghost cg-act" onclick="Centro.verAnexo('${this.esc(g.anexo_firmado_path)}')">Ver anexo</button></p>` : ''}
        ${g.anexo_firma_digital ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:8px 0 0;">
          ✓ Anexo firmado <b>digitalmente</b> por ${this.esc(g.anexo_firma_digital.firmante_nombre || '—')}
          (cédula ${this.esc(g.anexo_firma_digital.firmante_cedula || '—')})</p>` : ''}
        ${g.estado === 'pendiente_firma' && this.puedeCrearGestion() ? `
          <div style="margin-top:8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <button class="btn btn-primary cg-act"
              onclick="Centro.enviarFirmaAnexo('${this.esc(g.id)}')">Enviar anexo para firma digital</button>
            ${g.firma_solicitud_estado === 'pendiente' ? '<span style="font-size:12px; color:var(--fg-3);">enlace enviado — esperando la firma del cliente</span>' : ''}
          </div>` : ''}
        ${g.firma_pendiente_validacion && [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol) ? `
          <div class="cg-senal warn" style="margin-top:8px; align-items:center;">
            <span>Anexo firmado por persona <b>distinta al representante</b> — falta validar al firmante.</span>
            <button class="btn btn-primary" style="margin-left:auto; flex:none; padding:3px 11px; font-size:12px;"
              onclick="Centro.aceptarFirmanteGestion('${this.esc(g.id)}')">Aceptar firmante…</button></div>` : ''}
        ${asignando
          ? `<div style="margin-top:10px;">${this._slotsDeLineas(a.lineas).map((m, ix) => `
              <span style="display:inline-block; margin:0 6px 6px 0;">
              <input class="form-input" style="max-width:200px;padding:5px 9px;font-size:13px;"
                data-gaum="${ix}" data-modelo-id="${this.esc(m.id)}" data-modelo-label="${this.esc(m.label)}"
                placeholder="${this.esc(m.label)} ${ix + 1}…" value="${this.esc(asignados[ix]?.serial || '')}"></span>`).join('')}
             <div style="margin-top:6px;"><button class="btn btn-primary" onclick="Centro.guardarAsignacionAumento('${this.esc(g.id)}')">
               Guardar asignación</button>
               <span style="font-size:12.5px; color:var(--fg-3);"> Elige de los disponibles en bodega (el campo sugiere los del modelo).</span></div></div>`
          : (asignados.length ? `<p style="font-size:13px; margin:8px 0 0;"><b>Seriales:</b>
              ${asignados.map(s => `<span class="cg-mono">${this.esc(s.serial)}</span>`).join(', ')}</p>` : '')}`;
    } else if (g.tipo === 'baja') {
      const pen = g.penalidad_estimada;
      const esTerm = Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length;
      const cartaHtml = g.carta_path
        ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:0 0 8px;">✓ Carta del cliente adjunta${g.fecha_nota_cliente ? ` (nota del ${this.esc(g.fecha_nota_cliente)})` : ''}
             <button class="btn btn-ghost cg-act" onclick="Centro.verAnexo('${this.esc(g.carta_path)}')">Ver carta</button></p>`
        : `<div class="cg-senal warn" style="margin:0 0 8px;">
             <span><b>Falta la carta de solicitud del cliente</b> — la aprobación queda bloqueada hasta adjuntarla.</span>
             ${this.puedeCrearGestion() ? `<label class="btn btn-primary" style="margin-left:auto; padding:3px 11px; font-size:12px; cursor:pointer;">Subir carta
               <input type="file" accept="image/*,application/pdf" style="display:none;"
                 onchange="Centro.subirCarta('${this.esc(g.id)}', this.files[0])"></label>` : ''}</div>`;
      cuerpo = (esTerm ? `<div class="cg-senal bad" style="margin:0 0 8px;"><span><b>TERMINACIÓN TOTAL</b> — se desconectan todos los seriales del contrato.</span></div>` : '')
        + cartaHtml
        + `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
        <th>Serial</th><th>Modelo</th><th>Contrato</th><th>Motivo</th><th>Fin de facturación</th>
        </tr></thead><tbody>
        ${(g.items || []).map(it => `<tr>
          <td class="cg-mono">${this.esc(it.serial_saliente || it.serial || '—')}</td>
          <td>${this.esc(it.modelo || '—')}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(it.contrato_id || '—')}</td>
          <td style="font-size:12.5px;">${this.esc(it.motivo_detalle || it.motivo_codigo || '—')}</td>
          <td class="num" style="font-size:12.5px;">${this.esc(it.fecha_fin_facturacion || g.fecha_fin_facturacion || '—')}</td>
        </tr>`).join('')}</tbody></table></div>
        ${pen?.por_contrato?.length ? `
          <p style="font-size:13px; margin:10px 0 4px;"><b>Liquidación estimada por contrato — 3 meses en cualquier caso</b>
            <span style="color:var(--fg-4);">(vencido: 60 días de preaviso con servicio activo + 30 de penalidad · cobro inmediato)</span></p>
          ${pen.por_contrato.map(p => `<div style="display:flex; gap:10px; font-size:13px; padding:3px 0;">
            <span class="cg-mono">${this.esc(p.contrato_id || '—')}</span>
            <span style="color:var(--fg-3);">${this.esc(p.detalle || '')}</span>
            <b style="margin-left:auto;" class="num">$${Number(p.monto || 0).toFixed(2)}</b></div>`).join('')}
          <div style="display:flex; font-size:13.5px; border-top:1px solid var(--border-subtle); padding-top:5px; margin-top:3px;">
            <b>Total estimado</b><b style="margin-left:auto;" class="num">$${Number(pen.total || 0).toFixed(2)}</b></div>` : ''}`;
    } else if (g.tipo === 'reemplazo') {
      const asignando = this.puedeAsignar() && g.estado === 'pendiente_bodega';
      cuerpo = `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
        <th>Sale</th><th>Modelo</th><th>Entra</th><th>Modelo solicitado</th><th>Motivo</th><th>Contrato</th>
        </tr></thead><tbody>
        ${(g.items || []).map((it, ix) => `<tr>
          <td class="cg-mono">${this.esc(it.serial_saliente || '—')}</td>
          <td>${this.esc(it.modelo || '—')}</td>
          <td>${asignando
            ? `<input class="form-input" style="max-width:170px;padding:5px 9px;font-size:13px;" data-gitem="${ix}"
                 data-modelo-id="${this.esc(it.modelo_solicitado_id || '')}" data-modelo-label="${this.esc(it.modelo_solicitado || it.modelo || '')}"
                 placeholder="Serial de bodega…" value="${this.esc(it.serial_nuevo || '')}">`
            : `<span class="cg-mono">${this.esc(it.serial_nuevo || 'pendiente')}</span>`}</td>
          <td>${this.esc(it.modelo_solicitado || it.modelo || '—')}</td>
          <td style="font-size:12.5px;">${this.esc(it.motivo_detalle || it.motivo_codigo || '—')}
            ${it.elegibilidad === 'propio_excepcion' ? '<br><span class="cg-venc por_vencer">excepción serv. cliente</span>' : ''}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(it.contrato_id || '—')}</td>
        </tr>`).join('')}</tbody></table></div>
        ${asignando ? `<div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary" onclick="Centro.guardarAsignacion('${this.esc(g.id)}')">
            Guardar asignación</button>
          <span style="font-size:12.5px; color:var(--fg-3);">Cada serial debe existir en bodega (Disponible).
            Al completar todos, el sistema crea la OS de programación y avisa a Recepción.</span></div>` : ''}`;
    } else {
      const total = (g.demo?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      const asignados = g.demo?.seriales_asignados || [];
      const asignando = this.puedeAsignar() && g.estado === 'pendiente_bodega';
      cuerpo = `
        <p style="font-size:13px; margin:0 0 8px;"><b>Finalidad:</b> ${this.esc(g.demo?.finalidad || '—')} ·
          <b>Salida:</b> ${this.esc(g.demo?.fecha_salida || '—')} ·
          <b>Devolución estimada:</b> ${this.esc(g.demo?.fecha_devolucion_estimada || 'sin fecha')}</p>
        ${asignando
          ? `<div>${this._slotsDeLineas(g.demo?.lineas).map((m, ix) => `
              <span style="display:inline-block; margin:0 6px 6px 0;">
              <input class="form-input" style="max-width:200px;padding:5px 9px;font-size:13px;"
                data-gdemo="${ix}" data-modelo-id="${this.esc(m.id)}" data-modelo-label="${this.esc(m.label)}"
                placeholder="${this.esc(m.label)} ${ix + 1}…" value="${this.esc(asignados[ix]?.serial || '')}"></span>`).join('')}
             <div style="margin-top:6px;"><button class="btn btn-primary" onclick="Centro.guardarAsignacionDemo('${this.esc(g.id)}')">
               Guardar asignación</button>
               <span style="font-size:12.5px; color:var(--fg-3);"> Stock nuevo o refurbished, de bodega.</span></div>`
          : `<p style="font-size:13px; margin:0;"><b>Seriales:</b> ${asignados.length
              ? asignados.map(s => `<span class="cg-mono">${this.esc(s.serial)}</span>`).join(', ')
              : 'pendiente de bodega'}</p>`}`;
    }

    let aprobacion = '';
    if (g.estado === 'pendiente_aprobacion') {
      const esBaja = g.tipo === 'baja';
      const esAumento = g.tipo === 'aumento';
      const puede = (esBaja || esAumento) ? this.puedeAprobarBaja() : this.puedeAprobar();
      const fnAprobar = esBaja ? 'aprobarBajaGestion' : esAumento ? 'aprobarAumentoGestion' : 'aprobarGestion';
      // La baja no se aprueba sin la carta del cliente (pedido 2026-08-27).
      const sinCarta = esBaja && !g.carta_path;
      aprobacion = `<div class="cg-senal warn" style="margin:10px 0 0;">
           <span>${esBaja
             ? 'Baja esperando aprobación (una sola, con el desglose por contrato a la izquierda).'
             : esAumento
               ? 'Aumento esperando aprobación comercial — al aprobar, se imprime el anexo para la firma del cliente.'
               : 'Excepción por servicio al cliente (propio sin garantía) — requiere aprobación de administración.'}</span>
           ${puede ? `<span style="margin-left:auto; display:flex; gap:8px;">
             <button class="btn btn-primary cg-act" style="${sinCarta ? 'opacity:.5; cursor:not-allowed;' : ''}"
               ${sinCarta ? 'disabled title="Falta la carta de solicitud del cliente"' : ''}
               onclick="Centro.${fnAprobar}('${this.esc(g.id)}')">Aprobar</button>
             <button class="btn-danger cg-act" onclick="Centro.anularGestion('${this.esc(g.id)}')">Rechazar</button>
           </span>` : ''}</div>`;
    } else if (g.estado === 'pendiente_firma' && g.tipo === 'aumento') {
      aprobacion = `<div class="cg-senal info" style="margin:10px 0 0;">
           <span><b>Esperando la firma del cliente.</b> Imprime el anexo (deja explícito el período propio
             del equipo nuevo), recoge la firma y sube el archivo firmado — recién entonces el sistema
             aplica las líneas y avisa a Bodega.</span>
           ${this.puedeCrearGestion() ? `<span style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
             <a class="btn btn-ghost cg-act" target="_blank"
                href="./anexo-aumento.html?g=${encodeURIComponent(g.id)}">Imprimir anexo</a>
             <label class="btn btn-primary cg-act" style="cursor:pointer;">Subir firmado
               <input type="file" accept="application/pdf,image/*" style="display:none;"
                 onchange="Centro.subirAnexo('${this.esc(g.id)}', this.files[0])"></label>
           </span>` : ''}</div>`;
    }
    const anular = (this.puedeAprobar() || this.rol === ROLES.GERENTE)
      && !['cerrada', 'anulada', 'pendiente_aprobacion'].includes(g.estado)
      && !g.cierre?.entrega
      ? `<button class="btn-quiet" onclick="Centro.anularGestion('${this.esc(g.id)}')">Anular gestión</button>`
      : '';

    return `<div class="ds-card" style="padding:var(--sp-4); margin:-4px 0 10px; border-top:none;">
      <div class="cg-exp">
        <div>${cuerpo}${osHtml}</div>
        <div>${check}${aprobacion}</div>
      </div>
      <div style="display:flex; justify-content:flex-end; margin-top:8px;">${anular}</div>
    </div>`;
  },

  /* ── Acciones sobre el expediente ── */

  async aprobarGestion(gid) {
    try {
      await GestionesService.aprobar(gid);
      Toast.show('Excepción aprobada — Bodega recibirá el aviso', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar', 'bad'); }
  },

  async verAnexo(path) {
    try {
      const url = await GestionesService.urlAnexo(path);
      window.open(url, '_blank');
    } catch (e) { console.error(e); Toast.show('No se pudo abrir el anexo', 'bad'); }
  },

  async subirCarta(gid, file) {
    if (!file) return;
    try {
      Toast.show('Subiendo carta…', '');
      await GestionesService.subirCartaBaja(gid, file);
      Toast.show('Carta adjuntada', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo subir la carta', 'bad'); }
  },

  async aprobarAumentoGestion(gid) {
    try {
      await GestionesService.aprobarAumento(gid);
      Toast.show('Aumento aprobado — imprime el anexo y recoge la firma del cliente', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar el aumento', 'bad'); }
  },

  async subirAnexo(gid, file) {
    if (!file) return;
    try {
      Toast.show('Subiendo anexo firmado…', '');
      await GestionesService.registrarFirmaAumento(gid, file);
      Toast.show('Anexo firmado registrado — el sistema aplica las líneas y avisa a Bodega', 'ok');
      setTimeout(() => this.recargarGestiones(), 1200);
    } catch (e) { console.error(e); Toast.show('No se pudo subir el anexo', 'bad'); }
  },

  async guardarAsignacionAumento(gid) {
    const inputs = [...document.querySelectorAll('input[data-gaum]')];
    const seriales = [];
    try {
      for (const inp of inputs) {
        const serial = inp.value.trim().toUpperCase();
        if (!serial) continue;
        const v = await this._validarSerialBodega(serial);
        if (!v.ok) { Toast.show(v.why, 'bad'); return; }
        seriales.push({
          serial: v.unidad.serial || serial,
          pool_doc_id: v.unidad.id || null,
          modelo: v.unidad.modelo_label || '',
          modelo_id: v.unidad.modelo_id || null,
        });
      }
      if (!seriales.length) { Toast.show('Captura al menos un serial', 'warn'); return; }
      await GestionesService.asignarAumento(gid, seriales);
      Toast.show('Asignación guardada', 'ok');
      setTimeout(() => this.recargarGestiones(), 1200);
    } catch (e) { console.error(e); Toast.show('No se pudo guardar la asignación', 'bad'); }
  },

  async aprobarBajaGestion(gid) {
    try {
      await GestionesService.aprobarBaja(gid);
      Toast.show('Baja aprobada — el sistema deriva la facturación y crea la devolución por serial', 'ok');
      setTimeout(() => this.recargarGestiones(), 1200);
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar la baja', 'bad'); }
  },

  async anularGestion(gid) {
    const motivo = window.prompt('Motivo de la anulación (queda en el expediente):');
    if (motivo === null) return;
    try {
      await GestionesService.anular(gid, motivo);
      Toast.show('Gestión anulada — el sistema revierte sus efectos (órdenes, flags del pool)…', 'ok');
      // La limpieza corre en el trigger (~1-2s): refrescar la FICHA COMPLETA
      // para que equipos y señales dejen de mostrar los flags viejos.
      setTimeout(() => { if (this.cliente) this.abrir(this.cliente.id, { push: false }); }, 1800);
    } catch (e) { console.error(e); Toast.show('No se pudo anular', 'bad'); }
  },

  // Valida un serial contra el pool: debe existir y estar Disponible en bodega.
  async _validarSerialBodega(serial) {
    const matches = await EquiposPoolService.findBySerial(serial);
    const lista = Array.isArray(matches) ? matches : (matches ? [matches] : []);
    if (!lista.length) return { ok: false, why: `${serial}: no existe en el inventario` };
    const disp = lista.find(m => m.estado === 'en_bodega');
    if (!disp) return { ok: false, why: `${serial}: no está Disponible en bodega (está ${lista[0].estado})` };
    return { ok: true, unidad: disp };
  },

  async guardarAsignacion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g) return;
    const inputs = [...document.querySelectorAll('input[data-gitem]')];
    const items = (g.items || []).map(it => ({ ...it }));
    try {
      for (const inp of inputs) {
        const ix = Number(inp.dataset.gitem);
        const serial = inp.value.trim().toUpperCase();
        if (!serial) { items[ix].serial_nuevo = null; items[ix].pool_doc_id_nuevo = null; continue; }
        const v = await this._validarSerialBodega(serial);
        if (!v.ok) { Toast.show(v.why, 'bad'); return; }
        items[ix].serial_nuevo = v.unidad.serial || serial;
        items[ix].pool_doc_id_nuevo = v.unidad.id || null;
        items[ix].asignado_at = new Date().toISOString();
      }
      await GestionesService.asignarItems(gid, items);
      const completo = items.every(it => it.serial_nuevo);
      Toast.show(completo
        ? 'Asignación completa — el sistema crea la OS de programación y avisa a Recepción'
        : 'Asignación guardada (parcial)', 'ok');
      setTimeout(() => this.recargarGestiones(), 1200);
    } catch (e) { console.error(e); Toast.show('No se pudo guardar la asignación', 'bad'); }
  },

  async guardarAsignacionDemo(gid) {
    const inputs = [...document.querySelectorAll('input[data-gdemo]')];
    const seriales = [];
    try {
      for (const inp of inputs) {
        const serial = inp.value.trim().toUpperCase();
        if (!serial) continue;
        const v = await this._validarSerialBodega(serial);
        if (!v.ok) { Toast.show(v.why, 'bad'); return; }
        seriales.push({
          serial: v.unidad.serial || serial,
          pool_doc_id: v.unidad.id || null,
          modelo: v.unidad.modelo_label || '',
          modelo_id: v.unidad.modelo_id || null,
        });
      }
      if (!seriales.length) { Toast.show('Captura al menos un serial', 'warn'); return; }
      await GestionesService.asignarDemo(gid, seriales);
      Toast.show('Asignación guardada', 'ok');
      setTimeout(() => this.recargarGestiones(), 1200);
    } catch (e) { console.error(e); Toast.show('No se pudo guardar la asignación', 'bad'); }
  },

  /* ═════════ Menú "Nueva gestión" ═════════ */

  toggleMenu(e) {
    e.stopPropagation();
    document.getElementById('cgMenu').classList.toggle('hidden');
  },

  armarMenu() {
    const btn = document.getElementById('btnGestion');
    if (!this.puedeCrearGestion()) { btn?.classList.add('hidden'); return; }
    btn?.classList.remove('hidden');
    // Terminación total como GESTIÓN (2026-08-27) — la página vieja de
    // enmiendas queda para el histórico y se descontinuará en la Ola 6.
    // Menú SEGÚN EL ESTADO DE LA CUENTA (decisión 2026-08-28: la unidad es la
    // cuenta, no el contrato — cada acción tiene UN significado claro):
    //   nueva        → Nuevo contrato.
    //   fragmentada  → todo pasa por Renovar cuenta (consolida); agregar
    //                  equipos entra por ahí; terminación = toda la cuenta.
    //   consolidada  → Aumento (anexo directo al maestro), Renovar cuando
    //                  entra en ventana, Terminación de la cuenta.
    const est = this._cuentaEstado();
    let cuentaHtml = '';
    if (est.tipo === 'nueva') {
      cuentaHtml = `<button type="button" onclick="Centro.wizContrato()">Nuevo contrato</button>`;
    } else if (est.tipo === 'fragmentada') {
      const n = est.renovables.length;
      cuentaHtml = `
        <button type="button" onclick="Centro.wizAgregarEquipos()">Agregar equipos
          <span style="display:block; font-size:11px; color:var(--fg-4);">anexo rápido a la cuenta — el contrato ancla se elige solo</span></button>
        <button type="button" onclick="Centro.wizContrato({renovarCuenta:true})">Renovar cuenta
          <span style="display:block; font-size:11px; color:var(--fg-4);">consolida ${n ? `${n} contrato${n === 1 ? '' : 's'}` : 'la cuenta'}${est.custodia ? ` + ${est.custodia} radio${est.custodia === 1 ? '' : 's'} sin contrato` : ''} en un contrato maestro</span></button>
        ${n ? `<button type="button" onclick="Centro.wizTerminacionCuenta()">Terminación de la cuenta
          <span style="display:block; font-size:11px; color:var(--fg-4);">cancela los ${n} contrato${n === 1 ? '' : 's'} con una sola carta y aprobación</span></button>` : ''}`;
    } else {
      const m = est.maestro;
      cuentaHtml = `
        <button type="button" onclick="Centro.wizAumento('${this.esc(m.id)}')">Aumento de equipos (anexo)</button>
        ${this._wcEnVentana(m)
          ? `<button type="button" onclick="Centro.wizContrato('${this.esc(m.id)}')">Renovar cuenta</button>` : ''}
        <button type="button" onclick="Centro.wizTerminacionCuenta()">Terminación de la cuenta</button>`;
    }
    document.getElementById('cgMenu').innerHTML = `
      <div class="hd">Equipos</div>
      <button type="button" onclick="Centro.wizReemplazo()">Reemplazo de equipo</button>
      <button type="button" onclick="Centro.wizDemo()">Demo de equipos</button>
      <button type="button" onclick="Centro.wizBaja()">Baja de equipos (parcial, por serial)</button>
      <div class="hd">Cuenta</div>
      ${cuentaHtml}
      <div class="hd">Comercial</div>
      <a href="../cotizaciones/index.html">Nueva cotización</a>
      <a href="../contratos/nuevo-contrato.html">Formulario clásico de contrato</a>
      <div class="hd">Cliente</div>
      <a href="./index.html">Editar datos del cliente</a>`;
  },

  // Estado de la cuenta para el menú. Los DEMO/TEMP no cuentan (terminan por
  // su propia devolución); lo que define la cuenta son los renovables
  // (ALQ/PROP/REEMP operativos) y la custodia sin contrato.
  _cuentaEstado() {
    const operativos = this.contratos.filter(c => this._esVigente(c) && !this._renovadoPor(c));
    const renovables = operativos.filter(c => this._aplicaVenc(c));
    const custodia = this._wcCustodia().length;
    if (!renovables.length && !custodia) return { tipo: 'nueva', renovables, custodia, maestro: null };
    if (renovables.length === 1 && !custodia) return { tipo: 'consolidada', renovables, custodia, maestro: renovables[0] };
    return { tipo: 'fragmentada', renovables, custodia, maestro: null };
  },

  // Contrato ANCLA de una cuenta fragmentada: donde se cuelga el anexo de
  // aumento SIN preguntarle al vendedor (decisión 2026-08-28 — cada tramo
  // tiene vigencia propia, así que el papel que lo hospeda importa poco y la
  // consolidación futura absorbe las líneas de todos). Criterio: el ALQ/PROP
  // vigente de mayor facturación; a igualdad, el más reciente.
  _cuentaAncla() {
    const est = this._cuentaEstado();
    const comerciales = est.renovables.filter(c => ['ALQ', 'PROP'].includes(this._codigoTipo(c)));
    const candidatos = comerciales.length ? comerciales : est.renovables;
    if (!candidatos.length) return null;
    const m = (c) => Number(c.total_mensual ?? c.total_con_itbms ?? 0);
    return candidatos.slice().sort((a, b) => (m(b) - m(a))
      || String(b.contrato_id || '').localeCompare(String(a.contrato_id || '')))[0];
  },

  // "Agregar equipos": el camino LIVIANO para vender un radio más (2026-08-28
  // — pedirle al cliente re-firmar 200 radios para agregar uno es exagerado).
  // Consolidada → aumento directo al maestro; fragmentada → aumento al ancla
  // automática (la consolidación se OFRECE dentro del wizard, no se impone);
  // sin ningún contrato → no hay dónde colgar el anexo: renovar/regularizar.
  wizAgregarEquipos() {
    const est = this._cuentaEstado();
    if (est.tipo === 'consolidada') { this.wizAumento(est.maestro.id); return; }
    const ancla = this._cuentaAncla();
    if (ancla) this.wizAumento(ancla.id, { ancla: true });
    else this.wizContrato({ renovarCuenta: true, agregar: true });
  },

  /* ═════════ Wizards: reemplazo y demo ═════════ */

  // Catálogo de modelos (colección `modelos`) — regla de Alberto 2026-08-26:
  // los wizards SIEMPRE ofrecen la lista real, nunca texto libre.
  modelos: null,
  async _cargarModelos() {
    if (this.modelos) return this.modelos;
    try {
      const todos = await ModelosService.getModelos();
      this.modelos = (todos || [])
        .filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim() }))
        .filter(m => m.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('[centro] catálogo de modelos no disponible:', e?.message || e);
      this.modelos = [];
    }
    return this.modelos;
  },
  // <select> del catálogo. Preselecciona por id del catálogo o por label.
  _selModelo(attrs, selId, selLabel) {
    const up = String(selLabel || '').trim().toUpperCase();
    const opts = (this.modelos || []).map(m => {
      const sel = (selId && m.id === selId)
        || (!selId && up && (m.label.toUpperCase() === up || (up && m.label.toUpperCase().includes(up))));
      return `<option value="${this.esc(m.id)}" ${sel ? 'selected' : ''}>${this.esc(m.label)}</option>`;
    }).join('');
    return `<select class="form-select" ${attrs}><option value="">— Modelo —</option>${opts}</select>`;
  },
  _modeloDeSelect(sel) {
    const id = sel?.value || '';
    if (!id) return null;
    const m = (this.modelos || []).find(x => x.id === id);
    return m ? { id: m.id, label: m.label } : null;
  },

  MOTIVOS: [
    ['dano_no_reparable', 'Dañado — no reparable (diagnóstico de taller)'],
    ['falla_recurrente', 'Falla recurrente'],
    ['garantia_fabrica', 'Garantía de fábrica'],
    ['actualizacion', 'Actualización de modelo'],
    ['servicio_cliente', 'Servicio al cliente'],
    ['otro', 'Otro'],
  ],

  _abrirModal(html) {
    const m = document.getElementById('cgModal');
    m.innerHTML = `<div class="cg-modal" role="dialog" aria-modal="true">${html}</div>`;
    m.classList.remove('hidden');
    m.onclick = (e) => { if (e.target === m) this._cerrarModal(); };
    document.addEventListener('keydown', this._escModal);
    setTimeout(() => m.querySelector('input:not([type=hidden]), select, textarea, button')?.focus(), 60);
  },

  // Anatomía del kit (header fijo + cuerpo scrolleable + footer fijo) para los
  // modales largos: el título y las acciones nunca se pierden con el scroll.
  _abrirModalA({ titulo, cuerpo, footer }) {
    const m = document.getElementById('cgModal');
    m.innerHTML = `<div class="cg-modal cg-modal--anatomia" role="dialog" aria-modal="true" aria-labelledby="cgModalT">
      <div class="cg-modal-hd"><h3 id="cgModalT">${titulo}</h3>
        <button type="button" class="cg-x" aria-label="Cerrar" onclick="Centro._cerrarModal()">✕</button></div>
      <div class="cg-modal-bd">${cuerpo}</div>
      ${footer ? `<div class="cg-modal-ft">${footer}</div>` : ''}
    </div>`;
    m.classList.remove('hidden');
    m.onclick = (e) => { if (e.target === m) this._cerrarModal(); };
    document.addEventListener('keydown', this._escModal);
    setTimeout(() => m.querySelector('.cg-modal-bd input:not([type=hidden]), .cg-modal-bd select, .cg-modal-bd textarea, .cg-modal-bd button')?.focus(), 60);
  },
  _cerrarModal() {
    document.getElementById('cgModal')?.classList.add('hidden');
    document.removeEventListener('keydown', Centro._escModal);
  },
  _escModal(e) { if (e.key === 'Escape') Centro._cerrarModal(); },

  // Elegibilidad de un equipo del pool para reemplazo (decisiones §8):
  // alquiler siempre; propio adquirido en CECOMUNICA siempre (sin garantía →
  // excepción con aprobación admin); comprado fuera → bloqueado.
  _eleg(e) {
    if (!['en_cliente', 'asignado_contrato'].includes(e.estado)) {
      return { ok: false, label: 'No disponible', why: `El equipo no está con el cliente (${e.estado}).` };
    }
    if (e.propiedad === 'cliente') {
      if (!e.venta) return { ok: false, label: 'No adquirido en CECOMUNICA', why: 'Equipo del cliente comprado fuera — no aplica reemplazo.' };
      const v = e.venta.garantia_vence;
      const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null);
      if (d && !isNaN(d) && d > new Date()) {
        return { ok: true, code: 'propio_garantia', label: `Propio · garantía hasta ${d.toLocaleDateString('es-PA', { month: 'short', year: 'numeric' })}` };
      }
      return { ok: true, code: 'propio_excepcion', label: 'Propio · sin garantía',
               why: 'Se permite por servicio al cliente — requiere aprobación de administración.' };
    }
    return { ok: true, code: 'alquiler', label: e.propiedad === 'desconocida' ? 'Alquiler (propiedad por confirmar)' : 'Alquiler' };
  },

  async wizReemplazo() {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await this._cargarModelos();
    const filas = this.equipos.map((e, ix) => {
      const el = this._eleg(e);
      return `<tr style="${el.ok ? '' : 'opacity:.5;'}">
        <td>${el.ok ? `<input type="checkbox" data-wsel="${ix}" onchange="Centro._wizFila(${ix}, this.checked)">` : ''}</td>
        <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
        <td>${this.esc(e.modelo_label || '—')}</td>
        <td class="cg-mono" style="font-size:12px;">${this.esc(e.asignacion?.contrato_id || '—')}</td>
        <td style="font-size:12.5px;">${this.esc(el.label)}${el.why ? `<br><span style="color:var(--fg-4);font-size:11.5px;">${this.esc(el.why)}</span>` : ''}</td>
      </tr>
      <tr id="wcfg-${ix}" class="hidden"><td></td><td colspan="4" style="background:var(--surface-sunken, #EEF2F6);">
        <div style="display:flex; gap:10px; flex-wrap:wrap; padding:4px 0;">
          <select class="form-select" data-wmot="${ix}" style="max-width:280px;">
            <option value="">— Motivo —</option>
            ${this.MOTIVOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
          </select>
          ${this._selModelo(`data-wmod="${ix}" style="max-width:220px;"`, e.modelo_id, e.modelo_label)}
          <input class="form-input" data-wdet="${ix}" style="flex:1; min-width:180px;" placeholder="Detalle (opcional)">
        </div></td></tr>`;
    }).join('');
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Nueva solicitud de reemplazo — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        Marca los seriales a reemplazar (pueden ser de contratos distintos) e indica motivo y modelo.
        Al enviar, Bodega recibe el aviso; si hay un propio sin garantía, primero pasa por aprobación de administración.</p>
      <div class="cg-twrap" style="max-height:44vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th><th>Elegibilidad</th>
        </tr></thead><tbody>${filas || '<tr><td colspan="5" class="cg-empty">El cliente no tiene equipos en campo.</td></tr>'}</tbody></table></div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearReemplazo()">Enviar solicitud</button>
      </div>`);
  },

  _wizFila(ix, on) {
    document.getElementById(`wcfg-${ix}`)?.classList.toggle('hidden', !on);
  },

  async crearReemplazo() {
    const seleccion = [...document.querySelectorAll('input[data-wsel]:checked')].map(i => Number(i.dataset.wsel));
    if (!seleccion.length) { Toast.show('Marca al menos un serial', 'warn'); return; }
    const items = [];
    for (const ix of seleccion) {
      const e = this.equipos[ix];
      const el = this._eleg(e);
      const motivo = document.querySelector(`select[data-wmot="${ix}"]`)?.value || '';
      if (!motivo) { Toast.show(`Indica el motivo del serial ${e.serial}`, 'warn'); return; }
      const contrato = this.contratos.find(c => c.id === e.asignacion?.contrato_doc_id);
      const modeloSel = this._modeloDeSelect(document.querySelector(`select[data-wmod="${ix}"]`));
      if (!modeloSel) { Toast.show(`Elige el modelo de reemplazo del serial ${e.serial} (lista de modelos)`, 'warn'); return; }
      items.push({
        serial_saliente: e.serial || e.id,
        pool_doc_id_saliente: e.id,
        modelo: e.modelo_label || '',
        modelo_id: e.modelo_id || null,
        contrato_doc_id: e.asignacion?.contrato_doc_id || null,
        contrato_id: e.asignacion?.contrato_id || contrato?.contrato_id || null,
        elegibilidad: el.code || 'alquiler',
        motivo_codigo: motivo,
        motivo_detalle: document.querySelector(`input[data-wdet="${ix}"]`)?.value.trim() || '',
        modelo_solicitado: modeloSel.label,
        modelo_solicitado_id: modeloSel.id,
        serial_nuevo: null, pool_doc_id_nuevo: null,
      });
    }
    const requiereAprobacion = items.some(it => it.elegibilidad === 'propio_excepcion');
    try {
      const gid = await GestionesService.crear({
        tipo: 'reemplazo',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: requiereAprobacion ? 'pendiente_aprobacion' : 'pendiente_bodega',
        origen: { tipo: 'vendedor' },
        items,
        ...(requiereAprobacion ? { aprobacion: { requiere: true } } : {}),
      });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(requiereAprobacion
        ? `Solicitud ${gid} creada — espera aprobación de administración`
        : `Solicitud ${gid} enviada — Bodega recibirá el aviso`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear la solicitud', 'bad'); }
  },

  // Fila de línea modelo (+cantidad, +precio opcional) con el SELECT del catálogo.
  _lineaModeloHtml(pref, conPrecio) {
    return `<div style="display:flex; gap:8px; margin-bottom:8px;">
      ${this._selModelo(`data-${pref}-modelo style="flex:1;"`)}
      <input class="form-input" data-${pref}-cant type="number" min="1" value="1" style="width:86px;" title="Cantidad">
      ${conPrecio ? `<input class="form-input" data-${pref}-precio type="number" min="0" step="0.01" placeholder="$/mes" style="width:110px;" title="Precio mensual">` : ''}
    </div>`;
  },
  _addLineaModelo(contId, pref, conPrecio) {
    document.getElementById(contId)?.insertAdjacentHTML('beforeend', this._lineaModeloHtml(pref, conPrecio));
  },

  async wizDemo() {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await this._cargarModelos();
    const hoy = new Date().toISOString().slice(0, 10);
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Nueva solicitud de demo — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
        Bodega asigna los seriales (stock nuevo o refurbished), el sistema crea la OS de programación
        y al retorno los equipos pasan por inspección antes de volver a Disponible.</p>
      <div id="wdLineas">${this._lineaModeloHtml('wdl')}</div>
      <button class="btn btn-ghost" style="padding:4px 10px; font-size:12.5px; margin-bottom:12px;"
        onclick="Centro._addLineaModelo('wdLineas','wdl')">+ Agregar otro modelo</button>
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Motivo o finalidad del demo</label>
        <textarea class="form-input form-textarea" id="wdFin" placeholder="Ej.: prueba de cobertura previa a alquiler…"></textarea>
      </div>
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:4px;">
        <div class="form-field"><label class="form-label">Fecha de salida</label>
          <input class="form-input" type="date" id="wdSalida" value="${hoy}"></div>
        <div class="form-field"><label class="form-label">Devolución estimada (opcional)</label>
          <input class="form-input" type="date" id="wdDevol"></div>
      </div>
      <p style="font-size:12px; color:var(--fg-4); margin:0 0 10px;">Sin fecha estimada, el recordatorio
        al responsable sale a los 15 días de la salida; con fecha, al vencerse.</p>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearDemo()">Enviar solicitud</button>
      </div>`);
  },

  async crearDemo() {
    const selects = [...document.querySelectorAll('select[data-wdl-modelo]')];
    const cants = [...document.querySelectorAll('input[data-wdl-cant]')];
    const lineas = selects.map((s, i) => {
      const m = this._modeloDeSelect(s);
      return m ? { modelo: m.label, modelo_id: m.id, cantidad: Math.max(1, Number(cants[i]?.value || 1)) } : null;
    }).filter(Boolean);
    const finalidad = document.getElementById('wdFin')?.value.trim() || '';
    const salida = document.getElementById('wdSalida')?.value || '';
    if (!lineas.length) { Toast.show('Indica al menos un modelo', 'warn'); return; }
    if (!finalidad) { Toast.show('Indica la finalidad del demo', 'warn'); return; }
    try {
      const gid = await GestionesService.crear({
        tipo: 'demo',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_bodega',
        origen: { tipo: 'vendedor' },
        items: [],
        demo: {
          lineas, finalidad,
          fecha_salida: salida,
          fecha_devolucion_estimada: document.getElementById('wdDevol')?.value || null,
          seriales_asignados: [],
        },
      });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`Solicitud ${gid} enviada — Bodega recibirá el aviso`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear la solicitud', 'bad'); }
  },

  /* ═════════ Wizard: aumento por enmienda firmada (Ola 4) ═════════ */

  // Catálogo de cargos (colección `cargos`, el mismo del contrato).
  cargosCat: null,
  async _cargarCargos() {
    if (this.cargosCat) return this.cargosCat;
    try {
      const all = (typeof CargosService !== 'undefined') ? await CargosService.getCargos() : [];
      this.cargosCat = (all || []).filter(c => c.activo !== false)
        .sort((a, b) => String(a.concepto || '').localeCompare(String(b.concepto || ''), 'es'));
    } catch (e) { console.warn('[centro] catálogo de cargos no disponible:', e?.message || e); this.cargosCat = []; }
    return this.cargosCat;
  },

  _cargoLineaHtml() {
    const opts = (this.cargosCat || []).map(c =>
      `<option value="${this.esc(c.id)}" data-monto="${Number(c.monto_default) || 0}" data-rec="${c.recurrente ? 1 : 0}">${this.esc(c.concepto || '')}</option>`).join('');
    return `<div class="wa-cargo" style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
      <select class="form-select" data-wac-sel style="flex:1;" onchange="Centro._cargoSelChange(this)">
        <option value="">— cargo del catálogo —</option>${opts}</select>
      <input class="form-input" data-wac-cant type="number" min="1" value="1" style="width:70px;" title="Cantidad" onchange="Centro._previewTarifario()">
      <input class="form-input" data-wac-monto type="number" min="0" step="0.01" placeholder="$" style="width:100px;" onchange="Centro._previewTarifario()">
      <select class="form-select" data-wac-tipo style="width:110px;" onchange="Centro._previewTarifario()">
        <option value="unico">Único</option><option value="recurrente">Mensual</option></select>
      <button type="button" class="btn btn-ghost" style="padding:4px 8px;" title="Quitar"
        onclick="this.parentElement.remove(); Centro._previewTarifario()">✕</button>
    </div>`;
  },
  _cargoSelChange(sel) {
    const opt = sel.selectedOptions[0];
    const fila = sel.parentElement;
    if (opt && opt.value) {
      const m = Number(opt.dataset.monto) || 0;
      const monto = fila.querySelector('[data-wac-monto]');
      if (m && !monto.value) monto.value = m;
      fila.querySelector('[data-wac-tipo]').value = opt.dataset.rec === '1' ? 'recurrente' : 'unico';
    }
    this._previewTarifario();
  },
  // Las filas de cargos las comparten el aumento (#waTot) y el wizard de
  // contrato (#wcTot); cada preview no-opea si su contenedor no está.
  _previewTarifario() { this._aumPreview(); this._wcPreview(); },

  // Lector genérico de líneas modelo·cantidad·precio (los data-attrs que
  // pinta _lineaModeloHtml). Lo comparten el aumento (wau) y el contrato (wcm).
  _lineasModelo(pref) {
    const selects = [...document.querySelectorAll(`select[data-${pref}-modelo]`)];
    const cants = [...document.querySelectorAll(`input[data-${pref}-cant]`)];
    const precios = [...document.querySelectorAll(`input[data-${pref}-precio]`)];
    return selects.map((s, i) => {
      const m = this._modeloDeSelect(s);
      return m ? { modelo: m.label, modelo_id: m.id,
        cantidad: Math.max(1, Number(cants[i]?.value || 1)), precio: Number(precios[i]?.value || 0) } : null;
    }).filter(Boolean);
  },
  _aumLineas() { return this._lineasModelo('wau'); },
  _aumCargos() {
    return [...document.querySelectorAll('.wa-cargo')].map(f => {
      const sel = f.querySelector('[data-wac-sel]');
      const opt = sel?.selectedOptions[0];
      return {
        cargo_id: sel?.value || '',
        concepto: opt ? (opt.textContent || '').trim() : '',
        cantidad: Math.max(1, Math.round(Number(f.querySelector('[data-wac-cant]')?.value)) || 1),
        monto: Math.max(0, Number(f.querySelector('[data-wac-monto]')?.value || 0)),
        recurrente: f.querySelector('[data-wac-tipo]')?.value === 'recurrente',
      };
    }).filter(c => c.cargo_id && c.monto > 0);
  },

  // Aritmética del contrato — delega en js/domain/contratoTarifario.js (la
  // misma que usa nc-form y el wizard de contrato). Este adaptador conserva
  // la forma snake_case que ya persiste `gestiones.aumento.totales`.
  _totAumento(lineas, cargos, itbmsAplica) {
    const t = ContratoTarifario.totales(lineas, cargos, !!itbmsAplica);
    return {
      equipos_sub: t.equiposSub, cargos_rec: t.cargosRec, cargos_uni: t.cargosUni,
      itbms_aplica: t.itbmsAplica, itbms_porcentaje: t.itbmsPorc,
      itbms_mensual: t.itbmsMonto, total_mensual: t.totalConITBMS,
      itbms_unico: t.itbmsUni, primer_pago: t.primerPago,
    };
  },

  // Render del bloque tarifario (t en la forma snake_case de _totAumento).
  _tarifarioHtml(t) {
    const f = (n) => `$${Number(n || 0).toFixed(2)}`;
    const fila = (l, v, b) => `<div style="display:flex; font-size:13px; padding:2px 0;">
      <span${b ? ' style="font-weight:700;"' : ''}>${l}</span><span class="num" style="margin-left:auto;${b ? 'font-weight:700;' : ''}">${v}</span></div>`;
    return fila('Equipos (mensual)', f(t.equipos_sub))
      + (t.cargos_rec ? fila('Cargos mensuales', f(t.cargos_rec)) : '')
      + (t.itbms_aplica ? fila(`ITBMS (${(t.itbms_porcentaje * 100).toFixed(0)}%)`, f(t.itbms_mensual)) : fila('ITBMS', 'Exento'))
      + fila('TOTAL MENSUAL', f(t.total_mensual), true)
      + (t.cargos_uni ? (
          `<div style="border-top:1px solid var(--border-subtle); margin-top:4px; padding-top:4px;"></div>`
          + fila('Cargos únicos', f(t.cargos_uni))
          + (t.itbms_aplica ? fila('ITBMS únicos', f(t.itbms_unico)) : '')
          + fila('PRIMER PAGO (mes 1 + únicos)', f(t.primer_pago), true)) : '');
  },

  _aumPreview() {
    const cont = document.getElementById('waTot');
    if (!cont) return;
    const t = this._totAumento(this._aumLineas(), this._aumCargos(),
      document.getElementById('waItbms')?.checked !== false);
    cont.innerHTML = this._tarifarioHtml(t);
  },

  async wizAumento(preselId, opts = {}) {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await Promise.all([this._cargarModelos(), this._cargarCargos()]);
    const activos = this.contratos.filter(c => this._esVigente(c));
    if (!activos.length) { Toast.show('El cliente no tiene contratos vigentes', 'warn'); return; }
    // ITBMS por defecto: hereda del contrato destino; cliente exento manda.
    const cBase = activos.find(c => c.id === preselId) || activos[0];
    const itbmsDefault = this.cliente?.itbms_exento === true ? false : (cBase?.itbms_aplica !== false);
    // Ancla automática (cuenta fragmentada): el destino NO se pregunta — se
    // informa. Y la consolidación se OFRECE cuando conviene, sin imponerla.
    const est = this._cuentaEstado();
    const nudge = est.tipo === 'fragmentada' && (est.custodia || est.renovables.some(c => this._wcEnVentana(c)))
      ? `<div class="cg-senal warn" style="margin-bottom:10px; align-items:center;">
          <span>Esta cuenta tiene <b>${est.renovables.length} contrato(s)</b>${est.custodia ? ` y <b>${est.custodia} radio(s) sin contrato formal</b>` : ''} —
          si el cliente está por renovar, este es el momento de consolidarla.</span>
          <button class="btn btn-primary" style="margin-left:auto; flex:none; padding:3px 11px; font-size:12px;"
            onclick="Centro.wizContrato({renovarCuenta:true, agregar:true})">Mejor renovar la cuenta</button></div>` : '';
    const destinoHtml = opts.ancla
      ? `<div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Anexo a la cuenta</label>
          <p style="margin:0; font-size:13px;">Se cuelga del contrato ancla
            <span class="cg-mono">${this.esc(cBase.contrato_id || cBase.id)}</span>
            <span style="color:var(--fg-4);">(el de mayor facturación — se elige solo; el tramo tiene vigencia propia)</span></p>
          <select id="waContrato" class="hidden"><option value="${this.esc(cBase.id)}" selected></option></select></div>`
      : `<div class="form-field" style="margin-bottom:10px; max-width:340px;">
          <label class="form-label">Contrato destino</label>
          <select class="form-select" id="waContrato">
            ${activos.map(c => `<option value="${this.esc(c.id)}" ${c.id === preselId ? 'selected' : ''}>${this.esc(c.contrato_id || c.id)} · ${this.esc(c.tipo_contrato || '')}</option>`).join('')}
          </select></div>`;
    this._abrirModalA({
      titulo: `Aumento de equipos (enmienda) — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        La enmienda agrega líneas <b>con vigencia propia</b>: el período del equipo
        nuevo corre desde su entrega y vence más tarde que el resto — el anexo lo deja explícito y
        <b>requiere la firma del cliente</b> antes de aplicarse.</p>
      ${nudge}
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Destino del anexo</div>
        ${destinoHtml}
      </div>
      <div oninput="Centro._aumPreview()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Equipos y conceptos</div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
          <div id="waLineas">${this._lineaModeloHtml('wau', true)}</div>
          <button class="btn btn-ghost cg-act"
            onclick="Centro._addLineaModelo('waLineas','wau',true); Centro._aumPreview()">+ Agregar otro modelo</button></div>
        <div class="form-field" style="margin-bottom:4px;">
          <label class="form-label">Otros conceptos (cargos del catálogo — únicos o mensuales)</label>
          <div id="waCargos"></div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('waCargos').insertAdjacentHTML('beforeend', Centro._cargoLineaHtml())">+ Agregar cargo</button></div>
      </div>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">3</span> Vigencia y totales</div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; margin-bottom:10px;">
          <div class="form-field" style="margin:0; max-width:180px;">
            <label class="form-label" for="waMeses">Vigencia del tramo (meses)</label>
            <input class="form-input" type="number" id="waMeses" min="1" value="18"></div>
          <label class="cg-toggle" style="margin-bottom:2px;">
            <input type="checkbox" id="waItbms" ${itbmsDefault ? 'checked' : ''} onchange="Centro._aumPreview()">
            Aplica ITBMS${this.cliente?.itbms_exento === true ? ' <span style="color:var(--fg-4);">(cliente exento)</span>' : ''}
          </label>
        </div>
        <div id="waTot" class="ds-card" style="padding:10px 14px; max-width:380px;"></div>
      </div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearAumento()">Enviar a aprobación</button>`,
    });
    this._aumPreview();
  },

  async crearAumento() {
    const contratoDocId = document.getElementById('waContrato')?.value || '';
    const contrato = this.contratos.find(c => c.id === contratoDocId);
    if (!contrato) { Toast.show('Elige el contrato destino', 'warn'); return; }
    const lineas = this._aumLineas();
    if (!lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
    if (lineas.some(l => !(l.precio > 0))) { Toast.show('Cada línea necesita su precio mensual', 'warn'); return; }
    const meses = Number(document.getElementById('waMeses')?.value || 0);
    if (!(meses > 0)) { Toast.show('Indica la vigencia del tramo en meses', 'warn'); return; }
    const cargos = this._aumCargos();
    const itbmsAplica = document.getElementById('waItbms')?.checked !== false;
    const totales = this._totAumento(lineas, cargos, itbmsAplica);
    try {
      const gid = await GestionesService.crear({
        tipo: 'aumento',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_aprobacion',
        origen: { tipo: 'vendedor' },
        items: [],
        cierre: {},
        aprobacion: { requiere: true },
        aumento: {
          contrato_doc_id: contrato.id,
          contrato_id: contrato.contrato_id || contrato.id,
          lineas,
          cargos,
          itbms: { aplica: itbmsAplica, porcentaje: totales.itbms_porcentaje },
          totales,
          duracion_meses: meses,
          seriales_asignados: [],
        },
      });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`Aumento ${gid} enviado a aprobación comercial`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear el aumento', 'bad'); }
  },

  /* ═════════ Wizard: nuevo contrato / renovación (Ola 7) ═════════ */

  // Contrato desde la ficha del cliente, sin pasar por el formulario clásico.
  // Escribe EXACTAMENTE el mismo doc (ContratoTarifario.construirDoc) con el
  // mismo correlativo y estado inicial, así que la aprobación, la solicitud de
  // seriales a bodega, el PDF y la activación por firmado corren igual.
  // opts: id de contrato (Renovar de la fila) · {renovarCuenta:true} (consolida
  // los que están en ventana; sin contratos = regularización vía legacy) · nada.
  TIPOS_CONTRATO: { ALQ: 'Alquiler', PROP: 'Propio', DEMO: 'Demo', TEMP: 'Temporal' },

  _lineaModeloPre(pref, conPrecio, l) {
    return `<div style="display:flex; gap:8px; margin-bottom:8px;">
      ${this._selModelo(`data-${pref}-modelo style="flex:1;"`, l?.modelo_id, l?.modelo)}
      <input class="form-input" data-${pref}-cant type="number" min="1" value="${Math.max(1, Number(l?.cantidad || 1))}" style="width:86px;" title="Cantidad">
      ${conPrecio ? `<input class="form-input" data-${pref}-precio type="number" min="0" step="0.01" placeholder="$/mes" value="${l?.precio != null && l.precio !== '' ? Number(l.precio).toFixed(2) : ''}" style="width:110px;" title="Precio mensual">` : ''}
      <button type="button" class="btn btn-ghost" style="padding:4px 8px;" title="Quitar"
        onclick="this.parentElement.remove(); Centro._previewTarifario()">✕</button>
    </div>`;
  },

  _wcCandidatos() {
    return this.contratos.filter(c => this._esVigente(c) && !c.deleted);
  },
  _wcEnVentana(c) {
    if (!this._aplicaVenc(c) || this._renovadoPor(c)) return false;
    const dias = this._diasA(c.fecha_vencimiento);
    return dias !== null && dias <= this.AVISO_DIAS;
  },
  _wcCustodia() {
    return this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id);
  },
  // Fusión de líneas por modelo: suma cantidades; el precio queda el PRIMERO
  // > 0 en el orden dado (las líneas llegan del contrato más reciente primero,
  // así que gana la tarifa vigente). Clave por modelo_id o por label normalizado.
  _wcMergeLineas(lineas) {
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const out = new Map();
    for (const l of lineas) {
      if (!l) continue;
      const k = l.modelo_id || norm(l.modelo);
      if (!k) continue;
      const cur = out.get(k);
      if (!cur) out.set(k, { modelo_id: l.modelo_id || null, modelo: l.modelo || '',
        cantidad: Number(l.cantidad) || 0, precio: Number(l.precio) > 0 ? Number(l.precio) : '' });
      else {
        cur.cantidad += Number(l.cantidad) || 0;
        if (!(cur.precio > 0) && Number(l.precio) > 0) cur.precio = Number(l.precio);
      }
    }
    return [...out.values()];
  },

  async wizContrato(opts) {
    if (!this.puedeCrearGestion()) { Toast.show('Tu rol no crea contratos desde aquí', 'warn'); return; }
    if (typeof opts === 'string') opts = { renovarDe: opts };
    opts = opts || {};
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await Promise.all([this._cargarModelos(), this._cargarCargos()]);

    const candidatos = this._wcCandidatos();
    let preIds = [];
    if (opts.renovarDe) preIds = candidatos.some(c => c.id === opts.renovarDe) ? [opts.renovarDe] : [];
    // "Renovar cuenta" = CONSOLIDACIÓN (Alberto 2026-08-28, caso SEPROSA):
    // preselecciona TODOS los contratos vigentes renovables del cliente —
    // adiciones y reemplazos incluidos — para que la renovación los unifique
    // en UN contrato y muera el overhang de contratitos por cliente.
    else if (opts.renovarCuenta) {
      preIds = candidatos.filter(c => this._aplicaVenc(c) && !this._renovadoPor(c)).map(c => c.id);
    }
    const esRenov = !!(opts.renovarDe || opts.renovarCuenta);
    const custodia = this._wcCustodia();
    // Regularización: cuenta sin contratos en el sistema → escape legacy.
    const legacyAuto = esRenov && !preIds.length && !candidatos.length;

    // Prefill de líneas: copia del/los contratos que se renuevan (los más
    // recientes primero — su tarifa es la vigente); en "Renovar cuenta" suma
    // la custodia agrupada por modelo (sin precio — lo fija el vendedor).
    // Después se FUSIONA por modelo: una consolidación de 13 contratitos no
    // debe salir con 13 líneas repetidas del mismo radio. Todo editable.
    let lineas = [];
    const origenesSel = preIds.map(id => candidatos.find(x => x.id === id)).filter(Boolean)
      .sort((a, b) => String(b.contrato_id || '').localeCompare(String(a.contrato_id || '')));
    for (const c of origenesSel) {
      (c.equipos || []).forEach(l => lineas.push({ modelo_id: l.modelo_id, modelo: l.modelo, cantidad: l.cantidad, precio: l.precio }));
    }
    if (opts.renovarCuenta && custodia.length) {
      const porModelo = new Map();
      custodia.forEach(e => {
        const k = e.modelo_id || (e.modelo_label || '?');
        const cur = porModelo.get(k) || { modelo_id: e.modelo_id || null, modelo: e.modelo_label || '', cantidad: 0, precio: '' };
        cur.cantidad += 1; porModelo.set(k, cur);
      });
      porModelo.forEach(l => lineas.push(l));
    }
    lineas = this._wcMergeLineas(lineas);
    // "Agregar equipos" (cuenta fragmentada): la venta nueva entra en la misma
    // renovación consolidadora — línea en blanco lista para el equipo nuevo.
    if (opts.agregar) lineas.push(null);
    if (!lineas.length) lineas.push(null);

    const itbmsDefault = this.cliente?.itbms_exento === true ? false
      : (preIds.length ? (candidatos.find(c => c.id === preIds[0])?.itbms_aplica !== false) : true);

    const origenChks = candidatos.map(c => {
      const v = this._aplicaVenc(c) ? this._diasA(c.fecha_vencimiento) : null;
      const chip = v === null ? '' : v < 0 ? ` <span class="cg-venc vencido num">vencido ${-v} d</span>`
        : v <= this.AVISO_DIAS ? ` <span class="cg-venc por_vencer num">${v} d</span>` : '';
      return `<label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:3px 0;">
        <input type="checkbox" data-wco value="${this.esc(c.id)}" ${preIds.includes(c.id) ? 'checked' : ''}
          onchange="Centro._wcSyncPlan()" style="width:auto; margin:0;">
        <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>
        <span style="color:var(--fg-3);">${this.esc(c.tipo_contrato || '')} · ${this._unidadesActivas(c)} unid.</span>${chip}</label>`;
    }).join('');

    this._abrirModalA({
      titulo: `${opts.renovarCuenta ? 'Renovar cuenta (consolidación)' : esRenov ? 'Renovación' : 'Nuevo contrato'} — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 14px; font-size:13px; color:var(--fg-3); max-width:72ch;">
        El contrato nace <b>pendiente de aprobación</b> con el mismo flujo de siempre (aprobación →
        seriales de bodega → firma → activo).
        ${opts.renovarCuenta && preIds.length > 1 ? `Esta renovación <b>consolida los ${preIds.length} contratos
        marcados en UNO solo</b>: al activarse quedan marcados como renovados y pasan al histórico de la ficha.` : ''}
        ${custodia.length ? `<b>${custodia.length} equipo(s) en campo sin
        contrato formal</b> — al renovar, la cuenta los cubre.` : ''}
        ${opts.agregar ? `<b>La última línea de equipos está en blanco para la venta nueva</b> — elige el modelo,
        cantidad y precio; bodega asignará los seriales solo de los equipos nuevos.` : ''}</p>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Datos del contrato <span class="hint">tipo · acción · duración</span></div>
        <div style="display:flex; gap:16px; flex-wrap:wrap;">
          <div class="form-field" style="margin:0; max-width:170px;">
            <label class="form-label" for="wcTipo">Tipo</label>
            <select class="form-select" id="wcTipo" onchange="Centro._wcSyncTipo()">
              ${Object.entries(this.TIPOS_CONTRATO).map(([k, v]) =>
                `<option value="${k}" ${k === 'ALQ' ? 'selected' : ''}>${v}</option>`).join('')}
            </select></div>
          <div class="form-field" style="margin:0; max-width:170px;">
            <label class="form-label" for="wcAccion">Acción</label>
            <select class="form-select" id="wcAccion" onchange="Centro._wcSyncTipo()">
              <option value="Nuevo" ${!esRenov ? 'selected' : ''}>Nuevo</option>
              <option value="Renovación" ${esRenov ? 'selected' : ''}>Renovación</option>
              <option value="Adición">Adición</option>
              <option value="No Aplica">No Aplica</option>
            </select></div>
          <div class="form-field" style="margin:0; max-width:150px;">
            <label class="form-label" for="wcMeses">Duración (meses)</label>
            <input class="form-input" type="number" id="wcMeses" min="1" value="12"></div>
        </div>
        <div id="wcRenovBloque" class="${esRenov ? '' : 'hidden'}" style="margin-top:8px;">
          <label class="cg-toggle">
            <input type="checkbox" id="wcSinEquipo"> Renovación sin equipo (los radios actuales continúan)
          </label>
          <label class="cg-toggle" style="margin-left:8px;">
            <input type="checkbox" id="wcRefurb"> Refurbished / componentes
          </label>
        </div>
      </div>

      <div id="wcOrigenBloque" class="cg-paso ${esRenov ? '' : 'hidden'}">
        <div class="cg-paso-t"><span class="n">2</span> Contratos que se renuevan
          <span class="hint">${opts.renovarCuenta ? 'preseleccionados — la consolidación los absorbe todos' : 'el origen define qué equipos transicionan'}</span></div>
        <div class="form-field" style="margin-bottom:10px;">
          ${origenChks || '<p style="font-size:13px; color:var(--fg-3); margin:0;">El cliente no tiene contratos vigentes en el sistema.</p>'}
          <label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:6px 0 0;">
            <input type="checkbox" id="wcLegacy" ${legacyAuto ? 'checked' : ''} onchange="Centro._wcSyncPlan()" style="width:auto; margin:0;">
            El contrato original es de papel / no está en el sistema</label>
          <input class="form-input" id="wcLegacyRef" placeholder="Referencia del contrato en papel…" aria-label="Referencia del contrato en papel"
            value="${legacyAuto ? 'Cuenta sin contrato en sistema — regularización' : ''}"
            style="margin-top:6px; max-width:420px; ${legacyAuto ? '' : 'display:none;'}">
        </div>
        <div class="form-field" style="margin-bottom:4px;">
          <label class="form-label">Plan de transición de los equipos del origen</label>
          <div id="wcPlan" class="cg-twrap"></div>
        </div>
      </div>

      <div oninput="Centro._wcPreview()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">3</span> Equipos y tarifas
          <span class="hint">fusionados por modelo — la tarifa vigente manda</span></div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
          <div id="wcLineas">${lineas.map(l => this._lineaModeloPre('wcm', true, l)).join('')}</div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('wcLineas').insertAdjacentHTML('beforeend', Centro._lineaModeloPre('wcm', true)); Centro._wcPreview()">+ Agregar otro modelo</button></div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Otros conceptos (cargos del catálogo — únicos o mensuales)</label>
          <div id="wcCargos"></div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('wcCargos').insertAdjacentHTML('beforeend', Centro._cargoLineaHtml())">+ Agregar cargo</button></div>
        <label class="cg-toggle">
          <input type="checkbox" id="wcItbms" ${itbmsDefault ? 'checked' : ''} onchange="Centro._wcPreview()">
          Aplica ITBMS${this.cliente?.itbms_exento === true ? ' <span style="color:var(--fg-4);">(cliente exento)</span>' : ''}
        </label>
        <div id="wcTot" class="ds-card" style="padding:10px 14px; max-width:380px; margin-top:10px;"></div>
      </div>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">4</span> Observaciones <span class="hint">opcional</span></div>
        <textarea class="form-input" id="wcObs" rows="2" style="resize:vertical;" aria-label="Observaciones"></textarea>
      </div>
      </div>`,
      footer: `
        <a href="../contratos/nuevo-contrato.html" class="btn-quiet">Formulario clásico ›</a>
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="wcGuardar" onclick="Centro.crearContrato()">Guardar contrato</button>`,
    });
    document.getElementById('wcLegacy')?.addEventListener('change', (e) => {
      const ref = document.getElementById('wcLegacyRef');
      if (ref) ref.style.display = e.target.checked ? '' : 'none';
    });
    this._wcSyncPlan();
    this._wcPreview();
  },

  _wcSyncTipo() {
    const tipo = document.getElementById('wcTipo')?.value || 'ALQ';
    const acc = document.getElementById('wcAccion');
    if (!acc) return;
    if (tipo === 'DEMO' || tipo === 'TEMP') { acc.value = 'No Aplica'; acc.disabled = true; }
    else {
      acc.disabled = false;
      if (acc.value === 'No Aplica') acc.value = 'Nuevo';
    }
    const sel = { accion: acc.value, codigo_tipo: tipo };
    document.getElementById('wcOrigenBloque')?.classList.toggle('hidden', !OrigenContrato.aplica(sel));
    document.getElementById('wcRenovBloque')?.classList.toggle('hidden', acc.value !== 'Renovación');
    this._wcSyncPlan();
  },

  _wcOrigenIds() {
    return [...document.querySelectorAll('input[data-wco]:checked')].map(i => i.value);
  },

  // Unidades del pool de los contratos origen elegidos → plan por serial con
  // destino editable (default: continúa — es una renovación, no una excepción).
  _wcSyncPlan() {
    const cont = document.getElementById('wcPlan');
    if (!cont) return;
    const sel = { accion: document.getElementById('wcAccion')?.value, codigo_tipo: document.getElementById('wcTipo')?.value };
    const ids = this._wcOrigenIds();
    if (!TransicionPlan.aplica(sel) || !ids.length) { cont.innerHTML = ''; return; }
    const unidades = this.equipos.filter(e =>
      ids.includes(e.asignacion?.contrato_doc_id) && ['en_cliente', 'asignado_contrato'].includes(e.estado));
    if (!unidades.length) {
      cont.innerHTML = '<p style="font-size:12.5px; color:var(--fg-3); margin:0;">El origen no tiene unidades con serial en el pool — el plan se resuelve con recepción.</p>';
      return;
    }
    cont.innerHTML = `<table class="cg-tabla"><thead><tr>
      <th>Serial</th><th>Modelo</th><th>Contrato</th><th>Destino</th></tr></thead><tbody>
      ${unidades.map(e => `<tr>
        <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
        <td>${this.esc(e.modelo_label || '—')}</td>
        <td class="cg-mono">${this.esc(e.asignacion?.contrato_id || '')}</td>
        <td><select class="form-select" data-wcp="${this.esc(e.id)}" style="min-width:130px;">
          <option value="continua" selected>Continúa</option>
          <option value="devuelve">Se devuelve</option>
          <option value="reemplaza">Se reemplaza</option>
        </select></td></tr>`).join('')}</tbody></table>`;
  },

  _wcPreview() {
    const cont = document.getElementById('wcTot');
    if (!cont) return;
    const cargos = [...document.querySelectorAll('#wcCargos .wa-cargo')].length
      ? this._aumCargos() : [];
    const t = this._totAumento(this._lineasModelo('wcm'), cargos,
      document.getElementById('wcItbms')?.checked !== false);
    cont.innerHTML = this._tarifarioHtml(t);
  },

  async crearContrato() {
    if (this._wcGuardando) return;
    const tipo = document.getElementById('wcTipo')?.value || '';
    const tipoNombre = this.TIPOS_CONTRATO[tipo] || tipo;
    const accion = document.getElementById('wcAccion')?.value || 'Nuevo';
    const meses = parseInt(document.getElementById('wcMeses')?.value || '0', 10);
    if (!tipo) { Toast.show('Elige el tipo de contrato', 'warn'); return; }
    if (!(meses > 0)) { Toast.show('Indica la duración en meses', 'warn'); return; }

    const lineas = this._lineasModelo('wcm');
    if (!lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
    if (['ALQ', 'PROP'].includes(tipo) && lineas.some(l => !(l.precio > 0))) {
      Toast.show('Cada línea necesita su precio mensual', 'warn'); return;
    }

    const candidatos = this._wcCandidatos();
    const origenIds = this._wcOrigenIds();
    const origenSel = {
      accion, codigo_tipo: tipo,
      legacy: !!document.getElementById('wcLegacy')?.checked,
      legacy_ref: (document.getElementById('wcLegacyRef')?.value || '').trim(),
      origen_ids: origenIds,
      origen_refs: origenIds.map(id => {
        const c = candidatos.find(x => x.id === id);
        return c ? (c.contrato_id || c.id) : id;
      }),
      candidatos: candidatos.length,
    };
    const vOrigen = OrigenContrato.validar(origenSel);
    if (!vOrigen.ok) { Toast.show(`⚠️ ${vOrigen.mensaje}`, 'warn'); return; }

    let plan = null;
    if (TransicionPlan.aplica(origenSel)) {
      const unidades = [...document.querySelectorAll('select[data-wcp]')].map(s => {
        const e = this.equipos.find(x => x.id === s.dataset.wcp);
        return e ? { pool_id: e.id, serial: e.serial || e.id, serial_norm: e.id,
          modelo_id: e.modelo_id || null, modelo: e.modelo_label || '', destino: s.value } : null;
      }).filter(Boolean);
      if (unidades.length) {
        plan = TransicionPlan.construirSerial(unidades, origenIds);
        const vPlan = TransicionPlan.validar(plan);
        if (!vPlan.ok) { Toast.show(`⚠️ ${vPlan.mensaje}`, 'warn'); return; }
      }
    }

    this._wcGuardando = true;
    const btn = document.getElementById('wcGuardar');
    if (btn) btn.disabled = true;
    try {
      // Correlativo {TIPO}{YYYYMMDD}-{NN}: mismo doble mecanismo del
      // formulario clásico (piso best-effort + reserva atómica en contadores/).
      const hoy = new Date();
      const fechaStr = ContratosService.fechaStrLocal(hoy);
      const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      const fin = new Date(inicio); fin.setDate(fin.getDate() + 1);
      let piso = 0;
      try { piso = await ContratosService.maxSufijoPorTipoYFecha(tipo, inicio, fin); } catch (_) { /* piso 0 */ }
      const seq = await ContratosService.reservarSufijo(tipo, fechaStr, piso);
      const contrato_id = tipo + fechaStr + '-' + String(seq).padStart(2, '0');

      const cli = this.cliente;
      const contrato = ContratoTarifario.construirDoc({
        contrato_id,
        searchTokens: ContratosService.buildSearchTokens({ cliente_nombre: cli.nombre || '', contrato_id }),
        cliente: {
          id: cli.id, nombre: cli.nombre || '', direccion: cli.direccion || '',
          telefono: cli.telefono || '', ruc: cli.ruc || '', dv: cli.dv || '',
          representante: cli.representante || '', representante_cedula: cli.representante_cedula || '',
        },
        codigo_tipo: tipo,
        tipo_contrato: tipoNombre,
        accion,
        renovacion_sin_equipo: !!document.getElementById('wcSinEquipo')?.checked,
        renovacion_refurbished_componentes: !!document.getElementById('wcRefurb')?.checked,
        origenSel,
        transicion_plan: plan,
        reemplaza_seriales: null,
        duracion: `${meses} meses`,
        duracion_meses: meses,
        observaciones: document.getElementById('wcObs')?.value || '',
        equipos: lineas,
        cargos: [...document.querySelectorAll('#wcCargos .wa-cargo')].length ? this._aumCargos() : [],
        itbms_aplica: document.getElementById('wcItbms')?.checked !== false,
        creado_por_uid: this.uid,
      });

      const docRef = await ContratosService.addContrato(contrato);

      try {
        const equiposHtml = contrato.equipos.map(e =>
          `<li>${e.modelo} – ${e.cantidad} × $${Number(e.precio || 0).toFixed(2)}</li>`).join('');
        const obsEsc = (contrato.observaciones || '-').replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]));
        await MailService.enqueue({
          to: 'ventas@cecomunica.com',
          cc: firebase.auth().currentUser?.email || null,
          subject: `Nuevo contrato creado: ${contrato.contrato_id} – ${contrato.cliente_nombre}`,
          preheader: `Contrato pendiente de aprobación: ${contrato.cliente_nombre}`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Nuevo contrato creado</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Se ha registrado un nuevo contrato con el ID <b>${contrato.contrato_id}</b> desde el Centro de gestión.
            </p>
            ${contrato.accion === 'Renovación' ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #0074AC;border-radius:10px;background:#E6F4FB;font:700 15px Arial,sans-serif;color:#0B2A47;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? 'RENOVACIÓN SIN EQUIPO' : 'RENOVACIÓN CON EQUIPO'}</div>` : ''}
            <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.cliente_nombre}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.tipo_contrato}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.accion}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Duración</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.duracion || '-'}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Observaciones</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${obsEsc}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">$${Number(contrato.total_con_itbms || 0).toFixed(2)}</td></tr>
            </table>
            ${equiposHtml ? `<h4 style="margin:0 0 8px;font:600 16px Arial,sans-serif;">Equipos</h4><ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${equiposHtml}</ul>` : ''}
          `,
          ctaUrl: `${location.origin}/contratos/index.html?aprobar=${docRef.id}`,
          ctaLabel: 'Revisar contrato',
          meta: {
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: this.uid,
            source: 'centro-gestion',
          },
          status: 'queued',
        });
      } catch (e) { console.warn('No se pudo encolar el correo:', e); }

      this._cerrarModal();
      Toast.show(`✅ Contrato ${contrato_id} creado — pendiente de aprobación`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo crear el contrato', 'bad');
    } finally {
      this._wcGuardando = false;
      const b = document.getElementById('wcGuardar');
      if (b) b.disabled = false;
    }
  },

  /* ═════════ Wizard: baja por serial (Ola 3) ═════════ */

  MOTIVOS_BAJA: [
    ['fin_necesidad', 'Fin de la necesidad'],
    ['precio', 'Precio'],
    ['servicio', 'Servicio'],
    ['fallas_equipo', 'Fallas de equipo'],
    ['cierre_operacion', 'Cierre de operación'],
    ['morosidad', 'Morosidad'],
    ['cambio_proveedor', 'Cambio de proveedor'],
    ['migracion', 'Migración'],
    ['otro', 'Otro'],
  ],

  // Liquidación de baja según el tramo de cada ítem (decisión §8.4, versión
  // final 2026-08-27): SIEMPRE equivale a 3 meses de la mensualidad de la
  // línea, cobrados de inmediato. La diferencia es qué recibe el cliente:
  // no vencido → penalidad pura; vencido → 60 días de preaviso CON SERVICIO
  // ACTIVO + 30 días de penalidad.
  _penalidadBaja(items) {
    const por = new Map();
    for (const it of items) {
      const c = this.contratos.find(x => x.id === it.contrato_doc_id);
      if (!c) continue;
      const linea = (c.equipos || []).find(l => this._mismoModeloLinea(l, { modelo_id: it.modelo_id, modelo_label: it.modelo }));
      const precio = Number(linea?.precio || 0);
      const dias = this._diasA(c.fecha_vencimiento);
      const vencido = dias !== null && dias < 0;
      const cur = por.get(c.id) || { contrato_id: c.contrato_id || c.id, monto: 0, unidades: 0, vencido, sinPrecio: false };
      cur.monto += precio * 3;   // 3 meses en cualquier caso, cobro inmediato
      cur.unidades += 1;
      if (!precio) cur.sinPrecio = true;
      por.set(c.id, cur);
    }
    const lista = [...por.values()].map(p => ({
      contrato_id: p.contrato_id,
      monto: Math.round(p.monto * 100) / 100,
      detalle: `${p.unidades} unid. · ${p.vencido
        ? 'vencido: 60 días de preaviso (servicio activo) + 30 de penalidad'
        : 'no vencido: 3 meses de penalidad'}${p.sinPrecio ? ' · ⚠ línea sin precio' : ''}`,
    }));
    return { por_contrato: lista, total: Math.round(lista.reduce((s, p) => s + p.monto, 0) * 100) / 100 };
  },

  // Terminación de la CUENTA (decisión 2026-08-28): el cliente cancela el
  // servicio — se terminan TODOS los contratos renovables en una sola gestión
  // (una carta, una aprobación con el desglose, una devolución de toda la
  // flota incluida la custodia). Lo parcial es la Baja por serial.
  wizTerminacionCuenta() {
    const est = this._cuentaEstado();
    if (!est.renovables.length) { Toast.show('El cliente no tiene contratos vigentes que terminar', 'warn'); return; }
    this.wizBaja({ terminacionCuenta: true });
  },
  // Compat: terminación de UN contrato (ya no se ofrece en el menú).
  wizTerminacion(contratoDocId) {
    if (contratoDocId) this.wizBaja({ terminacionDe: contratoDocId });
    else this.wizTerminacionCuenta();
  },

  wizBaja(opts = {}) {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    const termCuenta = !!opts.terminacionCuenta;
    const termDe = opts.terminacionDe || null;
    const contratoTerm = termDe ? this.contratos.find(c => c.id === termDe) : null;
    // Contratos que la terminación cancela (se guarda para crearBaja).
    this._wbTermIds = termCuenta
      ? this._cuentaEstado().renovables.map(c => c.id)
      : (termDe ? [termDe] : []);
    const esTerm = this._wbTermIds.length > 0;
    const elegibles = this.equipos.filter(e => {
      if (!['en_cliente', 'asignado_contrato'].includes(e.estado)) return false;
      if (termCuenta) return this._wbTermIds.includes(e.asignacion?.contrato_doc_id)
        || !e.asignacion?.contrato_doc_id;   // la custodia también se recupera
      if (termDe) return e.asignacion?.contrato_doc_id === termDe;
      return !!e.asignacion?.contrato_doc_id;
    });
    const finMes = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); })();
    this._abrirModalA({
      titulo: termCuenta
        ? `Terminación de la cuenta — ${this.esc(this.cliente.nombre)}`
        : termDe
          ? `Terminación total — <span class="cg-mono">${this.esc(contratoTerm?.contrato_id || termDe)}</span>`
          : `Baja de equipos — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        ${termCuenta
          ? `Cancela <b>los ${this._wbTermIds.length} contrato(s) vigente(s)</b> de la cuenta y recupera toda la flota en campo
             (incluidos los radios sin contrato formal). Una sola carta del cliente y una sola aprobación con el desglose;
             los equipos propios del cliente no se recuperan.`
          : termDe
          ? 'Se desconectan <b>todos</b> los seriales del contrato. Requiere la carta de cancelación del cliente; al aprobarse, la orden de devolución se crea de inmediato (los equipos propios del cliente no se recuperan).'
          : 'Marca los seriales a dar de baja (pueden ser de contratos distintos — una sola aprobación con el desglose). Requiere la carta de solicitud del cliente; al aprobarse, la orden de devolución se crea de inmediato.'}</p>
      <div class="cg-twrap" style="max-height:32vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th><th>Propiedad</th>
        </tr></thead><tbody>
        ${elegibles.map((e) => `<tr>
          <td><input type="checkbox" data-bsel="${this.equipos.indexOf(e)}" ${esTerm ? 'checked disabled' : ''} onchange="Centro._bajaPreview()"></td>
          <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
          <td>${this.esc(e.modelo_label || '—')}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(e.asignacion?.contrato_id || 'sin contrato')}</td>
          <td style="font-size:12px;">${e.propiedad === 'cliente' ? 'del cliente <span style="color:var(--fg-4);">(no se recupera)</span>' : 'CECOMUNICA'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="cg-empty">Sin equipos en campo.</td></tr>'}
      </tbody></table></div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
        <select class="form-select" id="wbMotivo" style="max-width:230px;">
          <option value="">— Motivo —</option>
          ${this.MOTIVOS_BAJA.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
        </select>
        <input class="form-input" id="wbDet" style="flex:1; min-width:160px;" placeholder="Detalle (opcional)">
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; align-items:flex-end;">
        <div class="form-field" style="margin:0;">
          <label class="form-label">Carta del cliente (obligatoria)</label>
          <input class="form-input" type="file" id="wbCarta" accept="image/*,application/pdf" style="max-width:250px;"></div>
        <div class="form-field" style="margin:0;">
          <label class="form-label">Fecha de la nota</label>
          <input class="form-input" type="date" id="wbNota" style="width:150px;"></div>
        <div class="form-field" style="margin:0;">
          <label class="form-label">Término (referencial)</label>
          <select class="form-select" id="wbTermino" style="width:170px;" onchange="document.getElementById('wbFinWrap').classList.toggle('hidden', this.value!=='otro')">
            <option value="fin_mes">Hasta fin de mes</option>
            <option value="30_dias">30 días más</option>
            <option value="60_dias">60 días más</option>
            <option value="otro">Otro (fecha)</option>
          </select></div>
        <div class="form-field hidden" style="margin:0;" id="wbFinWrap">
          <label class="form-label">Fin (manual)</label>
          <input class="form-input" type="date" id="wbFin" value="${finMes}" style="width:150px;"></div>
        <div class="form-field" style="margin:0;">
          <label class="form-label">Depósito / garantía</label>
          <div style="display:flex; gap:6px;">
            <select class="form-select" id="wbDepAcc" style="width:120px;" onchange="document.getElementById('wbDepMonto').disabled=(this.value==='na')">
              <option value="na">No aplica</option><option value="devolver">Devolver</option><option value="retener">Retener</option>
            </select>
            <input class="form-input" type="number" id="wbDepMonto" min="0" step="0.01" placeholder="0.00" style="width:100px;" disabled></div></div>
      </div>
      <p style="font-size:11.5px; color:var(--fg-4); margin:6px 0 0;">El término de facturación es referencial:
        la facturación aún no corre en la plataforma — queda registrado para cuando corra y no bloquea el cierre.</p>
      <div id="wbPen" style="margin-top:12px;"></div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="${termCuenta || termDe ? 'btn-danger cg-act' : 'btn btn-primary'}" onclick="Centro.crearBaja()">Enviar a aprobación</button>`,
    });
    if (esTerm) this._bajaPreview();
  },

  _bajaItemsSeleccion() {
    return [...document.querySelectorAll('input[data-bsel]:checked')].map(i => {
      const e = this.equipos[Number(i.dataset.bsel)];
      return {
        serial_saliente: e.serial || e.id,
        pool_doc_id_saliente: e.id,
        modelo: e.modelo_label || '',
        modelo_id: e.modelo_id || null,
        contrato_doc_id: e.asignacion?.contrato_doc_id || null,
        contrato_id: e.asignacion?.contrato_id || null,
        propiedad: e.propiedad || null,   // 'cliente' = propio: no se recupera
      };
    });
  },

  _finPorTermino() {
    const t = document.getElementById('wbTermino')?.value || 'fin_mes';
    const d = new Date();
    if (t === 'fin_mes') return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    if (t === '30_dias') return new Date(d.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    if (t === '60_dias') return new Date(d.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    return document.getElementById('wbFin')?.value || '';
  },

  _bajaPreview() {
    const items = this._bajaItemsSeleccion();
    const pen = this._penalidadBaja(items);
    const todasPropias = items.length && items.every(i => i.propiedad === 'cliente');
    const sinContrato = items.filter(i => !i.contrato_doc_id).length;
    document.getElementById('wbPen').innerHTML = items.length ? `
      ${todasPropias ? '<div class="cg-senal info" style="margin-bottom:8px;">Equipos <b>propios del cliente</b>: la baja corta el servicio y la facturación — no se crea orden de recuperación.</div>' : ''}
      ${sinContrato ? `<div class="cg-senal warn" style="margin-bottom:8px;">${sinContrato} radio(s) <b>sin contrato formal</b>: se recuperan igual, pero no hay tarifa para estimar su liquidación — el monto exacto lo pone finanzas.</div>` : ''}
      <p style="font-size:13px; margin:0 0 4px;"><b>Liquidación estimada — 3 meses en cualquier caso, cobro inmediato</b>
        <span style="color:var(--fg-4);">(vencido: 60 días de preaviso con servicio activo + 30 de penalidad)</span></p>
      ${pen.por_contrato.map(p => `<div style="display:flex; gap:10px; font-size:13px; padding:2px 0;">
        <span class="cg-mono">${this.esc(p.contrato_id)}</span>
        <span style="color:var(--fg-3);">${this.esc(p.detalle)}</span>
        <b style="margin-left:auto;" class="num">$${p.monto.toFixed(2)}</b></div>`).join('')}
      <div style="display:flex; font-size:13.5px; border-top:1px solid var(--border-subtle); padding-top:4px;">
        <b>Total estimado</b><b style="margin-left:auto;" class="num">$${pen.total.toFixed(2)}</b></div>` : '';
  },

  async crearBaja() {
    const termIds = Array.isArray(this._wbTermIds) ? this._wbTermIds : [];
    const base = this._bajaItemsSeleccion();
    if (!base.length) { Toast.show('Marca al menos un serial', 'warn'); return; }
    const motivo = document.getElementById('wbMotivo')?.value || '';
    if (!motivo) { Toast.show('Indica el motivo de la baja', 'warn'); return; }
    const carta = document.getElementById('wbCarta')?.files?.[0] || null;
    if (!carta) { Toast.show('Adjunta la carta de solicitud del cliente (obligatoria)', 'warn'); return; }
    const detalle = document.getElementById('wbDet')?.value.trim() || '';
    const fin = this._finPorTermino();
    const depAcc = document.getElementById('wbDepAcc')?.value || 'na';
    const items = base.map(it => ({ ...it, motivo_codigo: motivo, motivo_detalle: detalle, fecha_fin_facturacion: fin || null }));
    const pen = this._penalidadBaja(items);
    try {
      const gid = await GestionesService.crear({
        tipo: 'baja',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_aprobacion',
        origen: { tipo: 'vendedor' },
        items,
        cierre: {},
        aprobacion: { requiere: true },
        penalidad_estimada: pen,
        fecha_fin_facturacion: fin || null,
        motivo_codigo: motivo,
        termino: document.getElementById('wbTermino')?.value || 'fin_mes',
        fecha_nota_cliente: document.getElementById('wbNota')?.value || null,
        deposito: depAcc === 'na' ? null : { accion: depAcc, monto: Number(document.getElementById('wbDepMonto')?.value || 0) },
        ...(termIds.length ? { terminacion_total_de: termIds } : {}),
      });
      try {
        await GestionesService.subirCartaBaja(gid, carta);
      } catch (e) {
        console.error(e);
        Toast.show('La gestión se creó pero la carta NO subió — adjúntala desde el expediente', 'warn');
      }
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`${termIds.length > 1 ? 'Terminación de la cuenta' : termIds.length ? 'Terminación total' : 'Baja'} ${gid} enviada a aprobación`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear la baja', 'bad'); }
  },
};
