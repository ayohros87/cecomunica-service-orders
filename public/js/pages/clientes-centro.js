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
        this.email = user.email || null;
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
        // Bandeja "Cuentas por regularizar" (plan 2026-09-08 §4.6): admin y
        // gerencia. El vendedor ve las suyas en el inicio y en cada ficha.
        if ([ROLES.ADMIN, ROLES.GERENTE, ROLES.RECEPCION].includes(this.rol)) {
          const ex = document.getElementById('cgToolsExtra');
          if (ex) ex.innerHTML = `<a class="btn btn-ghost" href="./regularizacion.html" style="font-size:13px;"><i data-lucide="clipboard-list"></i> Cuentas por regularizar</a>`;
        }
        this._wire();
        window.CentroAprobaciones?.init(this.rol);
        const params = new URLSearchParams(location.search);
        const id = params.get('id');
        this.gSel = params.get('g') || null;   // deep-link al expediente (correos)
        // Deep-link al contrato (?contrato=): el editor del módulo viejo vuelve
        // aquí y reabre el mismo contrato que se estaba viendo (2026-09-07).
        this.cSel = params.get('contrato') || null;
        // ?aviso=: el editor de contratos rebota aquí cuando no puede editar
        // y dice por qué (antes el toast se perdía en la redirección).
        const AVISOS = {
          activo: 'Ese contrato ya está ACTIVO y no se edita: los cambios van por anexo, ajuste de tarifa o renovación',
          firma_pendiente: 'Ese contrato tiene un enlace de firma abierto: retira el enlace desde el expediente y podrás editarlo',
        };
        const aviso = AVISOS[params.get('aviso') || ''];
        if (aviso) setTimeout(() => Toast.show(aviso, 'warn'), 300);
        if (id) await this.abrir(id, { push: false });
        else await this.cargarLista(true);
        // ?docs=1: el documento del contrato (contratos/documento.html) manda
        // aquí a ver el expediente legal — esa página es "papel" y no carga el
        // kit, así que el visor vive solo de este lado. Sin permiso no abre
        // nada: ahí el enlace ni se ofrece.
        if (id && params.get('docs') === '1' && this._puedeVerDocs()) this.verDocumentos();
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
    // El bloque Actividad carga el historial la primera vez que se abre.
    document.getElementById('blkActividad')?.addEventListener('toggle', (e) => { if (e.target.open) this.cargarActividad(); });
    document.addEventListener('click', (e) => {
      if (e.target.closest('.cg-acts')) return;
      for (const id of ['cgMenu', 'cgMasMenu']) {
        const menu = document.getElementById(id);
        if (menu && !menu.classList.contains('hidden')) menu.classList.add('hidden');
      }
    });
  },

  /* ═════════ Directorio ═════════ */

  esVendedor() { return this.rol === ROLES.VENDEDOR; },

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
    this._pararEscucha();
    this.cliente = null;
    document.getElementById('vistaFicha').classList.add('hidden');
    document.getElementById('vistaLista').classList.remove('hidden');
    const cola = window.CentroAprobaciones?.tipo;
    if (push) history.pushState({}, '', location.pathname + (cola ? `?aprobaciones=${cola}` : ''));
    window.CentroAprobaciones?.refrescar();
    if (!document.querySelector('#cgLista .cg-row')) this.cargarLista(true);
  },

  async abrir(clienteId, { push = true } = {}) {
    try {
      window.AprobacionesService?.invalidarHome();
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

      this._pintarEncabezado(c);

      // Skeletons mientras cargan contratos/flota/gestiones (la ficha antes
      // aparecía a saltos, sección por sección).
      const skel = (n, h) => Array.from({ length: n }, () =>
        `<div class="cg-skel" style="height:${h}px; margin-bottom:8px;"></div>`).join('');
      document.getElementById('fAhora').innerHTML = skel(1, 64);
      document.getElementById('fResumen').innerHTML = '';
      document.getElementById('fContratos').innerHTML = skel(3, 38);
      document.getElementById('fEquipos').innerHTML = skel(3, 38);
      document.getElementById('fGestiones').innerHTML = skel(2, 46);

      // Carga en paralelo: contratos + flota + gestiones. Las gestiones NO
      // tumban la ficha si fallan (p. ej. reglas aún sin desplegar en un
      // entorno): el cliente completo vale más que esa sección.
      const db = firebase.firestore();
      const [conSnap, equipos, , gestiones] = await Promise.all([
        db.collection('contratos').where('cliente_id', '==', clienteId).get(),
        EquiposPoolService.listarPorCliente(clienteId),
        // Catálogo → ModeloFamilia: el pareo equipo↔línea (tarifa, vencimiento,
        // Anexo A) se decide por familia N/R, no por texto.
        (window.ModelosService?.catalogo ? ModelosService.catalogo().catch(e => { console.warn('[centro] catálogo no disponible:', e?.message || e); return null; }) : null),
        GestionesService.listarPorCliente(clienteId).catch(e => {
          console.warn('[centro] gestiones no disponibles:', e?.message || e);
          return [];
        }),
      ]);
      this.contratos = this._mapContratos(conSnap);
      this.equipos = Array.isArray(equipos) ? equipos : [];
      this.gestiones = gestiones;

      this.pintarKpis();
      this.pintarSenales();
      this.pintarAcciones();
      this.pintarContratos();
      this.pintarEquipos();
      this.pintarGestiones();
      this.armarMenu();
      this._abrirBloques(clienteId);
      if (window.lucide?.createIcons) lucide.createIcons();
      if (this.cSel) {
        const cid = this.cSel; this.cSel = null;
        history.replaceState({}, '', `?id=${encodeURIComponent(clienteId)}`);
        if (this.contratos.some(x => x.id === cid)) this.verContrato(cid);
      }
      // Escucha en vivo: los triggers escriben el avance ~1-2s después de
      // cada acción y la página lo adivinaba con setTimeout — ahora el
      // expediente se repinta cuando el dato REAL llega.
      this._escucharGestiones(clienteId);
      this._escucharCliente(clienteId);
      // Con la persistencia multi-pestaña, la pestaña que abre el deep-link
      // del correo entra como SECUNDARIA: si la primaria está congelada por
      // el navegador, estos get() resuelven del caché de IndexedDB y la
      // ficha sale vieja hasta el F5 (reporte 2026-09-02). Si este pintado
      // salió del caché, se relee del servidor en background y se repinta.
      if (conSnap.metadata && conSnap.metadata.fromCache) this._revalidarFicha(clienteId);
      // Deep-link desde correo (?g=): aterrizar EN el expediente, no arriba
      // de la página (pedido 2026-08-27).
      if (this.gSel) {
        setTimeout(() => document.getElementById(`grow-${this.gSel}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
      }
    } catch (e) { console.error(e); Toast.show('No se pudo abrir el cliente', 'bad'); }
  },

  _pintarEncabezado(c) {
    document.getElementById('fAvatar').textContent = this._iniciales(c.nombre);
    document.getElementById('fNombre').textContent = c.nombre || '(sin nombre)';
    document.getElementById('fMeta').textContent = [
      c.rucdv_norm ? `RUC ${c.rucdv_norm}` : null, c.telefono || null, c.email || null,
      c.vendedor_email ? `Vendedor: ${c.vendedor_email}` : null,
    ].filter(Boolean).join(' · ') || '—';
    this._pintarChipReg(c);
  },

  /* ═════════ Regularización de la cuenta (plan 2026-09-08) ═════════
   * La deuda D1–D7 la CALCULA el job (clientes.regularizacion); aquí solo se
   * lee y se explica con la misma regla (Regularizacion, módulo compartido).
   * Principio: nunca trabar, siempre estampar, cada gestión puntual paga. */
  _reg() { return this.cliente?.regularizacion || null; },
  // Lo que se pega a cada gestión/contrato creado desde aquí ({} si al día).
  _estampaReg() {
    const st = (typeof Regularizacion !== 'undefined') ? Regularizacion.estampa(this._reg()) : null;
    return st ? { cuenta_regularizacion: st } : {};
  },
  _pintarChipReg(c) {
    const el = document.getElementById('fRegChip');
    if (!el) return;
    const chip = (typeof Regularizacion !== 'undefined') ? Regularizacion.chip(c?.regularizacion) : null;
    if (!chip) { el.innerHTML = ''; return; }
    const cls = chip.tono === 'bad' ? 'cg-chip--bad' : chip.tono === 'warn' ? 'cg-chip--warn' : 'cg-chip--muted';
    el.innerHTML = `<button type="button" class="cg-chip ${cls}" onclick="Centro.verRegularizacion()"
        style="border:0; cursor:pointer; font:inherit; font-size:12px;" title="Qué le falta a esta cuenta para estar bien registrada">
        ${this.esc(chip.texto)}</button>`;
  },
  // Panel "Qué falta": una fila por componente con la acción que lo cierra.
  verRegularizacion() {
    const r = this._reg();
    if (!r || !(r.puntos > 0)) { Toast.show('La cuenta está al día', 'ok'); return; }
    const filas = Regularizacion.desglose(r);
    const est = this._cuentaEstado();
    const tram = this._renovacionEnTramite();
    const puede = this.puedeCrearGestion();
    const regularizarBtn = !puede ? '' : tram
      ? `<button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal(); Centro.abrirGestion('ct-${this.esc(tram.id)}')">Ver la renovación en trámite</button>`
      : `<button class="btn btn-primary cg-act" onclick="Centro._cerrarModal(); Centro.wizContrato({renovarCuenta:true})">${est.tipo === 'sin_contrato' || est.tipo === 'nueva' ? 'Regularizar: contrato nuevo' : 'Regularizar con contrato nuevo'}</button>`;
    const accion = (f) => {
      // D1: la renovación consolidadora los cubre; con un contrato vigente
      // también sirve el anexo de regularización (sin bodega, sin OS).
      if (f.codigo === 'd1') return regularizarBtn + (puede && !tram && est.renovables.length
        ? ` <button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal(); Centro.wizRegularizarCuenta()">Actualizar seriales del cliente</button>` : '');
      if (f.codigo === 'd2') return f.ids.map(id => {
        const c = this.contratos.find(x => (x.contrato_id || x.id) === id);
        return c && this.puedeAsignar()
          ? `<a class="btn btn-ghost cg-act" href="../almacen/index.html?tab=asignar&contrato=${encodeURIComponent(c.id)}">Declarar seriales · <span class="cg-mono">${this.esc(id)}</span></a>`
          : `<span class="cg-mono" style="font-size:12px;">${this.esc(id)}</span>`;
      }).join(' ') + (this.puedeAsignar() ? '' : `<div style="font-size:12px; color:var(--fg-3); margin-top:4px;">Los seriales los declara bodega en Almacén · Asignar; si tú los tienes, mándaselos.</div>`);
      if (f.codigo === 'd5') return f.ids.map(id => {
        const c = this.contratos.find(x => (x.contrato_id || x.id) === id);
        return c ? `<button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal(); Centro.abrirGestion('ct-${this.esc(c.id)}')">Confirmar serial saliente · <span class="cg-mono">${this.esc(id)}</span></button>` : this.esc(id);
      }).join(' ');
      if (f.codigo === 'd7') return `<a class="btn btn-ghost cg-act" href="../inventario/equipos.html?tab=por_clasificar">Ver por clasificar</a>`;
      if (f.codigo === 'd3' || f.codigo === 'd4') return `<span style="font-size:12.5px; color:var(--fg-3);">Se cierra al regularizar la cuenta.</span>`;
      if (f.codigo === 'd6') return `<span style="font-size:12.5px; color:var(--fg-3);">Agrégalos por anexo o libéralos desde el expediente del contrato.</span>`;
      return '';
    };
    const ids = (f) => (f.codigo === 'd1' || f.codigo === 'd7') && f.ids.length
      ? `<div class="cg-mono" style="font-size:11.5px; color:var(--fg-4); margin-top:4px; word-break:break-word;">${f.ids.slice(0, 40).map(s => this.esc(s)).join(', ')}${f.ids.length > 40 ? ` … +${f.ids.length - 40}` : ''}</div>` : '';
    const puntuales = Number(r.gestiones_puntuales || 0);
    this._abrirModalA({
      titulo: `Qué falta para regularizar — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:72ch;">
          <b>${this.esc(Regularizacion.NIVEL_LABEL[r.nivel] || r.nivel)} · ${r.puntos} punto${r.puntos === 1 ? '' : 's'}</b>
          ${r.etiqueta === 'migracion' ? ' · deuda de migración (contratos anteriores al sistema)' : ''}.
          Ninguna gestión se frena por esto: cada gestión que declare seriales baja la deuda.
          <b>Actualizar seriales del cliente</b> (también en el menú) amarra al contrato lo que el cliente ya
          tiene: sin renovar, sin bodega y <b>sin mandarle nada a firmar</b>. Si hay que firmar algo, el camino
          es <b>Regularizar con contrato nuevo</b>, que abre la renovación con el plan por serial precargado.
          ${puntuales ? `<br>Gestiones puntuales hechas sobre esta deuda: <b>${puntuales}</b>${r.excede_margen ? ' — <span style="color:var(--cg-bad-deep, #991B1B);">excede el margen sin regularizar</span>' : ''}.` : ''}
        </p>
        <div class="cg-twrap"><table class="cg-table">
          <thead><tr><th>Qué falta</th><th>Cómo se cierra</th></tr></thead>
          <tbody>${filas.map(f => `<tr>
            <td style="white-space:normal;"><b>${f.n}</b> ${this.esc(f.label)}${ids(f)}</td>
            <td style="white-space:normal;">${accion(f)}</td></tr>`).join('')}</tbody>
        </table></div>`,
      footer: `<span class="sep"></span><button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>${r.d1 > 0 ? '' : regularizarBtn}`,
      banda: false,
    });
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // ── Historial de cambios de la ficha (2026-09-02) ──────────────────────
  // Lo escribe el trigger onClienteHistorial (server-side, inmutable por
  // rules): captura TODO escritor — grid, formulario, fusiones, scripts.
  // Se lee BAJO DEMANDA (botón) para no sumar lecturas a cada apertura.
  HIST_LABELS: {
    nombre: 'Nombre', ruc: 'RUC', dv: 'DV',
    representante: 'Representante legal', representante_cedula: 'Cédula del representante',
    representante_email: 'Correo del representante',
    telefono: 'Teléfono', email: 'Correo', email_acuses: 'Correo de acuses',
    direccion: 'Dirección', direccion_facturacion: 'Dirección de facturación',
    itbms_exento: 'ITBMS exento', itbms_motivo_exencion: 'Motivo de exención',
    tags: 'Etiquetas', vendedor_asignado: 'Vendedor (uid)', vendedor_email: 'Vendedor',
    activo: 'Activo', deleted: 'Eliminado', ip: 'IP',
    qbo_customer_id: 'QuickBooks (id)', qbo_customer_name: 'QuickBooks (cliente)',
  },
  _histVal(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (v === true) return 'Sí';
    if (v === false) return 'No';
    if (Array.isArray(v)) return v.join(', ') || '—';
    return String(v);
  },
  _histCuando(fv) {
    const d = fv?.toDate ? fv.toDate() : null;
    return d ? d.toLocaleString('es-PA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  },
  async verHistorial() {
    if (!this.cliente) return;
    this._abrirModalA({
      titulo: `Historial de la ficha — ${this.esc(this.cliente.nombre || '')}`,
      cuerpo: '<div class="cg-vacio">Cargando…</div>',
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>`,
    });
    let filas = [];
    try {
      const snap = await firebase.firestore().collection('clientes').doc(this.cliente.id)
        .collection('historial').orderBy('at', 'desc').limit(50).get();
      filas = snap.docs.map(d => d.data());
    } catch (e) { console.warn('[centro] historial no disponible:', e?.message || e); }
    const bd = document.querySelector('#cgModal .modal-body');
    if (!bd) return;
    if (!filas.length) {
      bd.innerHTML = `<div class="cg-vacio">Sin cambios registrados. El historial arrancó el
        2&nbsp;sep&nbsp;2026 — los cambios anteriores a esa fecha no quedaron guardados.</div>`;
      return;
    }
    bd.innerHTML = filas.map(h => {
      const quien = this.esc(h.por_email || h.por_uid || 'sistema / script');
      const cuando = this.esc(this._histCuando(h.at));
      let cuerpo = '';
      if (h.tipo === 'alta') {
        cuerpo = `<div style="font-size:13px;">Alta del cliente${h.nombre ? ` — <b>${this.esc(h.nombre)}</b>` : ''}</div>`;
      } else if (h.tipo === 'borrado_fisico') {
        cuerpo = `<div style="font-size:13px; color:#A03030;">Borrado físico del documento${h.nombre ? ` — <b>${this.esc(h.nombre)}</b>` : ''}</div>`;
      } else {
        cuerpo = `<ul style="margin:4px 0 0; padding-left:18px; font-size:13px;">` +
          Object.entries(h.cambios || {}).map(([campo, c]) => `
            <li style="margin:2px 0;"><b>${this.esc(this.HIST_LABELS[campo] || campo)}</b>:
              <span style="color:#A03030; text-decoration:line-through;">${this.esc(this._histVal(c?.antes))}</span>
              <span style="color:var(--fg-4);">→</span>
              <span style="color:#17714B; font-weight:600;">${this.esc(this._histVal(c?.despues))}</span></li>`).join('') +
          `</ul>`;
      }
      return `<div style="border-bottom:1px solid var(--border-subtle); padding:10px 2px;">
        <div style="font-size:12px; color:var(--fg-3);">${cuando} · ${quien}</div>
        ${cuerpo}
      </div>`;
    }).join('');
  },

  _mapContratos(snap) {
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(x => !x.deleted)
      .sort((a, b) => (b.fecha_creacion?.toMillis?.() || 0) - (a.fecha_creacion?.toMillis?.() || 0));
  },

  // ── Revalidación contra el servidor ──
  // firebase-init activa enablePersistence({synchronizeTabs:true}) y en ese
  // modo solo la pestaña primaria habla con el servidor. {source:'server'}
  // espera a que esta pestaña tome el liderazgo (la primaria congelada pierde
  // el lease en segundos) y trae lo fresco. Las gestiones no se releen aquí:
  // su onSnapshot ya repinta con la emisión del servidor cuando llega.
  async _revalidarFicha(clienteId) {
    try {
      const db = firebase.firestore();
      const [cliSnap, conSnap, equipos] = await Promise.all([
        db.collection('clientes').doc(clienteId).get({ source: 'server' }),
        db.collection('contratos').where('cliente_id', '==', clienteId).get({ source: 'server' }),
        EquiposPoolService.listarPorCliente(clienteId, { fresh: true }),
      ]);
      if (!this.cliente || this.cliente.id !== clienteId) return; // ya navegó a otra vista
      if (cliSnap.exists) {
        const c = { id: cliSnap.id, ...cliSnap.data() };
        // El candado de cartera se re-aplica sobre el dato real del servidor.
        if (this.esVendedor() && c.vendedor_asignado !== this.uid) {
          Toast.show('Este cliente no está en tu cartera', 'bad');
          this.volver({ push: true });
          return;
        }
        this.cliente = c;
        this._pintarEncabezado(c);
      }
      this.contratos = this._mapContratos(conSnap);
      this.equipos = Array.isArray(equipos) ? equipos : [];
      this.pintarKpis();
      this.pintarSenales();
      this.pintarAcciones();
      this.pintarContratos();
      this.pintarEquipos();
      this.armarMenu();
      if (window.lucide?.createIcons) lucide.createIcons();
    } catch (e) {
      // Sin red de verdad (offline) el caché es lo mejor que hay: se queda.
      console.warn('[centro] revalidación con el servidor no disponible:', e?.message || e);
    }
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

  // Duración legible: duracion_dias MANDA sobre el texto (2026-09-02, caso
  // FANLYC: el formulario viejo pisó "4 días" con "1 meses" — su select no
  // conoce los días; el numérico sobrevive y las vistas no se dejan mentir).
  _durTxt(c) {
    const d = Number(c?.duracion_dias || 0);
    if (d > 0) return `${d} día${d === 1 ? '' : 's'}`;
    return c?.duracion || '';
  },

  _codigoTipo(c) {
    if (c?.codigo_tipo) return c.codigo_tipo;
    const m = { 'Servicio': 'SERV', 'Alquiler': 'ALQ', 'Propio': 'PROP', 'Reemplazo': 'REEMP', 'Demo': 'DEMO', 'Temporal': 'TEMP' };
    if (m[c?.tipo_contrato]) return m[c.tipo_contrato];
    const x = String(c?.contrato_id || '').match(/^[A-Z]+/);
    return x ? x[0] : null;
  },
  // Señal de vencimiento/renovación: solo ALQ/PROP/REEMP (DEMO/TEMP terminan).
  _aplicaVenc(c) { return ['SERV', 'ALQ', 'PROP', 'REEMP'].includes(this._codigoTipo(c)); },
  // Renovación REAL vigente que ya cubre a este contrato (un REEMP amarrado
  // como origen NO cuenta: solo sustituye equipos, no renueva el período).
  _renovadoPor(c) {
    for (const id of (c?.renovado_por_ids || [])) {
      const r = this.contratos.find(x => x.id === id);
      if (!r || r.deleted || this._codigoTipo(r) === 'REEMP') continue;
      if (this._esVigente(r)) return r;
      // 2026-08-31 (caso C COMUNICA): la renovación TERMINÓ (vencido tras la
      // terminación total) y su origen 'aprobado' de junio RESUCITÓ como
      // operativo. Una renovación que llegó a vivir consume a sus orígenes
      // para siempre — solo una ANULADA (o borrada) los libera.
      if (r.estado !== 'anulado' && (r.fecha_activacion || r.estado_previo === 'activo')) return r;
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

  // Bandeja "REQUIERE TU ACCIÓN" — lo primero de la ficha (pedido 2026-08-28:
  // al entrar, incluso por el link del correo, lo pendiente de MI acción tiene
  // que ser lo primero, con el botón exacto y la evidencia al lado).
  abrirGestion(gid) {
    this.gSel = gid;
    this.pintarGestiones();
    if (window.lucide?.createIcons) lucide.createIcons();
    setTimeout(() => document.getElementById(`grow-${gid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  },
  // Lo que espera una acción de alguien (contratos en trámite, gestiones
  // vivas). Devuelve filas; pintarAhora las funde con las señales.
  _itemsAccion() {
    const items = [];
    const esAprobador = [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol);
    const it = (tono, t, s, btns) => items.push({ tono, t, s, btns });
    const B = (label, fn, primario = false) =>
      `<button class="${primario ? 'btn btn-primary' : 'btn btn-ghost'} cg-act" onclick="${fn}">${label}</button>`;

    // Contratos con trabajo pendiente.
    const vistos = new Set();
    for (const c of this._tramitesContrato()) {
      vistos.add(c.id);
      const id = `<span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`;
      const tipoTxt = c.accion === 'Renovación' ? 'Renovación de cuenta' : 'Contrato nuevo';
      const unid = (c.equipos || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      if (c.estado === 'pendiente_aprobacion') {
        if (esAprobador) it('warn', `Aprobar el contrato ${id}`,
          `${tipoTxt} · ${unid} unid. · $${Number(c.total_mensual || 0).toFixed(2)}/mes — revisa el detalle antes de aprobar`,
          B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`) + B('Aprobar', `Centro.aprobarContrato('${this.esc(c.id)}')`, true));
        else it('info', `El contrato ${id} espera aprobación de ventas`, tipoTxt,
          B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`));
      } else if (c.firmado_pendiente_validacion) {
        if (esAprobador) it('warn', `Validar al firmante del contrato ${id}`,
          'Firmó una persona distinta al representante registrado — revisa la cédula, el selfie y la firma',
          B('Validar firmante…', `Centro.aceptarFirmante('${this.esc(c.id)}')`, true));
      } else if (c.estado === 'aprobado' && !c.firmado && this.puedeCrearGestion()) {
        it('warn', `El contrato ${id} espera la firma del cliente`,
          c.firma_solicitud_estado === 'pendiente' ? 'El enlace de firma ya se envió — se puede reenviar' : 'Envíale el enlace de firma digital, o imprime el contrato y sube el firmado desde el expediente',
          B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`) + B('Enviar para firma', `Centro.enviarFirma('${this.esc(c.id)}')`, true));
      } else if (c.estado === 'activo') {
        const reg = this._regPendiente(c);
        if (reg?.motivo === 'sobrantes' && this.puedeCrearGestion()) {
          it('warn', `Resolver la regularización parcial de ${id}`,
            `${reg.sob} equipo(s) en custodia quedaron sin línea en el contrato (${reg.seriales.slice(0, 4).join(', ')}${reg.seriales.length > 4 ? '…' : ''}) — agrégalos por anexo o libéralos de la cuenta`,
            B('Ver expediente', `Centro.abrirGestion('ct-${this.esc(c.id)}')`) + B('Actualizar seriales', `Centro.wizAumento('${this.esc(c.id)}',{regularizar:true})`, true));
        }
      }
    }
    // Validaciones de firma fuera de la ventana de trámite.
    for (const c of (this.contratos || [])) {
      if (vistos.has(c.id) || !c.firmado_pendiente_validacion || !esAprobador) continue;
      it('warn', `Validar al firmante del contrato <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
        'Firmó una persona distinta al representante — revisa la cédula, el selfie y la firma',
        B('Validar firmante…', `Centro.aceptarFirmante('${this.esc(c.id)}')`, true));
    }

    // Gestiones con trabajo pendiente.
    for (const g of (this.gestiones || [])) {
      const gid = `<span class="cg-mono">${this.esc(g.id)}</span>`;
      const ver = B('Ver expediente', `Centro.abrirGestion('${this.esc(g.id)}')`);
      if (g.estado === 'pendiente_aprobacion') {
        const esBaja = g.tipo === 'baja';
        const esAum = g.tipo === 'aumento';
        const puede = (esBaja || esAum) ? this.puedeAprobarBaja() : this.puedeAprobar();
        const carta = esBaja && g.carta_path ? B('Ver carta', `Centro.verAnexo('${this.esc(g.carta_path)}')`) : '';
        if (puede) {
          const sinCarta = esBaja && !g.carta_path;
          const esTaller = g.origen?.tipo === 'taller';
          it('warn', `Aprobar ${esBaja ? (g.terminacion_total_de?.length ? 'la TERMINACIÓN de la cuenta' : 'la baja de equipos') : esAum ? 'el aumento (enmienda)' : esTaller ? 'el reemplazo que propuso el taller' : 'la excepción de garantía'} ${gid}`,
            sinCarta ? 'FALTA la carta del cliente — la aprobación está bloqueada hasta adjuntarla'
              : esTaller ? `Diagnóstico del taller (orden ${this.esc(g.origen?.orden_id || '—')}): ${this.esc(g.origen?.diagnostico || '—')}`
              : `${(g.items || []).length || (g.aumento?.lineas || []).length} renglón(es) — revisa la evidencia antes de aprobar`,
            carta + ver + (sinCarta ? '' : B('Revisar y aprobar', `Centro.abrirGestion('${this.esc(g.id)}')`, true)));
        } else if (esBaja && !g.carta_path && this.puedeCrearGestion()) {
          it('warn', `La baja ${gid} necesita la carta del cliente`, 'Adjúntala desde el expediente para desbloquear la aprobación', ver);
        }
      } else if (g.tipo === 'aumento' && g.estado === 'pendiente_firma' && !g.firma_pendiente_validacion && this.puedeCrearGestion()) {
        it('warn', `El anexo de aumento ${gid} espera la firma del cliente`,
          g.firma_solicitud_estado === 'pendiente' ? 'El enlace de firma ya se envió — se puede reenviar' : 'Envíale el enlace de firma digital (o imprime y sube el firmado)',
          ver + B('Enviar anexo para firma', `Centro.enviarFirmaAnexo('${this.esc(g.id)}')`, true));
      } else if (g.firma_pendiente_validacion && esAprobador) {
        it('warn', `Validar al firmante del anexo ${gid}`,
          'Firmó una persona distinta al representante — revisa la cédula, el selfie y la firma',
          B('Validar firmante…', `Centro.aceptarFirmanteGestion('${this.esc(g.id)}')`, true));
      } else if (g.estado === 'pendiente_bodega' && this.puedeAsignar()) {
        // Bodega asigna desde Almacén · Asignar (2026-09-03); aquí solo se señala.
        it('info', `Bodega debe asignar los seriales de ${gid}`,
          `${GestionesService.tipoLabel(g.tipo)} — se asignan en Almacén · Asignar`,
          `<a class="btn btn-primary cg-act" href="../almacen/index.html?tab=asignar&g=${encodeURIComponent(g.id)}">Asignar en Almacén</a>`);
      }
    }

    return items;
  },

  /* ═════════ Ficha reordenada (2026-09-08, "cada pieza en su lugar") ═════════
   * Verificado con emulador: la ficha medía 3,558 px (5,056 en móvil), los
   * equipos eran el 67 % y las gestiones quedaban al final. Ahora: cabecera
   * con estado y UN botón primario, una sola cola "Ahora", una franja de
   * números y bloques plegables con su resumen. Los pintores viejos quedan
   * como alias porque los llaman la recarga y el listener. */
  pintarAcciones() { this.pintarAhora(); },
  pintarSenales() { /* fundido en pintarAhora */ },
  pintarKpis() { this.pintarResumen(); },

  // "Le toca a" — quién destraba la fila (derivado del texto de la acción).
  _tocaA(t) {
    const s = String(t || '').toLowerCase();
    if (/espera aprobación de ventas/.test(s)) return 'ventas';
    if (/^aprobar|^validar|resolver|revisar/.test(s)) return 'ti';
    if (/espera la firma/.test(s)) return 'el cliente · tú envías el enlace';
    if (/necesita la carta/.test(s)) return 'ti · el cliente firma la carta';
    if (/bodega/.test(s)) return 'bodega';
    if (/venció|vence en|regulariz|sin contrato/.test(s)) return 'ti';
    return '';
  },
  _ahoraTodo: false,
  pintarAhora() {
    const cont = document.getElementById('fAhora');
    if (!cont) return;
    const acc = this._itemsAccion().map(x => ({ tono: x.tono === 'info' ? 'info' : 'warn', t: x.t, s: x.s, btns: x.btns }));
    const sen = this._itemsSenal().map(x => ({ tono: x.tipo, t: this.esc(x.txt), s: '', btns: x.extra || '' }));
    const peso = { bad: 0, warn: 1, info: 2 };
    const items = [...acc, ...sen].sort((a, b) => (peso[a.tono] ?? 3) - (peso[b.tono] ?? 3));
    if (!items.length) {
      cont.innerHTML = `<div class="ok"><i data-lucide="check-circle-2" style="width:15px;height:15px;"></i> Nada pendiente en esta cuenta.</div>`;
      return;
    }
    const MAX = 3;
    const vis = this._ahoraTodo ? items : items.slice(0, MAX);
    const fila = (x) => {
      const toca = this._tocaA(x.t);
      return `<div class="row ${x.tono}"><span class="dot"></span>
        <span class="t"><b>${x.t}</b><span class="s">${x.s}${x.s && toca ? ' · ' : ''}${toca ? `le toca a <span class="toca">${this.esc(toca)}</span>` : ''}</span></span>
        <span class="btns">${x.btns}</span></div>`;
    };
    cont.innerHTML = `<div class="hd">Ahora · ${items.length}
        ${items.length > MAX ? `<button type="button" class="mas" onclick="Centro._ahoraTodo=!Centro._ahoraTodo; Centro.pintarAhora(); if(window.lucide) lucide.createIcons()">${this._ahoraTodo ? 'Ver menos' : `Ver ${items.length - MAX} más`}</button>` : ''}</div>
      ${vis.map(fila).join('')}`;
  },

  // Franja de números con enlace al bloque (reemplaza los cuatro tiles).
  pintarResumen() {
    const cont = document.getElementById('fResumen');
    if (!cont) return;
    const vig = this.contratos.filter(c => this._esVigente(c) && !this._renovadoPor(c));
    const mensual = vig.reduce((s, c) => s + Number(c.total_mensual ?? c.total_con_itbms ?? 0), 0);
    const enContrato = this.equipos.filter(e => ['en_cliente', 'asignado_contrato'].includes(e.estado) && e.asignacion?.contrato_doc_id).length;
    const sinContrato = this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id).length;
    const porClasificar = this.equipos.filter(e => e.estado === 'por_clasificar').length;
    const taller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado)).length;
    const abiertas = (this.gestiones || []).filter(g => GestionesService.ABIERTAS.includes(g.estado)).length + this._tramitesContrato().length;
    const L = (blk, html) => `<button type="button" onclick="Centro.abrirBloque('${blk}')">${html}</button>`;
    cont.innerHTML = [
      L('blkContratos', `Vigentes <b>${vig.length}</b>`),
      `<span>Mensual <b class="num">$${mensual.toFixed(2)}</b></span>`,
      L('blkEquipos', `En contrato <b>${enContrato}</b>`),
      sinContrato ? L('blkEquipos', `Sin contrato <b>${sinContrato}</b>`) : '',
      porClasificar ? L('blkEquipos', `Por clasificar <b>${porClasificar}</b>`) : '',
      L('blkGestiones', `En trámite <b>${abiertas}</b>`),
      taller ? L('blkEquipos', `En taller <b>${taller}</b>`) : '',
    ].filter(Boolean).join('');
    // La cabecera resume la cuenta en una línea y los chips dicen el estado.
    const meta = document.getElementById('fMeta');
    const c = this.cliente || {};
    if (meta) meta.textContent = [
      `${vig.length} contrato${vig.length === 1 ? '' : 's'} vigente${vig.length === 1 ? '' : 's'}`,
      `${this.equipos.length} radio${this.equipos.length === 1 ? '' : 's'}`,
      c.vendedor_email ? `Vendedor: ${c.vendedor_email.split('@')[0]}` : null,
      c.telefono || null,
    ].filter(Boolean).join(' · ');
    this._pintarChipReg(c);
    this._pintarSumarios({ vig, enContrato, sinContrato, porClasificar, taller, abiertas });
    this._pintarPrimario();
  },

  // Resúmenes de una línea en la cabecera de cada bloque.
  _pintarSumarios({ vig, enContrato, sinContrato, porClasificar, taller, abiertas }) {
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const cerradas = (this.gestiones || []).filter(g => ['cerrada', 'anulada'].includes(g.estado)).length;
    set('sumGestiones', abiertas ? `${abiertas} en trámite · ${cerradas} en historial` : (cerradas ? `nada en trámite · ${cerradas} en historial` : 'nada en trámite'));
    let vencidos = 0, proxima = null;
    const hoy = new Date();
    for (const c of vig) {
      if (!this._aplicaVenc(c) || !c.fecha_vencimiento) continue;
      const d = c.fecha_vencimiento.toDate ? c.fecha_vencimiento.toDate() : new Date(c.fecha_vencimiento);
      if (isNaN(d)) continue;
      if (d < hoy) vencidos++; else if (!proxima || d < proxima) proxima = d;
    }
    set('sumContratos', vig.length
      ? `${vig.length} vigente${vig.length === 1 ? '' : 's'}${proxima ? ` · próximo vence ${this._fmtFecha(proxima)}` : ''}${vencidos ? ` · ${vencidos} vencido${vencidos === 1 ? '' : 's'}` : ''}`
      : 'sin contratos vigentes');
    set('sumEquipos', this.equipos.length
      ? [`${this.equipos.length}`, `${enContrato} en contrato`, sinContrato ? `${sinContrato} sin contrato` : '', porClasificar ? `${porClasificar} por clasificar` : '', taller ? `${taller} en taller` : ''].filter(Boolean).join(' · ')
      : 'sin equipos en el inventario');
  },

  // Chips de estado junto al nombre: vencidos, en trámite, regularización.
  _pintarChipReg(c) {
    const el = document.getElementById('fRegChip');
    if (!el) return;
    const chips = [];
    const vig = (this.contratos || []).filter(x => this._esVigente(x) && !this._renovadoPor(x));
    const vencidos = vig.filter(x => this._vencInfo(x)?.estado === 'vencido').length;
    if (vencidos) chips.push(`<button type="button" class="cg-chip cg-chip--bad" style="border:0; cursor:pointer; font:inherit; font-size:12px;" onclick="Centro.abrirBloque('blkContratos')">${vencidos} contrato${vencidos === 1 ? '' : 's'} vencido${vencidos === 1 ? '' : 's'}</button>`);
    const chip = (typeof Regularizacion !== 'undefined') ? Regularizacion.chip(c?.regularizacion) : null;
    if (chip) {
      const cls = chip.tono === 'bad' ? 'cg-chip--bad' : chip.tono === 'warn' ? 'cg-chip--warn' : 'cg-chip--muted';
      chips.push(`<button type="button" class="cg-chip ${cls}" onclick="Centro.verRegularizacion()"
        style="border:0; cursor:pointer; font:inherit; font-size:12px;" title="Qué le falta a esta cuenta para estar bien registrada">${this.esc(chip.texto)}</button>`);
    }
    const tram = (this.gestiones || []).filter(g => GestionesService.ABIERTAS.includes(g.estado)).length + this._tramitesContrato().length;
    if (tram) chips.push(`<button type="button" class="cg-chip cg-chip--info" style="border:0; cursor:pointer; font:inherit; font-size:12px;" onclick="Centro.abrirBloque('blkGestiones')">${tram} en trámite</button>`);
    if (!chips.length && this.contratos.length) chips.push(`<span class="cg-chip cg-chip--ok" style="font-size:12px;">Al día</span>`);
    el.innerHTML = chips.join(' ');
  },

  // La acción que la cuenta pide primero — el botón primario de la cabecera,
  // el destacado del menú y el dock móvil salen de aquí (una sola regla).
  _accionPrimaria() {
    if (!this.puedeCrearGestion()) return null;
    const est = this._cuentaEstado();
    const tram = this._renovacionEnTramite();
    const reg = this._reg();
    const deuda = !!(reg && reg.puntos > 0);
    if (tram) return { onclick: `Centro.abrirGestion('ct-${this.esc(tram.id)}')`, label: `Ver renovación en trámite`, hint: `${this.esc(tram.contrato_id || '')} — abre el expediente para ver en qué paso va` };
    if (est.tipo === 'nueva') return { onclick: 'Centro.wizContrato()', label: 'Nuevo contrato', hint: '' };
    if (est.tipo === 'sin_contrato') return { onclick: 'Centro.wizContrato({renovarCuenta:true})', label: 'Regularizar: contrato nuevo', hint: `cubre los ${est.custodia} radio${est.custodia === 1 ? '' : 's'} que el cliente aún tiene` };
    // Ojo con el nombre: "Regularizar cuenta" a secas se confundía con el
    // anexo del menú ("Regularizar lo que el cliente tiene"). Este camino
    // hace un CONTRATO NUEVO; el otro cuelga un anexo del contrato vigente.
    if (deuda) return { onclick: 'Centro.wizContrato({renovarCuenta:true})', label: 'Regularizar con contrato nuevo', hint: `${reg.puntos} punto${reg.puntos === 1 ? '' : 's'} — renovación consolidadora con el plan por serial` };
    if (est.tipo === 'fragmentada') return { onclick: 'Centro.wizContrato({renovarCuenta:true})', label: 'Renovar cuenta', hint: `consolida ${est.renovables.length} contratos en uno` };
    if (est.tipo === 'consolidada' && this._wcEnVentana(est.maestro)) return { onclick: `Centro.wizContrato('${this.esc(est.maestro.id)}')`, label: 'Renovar cuenta', hint: 'entra en ventana de renovación' };
    return null;
  },
  _pintarPrimario() {
    const P = this._accionPrimaria();
    const btn = document.getElementById('btnPrimario');
    if (btn) {
      btn.classList.toggle('hidden', !P);
      if (P) { btn.textContent = P.label; btn.setAttribute('onclick', P.onclick); btn.title = P.hint || ''; }
    }
    const dock = document.getElementById('cgDock');
    if (dock) dock.innerHTML = !this.puedeCrearGestion() ? '' : `<span aria-hidden="true"></span>
      <button class="btn" onclick="Centro.abrirMenuDesdeDock()">Nueva gestión ▾</button>
      ${P ? `<button class="btn btn-primary" onclick="${P.onclick}">${P.label}</button>` : ''}`;
  },
  abrirMenuDesdeDock() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => document.getElementById('cgMenu')?.classList.remove('hidden'), 250);
  },
  toggleMas(e) {
    e.stopPropagation();
    document.getElementById('cgMenu')?.classList.add('hidden');
    const m = document.getElementById('cgMasMenu');
    if (!m) return;
    m.classList.toggle('hidden');
    if (!m.classList.contains('hidden')) {
      document.addEventListener('click', () => m.classList.add('hidden'), { once: true });
    }
  },
  abrirBloque(id) {
    const d = document.getElementById(id);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  // Qué bloque abre solo al entrar: el que tenga trabajo vivo; si no, Contratos.
  _bloquesDe: null,
  _abrirBloques(clienteId) {
    if (this._bloquesDe === clienteId) return;
    this._bloquesDe = clienteId;
    const vivas = (this.gestiones || []).some(g => GestionesService.ABIERTAS.includes(g.estado)) || this._tramitesContrato().length > 0;
    const ids = ['blkGestiones', 'blkContratos', 'blkEquipos', 'blkActividad'];
    const abrir = this.gSel ? 'blkGestiones' : vivas ? 'blkGestiones' : 'blkContratos';
    ids.forEach(id => { const d = document.getElementById(id); if (d) d.open = id === abrir; });
    const act = document.getElementById('fActividad');
    if (act) act.innerHTML = '<div class="cg-vacio">Ábrelo para cargar el historial.</div>';
    this._actividadDe = null;
  },
  _actividadDe: null,
  async cargarActividad() {
    if (!this.cliente || this._actividadDe === this.cliente.id) return;
    this._actividadDe = this.cliente.id;
    const cont = document.getElementById('fActividad');
    if (!cont) return;
    cont.innerHTML = '<div class="cg-vacio">Cargando…</div>';
    let filas = [];
    try {
      const snap = await firebase.firestore().collection('clientes').doc(this.cliente.id)
        .collection('historial').orderBy('at', 'desc').limit(50).get();
      filas = snap.docs.map(d => d.data());
    } catch (e) { console.warn('[centro] historial no disponible:', e?.message || e); }
    cont.innerHTML = filas.length ? filas.map(h => this._histFilaHtml(h)).join('')
      : `<div class="cg-vacio">Sin cambios registrados. El historial arrancó el 2&nbsp;sep&nbsp;2026.</div>`;
    const sum = document.getElementById('sumActividad');
    if (sum && filas[0]) sum.textContent = `último cambio ${this._histCuando(filas[0].at)} · ${(filas[0].por_email || 'sistema').split('@')[0]}`;
  },
  _histFilaHtml(h) {
    const quien = this.esc(h.por_email || h.por_uid || 'sistema / script');
    const cuando = this.esc(this._histCuando(h.at));
    let cuerpo = '';
    if (h.tipo === 'alta') {
      cuerpo = `<div style="font-size:13px;">Alta del cliente${h.nombre ? ` — <b>${this.esc(h.nombre)}</b>` : ''}</div>`;
    } else if (h.tipo === 'borrado_fisico') {
      cuerpo = `<div style="font-size:13px; color:#A03030;">Borrado físico del documento${h.nombre ? ` — <b>${this.esc(h.nombre)}</b>` : ''}</div>`;
    } else {
      cuerpo = `<ul style="margin:4px 0 0; padding-left:18px; font-size:13px;">` +
        Object.entries(h.cambios || {}).map(([campo, c]) => `
          <li style="margin:2px 0;"><b>${this.esc(this.HIST_LABELS[campo] || campo)}</b>:
            <span style="color:#A03030; text-decoration:line-through;">${this.esc(this._histVal(c?.antes))}</span>
            <span style="color:var(--fg-4);">→</span>
            <span style="color:#17714B; font-weight:600;">${this.esc(this._histVal(c?.despues))}</span></li>`).join('') +
        `</ul>`;
    }
    return `<div style="border-bottom:1px solid var(--border-subtle); padding:10px 2px;">
      <div style="font-size:12px; color:var(--fg-3);">${cuando} · ${quien}</div>
      ${cuerpo}
    </div>`;
  },

  _itemsSenal() {
    const out = [];
    for (const c of this.contratos) {
      if (!this._esVigente(c) || !this._aplicaVenc(c) || this._renovadoPor(c)) continue;
      const v = this._vencInfo(c);
      if (!v) continue;
      // La fila de la cola "Ahora" lleva su botón: renovar (o ver el trámite).
      const tram = this._renovacionEnTramite();
      const cta = !this.puedeCrearGestion() ? '' : tram
        ? `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.abrirGestion('ct-${this.esc(tram.id)}')">Ver trámite</button>`
        : `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.wizContrato({renovarCuenta:true})">Renovar cuenta</button>`;
      if (v.estado === 'vencido') {
        out.push({ tipo: 'bad', txt: `El contrato ${c.contrato_id || c.id} venció hace ${-v.dias} día(s) — coordinar renovación o terminación.`, extra: cta });
      } else if (v.estado === 'por_vencer') {
        out.push({ tipo: 'warn', txt: `El contrato ${c.contrato_id || c.id} vence en ${v.dias} día(s) — iniciar renovación.`, extra: cta });
      }
    }
    // Regla 2026-08-27: una cuenta con equipos FUERA de contrato formal ya
    // requiere renovación/regularización (el documento marco los formaliza).
    const sinContrato = this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id).length;
    // Con el campo regularizacion ya calculado por el job, la deuda tiene UNA
    // voz: el chip de la cabecera + esta señal que abre "Qué falta". La señal
    // vieja de custodia (abajo) queda solo mientras el job no haya pasado.
    const reg = this._reg();
    if (reg && reg.puntos > 0) {
      const tram = this._renovacionEnTramite();
      out.unshift({
        tipo: reg.nivel === 'critica' ? 'bad' : reg.nivel === 'leve' ? 'info' : 'warn',
        txt: `${Regularizacion.resumen(reg)}${tram ? ` — la renovación en trámite (${tram.contrato_id || ''}) cubre la custodia al activarse.` : '.'}`,
        extra: `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.verRegularizacion()">Qué falta</button>`,
      });
    } else if (sinContrato) {
      const tram = this._renovacionEnTramite();
      out.unshift(tram ? {
        tipo: 'info',
        txt: `${sinContrato} equipo(s) sin contrato formal — la renovación en trámite (${tram.contrato_id || ''}) los cubrirá al activarse y entregarse.`,
        extra: `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.abrirGestion('ct-${this.esc(tram.id)}')">Ver trámite</button>`,
      } : (() => {
        // Sin contratos vigentes no hay nada que "renovar": la salida es un
        // contrato NUEVO que cubra esos equipos (2026-09-01, C COMUNICA).
        const sinVigentes = this._cuentaEstado().tipo === 'sin_contrato';
        return {
          tipo: 'warn',
          txt: sinVigentes
            ? `${sinContrato} equipo(s) con el cliente y la cuenta SIN contrato vigente — créale un contrato nuevo que los cubra.`
            : `${sinContrato} equipo(s) sin contrato formal — la cuenta requiere renovación / regularización.`,
          extra: this.puedeCrearGestion()
            ? `<button class="btn btn-primary cg-act cg-senal-cta"
                 onclick="Centro.wizContrato({renovarCuenta:true})">${sinVigentes ? 'Nuevo contrato' : 'Renovar cuenta'}</button>` : '',
        };
      })());
    }
    const pendDev = this.equipos.filter(e => e.pendiente_devolucion).length;
    if (pendDev) out.push({ tipo: 'warn', txt: `${pendDev} equipo(s) pendiente(s) de devolución.` });
    const enTaller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado)).length;
    if (enTaller) out.push({ tipo: 'info', txt: `${enTaller} equipo(s) en taller o en revisión.` });
    // Las gestiones abiertas NO se repiten aquí: ya viven en el KPI, en
    // "Requiere tu acción" y en la lista de Gestiones con su fila accionable.
    return out;
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
        ${this._masFila('tc-' + c.id, this._accionesContrato(c), c.contrato_id || c.id)}</td></tr>`;
  },

  // Vista previa del contrato en un modal: todo lo esencial sin navegar.
  async verContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    this._cerrarModal();
    await this._cargarOsContrato(id).catch(() => {});
    const t = (window.ContractTotals?.fromDoc) ? ContractTotals.fromDoc(c) : null;
    const enCampo = this.equipos.filter(e => e.asignacion?.contrato_doc_id === id);
    const renovador = this._renovadoPor(c);
    const dato = (l, v) => v ? `<div style="display:flex; gap:8px; font-size:13px; padding:2px 0;">
      <span style="color:var(--fg-3); min-width:120px;">${l}</span><span>${v}</span></div>` : '';
    // Modalidad de la línea: de quién es el equipo (2026-09-09). Sin esto el
    // contrato no decía por ningún lado si el radio es de alquiler o del
    // cliente — antes se leía del tipo ALQ/PROP, que ya no existe.
    const modLinea = (l) => l.modalidad === 'propio'
      ? '<span class="eqpool-prop eqpool-prop-cliente" title="Equipo propiedad del cliente — la línea es tarifa de servicio">Del cliente</span>'
      : l.modalidad === 'alquiler'
        ? '<span class="eqpool-prop eqpool-prop-cecomunica" title="Equipo de la flota de CECOMUNICA en renta">Alquiler</span>'
        : '<span class="eqpool-prop eqpool-prop-desconocida" title="Contrato anterior a la modalidad por línea — la propiedad real es la de cada serial, abajo">Sin declarar</span>';
    const lineas = (c.equipos || []).map(l => `<tr>
      <td>${this.esc(l.modelo || '—')}</td>
      <td>${modLinea(l)}</td>
      <td style="text-align:right;">${Number(l.cantidad || 0)}</td>
      <td style="text-align:right;" class="num">$${Number(l.precio || 0).toFixed(2)}</td>
      <td style="text-align:right;" class="num">$${(Number(l.cantidad || 0) * Number(l.precio || 0)).toFixed(2)}</td></tr>`).join('');
    const cargos = (c.cargos || []).map(x => `<tr>
      <td>${this.esc(x.concepto || '—')} <span style="color:var(--fg-4); font-size:11px;">${x.recurrente ? 'mensual' : 'único'}</span></td>
      <td></td>
      <td style="text-align:right;">${Number(x.cantidad || 1)}</td>
      <td style="text-align:right;" class="num">$${Number(x.monto || 0).toFixed(2)}</td>
      <td style="text-align:right;" class="num">$${(Number(x.cantidad || 1) * Number(x.monto || 0)).toFixed(2)}</td></tr>`).join('');
    // Los equipos en campo, con la propiedad de CADA serial: es la que manda
    // (la devolución nunca reclama un radio del cliente). Los del cliente van
    // primero — son la excepción que hay que notar.
    const P = window.EquiposPoolService;
    const enCampoOrd = [...enCampo].sort((a, b) =>
      (b.propiedad === 'cliente' ? 1 : 0) - (a.propiedad === 'cliente' ? 1 : 0)
      || String(a.serial || '').localeCompare(String(b.serial || '')));
    const filasCampo = enCampoOrd.map(e => `<tr>
      <td class="cg-mono"><a href="#" onclick="Centro.verKardex('${this.esc(e.id)}'); return false;">${this.esc(e.serial || e.id)}</a></td>
      <td>${this.esc(e.modelo_label || '—')}</td>
      <td>${P?.chipPropiedadHtml ? P.chipPropiedadHtml(e) : this.esc(e.propiedad || '')}</td>
      <td>${P?.chipEstadoHtml ? P.chipEstadoHtml(e.estado) : this.esc(e.estado || '')}</td></tr>`).join('');
    const resumenCampo = P?.resumenPropiedadTexto ? P.resumenPropiedadTexto(enCampo) : '';
    const reg = c.regularizacion;
    this._abrirModalA({
      titulo: `<span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>
        <span style="font-weight:400; color:var(--fg-3); font-size:13.5px;"> · ${this.esc(c.tipo_contrato || c.codigo_tipo || '')} · ${this.esc(c.estado || '')}</span>`,
      cuerpo: `
      <div style="margin:0 0 10px;">${this._vidaHtml(c)}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 24px; margin-bottom:10px;">
        ${dato('Acción', this.esc(c.accion || ''))}
        ${dato('Duración', this.esc(this._durTxt(c)))}
        ${dato('Creado', this._fmtFecha(c.fecha_creacion))}
        ${dato('Aprobado', c.fecha_aprobacion ? this._fmtFecha(c.fecha_aprobacion) : '')}
        ${dato('Origen', (c.contrato_origen_refs || []).map(r => `<span class="cg-mono">${this.esc(r)}</span>`).join(', ')
          || (c.origen_legacy_ref ? `papel: ${this.esc(c.origen_legacy_ref)}` : ''))}
        ${dato('Renovado por', renovador ? `<span class="cg-mono">${this.esc(renovador.contrato_id || renovador.id)}</span>` : '')}
        ${dato('Firmado', this._firmadoTxt(c))}
        ${dato('Entregado', this._entregaTxt(c))}
        ${dato('Firma digital', c.firmado_pendiente_validacion
          ? '<span class="cg-venc por_vencer">recibida — validar firmante</span>'
          : (!c.firmado && c.firma_solicitud_estado === 'pendiente' ? 'enlace enviado — esperando firma' : ''))}
      </div>
      ${lineas || cargos ? `<div class="cg-twrap" style="max-height:30vh; overflow:auto;">
        <table class="cg-tabla"><thead><tr><th>Línea</th><th>De quién es</th><th style="text-align:right;">Cant.</th>
          <th style="text-align:right;">Precio</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>${lineas}${cargos}</tbody></table></div>` : ''}
      ${t ? `<div style="display:flex; gap:18px; font-size:13.5px; margin-top:8px; flex-wrap:wrap;">
        <span>${this.esc(t.itbmsLabel || '')}</span>
        <span style="margin-left:auto;"><b>Mensual: <span class="num">$${Number(t.totalMensual || 0).toFixed(2)}</span></b></span>
        ${t.tieneCargosUnicos ? `<span><b>Primer pago: <span class="num">$${Number(t.primerPago || 0).toFixed(2)}</span></b></span>` : ''}
      </div>` : ''}
      ${enCampo.length ? `<div style="margin:12px 0 0;">
        <div style="display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; font-size:12.5px; margin-bottom:6px;">
          <b>${enCampo.length} equipo${enCampo.length === 1 ? '' : 's'} en campo bajo este contrato</b>
          ${resumenCampo ? `<span style="color:var(--fg-3);">${resumenCampo}</span>` : ''}</div>
        <div class="cg-twrap" style="max-height:26vh; overflow:auto;">
          <table class="cg-tabla"><thead><tr><th>Serial</th><th>Modelo</th><th>De quién es</th><th>Situación</th></tr></thead>
          <tbody>${filasCampo}</tbody></table></div></div>` : ''}
      ${reg?.amarradas != null ? `<p style="font-size:12.5px; color:var(--fg-3); margin:6px 0 0;">
        Regularización: ${reg.amarradas} radio(s) amarrados${reg.sin_cupo ? ` · <b style="color:var(--warn-deep, #92400E);">${reg.sin_cupo} sin cupo</b>` : ''}${reg.sin_linea ? ` · <b style="color:var(--warn-deep, #92400E);">${reg.sin_linea} sin línea: ${(reg.sin_linea_seriales || []).join(', ')}</b>` : ''}.</p>` : ''}
      ${c.transicion_plan?.nivel === 'serial' && window.TransicionPlan ? `<p style="font-size:12.5px; color:var(--fg-3); margin:6px 0 0;">
        Seriales declarados en la venta: ${this.esc(TransicionPlan.resumen(c.transicion_plan))}${c.plan_aplicado?.at ? ' — aplicado' : ''}.
        ${(c.transicion_plan.unidades || []).filter(u => u.destino === 'no_tiene').length
          ? `<br><b style="color:var(--warn-deep, #92400E);">No los tiene:</b> ${(c.transicion_plan.unidades || []).filter(u => u.destino === 'no_tiene').map(u => `<span class="cg-mono">${this.esc(u.serial)}</span>`).join(', ')}` : ''}
        ${c.accion === 'Renovación' && c.estado === 'aprobado' && !c.firmado && this.puedeCrearGestion()
          ? `<button class="btn btn-ghost cg-act" style="margin-left:8px;" onclick="Centro.wizSerialesRenovacion('${this.esc(c.id)}')">Corregir seriales</button>` : ''}</p>`
        : (c.accion === 'Renovación' && c.estado === 'aprobado' && !c.firmado && this.puedeCrearGestion()
          ? `<p style="font-size:12.5px; margin:6px 0 0;"><span style="color:var(--warn-deep, #92400E);">Esta renovación no declara qué seriales siguen con el cliente.</span>
             <button class="btn btn-ghost cg-act" style="margin-left:8px;" onclick="Centro.wizSerialesRenovacion('${this.esc(c.id)}')">Seriales de la cuenta</button></p>` : '')}
      ${this._osCache[id] && !this._osCache[id].loading && this._osCache[id].os.length ? this._osTramiteHtml(c) : ''}
      ${c.observaciones ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0; max-width:72ch;">${this.esc(c.observaciones)}</p>` : ''}`,
      // MISMA lista de acciones que el "⋯" de la fila: el footer dejó de ser
      // una botonera propia (2026-09-09) — "Ver el contrato" sale de la lista
      // porque es esta misma pantalla.
      footer: `<span class="sep"></span>
        <button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal()">Cerrar</button>
        ${this._pieAcciones('vc-' + c.id, this._accionesContrato(c).filter(a => a.id !== 'ver'))}`,
    });
  },

  // Anulación SIN salir del Centro (2026-09-04: Alberto y Zuleika buscaban
  // "Anular contrato" en la ficha — solo existía en el menú ⋯ del módulo
  // Contratos, al que el Centro ya no enlaza). Misma escritura que
  // ContratosLista.anular: js/domain/contratoAnulacion.js. La pregunta que
  // importa es QUÉ PASA CON LOS EQUIPOS, no el motivo.
  anularContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    if (![ROLES.ADMIN, ROLES.GERENTE].includes(this.rol)) { Toast.show('Solo administración o gerencia puede anular contratos.', 'bad'); return; }
    if (!ContratoAnulacion.esAnulable(c)) { Toast.show('Solo se puede anular un contrato ACTIVO, APROBADO o pendiente de aprobación.', 'bad'); return; }
    const cands = ContratoAnulacion.candidatos(this.contratos, id);
    const enCampo = this.equipos.filter(e => e.asignacion?.contrato_doc_id === id).length;
    // Un contrato EN TRÁMITE (pendiente de aprobación) nunca movió equipo: la
    // pregunta de los equipos sobra — solo el motivo.
    const conEquipos = ContratoAnulacion.preguntaEquipos(c);
    const opcion = (valor, checked, titulo, sub) => `
      <label style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border:1px solid var(--border-default); border-radius:10px; cursor:pointer;">
        <input type="radio" name="anulTipo" value="${valor}" ${checked ? 'checked' : ''} style="margin-top:3px;" onchange="Centro._anulSync()">
        <span><b>${titulo}</b><br><small style="color:var(--fg-3);">${sub}</small></span></label>`;
    this._cerrarModal();
    this._abrirModalA({
      titulo: `Anular <span class="cg-mono">${this.esc(c.contrato_id || id)}</span>`,
      cuerpo: `
        ${conEquipos ? `
        <p style="font-size:13px; color:var(--fg-3); margin:0 0 12px;">¿Qué pasa con los equipos${enCampo ? ` (<b>${enCampo}</b> en campo bajo este contrato)` : ''}?
          De eso depende que el sistema abra o no una orden para recuperarlos.</p>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
          ${opcion('sustitucion', true, 'Se rehace el contrato — el cliente conserva los equipos.', 'Error de precio, de representante, de modelo… El equipo no se mueve.')}
          ${opcion('terminacion', false, 'Termina el acuerdo — el cliente devuelve los equipos.', 'Se abrirá una orden de DEVOLUCIÓN para recuperarlos.')}
        </div>` : `
        <p style="font-size:13px; color:var(--fg-3); margin:0 0 12px;">El contrato está <b>en trámite</b> (todavía no se aprobó): se anula sin mover ningún equipo
          y queda en el historial con el motivo. Si hace falta, crea el contrato correcto después.</p>`}
        <div id="anulBloqueSust" style="margin-bottom:12px;${conEquipos ? '' : ' display:none;'}">
          <label style="display:block; font-weight:600; font-size:13px; margin-bottom:4px;">Contrato que lo sustituye <small style="font-weight:400; color:var(--fg-3);">(opcional)</small></label>
          <select class="form-input" id="anulSustituto" style="width:100%;">
            <option value="">Todavía no lo he creado</option>
            ${cands.map(x => `<option value="${this.esc(x.id)}">${this.esc(x.contrato_id || x.id)}${x.total_mensual ? ` — $${Number(x.total_mensual).toFixed(2)}/mes` : ''}</option>`).join('')}
          </select>
          <small style="color:var(--fg-3);">Si lo indicas, los equipos pasan solos al contrato nuevo.</small>
        </div>
        <label style="display:block; font-weight:600; font-size:13px; margin-bottom:4px;">Motivo</label>
        <textarea class="form-input" id="anulMotivo" rows="3" style="width:100%; resize:vertical;"
          placeholder="Ej: el precio no incluyó el ajuste del micrófono"></textarea>`,
      footer: `
        <button class="btn btn-ghost cg-act" onclick="Centro.verContrato('${this.esc(id)}')">Volver</button>
        <span class="sep"></span>
        <button class="btn-danger cg-act" onclick="Centro._anularContratoConfirmar('${this.esc(id)}')">Anular contrato</button>`,
    });
  },
  _anulSync() {
    const tipo = document.querySelector('#cgModal input[name="anulTipo"]:checked')?.value;
    document.getElementById('anulBloqueSust')?.classList.toggle('hidden', tipo !== 'sustitucion');
  },
  async _anularContratoConfirmar(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    const motivo = (document.getElementById('anulMotivo')?.value || '').trim();
    if (!motivo) { document.getElementById('anulMotivo')?.focus(); Toast.show('Debes indicar un motivo.', 'bad'); return; }
    const conEquipos = ContratoAnulacion.preguntaEquipos(c);
    const tipo = conEquipos
      ? (document.querySelector('#cgModal input[name="anulTipo"]:checked')?.value || 'sustitucion')
      : 'sustitucion';   // en trámite: nada se mueve
    const sustId = conEquipos && tipo === 'sustitucion' ? (document.getElementById('anulSustituto')?.value || '') : '';
    const sustituto = sustId ? this.contratos.find(x => x.id === sustId) : null;
    const update = ContratoAnulacion.buildUpdate(c, { motivo, tipo, sustituto, uid: this.uid }, id);
    try {
      await ContratosService.updateContrato(id, update);
      this._cerrarModal();
      Toast.show(ContratoAnulacion.mensaje(update, c), 'ok');
      // onAnnulment corre en ~1-2s (devolución / traspaso de equipos): la ficha
      // se recarga completa para que contratos, equipos y señales lo reflejen.
      setTimeout(() => { if (this.cliente) this.abrir(this.cliente.id, { push: false }); }, 1500);
    } catch (e) { console.error(e); Toast.show('No se pudo anular el contrato.', 'bad'); }
  },

  // Aprobación del contrato SIN salir del Centro (2026-08-28: el correo de
  // "contrato creado" mandaba al módulo viejo para aprobar). Mismos campos
  // que contratos-approval.js; las rules solo guardan el salto a 'activo'.
  // ── Contrato en papel: imprimir y subir el firmado desde el Centro ──
  // (Alberto 2026-09-07: el anexo de aumento tenía imprimir + subir firmado a
  // la vista y el contrato/renovación no — "Subir firmado" vivía solo en el
  // módulo viejo de /contratos/.) Misma vía que contratos-upload.js: subir el
  // PDF de un contrato APROBADO lo activa en el mismo write
  // (rules::esActivacionPorFirmado, admin/vendedor); sobre un contrato ACTIVO
  // repunta el archivo y archiva el anterior en firmado_historial[].
  _puedeSubirFirmado() { return [ROLES.ADMIN, 'admin', ROLES.VENDEDOR].includes(this.rol); },
  // Un contrato ACTIVO firmado DIGITALMENTE no tiene `firmado_url` y no le
  // falta nada: la firma vive dentro del documento. Sin esta excepción, al
  // volverse alcanzable esa rama (2026-09-10) le ofrecíamos "adjuntar el
  // firmado" a contratos que ya están completos.
  _aceptaFirmado(c) {
    return (c?.estado === 'aprobado' && !c.firmado)
      || (c?.estado === 'activo' && !c.firmado_url && c.firmado_tipo !== 'digital');
  },

  // ── El firmado, visible desde el Centro (2026-09-10) ──────────────────────
  // Un contrato firmado tiene el papel en Storage (`firmado_url`) o la firma
  // digital dentro del propio documento (`firmado_tipo === 'digital'`, sin
  // PDF: /firmar/ congela la copia y documento.html la reconstruye). Las dos
  // formas se abren igual de fácil o no se abre ninguna.
  _accFirmado(c) {
    if (!c?.firmado) return null;
    const cuando = c.firmado_fecha ? `firmado ${this._fmtFecha(c.firmado_fecha)}` : '';
    if (c.firmado_url) {
      // _menuAccionesHtml mete `href` crudo en el atributo: se escapa aquí.
      return this._acc({ id: 'firmado', grupo: 'Documentos', label: 'Ver el firmado (PDF)',
        blank: true, hint: cuando, href: this.esc(c.firmado_url) });
    }
    if (c.firmado_tipo === 'digital') {
      return this._acc({ id: 'firmado', grupo: 'Documentos', label: 'Ver el firmado (firma digital)',
        blank: true, hint: cuando ? `${cuando} — no hay PDF: el documento trae la firma` : 'no hay PDF: el documento trae la firma',
        href: `../contratos/documento.html?id=${encodeURIComponent(c.id)}` });
    }
    return null;
  },
  // Fila "Firmado" de la vista previa. Antes decía "sí ✓" y ahí se acababa.
  _firmadoTxt(c) {
    if (!c?.firmado) return '';
    const cuando = c.firmado_fecha ? ` · ${this._fmtFecha(c.firmado_fecha)}` : '';
    if (c.firmado_url) {
      return `<a href="${this.esc(c.firmado_url)}" target="_blank" rel="noopener">Ver el PDF firmado</a>${cuando}`;
    }
    if (c.firmado_tipo === 'digital') {
      return `<a href="../contratos/documento.html?id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Ver el documento firmado</a>${cuando} (firma digital)`;
    }
    return `sí ✓${cuando}`;
  },
  // Fila "Entregado" de la vista previa: dos de los tres requisitos de comisión
  // (firma y entrega) quedan a la vista donde Zuleika ya está parada.
  // Un "—" a secas se lee como "falta", y una RENOVACIÓN no entrega nada nunca
  // — por eso el motivo va escrito (caso R. Smith Coronado, ALQ20260601-02).
  _entregaTxt(c) {
    if (!c || c.estado !== 'activo') return '';
    if (c.entrega_confirmada === true) {
      return `sí ✓${c.fecha_entrega_ultima ? ` · ${this._fmtFecha(c.fecha_entrega_ultima)}` : ''}`;
    }
    if (!this._entregaAplica(c)) {
      return '<span style="color:var(--fg-3);">no aplica — los equipos ya están en el cliente</span>';
    }
    return '<span class="cg-venc por_vencer">pendiente</span>';
  },
  // Copia en el navegador del predicado `esperando` de
  // functions/src/triggers/contratos/onApproval.js:287. Consciente: hoy no hay
  // dónde compartirla entre front y back. La F2 de docs/plans/PLAN_COMISIONES.md
  // la unifica en lib/facturacionAvisos.entregaAplica() — si cambias una,
  // cambia la otra.
  _entregaAplica(c) {
    if (!c) return false;
    if (c.accion === 'Renovación' || c.renovacion_sin_equipo) return false;
    return (c.equipos || []).some(e => Number(e.cantidad || 0) > 0);
  },
  // "Editar" del expediente: el editor rechaza un contrato ACTIVO y uno con
  // enlace de firma abierto (rebotaba al Centro sin decir por qué — Cerdas,
  // 2026-09-09). Aquí se dice de frente y, si es el enlace, se ofrece retirarlo.
  // Retirar un enlace de firma pendiente: pendiente → cancelado en la
  // solicitud (la página pública lo muestra como "no válido"; la regla lo
  // permite a admin/gerente/vendedor) y el contrato vuelve a editarse. Al
  // reenviar se genera un enlace nuevo con la copia actualizada.
  async retirarEnlaceFirma(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || c.firma_solicitud_estado !== 'pendiente' || !c.firma_solicitud_id) { Toast.show('Este contrato no tiene un enlace de firma pendiente', 'warn'); return; }
    this._cerrarModal();
    const ok = await Modal.confirm({
      title: 'Retirar el enlace de firma', danger: true, confirmLabel: 'Retirar enlace',
      message: `El enlace que se le envió al cliente deja de servir (verá "enlace no válido"). El contrato
        <b class="cg-mono">${this.esc(c.contrato_id || c.id)}</b> vuelve a poder editarse; para firmar habrá que enviar un enlace nuevo.`,
    });
    if (!ok) { this.abrirGestion(`ct-${c.id}`); return; }
    try {
      await firebase.firestore().collection('firma_solicitudes').doc(c.firma_solicitud_id).update({ estado: 'cancelado' });
      await ContratosService.updateContrato(c.id, { firma_solicitud_estado: 'cancelado' });
      c.firma_solicitud_estado = 'cancelado';
      Toast.show('Enlace retirado — el contrato ya se puede editar', 'ok');
    } catch (e) { console.error(e); Toast.show('No se pudo retirar el enlace: ' + (e.message || e), 'bad'); }
    this.abrirGestion(`ct-${c.id}`);
  },

  async subirFirmadoContrato(id, fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    if (!this._puedeSubirFirmado()) { Toast.show('Solo administración o el vendedor suben el contrato firmado', 'warn'); return; }
    const c = this.contratos.find(x => x.id === id);
    if (!c) { Toast.show('Contrato no encontrado', 'bad'); return; }
    const modo = c.estado === 'aprobado' ? 'activacion' : c.estado === 'activo' ? 'reemplazo' : null;
    if (!modo) { Toast.show('Solo se sube el firmado a contratos aprobados o activos', 'warn'); return; }
    const legible = c.contrato_id || id;
    if (modo === 'reemplazo' && c.firmado_url && !(await Modal.confirm({
      title: 'Sustituir el archivo firmado', confirmLabel: 'Sustituir',
      message: `Vas a sustituir el archivo firmado de <b class="cg-mono">${this.esc(legible)}</b>. El actual queda
        archivado en el historial (no se borra); el estado y la fecha de activación no cambian.`,
    }))) return;
    // storage.rules exige application/pdf en contratos_firmados/: un PDF pasa
    // directo; las FOTOS (WhatsApp) se arman en un solo PDF con el conversor
    // de contratos-upload.js. Mezclar PDF con fotos no tiene orden: se rechaza.
    const esPdf = (f) => f.type === 'application/pdf' || (f.name.split('.').pop() || '').toLowerCase() === 'pdf';
    const esImg = (f) => /^image\//.test(f.type);
    let file;
    try {
      if (files.length === 1 && esPdf(files[0])) file = files[0];
      else if (files.every(esImg)) {
        if (!window.ContratosFirmado?._fotosAPdf) throw new Error('el conversor de fotos no está cargado');
        Toast.show(`Armando un PDF con ${files.length} foto(s)…`, '');
        const blob = await ContratosFirmado._fotosAPdf(files);
        file = new File([blob], `firmado_${files.length}fotos.pdf`, { type: 'application/pdf' });
      } else { Toast.show('Sube UN PDF, o solo fotos (varias a la vez) — no mezclados', 'warn'); return; }
    } catch (e) { console.error(e); Toast.show('No se pudo preparar el archivo: ' + (e?.message || e), 'bad'); return; }
    try {
      Toast.show('Subiendo contrato firmado…', '');
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
      const path = `contratos_firmados/${legible}_${Date.now()}.${ext}`;
      const snap = await firebase.storage().ref(path).put(file, {
        contentType: file.type,
        customMetadata: { contrato_doc_id: id, contrato_id: legible },
      });
      const url = await snap.ref.getDownloadURL();
      const ahora = firebase.firestore.Timestamp.now();
      const update = {
        firmado: true, firmado_url: url, firmado_nombre: file.name,
        firmado_storage_path: path, firmado_fecha: ahora, firmado_por_uid: this.uid,
      };
      if (modo === 'activacion') {
        update.estado_previo = c.estado;
        update.estado = 'activo';
        update.fecha_activacion = ahora;
      } else if (c.firmado_url) {
        // Timestamp.now() y no serverTimestamp(): arrayUnion no acepta sentinels.
        update.firmado_historial = firebase.firestore.FieldValue.arrayUnion({
          firmado_url: c.firmado_url || null, firmado_nombre: c.firmado_nombre || null,
          firmado_storage_path: c.firmado_storage_path || null, firmado_fecha: c.firmado_fecha || null,
          firmado_por_uid: c.firmado_por_uid || null,
          reemplazado_at: ahora, reemplazado_por_uid: this.uid, reemplazado_por: url,
        });
      }
      await ContratosService.updateContrato(id, update);
      this._cerrarModal();
      Toast.show(modo === 'activacion'
        ? `Contrato ${legible} firmado y ACTIVO — ${c.accion === 'Renovación' ? 'la cuenta queda consolidada; ' : ''}la custodia se amarra al entregarse`
        : `Contrato ${legible}: firmado reemplazado — el anterior quedó archivado`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo subir el contrato firmado: ' + (e?.message || e), 'bad', 8000);
    }
  },

  async aprobarContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || c.estado !== 'pendiente_aprobacion') { Toast.show('El contrato no está pendiente de aprobación', 'warn'); return; }
    try {
      await ContratosService.updateContrato(id, {
        estado: 'aprobado',
        fecha_aprobacion: firebase.firestore.Timestamp.now(),
        aprobado_por_uid: this.uid,
        fecha_modificacion: new Date(),
      });
      this._cerrarModal();
      Toast.show(`Contrato ${c.contrato_id || id} aprobado — sigue la firma del cliente`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar el contrato', 'bad'); }
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
        // Snapshot para que el firmante VEA el contrato completo en /firmar/
        // (pedido 2026-08-28): la página pública no puede leer contratos ni el
        // pool, así que el enlace carga su propia copia (partes + Anexo A).
        const enCampo = await (window.EquiposPoolService?.listarPorContrato
          ? EquiposPoolService.listarPorContrato(c.id).catch(() => []) : []);
        const rucdv = (c.cliente_rucdv && String(c.cliente_rucdv).trim())
          || ((c.cliente_ruc || this.cliente.ruc || '') + (c.cliente_dv || this.cliente.dv ? ` DV ${c.cliente_dv || this.cliente.dv}` : '')).trim();
        const ref = await firebase.firestore().collection('firma_solicitudes').add({
          estado: 'pendiente',
          contrato_doc_id: c.id,
          contrato_id: c.contrato_id || c.id,
          cliente_id: c.cliente_id || this.cliente.id,
          cliente_nombre: c.cliente_nombre || this.cliente.nombre || '',
          representante: { nombre: c.representante || this.cliente.representante || '', cedula: c.representante_cedula || this.cliente.representante_cedula || '' },
          // El TEXTO ÍNTEGRO queda CONGELADO en la solicitud (2026-08-31,
          // reclamo de Alberto: la firma no puede caer sobre un texto que el
          // cliente no vio — ni cambiar después de firmado). /firmar/ muestra
          // ESTA copia y el documento firmado se reconstruye desde aquí.
          documento: {
            cliente_rucdv: rucdv || '',
            observaciones: c.observaciones || '',
            // Cada serial con SU TARIFA (2026-09-02): línea del contrato por
            // modelo+modalidad + servicios amarrados al serial. Lo que el
            // cliente firma es exactamente esto — congelado.
            anexo: (enCampo || []).slice(0, 300).map(u => {
              // Línea por FAMILIA de modelo (PNC360S ≡ PNC360S-R) y modalidad
              // — antes era exacta y dejaba radios "sin tarifa" en el anexo
              // que firma el cliente (caso Chino Panameño, 2026-09-07).
              const linea = this._lineaDeEquipo(u, c);
              let extras = 0;
              (c.cargos || []).forEach(cg => {
                if (cg.recurrente && Array.isArray(cg.seriales) && cg.seriales.includes(u.serial || u.id)) extras += Number(cg.monto || 0);
              });
              return {
                serial: u.serial || u.id, modelo: u.modelo_label || '',
                propiedad: u.propiedad === 'cliente' ? 'Del cliente' : 'C COMUNICA',
                ...(linea || extras ? { tarifa_mensual: Number(((linea ? Number(linea.precio || 0) : 0) + extras).toFixed(2)) } : {}),
              };
            }),
            ...(window.ContratoV2Texto ? {
              texto_version: ContratoV2Texto.version,
              inventario_html: ContratoV2Texto.inventarioHtml,
              vigencia_html: ContratoV2Texto.vigenciaHtml(
                `<b>${this.esc(this._durTxt(c) || '____ meses')}</b>`),
              clausulas_html: ContratoV2Texto.clausulasHtml,
            } : {}),
          },
          declaracion: `Declaro que he leído el contrato ${c.contrato_id || c.id} COMPLETO en esta página (secciones 1–4 y cláusulas 5–18) y acepto sus términos y condiciones en nombre de ${c.cliente_nombre || this.cliente.nombre || 'la empresa'}.`,
          resumen: {
            tipo_contrato: c.tipo_contrato || '', duracion: this._durTxt(c),
            equipos: (c.equipos || []).map(l => ({ modelo: l.modelo || '', cantidad: Number(l.cantidad || 0), precio: Number(l.precio || 0), ...(l.modalidad ? { modalidad: l.modalidad } : {}) })),
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
          El cliente abre este enlace en su celular, lee el <b>contrato completo</b> (queda una copia
          congelada del texto en la solicitud) y <b>firma con el dedo</b> — la aceptación solo se
          habilita después de abrir el documento.
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
            <b>${FMT.esc(c?.cliente_nombre || '')}</b> está listo. Ábralo con el botón, lea el contrato
            completo y firme con el dedo desde su celular. Debe firmarlo el <b>representante legal</b>
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
          // Adenda a contrato en papel: la solicitud lo declara para que la
          // página de firma diga que el contrato marco está en papel.
          ...(a.contrato_papel && !a.contrato_doc_id ? { contrato_papel: true } : {}),
          titulo: a.es_ajuste
            ? `Anexo de ajuste de tarifa ${gid} — contrato ${a.contrato_id || ''}`
            : a.es_regularizacion
            ? `Anexo de regularización ${gid} — contrato ${a.contrato_id || ''}`
            : a.contrato_papel && !a.contrato_doc_id
            ? `Adenda de aumento ${gid} — contrato en papel ${a.contrato_id || ''}`
            : `Anexo de aumento ${gid} — contrato ${a.contrato_id || ''}`,
          declaracion: a.es_ajuste
            ? `Declaro que acepto ${[
                (a.cargos || []).length ? `los cargos del anexo ${gid} (${(a.cargos || []).map(c => `${c.concepto} $${Number(c.monto || 0).toFixed(2)}${c.recurrente ? '/mes' : ''} × ${c.cantidad}`).join('; ')})` : '',
                (a.ajustes_precio || []).length ? `el ajuste de tarifa de ${a.ajustes_precio.length} línea(s): ${a.ajustes_precio.map(x => `${x.modelo} de $${Number(x.precio_anterior).toFixed(2)} a $${Number(x.precio_nuevo).toFixed(2)}/mes`).join('; ')}` : '',
              ].filter(Boolean).join(' y ')} al contrato ${a.contrato_id || ''} en nombre de ${g.cliente_nombre || 'la empresa'}.`
            : a.es_regularizacion
            ? `Declaro que los equipos del anexo ${gid} (${(a.regulariza_seriales || []).map(s => s.serial).join(', ')}) están en poder de ${g.cliente_nombre || 'la empresa'} y acepto su incorporación al contrato ${a.contrato_id || ''} con las tarifas indicadas.`
            : `Declaro que he leído el anexo de aumento ${gid} al contrato ${a.contrato_id || ''} y acepto sus términos y condiciones en nombre de ${g.cliente_nombre || 'la empresa'}.`,
          representante: { nombre: this.cliente.representante || '', cedula: this.cliente.representante_cedula || '' },
          ...(a.es_ajuste ? { es_ajuste: true,
            ...(Array.isArray(a.ajustes_precio) && a.ajustes_precio.length
              ? { ajustes_precio: a.ajustes_precio } : {}) } : {}),
          ...(a.es_regularizacion ? { es_regularizacion: true,
            // La modalidad viaja en el congelado (2026-09-09): el cliente que
            // firma tiene que ver de quién es cada radio que se le amarra.
            regulariza_seriales: (a.regulariza_seriales || []).map(s => ({
              serial: s.serial || '', modelo: s.modelo || '',
              ...(s.modalidad ? { modalidad: s.modalidad } : {}) })) } : {}),
          // Texto del anexo CONGELADO con su versión (misma regla que el
          // contrato: la firma cae sobre lo que el cliente leyó, inmutable) +
          // las cláusulas del marco que el anexo cita, para leerlas ahí mismo.
          ...(window.ContratoV2Texto ? { documento: {
            texto_version: ContratoV2Texto.version,
            intro_html: ContratoV2Texto.anexoIntro(a.es_regularizacion === true),
            marco_html: ContratoV2Texto.anexoMarco,
            clausulas_html: ContratoV2Texto.clausulasHtml,
          } } : {}),
          resumen: {
            tipo_contrato: a.es_regularizacion ? 'Anexo de regularización' : 'Anexo de aumento',
            duracion: a.es_ajuste
              ? `Rige con el contrato${a.duracion_meses ? ` (${a.duracion_meses} meses)` : ''}`
              : a.es_regularizacion
              ? `${a.duracion_meses || '?'} meses (desde la firma — equipos ya entregados)`
              : `${a.duracion_meses || '?'} meses (tramo del anexo, desde la entrega)`,
            equipos: (a.lineas || []).map(l => ({ modelo: l.modelo || '', cantidad: Number(l.cantidad || 0), precio: Number(l.precio || 0), ...(l.modalidad ? { modalidad: l.modalidad } : {}) })),
            cargos: (a.cargos || []).map(x => ({ concepto: x.concepto || '', cantidad: Number(x.cantidad || 1), monto: Number(x.monto || 0), recurrente: !!x.recurrente,
              ...(Array.isArray(x.seriales) && x.seriales.length ? { seriales: x.seriales } : {}) })),
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
          El cliente abre el enlace en su celular, revisa el anexo (${this.esc(this._resumenAnexoTxt(a))})
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

  // Resumen en texto de lo que trae el anexo (líneas + cargos + tarifas
  // renegociadas) — para correos y modales: nunca "(vacío)" en un ajuste.
  _resumenAnexoTxt(a = {}) {
    return [
      ...(a.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`),
      ...(a.cargos || []).map(c => `${c.cantidad} × ${c.concepto} $${Number(c.monto || 0).toFixed(2)}${c.recurrente ? '/mes' : ''}`),
      ...(a.ajustes_precio || []).map(x => `${x.modelo} $${Number(x.precio_anterior).toFixed(2)}→$${Number(x.precio_nuevo).toFixed(2)}`),
    ].join(', ') || '—';
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
            Estimado cliente: el anexo al contrato <b>${FMT.esc(a.contrato_id || '')}</b> de
            <b>${FMT.esc(g?.cliente_nombre || '')}</b> está listo
            (${FMT.esc(this._resumenAnexoTxt(a))}).
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
    // Los contratos EN TRÁMITE (pendiente de aprobación / aprobado sin firmar
    // reciente) NO van en esta tabla: decir "aprobado" aquí los hacía parecer
    // contratos andando (reclamo 2026-08-28). Viven en "Requiere tu acción" y
    // en Gestiones con su pipeline.
    // Solo los trámites NO activos salen de la tabla: una renovación ya
    // ACTIVA es un contrato andando (va en la tabla) aunque su pipeline siga
    // visible en Gestiones hasta regularizar.
    const tramiteIds = new Set(this._tramitesContrato().filter(c => c.estado !== 'activo').map(c => c.id));
    const operativos = this.contratos.filter(c => this._esVigente(c) && !this._renovadoPor(c) && !tramiteIds.has(c.id));
    const historico = this.contratos.filter(c => !operativos.includes(c) && !tramiteIds.has(c.id));
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
        ${(() => {
          const tram = this._renovacionEnTramite();
          if (tram) return `<button class="btn btn-ghost cg-act cg-senal-cta"
            onclick="Centro.abrirGestion('ct-${this.esc(tram.id)}')">Renovación en trámite ›</button>`;
          return this.puedeCrearGestion() && (operativos.length > 1 || this._wcCustodia().length)
            ? `<button class="btn btn-primary cg-act cg-senal-cta"
                 title="Consolida los contratos de la cuenta en uno solo"
                 onclick="Centro.wizContrato({renovarCuenta:true})">Renovar cuenta</button>` : '';
        })()}
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
      ${tramiteIds.size ? `<p style="font-size:12px; color:var(--fg-4); margin:0 0 8px;">
        ${tramiteIds.size} contrato(s) <b>en trámite</b> (aprobación/firma) — atiéndelos arriba en “Requiere tu acción” o en Gestiones.</p>` : ''}
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
          const refPapel = e.vigencia?.contrato_papel_ref ? `adenda al contrato en papel ${this.esc(e.vigencia.contrato_papel_ref)} · ` : '';
          return `<span class="cg-venc ${cls} num" title="Vence ${this._fmtFecha(fvU)} · ${refPapel}período estampado desde la orden de entrega — sin contrato formal (regularizar al renovar)">${label} *</span>`;
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
  // "Una familia, dos filas" (2026-09-07): la decisión vive en ModeloFamilia
  // (misma fila del catálogo primero, luego misma familia N/R; la modalidad
  // filtra y una línea sin modalidad es legacy). El texto de aquí abajo solo
  // corre si el módulo no cargó.
  _normModelo(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },
  _mismoModeloLinea(l, e) {
    if (window.ModeloFamilia) return ModeloFamilia.lineasCompatibles(this._refEquipo(e), [l]).length > 0;
    if (l.modelo_id && e.modelo_id && l.modelo_id === e.modelo_id) return true;
    const a = this._normModelo(l.modelo), b = this._normModelo(e.modelo_label);
    if (!a || !b) return false;
    return a === b || a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a);
  },
  _refEquipo(e) {
    return { modelo_id: e.modelo_id || null, modelo: e.modelo_label || e.modelo || '', propiedad: e.propiedad, modalidad: e.modalidad };
  },

  // Línea del contrato que le corresponde a la unidad — la que define su
  // tarifa y su tramo. Exacta primero; si no, la de su familia.
  _lineaDeEquipo(e, c) {
    const ls = c?.equipos || [];
    if (window.ModeloFamilia) { const i = ModeloFamilia.lineaPara(this._refEquipo(e), ls); return i >= 0 ? ls[i] : undefined; }
    return ls.find(l => this._mismoModeloLinea(l, e));
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
    if (!cont) return;
    const q = (document.getElementById('fEqFiltro')?.value || '').trim().toUpperCase();
    const chip = (e) => (window.EquiposPoolService?.chipEstadoHtml)
      ? EquiposPoolService.chipEstadoHtml(e.estado)
      : this.esc(e.estado || '—');
    // "De quién es" por serial (2026-09-09): la propiedad de CADA unidad, que
    // es la que manda desde que la cuenta se maneja por serial y no por el
    // tipo del contrato.
    const chipProp = (e) => (window.EquiposPoolService?.chipPropiedadHtml)
      ? EquiposPoolService.chipPropiedadHtml(e)
      : this.esc(e.propiedad || '—');
    const fila = (e) => `<tr>
      <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
      <td>${this.esc(e.modelo_label || '—')}</td>
      <td>${chipProp(e)}</td>
      <td>${chip(e)}${e.pendiente_devolucion ? ' <span class="cg-venc por_vencer">pend. devolución</span>' : ''}</td>
      <td class="cg-mono" style="font-size:12px;">${this.esc(e.asignacion?.contrato_id || '—')}</td>
      <td style="text-align:right;">${this._tarifaEquipo(e)}</td>
      <td>${this._vencChipEquipo(e)}</td>
      <td style="text-align:right;"><button class="btn btn-ghost cg-act"
        title="Historia completa de esta unidad" onclick="Centro.verKardex('${this.esc(e.id)}')">Kardex ›</button></td></tr>`;
    const tabla = (rows) => `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
      <th>Serial</th><th>Modelo</th><th>De quién es</th><th>Situación</th><th>Contrato</th><th style="text-align:right;">Tarifa</th><th>Vence</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    const resProp = (items) => (window.EquiposPoolService?.resumenPropiedadTexto)
      ? EquiposPoolService.resumenPropiedadTexto(items) : '';
    if (!this.equipos.length) { cont.innerHTML = '<div class="cg-empty">Sin equipos asignados en el inventario.</div>'; return; }
    // Buscar un serial lo abre directo: con filtro, lista plana.
    if (q) {
      const lista = this.equipos.filter(e => `${e.serial || ''} ${e.modelo_label || ''} ${e.asignacion?.contrato_id || ''}`.toUpperCase().includes(q));
      cont.innerHTML = lista.length ? tabla(lista.map(fila).join('')) : '<div class="cg-empty">Ningún equipo coincide con la búsqueda.</div>';
      return;
    }
    // Sin filtro: GRUPOS (2026-09-08). Antes eran 52 filas abiertas con los
    // "por clasificar" primero — el 67 % de la ficha. Un grupo por contrato,
    // con conteo, modelos y vencimiento; "sin contrato" y "por clasificar"
    // aparte con su salida; los seriales aparecen al abrir el grupo.
    // …pero agrupar tiene sentido cuando hay MUCHO que ordenar. En una cuenta
    // chica (Alberto 2026-09-09, caso FORTUNATO MANGRAVITA: 13 radios, todos
    // del mismo contrato) el grupo es un clic de más para ver la lista que
    // cabe entera: hasta 15 equipos, o cuando todo cae en un solo grupo, la
    // tabla va plana. La columna "Contrato" ya dice de dónde viene cada uno.
    const grupos = new Map();
    for (const e of this.equipos) {
      let k, orden;
      if (['en_taller', 'devuelto_revision'].includes(e.estado)) { k = 'taller'; orden = 3; }
      else if (e.estado === 'por_clasificar') { k = 'por_clasificar'; orden = 4; }
      else if (['en_cliente', 'asignado_contrato'].includes(e.estado)) {
        k = e.asignacion?.contrato_doc_id ? `c:${e.asignacion.contrato_doc_id}` : 'sin_contrato';
        orden = e.asignacion?.contrato_doc_id ? 1 : 2;
      } else { k = `otros:${e.estado}`; orden = 5; }
      if (!grupos.has(k)) grupos.set(k, { k, orden, items: [] });
      grupos.get(k).items.push(e);
    }
    // Cuenta chica o de un solo grupo: la lista entera, sin clics de por medio.
    if (this.equipos.length <= 15 || grupos.size === 1) {
      const sinContrato = (grupos.get('sin_contrato')?.items || []).length;
      const porClasificar = (grupos.get('por_clasificar')?.items || []).length;
      const aviso = (sinContrato || porClasificar) && this.puedeCrearGestion()
        ? `<div class="cg-senal warn" style="margin-bottom:8px; align-items:center;">
            <span>${[sinContrato ? `<b>${sinContrato}</b> en campo sin contrato` : '',
                     porClasificar ? `<b>${porClasificar}</b> por clasificar` : ''].filter(Boolean).join(' · ')}
              — cuentan como deuda de la cuenta.</span>
            <button class="btn btn-ghost" style="margin-left:auto; flex:none; padding:3px 11px; font-size:12px;"
              onclick="event.preventDefault(); Centro.verRegularizacion()">Qué falta</button></div>`
        : '';
      const orden = (e) => (['en_cliente', 'asignado_contrato'].includes(e.estado) ? 0 : 1);
      const todos = [...this.equipos].sort((a, b) => orden(a) - orden(b)
        || String(a.asignacion?.contrato_id || 'zzz').localeCompare(String(b.asignacion?.contrato_id || 'zzz'))
        || String(a.serial || a.id).localeCompare(String(b.serial || b.id)));
      const resumen = resProp(todos);
      cont.innerHTML = `${aviso}${resumen ? `<div style="font-size:12.5px; color:var(--fg-3); margin-bottom:6px;">${this.esc(resumen)}</div>` : ''}${tabla(todos.map(fila).join(''))}`;
      return;
    }
    const venceDe = (c) => { const d = c?.fecha_vencimiento?.toDate ? c.fecha_vencimiento.toDate() : (c?.fecha_vencimiento ? new Date(c.fecha_vencimiento) : null); return d && !isNaN(d) ? d.getTime() : Infinity; };
    const lista = [...grupos.values()].sort((a, b) => a.orden - b.orden
      || (a.k.startsWith('c:') && b.k.startsWith('c:') ? venceDe(this.contratos.find(c => c.id === a.k.slice(2))) - venceDe(this.contratos.find(c => c.id === b.k.slice(2))) : 0));
    const modelos = (items) => { const m = [...new Set(items.map(e => e.modelo_label).filter(Boolean))]; return m.length ? this.esc(m.slice(0, 2).join(', ')) + (m.length > 2 ? ` +${m.length - 2}` : '') : '<span style="color:var(--fg-4);">sin modelo</span>'; };
    const abiertos = this._eqGruposAbiertos || new Set();
    this._eqGruposAbiertos = abiertos;
    const html = lista.map(g => {
      const n = g.items.length;
      let titulo = '', k2 = '', tono = '', accion = '';
      if (g.k.startsWith('c:')) {
        const c = this.contratos.find(x => x.id === g.k.slice(2));
        titulo = `<span class="cg-mono">${this.esc(c?.contrato_id || g.items[0].asignacion?.contrato_id || '—')}</span> · ${modelos(g.items)}`;
        k2 = c ? `${this._tarifaEquipo(g.items[0])} · ${this._vencChipEquipo(g.items[0])}` : '';
      } else if (g.k === 'sin_contrato') {
        titulo = `<b>En campo sin contrato</b> · ${modelos(g.items)}`; tono = 'warn';
        k2 = 'cuentan como deuda de la cuenta';
        accion = this.puedeCrearGestion() ? `<button class="btn btn-ghost cg-act" onclick="event.preventDefault(); Centro.verRegularizacion()">Qué falta</button>` : '';
      } else if (g.k === 'por_clasificar') {
        titulo = `<b>Por clasificar</b> · ubicación desconocida`; tono = 'warn';
        k2 = 'cola de bodega';
        accion = `<a class="btn btn-ghost cg-act" href="../inventario/equipos.html?tab=por_clasificar" onclick="event.stopPropagation()">Ver por clasificar</a>`;
      } else if (g.k === 'taller') {
        titulo = `<b>En taller / revisión</b> · ${modelos(g.items)}`;
        k2 = 'vuelven al cliente al entregarse la orden';
      } else {
        titulo = `<b>${this.esc((window.EquiposPoolService?.ESTADO_LABELS || {})[g.items[0].estado] || g.items[0].estado)}</b> · ${modelos(g.items)}`;
      }
      const open = abiertos.has(g.k) || (lista.length === 1);
      // El desglose de propiedad va en el MISMO span del conteo: la rejilla
      // del summary tiene 5 celdas fijas y en móvil se oculta la segunda .k.
      const rp = resProp(g.items);
      return `<details class="cg-eqgrp ${tono}" data-grp="${this.esc(g.k)}" ${open ? 'open' : ''} ontoggle="Centro._eqToggle(this)">
        <summary><span>${titulo}</span><span class="k">${n} equipo${n === 1 ? '' : 's'}${rp ? ` · ${rp}` : ''}</span><span class="k">${k2}</span><span>${accion}</span><span class="chev">›</span></summary>
        <div style="padding:6px 8px 8px;">${tabla(g.items.map(fila).join(''))}</div>
      </details>`;
    }).join('');
    cont.innerHTML = html;
  },
  _eqGruposAbiertos: null,
  _eqToggle(d) {
    const s = this._eqGruposAbiertos || (this._eqGruposAbiertos = new Set());
    if (d.open) s.add(d.dataset.grp); else s.delete(d.dataset.grp);
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
    window.AprobacionesService?.invalidarHome();
    this.gestiones = await GestionesService.listarPorCliente(this.cliente.id).catch(() => this.gestiones || []);
    this.pintarAcciones();
    this.pintarKpis();
    this.pintarSenales();
    this.pintarGestiones();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // ── Escucha en vivo de las gestiones de la ficha (2026-08-31) ──
  // Los triggers escriben el avance segundos después de cada acción; el
  // listener repinta con el estado real en vez de adivinar con timeouts.
  _unsubGestiones: null,
  _repintarPend: false,
  _escucharGestiones(clienteId) {
    this._pararEscucha();
    try {
      this._unsubGestiones = firebase.firestore().collection('gestiones')
        .where('cliente_id', '==', clienteId)
        .onSnapshot((snap) => {
          if (!this.cliente || this.cliente.id !== clienteId) return;
          const out = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          out.sort((a, b) => (b.fecha_solicitud?.toMillis?.() || 0) - (a.fecha_solicitud?.toMillis?.() || 0));
          // Una gestión que CAMBIA DE ESTADO casi siempre movió la cuenta:
          // amarró seriales, soltó radios, agregó líneas a un contrato. Antes
          // solo se repintaba el expediente y el resto de la ficha (flota,
          // contratos, chip de regularización, menú de acciones) se quedaba
          // con lo que se leyó al entrar — el reporte de Alberto 2026-09-09:
          // "los menús se quedan estáticos". Ahora se relee lo de verdad.
          const estados = out.map(g => `${g.id}:${g.estado}`).join('|');
          const movio = this._gEstados !== null && this._gEstados !== estados;
          this._gEstados = estados;
          this.gestiones = out;
          this._repintarGestiones();
          if (movio) this._revalidarPronto(clienteId);
        }, (e) => console.warn('[centro] escucha de gestiones no disponible:', e?.message || e));
    } catch (e) { console.warn('[centro] escucha de gestiones no disponible:', e?.message || e); }
  },
  // Los triggers escriben en cadena (pool → contrato → cuenta): se relee un
  // par de veces, no una, para no pintar a medio camino.
  _gEstados: null,
  _revalTimers: [],
  _revalidarPronto(clienteId) {
    this._revalTimers.forEach(t => clearTimeout(t));
    this._revalTimers = [1200, 6000].map(ms => setTimeout(() => {
      if (this.cliente && this.cliente.id === clienteId) this._revalidarFicha(clienteId);
    }, ms));
  },

  // ── Escucha en vivo del cliente (2026-09-09) ──
  // `clientes/{id}.regularizacion` lo escribe el back (al aplicar el anexo y
  // en el barrido). Sin esta escucha, el chip "Por regularizar" y el menú se
  // quedaban con el número viejo hasta el F5.
  _unsubCliente: null,
  _escucharCliente(clienteId) {
    try {
      this._unsubCliente = firebase.firestore().collection('clientes').doc(clienteId)
        .onSnapshot((snap) => {
          if (!snap.exists || !this.cliente || this.cliente.id !== clienteId) return;
          const antes = this.cliente.regularizacion || null;
          this.cliente = { id: snap.id, ...snap.data() };
          const ahora = this.cliente.regularizacion || null;
          this._pintarEncabezado(this.cliente);
          this.pintarSenales();
          this.pintarAcciones();
          this.armarMenu();
          if (window.lucide?.createIcons) lucide.createIcons();
          const pa = Number(antes?.puntos || 0), pd = Number(ahora?.puntos || 0);
          if (antes && pa !== pd) {
            Toast.show(pd === 0
              ? 'La cuenta quedó al día — ya no pide regularización'
              : `La cuenta bajó de ${pa} a ${pd} punto${pd === 1 ? '' : 's'} por regularizar`, pd === 0 ? 'ok' : '');
          }
        }, (e) => console.warn('[centro] escucha del cliente no disponible:', e?.message || e));
    } catch (e) { console.warn('[centro] escucha del cliente no disponible:', e?.message || e); }
  },
  _pararEscucha() {
    if (this._unsubGestiones) {
      try { this._unsubGestiones(); } catch (e) { /* nada */ }
      this._unsubGestiones = null;
    }
    if (this._unsubCliente) {
      try { this._unsubCliente(); } catch (e) { /* nada */ }
      this._unsubCliente = null;
    }
    this._revalTimers.forEach(t => clearTimeout(t));
    this._revalTimers = [];
    this._gEstados = null;
  },
  _repintarGestiones() {
    // Con el foco en un campo del expediente (bodega tecleando seriales) el
    // repintado se pospone al blur — si no, le borra lo escrito a mitad.
    const act = document.activeElement;
    const enExp = act && document.getElementById('fGestiones')?.contains(act)
      && ['INPUT', 'SELECT', 'TEXTAREA'].includes(act.tagName);
    if (enExp) {
      if (!this._repintarPend) {
        this._repintarPend = true;
        act.addEventListener('blur', () => {
          this._repintarPend = false;
          setTimeout(() => this._repintarGestiones(), 120);
        }, { once: true });
      }
      return;
    }
    this.pintarAcciones();
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

  // Contratos EN TRÁMITE (renovación de cuenta / contrato nuevo) como
  // expedientes de esta sección (pedido 2026-08-28: la renovación no aparecía
  // en Gestiones y solo se podía aprobar en el módulo viejo). El contrato ES
  // el expediente: pipeline aprobación → firma → activación → regularización,
  // con las acciones aquí mismo.
  _tramitesContrato() {
    const dias = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? (Date.now() - d) / 86400000 : null; };
    return (this.contratos || []).filter(c => !c.deleted && (
      c.estado === 'pendiente_aprobacion'
      || (c.estado === 'aprobado' && !c.firmado && (dias(c.fecha_creacion) ?? 999) < 45)
      // Renovación ACTIVA pero con la regularización PENDIENTE o PARCIAL
      // (caso C COMUNICA 2026-08-28: el trigger amarró 2 y dejó 2 sin línea,
      // y el check se daba por listo con solo regularizacion.at): el trámite
      // no termina hasta que la conciliación queda EN CERO.
      || (c.accion === 'Renovación' && c.estado === 'activo' && !!this._regPendiente(c)
          && (dias(c.fecha_creacion) ?? 999) < 45)));
  },
  // La regularización solo está completa cuando CORRIÓ y quedó en cero.
  // Devuelve null si está lista; {motivo:'pendiente'} si aún no corre (la
  // custodia se amarra al entregarse la OS); {motivo:'sobrantes', seriales}
  // si corrió pero dejó equipos sin línea o sin cupo en el contrato.
  _regPendiente(c) {
    if (c.estado !== 'activo') return null;
    const r = c.regularizacion;
    if (!r?.at) return { motivo: 'pendiente' };
    const sob = Number(r.sin_linea || 0) + Number(r.sin_cupo || 0);
    if (!sob) return null;
    return { motivo: 'sobrantes', sob,
      seriales: [...(r.sin_linea_seriales || []), ...(r.sin_cupo_seriales || [])] };
  },
  // Una renovación EN CURSO apaga todos los botones de "Renovar cuenta"
  // (reclamo 2026-08-28: mil botones de renovación con una ya en trámite).
  _renovacionEnTramite() {
    return this._tramitesContrato().find(c => c.accion === 'Renovación') || null;
  },
  _tramiteHtml(c) {
    const abierta = this.gSel === 'ct-' + c.id;
    const reg = this._regPendiente(c);
    const r = c.regularizacion;
    const regSub = reg?.motivo === 'sobrantes'
      ? `${Number(r?.amarradas || 0)} amarrado(s) · ${reg.sob} SIN resolver: ${reg.seriales.slice(0, 4).join(', ')}${reg.seriales.length > 4 ? '…' : ''} — agrégalos por anexo o libéralos`
      : (r?.at && !reg) ? `${Number(r.amarradas || 0)} radio(s) amarrados — conciliación en cero`
      : 'la custodia se amarra sola al entregarse la orden de servicio';
    const pasos = [
      ['Aprobación comercial', c.estado !== 'pendiente_aprobacion', 'llega a ventas@cecomunica.com'],
      ['Firma del cliente', !!c.firmado, c.firma_solicitud_estado === 'pendiente' ? 'enlace de firma enviado — esperando' : 'enlace digital, o subir el firmado'],
      ['Activación', c.estado === 'activo', 'automática al validarse la firma'],
      ['Regularización de la cuenta', c.estado === 'activo' && !reg, regSub],
    ];
    const done = pasos.filter(p => p[1]).length;
    const [chipCls, chipTxt] = c.estado === 'pendiente_aprobacion' ? ['cg-chip--warn', 'Esperando aprobación']
      : !c.firmado ? ['cg-chip--warn', 'Esperando firma']
      : c.estado === 'activo' && reg?.motivo === 'sobrantes' ? ['cg-chip--warn', 'Activo — regularización parcial']
      : c.estado === 'activo' && reg ? ['cg-chip--info', 'Activo — regularización pendiente']
      : c.estado === 'activo' ? ['cg-chip--ok', 'Activo'] : ['cg-chip--info', 'En trámite'];
    const unid = (c.equipos || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const esRenov = c.accion === 'Renovación';
    const timeline = `<div class="cg-tl">` + pasos.map(([t, ok, s], i) => {
      const next = !ok && pasos.slice(0, i).every(p => p[1]);
      return `<div class="cg-tl-item${ok ? ' done' : next ? ' next' : ''}">
        <span class="cg-tl-dot">${ok ? '✓' : ''}</span>
        <span class="cg-tl-t"><b>${t}</b><span class="s">${s}</span></span></div>`;
    }).join('') + `</div>`;
    // Las acciones ya NO se pintan aquí sueltas: viven en el "⋯" de la fila y
    // en el pie del detalle, la misma lista y en el mismo orden que la de una
    // gestión (2026-09-09). Se deja el atajo al siguiente paso, que sale de
    // esa misma lista — no es una botonera aparte.
    const acc = this._accionesContrato(c);
    const acciones = this._pieAcciones('dct-' + c.id, acc);
    return `
      <div class="cg-row" id="grow-ct-${this.esc(c.id)}" role="button" tabindex="0" onclick="Centro.toggleGestion('ct-${this.esc(c.id)}')"
           onkeydown="if(event.key==='Enter')this.click()" style="${abierta ? 'border-color:var(--accent);' : ''}">
        <div style="min-width:0; flex:1;"><div class="n cg-mono" style="font-size:13px;">${this.esc(c.contrato_id || c.id)}</div>
          <div class="s">${esRenov ? 'Renovación de cuenta' : 'Contrato nuevo'} · ${unid} unid. · $${Number(c.total_mensual || 0).toFixed(2)}/mes</div></div>
        <span class="num" style="font-size:12px; color:var(--fg-3); flex:none;">${done}/4</span>
        <span class="cg-chip ${chipCls}" style="flex:none;">${chipTxt}</span>
        ${this._masFila('ct-' + c.id, this._accionesContrato(c), c.contrato_id || c.id)}
        <span class="arr" style="margin-left:0;">${abierta ? '▾' : '›'}</span>
      </div>
      ${abierta ? `<div class="ds-card" style="padding:var(--sp-4); margin:-4px 0 10px; border-top:none;">
        <div class="cg-exp">
          <div>
            <p style="font-size:13px; margin:0 0 8px;">${esRenov
              ? `Renueva y <b>consolida la cuenta</b>: sus orígenes quedan marcados como renovados al activarse.`
              : `Contrato nuevo pendiente del ciclo aprobación → firma → activo.`}
              <b>Duración:</b> ${this.esc(this._durTxt(c) || '—')}</p>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">${acciones}</div>
            ${this._osTramiteHtml(c)}
          </div>
          <div>${timeline}</div>
        </div>
      </div>` : ''}`;
  },

  // ── Flujo de las órdenes de servicio del contrato (pedido 2026-08-28: el
  // vendedor debe VER el equipo avanzar por bodega/taller sin salir de la
  // ficha). El vínculo vive en ordenes_de_servicio.contrato.contrato_doc_id
  // (mapa estampado al crear la orden); las fechas del doc son las etapas.
  _osCache: {},
  async _cargarOsContrato(cid) {
    if (this._osCache[cid]) return;
    this._osCache[cid] = { loading: true };
    try {
      const snap = await firebase.firestore().collection('ordenes_de_servicio')
        .where('contrato.contrato_doc_id', '==', cid).limit(20).get();
      const os = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(o => o.eliminado !== true)
        .sort((a, b) => String(b.id).localeCompare(String(a.id)));
      this._osCache[cid] = { os };
    } catch (e) {
      console.warn('[centro] órdenes del contrato no legibles:', e?.message || e);
      this._osCache[cid] = { os: [], error: true };
    }
    if (this.gSel === 'ct-' + cid) { this.pintarGestiones(); if (window.lucide?.createIcons) lucide.createIcons(); }
  },
  _osPasos(o) {
    const f = (ts) => { const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d && !isNaN(d) ? d.toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit' }) : null; };
    return [
      ['Creada', f(o.fecha_creacion || o.creado_en)],
      ['Recibida', f(o.fecha_recepcion)],
      [o.tecnico_asignado ? `Asignada (${o.tecnico_asignado})` : 'Asignada', f(o.fecha_asignacion)],
      ['Completada', f(o.fecha_completado)],
      ['Entregada', f(o.fecha_entrega)],
    ];
  },
  _osTramiteHtml(c) {
    const cch = this._osCache[c.id];
    if (!cch || cch.loading) {
      if (!cch) this._cargarOsContrato(c.id);
      return `<div class="cg-skel" style="height:34px; margin-top:10px;" aria-label="Cargando órdenes…"></div>`;
    }
    if (!cch.os.length) return `<p style="font-size:12.5px; color:var(--fg-3); margin:10px 0 0;">
      Aún sin órdenes de servicio de este contrato — bodega crea la orden al preparar los equipos.</p>`;
    return `<div style="margin-top:10px;">` + cch.os.map(o => {
      const pasos = this._osPasos(o);
      const idxNext = pasos.findIndex(p => !p[1]);
      const flujo = pasos.map((p, i) => {
        const ok = !!p[1];
        const estilo = ok ? '' : (i === idxNext ? 'color:var(--warn-deep, #92400E); font-weight:600;' : 'color:var(--fg-4);');
        return `<span style="white-space:nowrap; ${estilo}">${ok ? '✓ ' : '○ '}${this.esc(p[0])}${p[1] ? ` <span style="color:var(--fg-4); font-weight:400;">${p[1]}</span>` : ''}</span>`;
      }).join('<span style="color:var(--fg-4);"> › </span>');
      const nSer = (o.equipos || []).length;
      return `<div class="cg-os" style="margin-bottom:6px;">
        <a href="../ordenes/editar-orden.html?id=${encodeURIComponent(o.id)}">
          <b>${this.esc(o.tipo_de_servicio || 'ORDEN')}</b>&nbsp;<span class="cg-mono">${this.esc(o.id)}</span></a>
        <span style="font-size:12px; color:var(--fg-3);">${nSer} equipo(s) · ${this.esc(o.estado_reparacion || '—')}</span>
        <div style="flex-basis:100%; font-size:12px; margin-top:3px; display:flex; flex-wrap:wrap; gap:2px 4px;">${flujo}</div>
      </div>`;
    }).join('') + `</div>`;
  },

  pintarGestiones() {
    const cont = document.getElementById('fGestiones');
    const tramites = this._tramitesContrato();
    const tramHtml = tramites.map(c => this._tramiteHtml(c)).join('');
    if (!(this.gestiones || []).length && !tramites.length) {
      cont.innerHTML = `<div class="cg-empty">Sin gestiones registradas todavía.
        ${this.puedeCrearGestion() ? `<div class="cta"><button class="btn btn-primary cg-act"
          onclick="event.stopPropagation(); document.getElementById('btnGestion')?.scrollIntoView({block:'center'}); document.getElementById('btnGestion')?.click()">Nueva gestión</button></div>` : ''}</div>`;
      return;
    }
    const filaG = (g, atenuada) => {
      // Progreso con LOS PASOS DEL TIPO (el 4 fijo de reemplazo/demo pintaba
      // "3/4" en un aumento cerrado con sus 6 pasos completos).
      const defsG = this.CIERRE_DEFS[g.tipo] || this.CIERRE_DEFS.reemplazo;
      const done = defsG.filter(([k]) => g.cierre?.[k] === true).length;
      const fecha = g.fecha_solicitud?.toDate ? g.fecha_solicitud.toDate().toLocaleDateString('es-PA') : '—';
      const abierta = this.gSel === g.id;
      return `
      <div class="cg-row${atenuada && !abierta ? ' cg-tenue' : ''}" id="grow-${this.esc(g.id)}" role="button" tabindex="0" onclick="Centro.toggleGestion('${this.esc(g.id)}')"
           onkeydown="if(event.key==='Enter')this.click()"
           style="${abierta ? 'border-color:var(--accent);' : ''}">
        <div style="min-width:0; flex:1;"><div class="n cg-mono" style="font-size:13px;${g.estado === 'anulada' ? ' text-decoration:line-through; color:var(--fg-3);' : ''}">${this.esc(g.id)}</div>
          <div class="s">${g.tipo === 'aumento' && g.aumento?.es_regularizacion ? 'Regularización por anexo'
            : g.tipo === 'aumento' && g.aumento?.es_ajuste ? 'Ajuste de tarifa / servicios'
            : g.tipo === 'aumento' && g.aumento?.contrato_papel && !g.aumento?.contrato_doc_id ? `Adenda a contrato en papel <span class="cg-mono">${this.esc(g.aumento.contrato_id || '')}</span>`
            : this.esc(GestionesService.tipoLabel(g.tipo))} · ${g.tipo === 'demo'
            ? this.esc((g.demo?.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`).join(', ') || '—')
            : g.tipo === 'aumento'
            ? this.esc([...(g.aumento?.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`),
                        ...(g.aumento?.cargos || []).map(c => `${c.cantidad} × ${c.concepto}`)].join(', ') || '—')
            : `${(g.items || []).length} serial(es)`} · ${fecha}${g.estado === 'anulada' && g.anulada_motivo ? ` · <i>${this.esc(g.anulada_motivo)}</i>` : ''}</div></div>
        ${atenuada ? '' : `<span class="num" style="font-size:12px; color:var(--fg-3); flex:none;">${done}/${defsG.length}</span>`}
        ${g.regularizacion_bloqueada ? `<span class="cg-chip cg-chip--bad" style="flex:none;" title="Las cantidades del anexo no coinciden con los seriales — no se aplicó">No aplicado</span>` : ''}
        <span class="cg-chip cg-chip--estado-${this.esc(g.estado)}" style="flex:none;">${this.esc(GestionesService.estadoLabel(g.estado))}</span>
        ${this._masFila(g.id, this._accionesGestion(g), g.id)}
        <span class="arr" style="margin-left:0;">${abierta ? '▾' : '›'}</span>
      </div>
      ${abierta ? this._detalleGestion(g) : ''}`;
    };

    // Jerarquía (2026-09-02, pedido de Alberto: "las anuladas toman casi la
    // misma precedencia que las pendientes"): lo VIVO arriba — ordenado por
    // urgencia (quién espera una acción) — y cerradas/anuladas plegadas como
    // historial atenuado, igual que el Histórico de contratos.
    const PESO = { pendiente_aprobacion: 0, pendiente_firma: 1, pendiente_bodega: 2, en_proceso: 3, retorno: 4, en_demo: 5 };
    const ts = (g) => (g.fecha_solicitud?.toDate ? g.fecha_solicitud.toDate().getTime() : 0);
    const todas = this.gestiones || [];
    const vivas = todas.filter(g => !['cerrada', 'anulada'].includes(g.estado))
      .sort((a, b) => ((PESO[a.estado] ?? 9) - (PESO[b.estado] ?? 9)) || (ts(b) - ts(a)));
    const historial = todas.filter(g => ['cerrada', 'anulada'].includes(g.estado))
      .sort((a, b) => (a.estado === 'anulada' ? 1 : 0) - (b.estado === 'anulada' ? 1 : 0) || (ts(b) - ts(a)));
    const cerradasN = historial.filter(g => g.estado === 'cerrada').length;
    const anuladasN = historial.length - cerradasN;
    const histAbierto = historial.some(g => g.id === this.gSel);
    cont.innerHTML = tramHtml
      + vivas.map(g => filaG(g, false)).join('')
      + (historial.length ? `
        <details ${histAbierto ? 'open' : ''} style="margin-top:10px;">
          <summary style="cursor:pointer; font-size:12.5px; color:var(--fg-3); padding:4px 2px; user-select:none;">
            Historial — ${cerradasN} cerrada${cerradasN === 1 ? '' : 's'}${anuladasN ? ` · ${anuladasN} anulada${anuladasN === 1 ? '' : 's'}` : ''}</summary>
          <div style="margin-top:8px;">${historial.map(g => filaG(g, true)).join('')}</div>
        </details>` : '');
  },

  // La asignación de seriales de bodega (aumento/demo/reemplazo) se hace en
  // Almacén · Asignar desde 2026-09-03 (propuesta "Asignar desde Almacén"):
  // mismo formulario que los contratos, picker del estante y política dura.
  // El expediente solo la MUESTRA y, a quien puede asignar, le da el enlace
  // desde el menú de acciones (_accionesGestion → "Asignar seriales en Almacén").

  _detalleGestion(g) {
    // Checklist como timeline del kit: done = completado; next = el paso que
    // sigue (todos los anteriores completos) — el ojo sabe dónde está parado.
    let defs = this.CIERRE_DEFS[g.tipo] || this.CIERRE_DEFS.reemplazo;
    // La regularización comparte flags con el aumento pero su historia es
    // otra: sin bodega, sin OS, tramo desde la firma.
    if (g.tipo === 'aumento' && g.aumento?.es_ajuste) defs = [
      ['aprobacion', 'Aprobación comercial', 'Administración / gerencia'],
      ['firma', 'Anexo firmado por el cliente', 'Acepta los cargos / servicios nuevos'],
      ['derivacion', 'Cargos aplicados al contrato', 'Amarrados por serial cuando aplica'],
      ['asignacion', 'Sin bodega', 'No aplica: no hay equipos nuevos'],
      ['programacion', 'Sin orden de servicio', 'No aplica'],
      ['entrega', 'Ajuste completo', 'La tarifa mensual del contrato queda actualizada'],
    ];
    else if (g.tipo === 'aumento' && g.aumento?.es_regularizacion) defs = [
      ['aprobacion', 'Aprobación comercial', 'Administración / gerencia'],
      ['firma', 'Aplicada sin firma del cliente', 'Los equipos ya estaban en su poder — no se le envía nada a firmar'],
      ['derivacion', 'Líneas aplicadas al contrato', 'El tramo corre desde que se aplica'],
      ['asignacion', 'Seriales amarrados al contrato', 'Ya estaban en campo — sin pasar por bodega'],
      ['programacion', 'Sin orden de servicio', 'No aplica: nada que programar'],
      ['entrega', 'Regularización completa', 'Los sobrantes de la conciliación bajan a cero'],
    ];
    // Adenda a contrato EN PAPEL: mismo circuito del aumento, pero no hay
    // contrato interno al que aplicarle líneas — el tramo va a cada equipo.
    else if (g.tipo === 'aumento' && g.aumento?.contrato_papel && !g.aumento?.contrato_doc_id) defs = [
      ['aprobacion', 'Aprobación comercial', 'Administración / gerencia'],
      ['firma', 'Adenda firmada por el cliente', 'Cita el número del contrato en papel'],
      ['derivacion', 'Adenda registrada', 'Sin contrato en el sistema: nada que aplicar — la cuenta sigue por regularizar'],
      ['asignacion', 'Asignación de seriales', 'Bodega'],
      ['programacion', 'Programación', 'OS de programación confirmada'],
      ['entrega', 'Entrega al cliente', 'El tramo se estampa en cada equipo (custodia con vigencia propia)'],
    ];
    const check = `<div class="cg-tl">` + defs.map(([k, t, s], i) => {
      const done = g.cierre?.[k] === true;
      const next = !done && defs.slice(0, i).every(([kk]) => g.cierre?.[kk] === true);
      // El paso de la firma se rotula con el expediente, no con la plantilla
      // (2026-09-10, caso GA20260909-03): una actualización de seriales se
      // aplica SIN firma y el checklist la daba por "Anexo firmado".
      const titulo = k === 'firma' && typeof GestionAutorizacion !== 'undefined'
        ? GestionAutorizacion.pasoFirma(g, !done) : t;
      const sub = k === 'firma' && done && typeof GestionAutorizacion !== 'undefined'
        && !GestionAutorizacion.texto(g).firmado
        ? 'Al cliente no se le envió nada a firmar' : s;
      return `<div class="cg-tl-item${done ? ' done' : next ? ' next' : ''}">
        <span class="cg-tl-dot">${done ? '✓' : ''}</span>
        <span class="cg-tl-t"><b>${titulo}</b><span class="s">${sub}</span></span>
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
      // Pre-asignación durante la firma (2026-09-03, planteamiento de Zuleika:
      // la firma no debe frenar la preparación): bodega puede asignar los
      // seriales del aumento desde que se aprueba comercialmente — la OS solo
      // sale cuando el anexo quede firmado (el trigger exige cierre.derivacion).
      // Con la OS ya creada (sale apenas la asignación se completa, aunque el
      // anexo siga en firma — 2026-09-03) los seriales dejan de editarse aquí:
      // pool y orden ya los tienen amarrados.
      const preAsignando = g.estado === 'pendiente_firma' && !a.es_ajuste && !a.es_regularizacion
        && !g.ordenes?.programacion_id;
      const asignando = this.puedeAsignar() && !g.ordenes?.programacion_id
        && (g.estado === 'pendiente_bodega' || preAsignando);
      cuerpo = `
        ${a.es_ajuste ? `<p style="font-size:12.5px; margin:0 0 8px; color:var(--fg-3);">
          <b>Anexo de ajuste de tarifa / servicios</b> — sin equipos nuevos;
          al firmarse se aplica al contrato y cierra solo, sin bodega ni entrega.</p>
          ${(a.ajustes_precio || []).length ? `<p style="font-size:12.5px; margin:0 0 8px;">
            <b>Tarifas renegociadas:</b> ${a.ajustes_precio.map(x =>
              `${this.esc(x.modelo)} <span class="num">$${Number(x.precio_anterior).toFixed(2)} → $${Number(x.precio_nuevo).toFixed(2)}</span>`).join(' · ')}</p>` : ''}` : ''}
        ${g.regularizacion_bloqueada ? `<div class="cg-senal bad" style="margin-bottom:10px;">
          <span><b>El anexo no se aplicó:</b> ${this.esc(g.regularizacion_bloqueada.motivo || 'las cantidades no coinciden con los seriales')}.
          Un anexo de regularización solo cubre equipos que el cliente ya tiene; los radios nuevos van en un aumento aparte.
          Anula esta gestión y créala de nuevo desde "Nueva gestión".</span></div>` : ''}
        ${a.es_regularizacion ? `<p style="font-size:12.5px; margin:0 0 8px; color:var(--fg-3);">
          <b>Anexo de regularización</b> — amarra equipos que el cliente ya tiene
          (<span class="cg-mono">${(a.regulariza_seriales || []).map(s => this.esc(s.serial)).join(', ')}</span>);
          al firmarse se aplica y cierra solo, sin bodega ni entrega.</p>` : ''}
        ${a.contrato_papel && !a.contrato_doc_id ? `<div class="cg-senal warn" style="margin:0 0 8px;">
          <span><b>Adenda a contrato en papel</b> — el contrato marco <span class="cg-mono">${this.esc(a.contrato_id || '—')}</span>
          no está en el sistema. Al entregarse, cada equipo queda en <b>custodia con su tramo propio</b>;
          la cuenta sigue <b>pendiente de regularizar</b> (contrato nuevo cuando se pueda).</span></div>` : ''}
        <p style="font-size:13px; margin:0 0 8px;"><b>${a.contrato_papel && !a.contrato_doc_id ? 'Contrato en papel' : 'Contrato destino'}:</b>
          <span class="cg-mono">${this.esc(a.contrato_id || '—')}</span> ·
          <b>Vigencia:</b> ${a.es_ajuste
            ? `rige con el contrato${a.duracion_meses ? ` (${this.esc(String(a.duracion_meses))} meses)` : ''}`
            : `tramo de ${this.esc(String(a.duracion_meses || '?'))} meses ${a.es_regularizacion ? 'desde la firma' : 'desde la entrega'}`}</p>
        <div class="cg-twrap"><table class="cg-tabla"><thead><tr>
          <th>Cant.</th><th>Modelo</th><th>Precio/mes</th></tr></thead><tbody>
          ${(a.lineas || []).map(l => `<tr><td class="num">${Number(l.cantidad || 0)}</td>
            <td>${this.esc(l.modelo || '—')}</td><td class="num">$${Number(l.precio || 0).toFixed(2)}</td></tr>`).join('')}
          ${(a.cargos || []).map(c => `<tr><td class="num">${Number(c.cantidad || 0)}</td>
            <td style="color:var(--fg-3);">${this.esc(c.concepto || '—')} <span class="cg-venc ${c.recurrente ? 'vigente' : 'por_vencer'}" style="font-size:10.5px;">${c.recurrente ? 'mensual' : 'único'}</span>
              ${(c.seriales || []).length ? `<div class="cg-mono" style="font-size:11px; color:var(--fg-4);">${c.seriales.map(s => this.esc(s)).join(', ')}</div>` : ''}</td>
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
        ${g.sin_firma ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;">✓ Regularización cerrada
          <b>sin firma del cliente</b> por ${this.esc(g.sin_firma.por_email || '—')}${g.sin_firma.motivo ? ` — ${this.esc(g.sin_firma.motivo)}` : ''}</p>` : ''}
        ${g.firma_solicitud_estado === 'pendiente' ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;">
          Enlace de firma enviado — esperando al cliente. Se reenvía o se retira desde <b>Acciones</b>.</p>` : ''}
        ${g.firma_pendiente_validacion ? `
          <div class="cg-senal warn" style="margin-top:8px;">
            <span>Anexo firmado por persona <b>distinta al representante</b> — falta validar al firmante
              (<b>Acciones › Aceptar al firmante</b>).</span></div>` : ''}
        ${asignados.length ? `<p style="font-size:13px; margin:8px 0 0;"><b>Seriales:</b>
              ${asignados.map(s => `<span class="cg-mono">${this.esc(s.serial)}</span>`).join(', ')}
              ${total > asignados.length ? `<span style="color:var(--fg-3);">· ${asignados.length} de ${total}</span>` : ''}</p>` : ''}
        ${asignando
          ? `<p style="font-size:12.5px; color:var(--fg-3); margin:10px 0 0;">Bodega asigna los seriales desde
               <b>Almacén · Asignar</b> (Acciones ›).${preAsignando ? ' La firma del anexo corre <b>en paralelo</b> — la orden de programación saldrá sola al firmarse.' : ''}</p>`
          : ''}`;
    } else if (g.tipo === 'baja') {
      const pen = g.penalidad_estimada;
      const esTerm = Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length;
      const cartaHtml = g.carta_path
        ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:0 0 8px;">✓ Carta del cliente adjunta${g.fecha_nota_cliente ? ` (nota del ${this.esc(g.fecha_nota_cliente)})` : ''}
             <button class="btn btn-ghost cg-act" onclick="Centro.verAnexo('${this.esc(g.carta_path)}')">Ver carta</button></p>`
        : `<div class="cg-senal warn" style="margin:0 0 8px;">
             <span><b>Falta la carta de solicitud del cliente</b> — la aprobación queda bloqueada hasta adjuntarla
               (<b>Acciones › Subir la carta del cliente</b>).</span></div>`;
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
      // Propuesta del TALLER (2026-09-09): el diagnóstico va PRIMERO — es lo
      // que se lee para decidir. Sin esto, ventas aprobaría a ciegas.
      const taller = g.origen?.tipo === 'taller' ? `
        <div class="cg-senal info" style="margin:0 0 10px; display:block;">
          <div style="font-size:12.5px; color:var(--fg-3);">Propuesta del taller ·
            ${this.esc(g.origen.tecnico_email || g.responsable_email || '—')} ·
            orden <span class="cg-mono">${this.esc(g.origen.orden_id || '—')}</span></div>
          <div style="font-size:13.5px; margin-top:4px;">${this.esc(g.origen.diagnostico || '—')}</div>
          <div style="font-size:12.5px; color:var(--fg-3); margin-top:4px;">
            ${(g.items || []).every(it => it.saliente_en_casa)
              ? 'Los radios ya están en CECOMUNICA — no se abrirá orden de devolución.'
              : 'Los radios siguen donde el cliente — al entregar el reemplazo se abre sola la devolución.'}</div>
        </div>` : '';
      cuerpo = taller + `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
        <th>Sale</th><th>Modelo</th><th>Entra</th><th>Modelo solicitado</th><th>Motivo</th><th>Contrato</th>
        </tr></thead><tbody>
        ${(g.items || []).map((it, ix) => `<tr>
          <td class="cg-mono">${this.esc(it.serial_saliente || '—')}</td>
          <td>${this.esc(it.modelo || '—')}</td>
          <td><span class="cg-mono">${this.esc(it.serial_nuevo || 'pendiente')}</span></td>
          <td>${this.esc(it.modelo_solicitado || it.modelo || '—')}</td>
          <td style="font-size:12.5px;">${this.esc(it.motivo_detalle || it.motivo_codigo || '—')}
            ${it.elegibilidad === 'propio_excepcion' ? '<br><span class="cg-venc por_vencer">excepción serv. cliente</span>' : ''}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(it.contrato_id || '—')}</td>
        </tr>`).join('')}</tbody></table></div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:10px 0 0;">
          <button class="btn btn-ghost cg-act" onclick="Centro.jsonReemplazoRecepcion('${this.esc(g.id)}')"
            title="Descarga el nombre, los grupos y el GPS de cada radio que sale, en el formato que carga el lote de POC">
            <i data-lucide="download"></i> JSON para recepción</button>
          <span style="font-size:12px; color:var(--fg-3);">Lo que cada radio nuevo debe heredar del que sustituye.
            Recepción también puede jalarlo sola desde el lote de POC — esto es para mandárselo por adelantado.</span>
        </div>
        ${asignando ? `<p style="font-size:12.5px; color:var(--fg-3); margin:10px 0 0;">Bodega elige en
          <b>Almacén · Asignar</b> (Acciones ›) la unidad que sustituye a cada radio.
          Al completar todos, el sistema crea la OS de programación y avisa a Recepción.</p>` : ''}`;
    } else {
      const total = (g.demo?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      const asignados = g.demo?.seriales_asignados || [];
      const asignando = this.puedeAsignar() && g.estado === 'pendiente_bodega';
      cuerpo = `
        <p style="font-size:13px; margin:0 0 8px;"><b>Finalidad:</b> ${this.esc(g.demo?.finalidad || '—')} ·
          <b>Salida:</b> ${this.esc(g.demo?.fecha_salida || '—')} ·
          <b>Devolución estimada:</b> ${this.esc(g.demo?.fecha_devolucion_estimada || 'sin fecha')}</p>
        <p style="font-size:13px; margin:0;"><b>Seriales:</b> ${asignados.length
              ? asignados.map(s => `<span class="cg-mono">${this.esc(s.serial)}</span>`).join(', ')
                + (total > asignados.length ? ` <span style="color:var(--fg-3);">· ${asignados.length} de ${total}</span>` : '')
              : 'pendiente de bodega'}</p>
        ${asignando
          ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;">Stock nuevo o refurbished, de bodega —
               se asigna en <b>Almacén · Asignar</b> (Acciones ›).</p>`
          : ''}`;
    }

    let aprobacion = '';
    if (g.estado === 'pendiente_aprobacion') {
      const esBaja = g.tipo === 'baja';
      const esAumento = g.tipo === 'aumento';
      // Actualización de seriales (antes "anexo de regularización"): NO pasa
      // por firma — Alberto 2026-09-09: "ese camino vamos a hacerlo sin firma
      // solamente, ya que si vamos a firmar será un contrato". Se aplica al
      // aprobarse: el contrato gana las líneas y los seriales se amarran.
      const esActSeriales = esAumento && g.aumento?.es_regularizacion === true;
      const puede = (esBaja || esAumento) ? this.puedeAprobarBaja() : this.puedeAprobar();
      const fnAprobar = esBaja ? 'aprobarBajaGestion'
        : esActSeriales ? 'aprobarActualizacionSeriales'
        : esAumento ? 'aprobarAumentoGestion' : 'aprobarGestion';
      // La baja no se aprueba sin la carta del cliente (pedido 2026-08-27).
      const sinCarta = esBaja && !g.carta_path;
      aprobacion = `<div class="cg-senal warn" style="margin:10px 0 0;">
           <span>${esBaja
             ? 'Baja esperando aprobación (una sola, con el desglose por contrato a la izquierda).'
             : esActSeriales
               ? 'Actualización de seriales esperando aprobación — al aprobar se aplica de una vez: el contrato gana las líneas, los seriales se amarran y no se le envía nada al cliente.'
             : esAumento
               ? 'Aumento esperando aprobación comercial — al aprobar, se imprime el anexo para la firma del cliente.'
               : g.origen?.tipo === 'taller'
                 ? 'El taller propone este reemplazo y espera la decisión de ventas. Al aprobar, Bodega recibe el aviso para asignar el equipo que sustituye a cada radio (mismo modelo).'
                 : 'Excepción por servicio al cliente (propio sin garantía) — requiere aprobación de administración.'}</span>
           </div>`;
      void puede; void fnAprobar; void sinCarta;
    } else if (g.estado === 'pendiente_firma' && g.tipo === 'aumento' && g.aumento?.es_regularizacion === true) {
      aprobacion = `<div class="cg-senal warn" style="margin:10px 0 0;">
           <span><b>Quedó esperando firma de antes.</b> Las actualizaciones de seriales ya no se firman
             (2026-09-09): dale <b>Aplicar sin firma</b> y el contrato gana las líneas de una vez.</span></div>`;
    } else if (g.estado === 'pendiente_firma' && g.tipo === 'aumento') {
      aprobacion = `<div class="cg-senal info" style="margin:10px 0 0;">
           <span><b>Esperando la firma del cliente.</b> Imprime el anexo (deja explícito el período propio
             del equipo nuevo), recoge la firma y sube el archivo firmado. La preparación corre
             <b>en paralelo</b>: bodega asigna y la orden de programación sale sola — la firma solo
             frena la <b>entrega</b>.</span>
           </div>`;
    }
    // Pie del expediente: el siguiente paso y "Acciones ⋯" — la MISMA lista
    // del "⋯" de la fila. Nada de botoneras por estado repartidas por el
    // cuerpo (M.A.M. PROTECTION, 2026-09-09).
    const fEd = g.editada?.at?.toDate ? g.editada.at.toDate().toLocaleDateString('es-PA') : '';
    const editada = g.editada
      ? `<span style="font-size:12px; color:var(--fg-3);">✎ Corregida por ${this.esc(g.editada.por_email || '—')}${fEd ? ` el ${fEd}` : ''}</span>` : '';
    const pie = `<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:10px;">
           <span style="margin-right:auto;">${editada}</span>
           ${this._pieAcciones('dg-' + g.id, this._accionesGestion(g))}</div>`;

    return `<div class="ds-card" style="padding:var(--sp-4); margin:-4px 0 10px; border-top:none;">
      <div class="cg-exp">
        <div>${cuerpo}${osHtml}</div>
        <div>${check}${aprobacion}</div>
      </div>
      ${pie}
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

  // Aprobar la ACTUALIZACIÓN DE SERIALES = aplicarla. No hay paso de firma
  // (2026-09-09): se dice qué va a pasar y se hace.
  async aprobarActualizacionSeriales(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    const a = g?.aumento || {};
    if (!g || a.es_regularizacion !== true) { Toast.show('Esta gestión no es una actualización de seriales', 'warn'); return; }
    const nEntran = (a.regulariza_seriales || []).length;
    const nFuera = (a.regulariza_no_tiene || []).length;
    const ok = await Modal.confirm({
      title: 'Aprobar y aplicar', confirmLabel: 'Aprobar y aplicar',
      message: `Al contrato <b class="cg-mono">${this.esc(a.contrato_id || '')}</b> se le agregan las líneas del
        expediente y <b>${nEntran} serial(es)</b> quedan amarrados${nFuera ? `; <b>${nFuera}</b> que el cliente no tiene salen de la cuenta` : ''}.
        <br><br><b>Al cliente no se le envía nada</b>: esto solo pone el sistema al día. Si hiciera falta que
        el cliente firme, el camino es un contrato.`,
    });
    if (!ok) { this.abrirGestion(gid); return; }
    try {
      await GestionesService.aprobarActualizacionSeriales(gid);
      Toast.show('Aprobada y aplicada — el sistema amarra los seriales al contrato', 'ok');
      await this.recargarGestiones();   // el avance del trigger llega por la escucha en vivo
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar: ' + (e.message || e), 'bad'); }
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
      await this.recargarGestiones();   // el avance del trigger llega solo por la escucha en vivo
    } catch (e) { console.error(e); Toast.show('No se pudo subir el anexo', 'bad'); }
  },

  // Cerrar la regularización sin mandarla a firmar (2026-09-09, Alberto): son
  // radios que el cliente tiene desde hace años y el anexo solo pone al día el
  // sistema. Se pide el motivo porque queda en el expediente para siempre: es
  // la única constancia de por qué ese anexo no lleva firma.
  async cerrarRegSinFirma(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || g.aumento?.es_regularizacion !== true) { Toast.show('Solo los anexos de regularización se cierran sin firma', 'warn'); return; }
    const motivo = await Modal.prompt({
      title: 'Cerrar sin firma del cliente',
      confirmLabel: 'Cerrar y aplicar', multiline: true,
      message: `Las líneas se aplican al contrato <b class="cg-mono">${this.esc(g.aumento.contrato_id || '')}</b> igual que
        con un anexo firmado, pero <b>al cliente no se le envía nada</b>. Queda en el expediente quién lo cerró y por qué.
        <br><br>Motivo (por ejemplo: “equipos en campo desde 2021, se pone al día el sistema”):`,
    });
    if (motivo === null) return;
    try {
      await GestionesService.cerrarRegularizacionSinFirma(gid, motivo);
      Toast.show('Regularización cerrada — el sistema aplica las líneas al contrato', 'ok');
      await this.recargarGestiones();   // el avance del trigger llega por la escucha en vivo
    } catch (e) { console.error(e); Toast.show('No se pudo cerrar la regularización: ' + (e.message || e), 'bad'); }
  },

  // Retirar el enlace de firma del ANEXO — el mismo gesto que en el contrato
  // (2026-09-09, Alberto: "si se envió para firma y el cliente aún no ha
  // firmado igual se debe poder retirar"). Sin esto, mandar el enlace dejaba
  // el anexo trancado: no se corregía, y el cliente seguía teniendo en la mano
  // un enlace con la copia vieja.
  async retirarFirmaAnexo(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || g.firma_solicitud_estado !== 'pendiente' || !g.firma_solicitud_id) {
      Toast.show('Este anexo no tiene un enlace de firma pendiente', 'warn'); return;
    }
    this._cerrarModal();
    const ok = await Modal.confirm({
      title: 'Retirar el enlace de firma', danger: true, confirmLabel: 'Retirar enlace',
      message: `El enlace que se le envió al cliente deja de servir (verá “enlace no válido”). El anexo
        <b class="cg-mono">${this.esc(gid)}</b> se queda esperando firma y <b>vuelve a poder corregirse</b>;
        para firmar habrá que enviar un enlace nuevo, con la copia al día.`,
    });
    if (!ok) { this.abrirGestion(gid); return; }
    try {
      await GestionesService.retirarEnlaceFirma(gid);
      Toast.show('Enlace retirado — el anexo ya se puede corregir', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo retirar el enlace: ' + (e.message || e), 'bad'); }
    this.abrirGestion(gid);
  },

  async aprobarBajaGestion(gid) {
    try {
      await GestionesService.aprobarBaja(gid);
      Toast.show('Baja aprobada — el sistema deriva la facturación y crea la devolución por serial', 'ok');
      await this.recargarGestiones();   // el avance del trigger llega solo por la escucha en vivo
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar la baja', 'bad'); }
  },

  async anularGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    const perm = GestionesService.puedeAnularse(g, { rol: this.rol, uid: firebase.auth().currentUser?.uid });
    if (!perm.ok) { Toast.show(perm.motivo, 'warn'); return; }
    const enlaceVivo = g?.firma_solicitud_estado === 'pendiente' && !!g?.firma_solicitud_id;
    const motivo = await Modal.prompt({ title: 'Anular gestión', confirmLabel: 'Anular', multiline: true,
      message: `${enlaceVivo ? 'El <b>enlace de firma</b> que tiene el cliente se retira con la anulación: verá “enlace no válido”.<br><br>' : ''}Motivo de la anulación (queda en el expediente):` });
    if (motivo === null) return;
    try {
      // El enlace vivo se retira ANTES: una gestión anulada con el enlace en
      // la calle se puede firmar igual, y el cliente recibiría la constancia
      // de un anexo que ya no existe.
      if (enlaceVivo) {
        try { await GestionesService.retirarEnlaceFirma(gid); }
        catch (e) { console.error(e); Toast.show('Ojo: el enlace de firma NO se retiró — ' + (e.message || e), 'warn'); }
      }
      await GestionesService.anular(gid, motivo);
      Toast.show('Gestión anulada — el sistema revierte sus efectos (órdenes, flags del pool)…', 'ok');
      // La limpieza corre en el trigger (~1-2s): refrescar la FICHA COMPLETA
      // para que equipos y señales dejen de mostrar los flags viejos.
      setTimeout(() => { if (this.cliente) this.abrir(this.cliente.id, { push: false }); }, 1800);
    } catch (e) { console.error(e); Toast.show('No se pudo anular', 'bad'); }
  },

  /* ── Editar el expediente antes de que surta efecto (2026-09-09) ──────
     Hasta hoy, un dedo mal puesto al crear la gestión (una cantidad, un
     precio, una fecha, el motivo) solo se arreglaba anulando y volviendo a
     crearla: correlativo nuevo, otro correo de aprobación y el historial
     lleno de anuladas. Aquí se corrige en el sitio, mientras nadie haya
     actuado sobre ella — GestionesService.puedeEditarse dice hasta cuándo, y
     por qué no cuando ya no se puede. El estado NUNCA cambia al editar. */

  async editarGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    const perm = GestionesService.puedeEditarse(g);
    if (!perm.ok) { Toast.show(perm.motivo, 'warn'); return; }
    if (!this.puedeCrearGestion()) { Toast.show('Tu rol no edita gestiones', 'warn'); return; }
    await Promise.all([this._cargarModelos(), this._cargarCargos()]);
    const cuerpo = g.tipo === 'aumento' ? this._edAumentoHtml(g)
      : g.tipo === 'baja' ? this._edBajaHtml(g)
      : g.tipo === 'reemplazo' ? this._edReemplazoHtml(g)
      : this._edDemoHtml(g);
    this._abrirModalA({
      banda: false,
      titulo: `Corregir ${this.esc(GestionesService.tipoLabel(g.tipo).toLowerCase())} — <span class="cg-mono">${this.esc(g.id)}</span>`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        ${g.estado === 'pendiente_aprobacion'
          ? 'Sigue esperando aprobación: quien la apruebe verá ya los datos corregidos (el correo de aprobación no se reenvía).'
          : `La gestión se queda en <b>${this.esc(GestionesService.estadoLabel(g.estado).toLowerCase())}</b> — solo cambia lo que dice el expediente.`}
        Queda en la bitácora quién corrigió y qué.</p>
      ${cuerpo}
      <div class="form-field" style="margin:12px 0 0;">
        <label class="form-label" for="geNotas">Notas del expediente</label>
        <textarea class="form-input" id="geNotas" rows="2" placeholder="Opcional">${this.esc(g.notas || '')}</textarea></div>`,
      footer: `<span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.guardarEdicionGestion('${this.esc(g.id)}')">Guardar cambios</button>`,
    });
    if (g.tipo === 'aumento') this._aumPreview();
  },

  // Aumento / adenda / regularización / ajuste: mismas filas del wizard, ya
  // prellenadas (por eso reusa los prefijos `wau`/`wac` y #waTot).
  _edAumentoHtml(g) {
    const a = g.aumento || {};
    const esReg = a.es_regularizacion === true;
    const itbms = a.totales?.itbms_aplica !== false;
    // La regularización trabaja sobre seriales concretos: se rehidrata el
    // estado del wizard para que cambiar "de quién es" baje a los seriales
    // (es lo que B3 lee al aplicar el anexo) y no se quede solo en la línea.
    this._aumRegulariza = esReg ? (a.regulariza_seriales || []).map(s => ({ ...s })) : null;
    this._aumRegularizaTodos = esReg ? [...this._aumRegulariza] : null;
    const lineas = esReg
      ? this._aumLineasFijasHtml(Object.fromEntries((a.lineas || []).map(l =>
          [(l.modelo_id || l.modelo) + '|' + (l.modalidad || 'alquiler'), l.precio ?? ''])))
      : (a.lineas || []).map(l => this._lineaModeloPre('wau', true, l)).join('');
    return `
      ${esReg ? `<div class="cg-senal warn" style="margin-bottom:10px;"><span>Anexo de <b>regularización</b>: el modelo y la
        cantidad los mandan los ${(a.regulariza_seriales || []).length} serial(es) que el cliente ya tiene — aquí se corrige el
        <b>precio</b> y <b>de quién es</b> cada equipo. Para cambiar qué seriales entran, anula el anexo y créalo de nuevo.</span></div>` : ''}
      <div ${esReg ? '' : 'oninput="Centro._aumPreview()" onchange="Centro._aumPreview()"'}>
      ${a.es_ajuste ? '' : `<div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
        <div id="waLineas" ${esReg ? 'oninput="Centro._aumPreview()"' : ''}>${lineas}</div>
        ${esReg ? '' : `<button class="btn btn-ghost cg-act"
          onclick="Centro._addLineaModelo('waLineas','wau',true); Centro._aumPreview()">+ Agregar otro modelo</button>`}</div>`}
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Otros conceptos (cargos del catálogo)</label>
        <div id="waCargos">${(a.cargos || []).map(c => this._cargoLineaHtml(c)).join('')}</div>
        <button class="btn btn-ghost cg-act"
          onclick="document.getElementById('waCargos').insertAdjacentHTML('beforeend', Centro._cargoLineaHtml()); Centro._aumPreview()">+ Agregar cargo</button></div>
      <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; margin-bottom:10px;">
        <div class="form-field" style="margin:0; max-width:200px;">
          <label class="form-label" for="waMeses">Vigencia del tramo (meses)</label>
          <input class="form-input" type="number" id="waMeses" min="1" value="${Number(a.duracion_meses || 0) || ''}"></div>
        <label class="cg-toggle" style="margin-bottom:2px;">
          <input type="checkbox" id="waItbms" ${itbms ? 'checked' : ''} onchange="Centro._aumPreview()">
          Aplica ITBMS${this.cliente?.itbms_exento === true ? ' <span style="color:var(--fg-4);">(cliente exento)</span>' : ''}</label>
      </div>
      <div id="waTot" class="ds-card" style="padding:10px 14px; max-width:380px;"></div>
      </div>`;
  },

  // Baja: qué seriales entran, el motivo y las dos fechas que decide la nota
  // del cliente. La terminación total no deja quitar seriales — es del
  // contrato entero.
  _edBajaHtml(g) {
    const esTerm = Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length;
    const it0 = (g.items || [])[0] || {};
    return `
      ${esTerm ? `<div class="cg-senal bad" style="margin-bottom:10px;"><span><b>Terminación total</b>: entran todos los
        seriales del contrato — aquí solo se corrigen el motivo y las fechas.</span></div>` : ''}
      <div class="cg-twrap" style="max-height:30vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th></tr></thead><tbody>
        ${(g.items || []).map((it, i) => `<tr>
          <td><input type="checkbox" data-gesel="${i}" checked ${esTerm ? 'disabled' : ''}></td>
          <td class="cg-mono">${this.esc(it.serial_saliente || it.serial || '—')}</td>
          <td>${this.esc(it.modelo || '—')}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(it.contrato_id || '—')}</td></tr>`).join('')}
      </tbody></table></div>
      ${esTerm ? '' : '<p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Desmarca los seriales que no van en esta baja.</p>'}
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
        <select class="form-select" id="geMotivo" style="max-width:260px;">
          <option value="">— Motivo —</option>
          ${this.MOTIVOS_BAJA.map(([k, l]) => `<option value="${k}" ${k === (g.motivo_codigo || it0.motivo_codigo) ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <input class="form-input" id="geDet" style="flex:1; min-width:160px;" placeholder="Detalle (opcional)" value="${this.esc(it0.motivo_detalle || '')}">
      </div>
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:10px;">
        <div class="form-field" style="margin:0;"><label class="form-label" for="geNota">Fecha de la nota del cliente</label>
          <input class="form-input" type="date" id="geNota" style="width:165px;" value="${this.esc(g.fecha_nota_cliente || '')}"></div>
        <div class="form-field" style="margin:0;"><label class="form-label" for="geFin">Fin de facturación</label>
          <input class="form-input" type="date" id="geFin" style="width:165px;" value="${this.esc(g.fecha_fin_facturacion || '')}"></div>
      </div>
      <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">La liquidación estimada se recalcula sola con los seriales que queden.</p>`;
  },

  // Reemplazo: qué radios salen, con qué modelo se piden y por qué. El serial
  // que ENTRA no se toca aquí — eso lo declara bodega en Almacén · Asignar.
  _edReemplazoHtml(g) {
    return `
      <div class="cg-twrap" style="max-height:38vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Sale</th><th>Modelo solicitado</th><th>Motivo</th><th>Detalle</th>
        </tr></thead><tbody>
        ${(g.items || []).map((it, i) => `<tr>
          <td><input type="checkbox" data-gesel="${i}" checked></td>
          <td class="cg-mono">${this.esc(it.serial_saliente || '—')}<div style="font-size:11.5px; color:var(--fg-4);">${this.esc(it.modelo || '')}</div></td>
          <td>${this._selModelo(`data-gemod="${i}" style="min-width:170px;"`, it.modelo_solicitado_id, it.modelo_solicitado)}</td>
          <td><select class="form-select" data-gemot="${i}" style="min-width:170px;">
            <option value="">— Motivo —</option>
            ${this.MOTIVOS.map(([k, l]) => `<option value="${k}" ${k === it.motivo_codigo ? 'selected' : ''}>${l}</option>`).join('')}
          </select></td>
          <td><input class="form-input" data-gedet="${i}" style="min-width:150px;" value="${this.esc(it.motivo_detalle || '')}" placeholder="Opcional"></td>
        </tr>`).join('')}
      </tbody></table></div>
      <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Desmarca los radios que no van en esta solicitud.
        El serial que <b>entra</b> lo declara bodega en Almacén · Asignar.</p>`;
  },

  _edDemoHtml(g) {
    const d = g.demo || {};
    return `
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Equipos (modelo · cantidad)</label>
        <div id="wdLineas">${(d.lineas || []).map(l => this._lineaModeloPre('wdl', false, l)).join('')}</div>
        <button class="btn btn-ghost cg-act" onclick="Centro._addLineaModelo('wdLineas','wdl')">+ Agregar otro modelo</button></div>
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label" for="wdFin">Finalidad del demo</label>
        <input class="form-input" id="wdFin" value="${this.esc(d.finalidad || '')}" placeholder="Para qué lo quiere el cliente"></div>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <div class="form-field" style="margin:0;"><label class="form-label" for="wdSalida">Salida</label>
          <input class="form-input" type="date" id="wdSalida" style="width:165px;" value="${this.esc(d.fecha_salida || '')}"></div>
        <div class="form-field" style="margin:0;"><label class="form-label" for="wdDevol">Devolución estimada</label>
          <input class="form-input" type="date" id="wdDevol" style="width:165px;" value="${this.esc(d.fecha_devolucion_estimada || '')}"></div>
      </div>`;
  },

  // Lee el formulario, arma el parche del tipo y lo escribe. Cada rama valida
  // lo mismo que su wizard: una gestión corregida no puede quedar peor que
  // una recién creada.
  async guardarEdicionGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g) { Toast.show('Expediente no encontrado', 'bad'); return; }
    const notas = document.getElementById('geNotas')?.value.trim() || '';
    const cambios = { notas };
    const dicho = [];
    if (notas !== (g.notas || '')) dicho.push('notas');

    if (g.tipo === 'aumento') {
      const a = g.aumento || {};
      const lineas = a.es_ajuste ? [] : this._aumLineas();
      const cargos = this._aumCargos();
      if (!a.es_ajuste && !lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
      if (lineas.some(l => !(l.precio > 0))) { Toast.show('Cada línea necesita su precio mensual', 'warn'); return; }
      if (this._lineasSinModalidad(lineas)) { Toast.show(this.MSG_SIN_MODALIDAD, 'warn'); return; }
      if (a.es_ajuste && !cargos.length) { Toast.show('Un ajuste de tarifa necesita al menos un cargo', 'warn'); return; }
      // Un anexo de regularización cubre EXACTAMENTE los seriales que ya
      // están con el cliente: cierra sin bodega, y un radio de más nunca
      // saldría (mismo candado que crearAumento).
      if (a.es_regularizacion) {
        const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
        const n = (this._aumRegulariza || []).length;
        if (total !== n) { Toast.show(`El anexo cubre exactamente ${n} equipo(s) que el cliente ya tiene`, 'warn'); return; }
      }
      const meses = Number(document.getElementById('waMeses')?.value || 0);
      if (!(meses > 0)) { Toast.show('Indica la vigencia del tramo en meses', 'warn'); return; }
      const itbmsAplica = document.getElementById('waItbms')?.checked !== false;
      const totales = this._totAumento(lineas, cargos, itbmsAplica);
      Object.assign(cambios, {
        'aumento.lineas': lineas,
        'aumento.cargos': cargos,
        'aumento.duracion_meses': meses,
        'aumento.itbms': { aplica: itbmsAplica, porcentaje: totales.itbms_porcentaje },
        'aumento.totales': totales,
        ...(a.es_regularizacion ? { 'aumento.regulariza_seriales': this._aumRegulariza || [] } : {}),
      });
      dicho.push(`${lineas.length} línea(s), ${cargos.length} cargo(s), ${meses} meses, total $${Number(totales.total_mensual || 0).toFixed(2)}/mes`);

    } else if (g.tipo === 'baja') {
      const sel = new Set([...document.querySelectorAll('input[data-gesel]:checked')].map(i => Number(i.dataset.gesel)));
      const esTerm = Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length;
      const items = (g.items || []).filter((_, i) => esTerm || sel.has(i));
      if (!items.length) { Toast.show('Deja al menos un serial en la baja', 'warn'); return; }
      const motivo = document.getElementById('geMotivo')?.value || '';
      if (!motivo) { Toast.show('Indica el motivo de la baja', 'warn'); return; }
      const detalle = document.getElementById('geDet')?.value.trim() || '';
      const fin = document.getElementById('geFin')?.value || null;
      const nuevos = items.map(it => ({ ...it, motivo_codigo: motivo, motivo_detalle: detalle, fecha_fin_facturacion: fin || null }));
      Object.assign(cambios, {
        items: nuevos,
        motivo_codigo: motivo,
        fecha_fin_facturacion: fin,
        fecha_nota_cliente: document.getElementById('geNota')?.value || null,
        penalidad_estimada: this._penalidadBaja(nuevos),
        contratos_afectados: Array.from(new Set([
          ...nuevos.map(i => i.contrato_doc_id).filter(Boolean),
          ...(Array.isArray(g.terminacion_total_de) ? g.terminacion_total_de : []),
        ])),
      });
      dicho.push(`${nuevos.length} serial(es), motivo "${motivo}"${fin ? `, fin de facturación ${fin}` : ''}`);

    } else if (g.tipo === 'reemplazo') {
      const sel = [...document.querySelectorAll('input[data-gesel]:checked')].map(i => Number(i.dataset.gesel));
      if (!sel.length) { Toast.show('Deja al menos un radio en la solicitud', 'warn'); return; }
      const nuevos = [];
      for (const i of sel) {
        const it = g.items[i];
        const motivo = document.querySelector(`select[data-gemot="${i}"]`)?.value || '';
        if (!motivo) { Toast.show(`Indica el motivo del serial ${it.serial_saliente}`, 'warn'); return; }
        const m = this._modeloDeSelect(document.querySelector(`select[data-gemod="${i}"]`));
        if (!m) { Toast.show(`Elige el modelo de reemplazo del serial ${it.serial_saliente}`, 'warn'); return; }
        nuevos.push({ ...it,
          motivo_codigo: motivo,
          motivo_detalle: document.querySelector(`input[data-gedet="${i}"]`)?.value.trim() || '',
          modelo_solicitado: m.label, modelo_solicitado_id: m.id,
        });
      }
      Object.assign(cambios, {
        items: nuevos,
        contratos_afectados: Array.from(new Set(nuevos.map(i => i.contrato_doc_id).filter(Boolean))),
      });
      dicho.push(`${nuevos.length} radio(s): ${nuevos.map(i => `${i.serial_saliente}→${i.modelo_solicitado}`).join(', ')}`);

    } else {
      const lineas = this._lineasModelo('wdl').map(l => ({ modelo: l.modelo, modelo_id: l.modelo_id, cantidad: l.cantidad }));
      const finalidad = document.getElementById('wdFin')?.value.trim() || '';
      if (!lineas.length) { Toast.show('Indica al menos un modelo', 'warn'); return; }
      if (!finalidad) { Toast.show('Indica la finalidad del demo', 'warn'); return; }
      Object.assign(cambios, {
        'demo.lineas': lineas,
        'demo.finalidad': finalidad,
        'demo.fecha_salida': document.getElementById('wdSalida')?.value || '',
        'demo.fecha_devolucion_estimada': document.getElementById('wdDevol')?.value || null,
      });
      dicho.push(`${lineas.reduce((s, l) => s + l.cantidad, 0)} equipo(s), "${finalidad}"`);
    }

    try {
      await GestionesService.editar(gid, cambios, `Expediente corregido — ${dicho.join(' · ')}.`);
      this._aumRegulariza = null;
      this._aumRegularizaTodos = null;
      this._cerrarModal();
      Toast.show('Gestión corregida', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo guardar: ' + (e.message || e), 'bad'); }
  },

  /* ═════════ Acciones: UN menú, siempre en el mismo sitio ═════════
     Antes cada acción vivía donde cupo: aprobar en el aviso amarillo,
     editar/anular al pie, la firma en medio del cuerpo, "anular contrato" en
     otro pie y el resto en el footer del modal "Ver contrato". Tres gestiones
     del MISMO cliente enseñaban tres botoneras distintas (M.A.M. PROTECTION,
     2026-09-09: "algunas le sale editar, otra anular… cada vez hay que buscar
     botones en lugares distintos").

     Ahora hay UNA lista por expediente —gestión o contrato—, se pinta en el
     "⋯" de la fila y en el pie del detalle, y lo que NO se puede sale en gris
     con el motivo, nunca escondido. Editar y Anular están SIEMPRE: son las dos
     que se buscan cuando algo salió mal. */

  // Descriptor: { id, label, hint, grupo, ok, motivo, onclick|href|file, danger, primaria }
  _acc(a) { return { grupo: 'Avanzar', ok: true, motivo: '', ...a }; },

  _accionesGestion(g) {
    const id = this.esc(g.id);
    const A = [];
    const puedeG = this.puedeCrearGestion();
    const esBaja = g.tipo === 'baja';
    const esAum = g.tipo === 'aumento';
    const esAct = esAum && g.aumento?.es_regularizacion === true;   // actualización de seriales
    const terminal = ['cerrada', 'anulada'].includes(g.estado);

    // ── Avanzar: lo que mueve el expediente al siguiente paso ──
    if (g.estado === 'pendiente_aprobacion') {
      const puede = (esBaja || esAum) ? this.puedeAprobarBaja() : this.puedeAprobar();
      const sinCarta = esBaja && !g.carta_path;
      const fn = esBaja ? 'aprobarBajaGestion' : esAct ? 'aprobarActualizacionSeriales'
        : esAum ? 'aprobarAumentoGestion' : 'aprobarGestion';
      A.push(this._acc({ id: 'aprobar', label: esAct ? 'Aprobar y aplicar' : 'Aprobar', primaria: true,
        hint: esAct ? 'aplica las líneas al contrato y amarra los seriales'
          : esBaja ? 'una sola aprobación, con el desglose por contrato' : 'la gestión pasa al siguiente paso',
        onclick: `Centro.${fn}('${id}')`,
        ok: puede && !sinCarta,
        motivo: !puede ? 'solo administración o gerencia aprueba' : 'falta la carta de solicitud del cliente' }));
    }
    if (esAct && g.estado === 'pendiente_firma') {
      A.push(this._acc({ id: 'aplicar_sin_firma', label: 'Aplicar sin firma', primaria: true,
        hint: 'las actualizaciones de seriales ya no se firman — se aplican',
        onclick: `Centro.cerrarRegSinFirma('${id}')`, ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
    }
    if (esAum && !esAct && g.estado === 'pendiente_firma') {
      const conEnlace = g.firma_solicitud_estado === 'pendiente';
      A.push(this._acc({ id: 'firma', label: conEnlace ? 'Ver o reenviar el enlace de firma' : 'Enviar anexo para firma digital',
        primaria: !conEnlace, hint: conEnlace ? 'el cliente ya lo tiene — se puede reenviar' : 'el cliente firma con el dedo, desde el celular',
        onclick: `Centro.enviarFirmaAnexo('${id}')`, ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
      A.push(this._acc({ id: 'subir_firmado', label: 'Subir el anexo firmado', hint: 'PDF o foto del papel firmado',
        file: `Centro.subirAnexo('${id}', this.files[0])`, accept: 'application/pdf,image/*',
        ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
    }
    if (g.firma_pendiente_validacion) {
      A.push(this._acc({ id: 'firmante', label: 'Aceptar al firmante…', primaria: true,
        hint: 'firmó alguien distinto al representante registrado',
        onclick: `Centro.aceptarFirmanteGestion('${id}')`,
        ok: [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol), motivo: 'lo valida administración o gerencia' }));
    }
    // Bodega. El formulario vive en Almacén · Asignar desde 2026-09-03.
    const faltanSeriales = !g.ordenes?.programacion_id && !esAct && !g.aumento?.es_ajuste
      && (g.estado === 'pendiente_bodega' || (esAum && g.estado === 'pendiente_firma'));
    if (faltanSeriales) {
      const yaHay = (g.aumento?.seriales_asignados || []).length || (g.demo?.seriales_asignados || []).length
        || (g.items || []).some(i => i.serial_nuevo);
      A.push(this._acc({ id: 'asignar', label: yaHay ? 'Completar seriales en Almacén' : 'Asignar seriales en Almacén',
        primaria: g.estado === 'pendiente_bodega', hint: 'el picker del estante y la política dura viven allá',
        href: `../almacen/index.html?tab=asignar&g=${encodeURIComponent(g.id)}`,
        ok: this.puedeAsignar(), motivo: 'los seriales los declara bodega (Almacén · Asignar)' }));
    }

    // ── Documentos: papeles y órdenes ──
    if (esAum && !esAct) {
      A.push(this._acc({ id: 'imprimir', grupo: 'Documentos', label: 'Imprimir el anexo',
        hint: 'deja explícito el período propio del equipo nuevo', blank: true,
        href: `./anexo-aumento.html?g=${encodeURIComponent(g.id)}` }));
    }
    if (esBaja) {
      A.push(g.carta_path
        ? this._acc({ id: 'ver_carta', grupo: 'Documentos', label: 'Ver la carta del cliente',
            onclick: `Centro.verAnexo('${this.esc(g.carta_path)}')` })
        : this._acc({ id: 'subir_carta', grupo: 'Documentos', label: 'Subir la carta del cliente',
            hint: 'obligatoria: sin ella la baja no se aprueba', accept: 'image/*,application/pdf',
            file: `Centro.subirCarta('${id}', this.files[0])`, ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
    }
    if (g.anexo_firmado_path) {
      A.push(this._acc({ id: 'ver_anexo', grupo: 'Documentos', label: 'Ver el anexo firmado',
        onclick: `Centro.verAnexo('${this.esc(g.anexo_firmado_path)}')` }));
    }
    const ordenes = [
      ...(g.ordenes?.programacion_ids || (g.ordenes?.programacion_id ? [g.ordenes.programacion_id] : [])).map(x => ['PROGRAMACIÓN', x]),
      ...(g.ordenes?.devolucion_id ? [['DEVOLUCIÓN', g.ordenes.devolucion_id]] : []),
      ...(g.ordenes?.entrada_id ? [['ENTRADA', g.ordenes.entrada_id]] : []),
    ];
    for (const [tipo, oid] of ordenes) {
      A.push(this._acc({ id: `os-${oid}`, grupo: 'Documentos', label: `Ver la orden ${tipo}`, hint: oid,
        href: `../ordenes/editar-orden.html?id=${encodeURIComponent(oid)}` }));
    }

    // ── Corregir: SIEMPRE las dos, con el motivo cuando no se puede ──
    const pEd = GestionesService.puedeEditarse(g);
    A.push(this._acc({ id: 'editar', grupo: 'Corregir', label: 'Editar…',
      hint: 'cantidades, precios, fechas, motivos y qué seriales entran',
      onclick: `Centro.editarGestion('${id}')`,
      ok: puedeG && pEd.ok, motivo: !puedeG ? 'tu rol no edita gestiones' : pEd.motivo }));
    if (g.firma_solicitud_estado === 'pendiente') {
      A.push(this._acc({ id: 'retirar_firma', grupo: 'Corregir', label: 'Retirar el enlace de firma…',
        hint: 'el enlace del cliente deja de servir y el anexo vuelve a poder corregirse',
        onclick: `Centro.retirarFirmaAnexo('${id}')`, ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
    }
    const pAn = GestionesService.puedeAnularse(g, { rol: this.rol, uid: firebase.auth().currentUser?.uid });
    A.push(this._acc({ id: 'anular', grupo: 'Corregir', label: 'Anular gestión…', danger: true,
      hint: g.estado === 'pendiente_aprobacion' ? 'es también el “rechazar” de la aprobación — pide el motivo' : 'pide el motivo y revierte lo que se pueda',
      onclick: `Centro.anularGestion('${id}')`, ok: pAn.ok, motivo: pAn.motivo }));
    void terminal;
    return A;
  },

  _accionesContrato(c) {
    const id = this.esc(c.id);
    const A = [];
    const puedeG = this.puedeCrearGestion();
    const mando = [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol);
    const esperaFirma = c.estado === 'aprobado' && !c.firmado;
    const conEnlace = esperaFirma && c.firma_solicitud_estado === 'pendiente';
    const reg = this._regPendiente(c);

    if (c.estado === 'pendiente_aprobacion') {
      A.push(this._acc({ id: 'aprobar', label: 'Aprobar contrato', primaria: true,
        hint: 'después se le manda a firmar al cliente',
        onclick: `Centro.aprobarContrato('${id}')`, ok: mando, motivo: 'lo aprueba administración o gerencia' }));
    }
    if (esperaFirma) {
      A.push(this._acc({ id: 'firma', label: conEnlace ? 'Ver o reenviar el enlace de firma' : 'Enviar para firma',
        primaria: !conEnlace, hint: conEnlace ? 'el cliente ya lo tiene — se puede reenviar' : 'el cliente firma con el dedo, desde el celular',
        onclick: `Centro.enviarFirma('${id}')`, ok: puedeG, motivo: 'tu rol no mueve contratos' }));
    }
    // "Subir el contrato firmado" ya NO cuelga de esperaFirma (2026-09-10): la
    // rama `activo && !firmado_url` de _aceptaFirmado() era inalcanzable, así
    // que a un contrato ya activo al que le falta el papel no había forma de
    // completarle el expediente desde ninguna pantalla.
    if (this._aceptaFirmado(c)) {
      const yaActivo = c.estado === 'activo';
      A.push(this._acc({ id: 'subir_firmado',
        label: yaActivo ? 'Adjuntar el contrato firmado' : 'Subir el contrato firmado',
        hint: yaActivo ? 'el contrato ya está activo; falta el papel en el expediente' : 'PDF, o fotos que se arman en un solo PDF',
        file: `Centro.subirFirmadoContrato('${id}', this.files)`, accept: 'application/pdf,image/*', multiple: true,
        ok: this._puedeSubirFirmado(), motivo: 'lo sube administración o el vendedor' }));
    }
    if (c.firmado_pendiente_validacion) {
      A.push(this._acc({ id: 'firmante', label: 'Aceptar al firmante…', primaria: true,
        hint: 'firmó alguien distinto al representante registrado',
        onclick: `Centro.aceptarFirmante('${id}')`, ok: mando, motivo: 'lo valida administración o gerencia' }));
    }
    if (c.accion === 'Renovación' && esperaFirma) {
      A.push(this._acc({ id: 'seriales', label: 'Seriales de la cuenta',
        hint: 'cuáles siguen con el cliente, cuáles no tiene y cuáles faltan — antes de la firma',
        onclick: `Centro.wizSerialesRenovacion('${id}')`, ok: puedeG, motivo: 'tu rol no mueve contratos' }));
    }
    if (reg?.motivo === 'sobrantes') {
      A.push(this._acc({ id: 'actualizar', label: 'Actualizar seriales',
        hint: `${reg.sob} radio(s) del cliente sin línea en este contrato`,
        onclick: `Centro.wizAumento('${id}',{regularizar:true})`, ok: puedeG, motivo: 'tu rol no mueve contratos' }));
    }

    A.push(this._acc({ id: 'ver', grupo: 'Documentos', label: 'Ver el contrato', hint: 'líneas, totales, equipos en campo',
      onclick: `Centro.verContrato('${id}')` }));
    A.push(this._acc({ id: 'documento', grupo: 'Documentos', label: 'Documento completo', blank: true,
      hint: esperaFirma ? 'para imprimirlo y recoger la firma en papel' : '',
      href: `../contratos/documento.html?id=${encodeURIComponent(c.id)}` }));
    // El firmado. El enlace vivía SOLO en el archivo /contratos/ y por eso
    // "dentro de la gestión del cliente no aparece el contrato firmado"
    // (Zuleika, 2026-09-10): el PDF estaba en Storage desde siempre, lo que
    // faltaba era la puerta. Papel → el archivo; firma digital → el documento
    // reconstruido, que es donde vive esa firma (no hay PDF que abrir).
    const firmadoAcc = this._accFirmado(c);
    if (firmadoAcc) A.push(firmadoAcc);

    // Corregir. El criterio de si el contrato admite cambios vive en
    // js/domain/contratoEdicion.js — el mismo que aplica el editor al abrirse.
    // Antes cada uno tenía el suyo: el Centro ofrecía "Editar…" y la página
    // devolvía al usuario con un aviso, o al revés.
    const ed = ContratoEdicion.puedeEditarse(c);
    A.push(this._acc({ id: 'editar', grupo: 'Corregir', label: 'Editar…',
      hint: 'tipo, duración, equipos, cargos y observaciones',
      onclick: `Centro.editarContrato('${id}')`,
      ok: ed.ok && puedeG,
      motivo: !puedeG ? 'tu rol no edita contratos' : ed.texto }));
    if (conEnlace) {
      A.push(this._acc({ id: 'retirar_firma', grupo: 'Corregir', label: 'Retirar el enlace de firma…',
        hint: 'el enlace del cliente deja de servir y el contrato vuelve a poder editarse',
        onclick: `Centro.retirarEnlaceFirma('${id}')`, ok: puedeG, motivo: 'tu rol no mueve contratos' }));
    }
    const anulable = ContratoAnulacion.esAnulable(c);
    A.push(this._acc({ id: 'anular', grupo: 'Corregir', label: 'Anular contrato…', danger: true,
      hint: 'pide el motivo y queda en el historial',
      onclick: `Centro.anularContrato('${id}')`,
      ok: anulable && mando,
      motivo: !anulable ? `un contrato ${this.esc(c.estado || '')} ya no se anula desde aquí` : 'lo anula administración o gerencia' }));
    return A;
  },

  // Render del menú (mismos estilos que el de "Nueva gestión": .cg-menu).
  _menuAccionesHtml(acc) {
    const item = (a) => {
      const hint = a.ok ? (a.hint || '') : (a.motivo || 'no se puede ahora');
      const cls = [a.ok ? '' : 'off', a.ok && a.primaria ? 'top' : '', a.ok && a.danger ? 'mal' : ''].filter(Boolean).join(' ');
      const cuerpo = `${this.esc(a.label)}${hint ? `<span class="cg-menu-hint">${hint}</span>` : ''}`;
      if (!a.ok) return `<button type="button" class="${cls}" disabled aria-disabled="true">${cuerpo}</button>`;
      if (a.file) return `<label class="${cls}" style="cursor:pointer; display:block;">${cuerpo}
        <input type="file" ${a.multiple ? 'multiple' : ''} accept="${this.esc(a.accept || '')}" style="display:none;"
          onchange="Centro._cerrarAcciones(); ${a.file}"></label>`;
      if (a.href) return `<a class="${cls}" href="${a.href}"${a.blank ? ' target="_blank" rel="noopener"' : ''}>${cuerpo}</a>`;
      return `<button type="button" class="${cls}" onclick="Centro._cerrarAcciones(); ${a.onclick}">${cuerpo}</button>`;
    };
    return ['Avanzar', 'Documentos', 'Corregir'].map(gr => {
      const xs = acc.filter(a => a.grupo === gr);
      return xs.length ? `<div class="hd">${gr}</div>${xs.map(item).join('')}` : '';
    }).join('');
  },

  // El "⋯" de una fila: SIEMPRE al final, gestión o contrato, abierta o no.
  _masFila(key, acc, etiqueta) {
    if (!acc.length) return '';
    return `<span class="cg-rowacts" onclick="event.stopPropagation();">
      <button type="button" class="cg-masbtn" aria-haspopup="true" title="Acciones"
        aria-label="Acciones de ${this.esc(etiqueta)}" onclick="Centro.toggleAcciones('${this.esc(key)}', event)">⋯</button>
      <div class="cg-menu cg-accmenu hidden" id="accm-${this.esc(key)}">${this._menuAccionesHtml(acc)}</div>
    </span>`;
  },

  // Pie del detalle: el siguiente paso como botón (sale de la MISMA lista) y
  // el resto detrás de "Acciones ⋯", que abre el mismo menú de la fila. Con el
  // expediente abierto el "⋯" de arriba queda lejos; esto lo repite al pie,
  // pero es la misma lista, no otra botonera.
  _pieAcciones(key, acc) {
    const P = acc.find(a => a.primaria && a.ok);
    const btn = !P ? ''
      : P.file
        ? `<label class="btn btn-primary cg-act" style="cursor:pointer;">${this.esc(P.label)}
             <input type="file" ${P.multiple ? 'multiple' : ''} accept="${this.esc(P.accept || '')}" style="display:none;" onchange="${P.file}"></label>`
        : P.href
          ? `<a class="btn btn-primary cg-act" href="${P.href}"${P.blank ? ' target="_blank" rel="noopener"' : ''}>${this.esc(P.label)}</a>`
          : `<button class="btn btn-primary cg-act" onclick="${P.onclick}">${this.esc(P.label)}</button>`;
    return `<span class="cg-rowacts">${btn}
      <button type="button" class="btn btn-ghost cg-act" onclick="Centro.toggleAcciones('${this.esc(key)}', event)">Acciones ⋯</button>
      <div class="cg-menu cg-accmenu cg-up hidden" id="accm-${this.esc(key)}">${this._menuAccionesHtml(acc)}</div></span>`;
  },

  // Un solo menú abierto a la vez (incluidos los dos de la cabecera).
  toggleAcciones(key, ev) {
    ev?.stopPropagation();
    const el = document.getElementById('accm-' + key);
    const abierto = el && !el.classList.contains('hidden');
    this._cerrarAcciones();
    if (!el || abierto) return;
    el.classList.remove('hidden');
    // Posición FIJA calculada desde el botón: el menú vive dentro de filas y
    // de la tabla de contratos, que tiene overflow — ahí un `absolute` se
    // corta a la mitad. Y si abajo no cabe, se abre hacia arriba.
    const btn = ev?.currentTarget?.getBoundingClientRect ? ev.currentTarget : null;
    const r = btn?.getBoundingClientRect();
    if (r) {
      const ancho = el.offsetWidth || 300, alto = el.offsetHeight || 260;
      const izq = Math.max(8, Math.min(window.innerWidth - ancho - 8, r.right - ancho));
      const cabeAbajo = r.bottom + alto + 10 <= window.innerHeight;
      el.style.position = 'fixed';
      el.style.left = `${izq}px`;
      el.style.top = `${cabeAbajo || r.top - alto - 10 < 0 ? r.bottom + 6 : r.top - alto - 6}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.maxHeight = `${Math.max(180, window.innerHeight - (cabeAbajo ? r.bottom : 0) - 16)}px`;
    }
    setTimeout(() => {
      document.addEventListener('click', Centro._cerrarAcciones, { once: true });
      window.addEventListener('scroll', Centro._cerrarAcciones, { once: true, capture: true });
    }, 0);
  },
  _cerrarAcciones() {
    document.querySelectorAll('.cg-accmenu:not(.hidden)').forEach(m => {
      m.classList.add('hidden');
      m.style.position = ''; m.style.left = ''; m.style.top = ''; m.style.right = ''; m.style.bottom = ''; m.style.maxHeight = '';
    });
    document.getElementById('cgMenu')?.classList.add('hidden');
    document.getElementById('cgMasMenu')?.classList.add('hidden');
  },

  /* ═════════ Menú "Nueva gestión" ═════════ */

  toggleMenu(e) {
    e.stopPropagation();
    // El "⋯" se cierra al abrir este (2026-09-09, Alberto: "aprieto los 3
    // puntitos y luego nueva gestión y no se cierra el menú"). toggleMas ya
    // hacía lo simétrico, y el stopPropagation de aquí impedía que el
    // listener {once:true} que deja toggleMas llegara a cerrarlo.
    document.getElementById('cgMasMenu')?.classList.add('hidden');
    document.getElementById('cgMenu').classList.toggle('hidden');
  },

  armarMenu() {
    const btn = document.getElementById('btnGestion');
    this._pintarHeadLinks();
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
    // ── Menú POR INTENCIÓN (plan 2026-09-08 §4.2, rediseño del menú de
    // 2026-08-28). Depende de dos hechos y una excepción: ¿hay radios en
    // campo?, ¿hay contrato vigente?, ¿hay renovación en trámite? Mismo nombre
    // para la misma intención en todos los estados; lo que no aplica se
    // ESCONDE, no se deshabilita. Cotizar / Datos / Historial viven en la
    // cabecera (_pintarHeadLinks): este menú es solo para gestiones.
    const est = this._cuentaEstado();
    const tram = this._renovacionEnTramite();
    const hayRadios = this.equipos.some(e => ['en_cliente', 'asignado_contrato'].includes(e.estado));
    const hayContrato = est.renovables.length > 0;
    const reg = this._reg();
    const deuda = !!(reg && reg.puntos > 0);
    const item = (onclick, label, hint, cls = '') =>
      `<button type="button" class="${cls}" onclick="${onclick}">${label}${hint ? `<span class="cg-menu-hint">${hint}</span>` : ''}</button>`;
    const grupo = (hd, items) => { const xs = items.filter(Boolean); return xs.length ? `<div class="hd">${hd}</div>${xs.join('')}` : ''; };

    // Arriba, destacado: lo que la cuenta pide primero (misma regla que el
    // botón primario de la cabecera y el dock móvil: _accionPrimaria).
    const P = this._accionPrimaria();
    const top = P ? item(P.onclick, P.label, P.hint, 'top') : '';
    // Renovar cuenta ya es el destacado cuando aplica: no se repite en "Cambiar".
    const n = est.renovables.length;
    const renovar = '';
    void deuda; void reg;

    // "Poner la cuenta al día" (Alberto 2026-09-09): estaba escondido dentro
    // de "Qué falta" y entraba por un contrato elegido a dedo. Es una gestión
    // de CUENTA —abarca todo lo que el cliente tiene, venga del contrato que
    // venga— y por eso vive en el menú, como las demás.
    const d1Menu = this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id && !e.pendiente_devolucion);
    // Se ofrece SIEMPRE que haya contrato vigente, tenga o no radios sueltos
    // (Alberto 2026-09-09: "no estoy viendo el menú actualizar seriales del
    // cliente"). Con la cuenta al día el camino sigue sirviendo para declarar
    // seriales que el sistema no conoce y para sacar los que el cliente ya no
    // tiene; el hint dice cuál de los dos casos es.
    const alDia = grupo('Actualizar', [
      hayContrato && !tram
        ? item('Centro.wizRegularizarCuenta()', 'Actualizar seriales del cliente',
          d1Menu.length
            ? `amarra al contrato los ${d1Menu.length} radio(s) que ya tiene — sin firma, sin bodega y sin entrega`
            : 'declara los que el sistema no conoce o saca los que el cliente ya no tiene — sin firma') : '',
    ]);
    const dar = grupo('Dar equipos', [
      hayContrato && !tram ? item('Centro.wizAgregarEquipos()', 'Agregar equipos', 'anexo al contrato de la cuenta') : '',
      // TEMP (evento) y DEMO son independientes de la cuenta: no cuentan para
      // _cuentaEstado ni renuevan nada (caso Arraiján / Elvia, 2026-09-07).
      item('Centro.wizContrato({temporal:true})', 'Contrato temporal', 'por evento, días o meses'),
      item('Centro.wizDemo()', 'Demo', 'prueba sin cargo, termina con la devolución'),
    ]);
    const cambiar = grupo('Cambiar', [
      hayRadios ? item('Centro.wizReemplazo()', 'Reemplazar un equipo') : '',
      hayContrato ? item(est.tipo === 'consolidada' ? `Centro.wizAjuste('${this.esc(est.maestro.id)}')` : 'Centro.wizAjuste()',
        'Ajustar tarifa / servicios', 'cargos como GPS, amarrados por serial') : '',
      renovar,
    ]);
    const retirar = grupo('Retirar', [
      hayRadios ? item('Centro.wizBaja()', 'Baja parcial por serial') : '',
      hayContrato ? item('Centro.wizTerminacionCuenta()', 'Terminar la cuenta', n > 1 ? `cancela los ${n} contratos con una sola carta` : '') : '',
    ]);
    // Pie discreto: salidas raras. Adenda a contrato EN PAPEL (2026-09-07,
    // caso Falcon): el marco no está en el sistema y hoy no se puede
    // regularizar, pero hace falta un equipo más; no crea contrato interno.
    // Solo donde tiene sentido: cuenta sin contrato en el sistema.
    const pie = [
      (est.tipo === 'nueva' || est.tipo === 'sin_contrato')
        ? item('Centro.wizAumento(null,{papel:true})', '¿Contrato en papel? Adenda de aumento', '', 'pie') : '',
      this._puedeMasiva() ? `<a class="pie" href="./index.html">Edición masiva de clientes</a>` : '',
    ].filter(Boolean).join('');

    document.getElementById('cgMenu').innerHTML = `${top}${alDia}${dar}${cambiar}${retirar}${pie}`;
  },

  // Menú "⋯" de la cabecera: Cotizar, Datos del cliente, Historial (2026-09-08).
  _pintarHeadLinks() {
    const el = document.getElementById('cgMasMenu');
    if (!el || !this.cliente) return;
    const id = this.esc(this.cliente.id);
    el.innerHTML = `
      ${this._puedeCotizar() ? `<a href="../cotizaciones/nueva-cotizacion.html?cliente_id=${id}&from=centro">Nueva cotización<span class="cg-menu-hint">abre el editor con este cliente ya elegido</span></a>` : ''}
      <a href="./ficha.html?id=${id}&from=centro">${this._puedeEditarCliente() ? 'Editar datos del cliente' : 'Ver datos del cliente'}<span class="cg-menu-hint">${this._puedeEditarCliente() ? 'RUC, representante, contacto, vendedor' : 'solo lectura — los cambios los hace cobros'}</span></a>
      ${this._puedeVerDocs() ? `<button type="button" onclick="Centro.verDocumentos()">Documentos del cliente<span class="cg-menu-hint">registro público, cédula, poderes</span></button>` : ''}
      <button type="button" onclick="Centro.abrirBloque('blkActividad')">Historial de la ficha<span class="cg-menu-hint">quién cambió qué y cuándo</span></button>`;
  },

  // Documentos legales del cliente (PII). Hasta 2026-09-10 solo se veían desde
  // el form de cliente del módulo de contratos; el Centro es la ficha 360, así
  // que el expediente digital se abre AQUÍ. Espejo exacto de ALLOWED_ROLES de
  // la callable getClienteDocUrl (functions/src/callable/getClienteDocUrl.js):
  // admin + recepción. A los demás ni se les ofrece — la lista de metadata sí
  // la dejan leer las rules, pero los bytes los negaría la callable.
  _puedeVerDocs() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION].includes(this.rol); },

  async verDocumentos() {
    if (!this.cliente || !this._puedeVerDocs()) return;
    this._cerrarAcciones();
    const id = this.cliente.id;
    // Subir sigue viviendo en el form de cliente: aquí solo se consulta.
    const urlSubir = `../contratos/nuevo-cliente.html?id=${encodeURIComponent(id)}&from=centro#docsSection`;
    this._abrirModalA({
      titulo: 'Documentos del cliente',
      banda: false,
      cuerpo: `<p style="margin:0 0 12px; font-size:13px; color:var(--fg-3);">
          Expediente legal de <b>${this.esc(this.cliente.nombre || '')}</b>. Cada archivo se abre con un
          enlace que vence a los 5 minutos y queda registrado en la auditoría de PII.</p>
        <div id="cgDocsList"><p style="color:var(--fg-3); font-size:13px;">Cargando documentos…</p></div>`,
      footer: `<a href="${urlSubir}" style="font-size:12.5px;">Cargar un documento ›</a>
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>`,
    });
    try {
      const docs = await ClienteDocumentosService.list(id);
      const cont = document.getElementById('cgDocsList');
      if (!cont) return;
      if (!docs.length) {
        cont.innerHTML = `<p style="color:var(--fg-3); font-size:13px;">No hay documentos cargados para este cliente.</p>`;
        return;
      }
      cont.innerHTML = docs.map(d => this._docFilaHtml(d)).join('');
      if (window.lucide?.createIcons) lucide.createIcons();
    } catch (err) {
      const cont = document.getElementById('cgDocsList');
      if (cont) cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">No se pudieron cargar los documentos: ${this.esc(err?.message || err)}</p>`;
    }
  },
  // OJO con el ícono: el vendor de lucide es A MEDIDA (198 nombres) y `image`
  // NO está — verificado en el emulador, el <i> se quedaba sin convertir y la
  // fila salía sin ícono. `camera` sí está en el censo.
  _docFilaHtml(d) {
    const kb = Number(d.size) || 0;
    const tam = !kb ? '' : kb < 1024 * 1024 ? `${Math.round(kb / 1024)} KB` : `${(kb / 1024 / 1024).toFixed(1)} MB`;
    const f = d.subido_en?.toDate ? (window.FMT?.datetime ? FMT.datetime(d.subido_en.toDate()) : d.subido_en.toDate().toLocaleString('es-PA', { hour12: false })) : '';
    const meta = [this.esc(d.nombre_archivo || ''), tam, this.esc(f)].filter(Boolean).join(' · ');
    return `<div style="display:flex; gap:10px; align-items:center; padding:9px 2px; border-bottom:1px solid var(--border-subtle);">
      <i data-lucide="${(d.content_type || '').includes('pdf') ? 'file-text' : 'camera'}" style="width:18px; height:18px; color:var(--fg-3); flex:none;"></i>
      <div style="flex:1; min-width:0;">
        <div style="font-size:13px; font-weight:600;">${this.esc(ClienteDocumentosService.labelFor(d.tipo))}</div>
        <div style="font-size:12px; color:var(--fg-4); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${meta}</div>
      </div>
      <button type="button" class="btn btn-ghost cg-act" onclick="Centro.verDocumento('${this.esc(d.id)}', this)">Ver</button>
    </div>`;
  },
  // La pestaña se abre ANTES del await: si se abriera con la URL ya firmada, el
  // navegador la trataría como popup (el gesto del clic ya se perdió) y la
  // bloquearía. Se abre vacía con el clic y luego se le pone el destino. Sin
  // 'noopener' en las features (Chrome devuelve null y no habría a quién
  // ponerle el destino): el enlace se corta anulando `opener` a mano.
  async verDocumento(docId, btn) {
    const tab = window.open('about:blank', '_blank');
    if (tab) { try { tab.opener = null; } catch (_) {} }
    if (btn) btn.disabled = true;
    try {
      const url = await ClienteDocumentosService.getViewUrl(this.cliente.id, docId);
      if (tab) tab.location.href = url; else window.open(url, '_blank', 'noopener');
    } catch (err) {
      if (tab) tab.close();
      Toast.show(err?.message || 'No se pudo abrir el documento.', 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  // El grid de edición masiva salió del home/rail (2026-09-03): se entra SOLO
  // por aquí y solo los roles que la página acepta (su propio guard: admin y
  // recepción — gerente nunca pasó ese guard, así que no se le ofrece).
  _puedeMasiva() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION].includes(this.rol); },

  // Espejo de FichaCliente._puedeEditar (clientes-ficha.js) y del candado de
  // identidad en rules: admin/gerente/recepción. Cobros entra con rol recepción
  // (cobros@cecomunica.com); al vendedor se le muestra la ficha en solo lectura
  // y se le dirige a cobros.
  _puedeEditarCliente() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION, ROLES.GERENTE].includes(this.rol); },

  // Espejo del guard del editor de cotizaciones (admin/vendedor/jefe_taller);
  // gerente y recepción ven este menú pero el editor los rebotaría al home,
  // así que a ellos no se les ofrece la entrada.
  _puedeCotizar() { return [ROLES.ADMIN, 'admin', ROLES.VENDEDOR].includes(this.rol); },

  // Estado de la cuenta para el menú. Los DEMO/TEMP no cuentan (terminan por
  // su propia devolución); lo que define la cuenta son los renovables
  // (ALQ/PROP/REEMP operativos) y la custodia sin contrato.
  _cuentaEstado() {
    const operativos = this.contratos.filter(c => this._esVigente(c) && !this._renovadoPor(c));
    const renovables = operativos.filter(c => this._aplicaVenc(c));
    const custodia = this._wcCustodia().length;
    if (!renovables.length && !custodia) return { tipo: 'nueva', renovables, custodia, maestro: null };
    // 2026-09-01 (C COMUNICA tras la terminación total): SIN contratos
    // vigentes pero CON equipos en campo — no hay nada que renovar; lo que
    // aplica es un CONTRATO NUEVO que cubra esa custodia (el wizard entra en
    // regularización legacy y la amarra al activarse).
    if (!renovables.length) return { tipo: 'sin_contrato', renovables, custodia, maestro: null };
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
    const comerciales = est.renovables.filter(c => ['SERV', 'ALQ', 'PROP'].includes(this._codigoTipo(c)));
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

  // "Poner la cuenta al día": la regularización por ANEXO, entrando por la
  // CUENTA (Alberto 2026-09-09: "debe ser un botón del menú que abarque todo
  // lo que el cliente tiene, no por contrato"). Los seriales SIEMPRE fueron
  // los de toda la cuenta —vengan del contrato que vengan o de ninguno—; lo
  // que se elegía a dedo era el contrato donde colgar el anexo: salía
  // `activos[0]`, el primero de la lista. Ahora es el ANCLA de la cuenta (la
  // de mayor facturación, la misma que usa "Agregar equipos"), dicha de frente
  // y cambiable si hay varios.
  wizRegularizarCuenta() {
    const est = this._cuentaEstado();
    const ancla = est.tipo === 'consolidada' ? est.maestro : this._cuentaAncla();
    if (!ancla) {
      Toast.show('La cuenta no tiene contrato vigente donde colgar el anexo — regularízala con un contrato nuevo', 'warn');
      this.wizContrato({ renovarCuenta: true });
      return;
    }
    this.wizAumento(ancla.id, { regularizarD1: true });
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

  // ── Modales del Centro: hojas del kit (Modal.sheet, 2026-09-10) ────────
  // Antes esto pintaba a mano dentro de un <div id="cgModal"> con CSS suelto
  // en la propia página (.cg-overlay/.cg-modal). Un resto de declaración
  // huérfano invalidó esa regla entre el 26-ago y el 9-sep-2026 y los modales
  // salieron al PIE de la página, sin fondo ni centrado: había que scrollear
  // para verlos. Ahora el centrado, el z-index y la anatomía los pone
  // ceco-ui.css, que tiene guardias (K3, K9, K10).
  //
  // Las firmas no cambian: `_abrirModal(html)` para el modal simple (el
  // contenido trae su propio título y sus botones) y `_abrirModalA({...})`
  // para la anatomía. El nodo raíz conserva el id `cgModal`, así que los
  // `document.querySelector('#cgModal …')` de la página siguen sirviendo.
  _abrirModal(html, size = 'lg') {
    this._montarHoja({ html, size, focoEn: '.modal-body' });
  },

  // Anatomía del kit (header fijo + cuerpo scrolleable + footer fijo) para los
  // modales largos: el título y las acciones nunca se pierden con el scroll.
  // Banda de regularización en los wizards (plan 2026-09-08 §4.3): un renglón,
  // nunca bloquea. Dice cuánta deuda hay y que esta gestión quedará como
  // puntual (#n). banda:false para los modales que no crean nada.
  _bandaReg() {
    const r = this._reg();
    if (!r || !(r.puntos > 0) || typeof Regularizacion === 'undefined') return '';
    const n = (Number(r.gestiones_puntuales) || 0) + 1;
    const bad = r.nivel === 'critica' || r.excede_margen;
    // UN renglón de contexto bajo el título (2026-09-08): el campo va primero.
    return `<div class="cg-banda-reg" style="display:flex; gap:10px; align-items:center; margin:-4px 0 12px; font-size:12.5px; color:${bad ? 'var(--cg-bad-deep, #991B1B)' : 'var(--cg-warn-deep, #92400E)'};">
      <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><b>Cuenta por regularizar · ${r.puntos}</b> · gestión puntual #${n}${r.excede_margen ? ' · excede el margen' : ''}</span>
      <button type="button" style="background:none; border:0; padding:0; font:inherit; font-weight:600; color:var(--accent); cursor:pointer; white-space:nowrap;" onclick="Centro.verRegularizacion()">Qué falta</button>
    </div>`;
  },

  _abrirModalA({ titulo, cuerpo, footer, banda = true, size = 'lg' }) {
    this._montarHoja({
      titleHtml: titulo,
      html: (banda ? this._bandaReg() : '') + cuerpo,
      footerHtml: footer || '',
      size,
      focoEn: '.modal-body',
    });
  },

  // Una hoja a la vez: abrir otra cierra la anterior, igual que cuando todas
  // compartían el mismo div. El foco va al primer campo del CUERPO (no al
  // botón del pie, que es lo que enfoca el kit por defecto): estos modales
  // son formularios y wizards, y ahí se empieza escribiendo.
  _montarHoja({ titleHtml = '', html = '', footerHtml = '', size = 'lg', focoEn = '' }) {
    this._cerrarModal();
    let propia = null;
    Modal.sheet({
      titleHtml, html, footerHtml, size,
      onMount: (root, api) => {
        propia = api;
        this._hojaApi = api;
        root.id = 'cgModal';
        if (focoEn) {
          setTimeout(() => root.querySelector(
            `${focoEn} input:not([type=hidden]), ${focoEn} select, ${focoEn} textarea, ${focoEn} button`
          )?.focus(), 60);
        }
      },
    }).then(() => { if (this._hojaApi === propia) this._hojaApi = null; });
  },

  _cerrarModal() {
    const api = Centro._hojaApi;
    Centro._hojaApi = null;
    if (api) api.close(null);
  },

  // Elegibilidad de un equipo del pool para reemplazo (decisiones §8):
  // alquiler siempre; propio adquirido en CECOMUNICA siempre (sin garantía →
  // excepción con aprobación admin); comprado fuera → bloqueado.
  _eleg(e) {
    if (!['en_cliente', 'asignado_contrato'].includes(e.estado)) {
      return { ok: false, label: 'No disponible', why: `El equipo no está con el cliente (${e.estado}).` };
    }
    if (e.propiedad === 'cliente') {
      if (!e.venta) return { ok: false, label: 'No adquirido en CECOMUNICA', why: 'Equipo del cliente comprado fuera — no aplica reemplazo.' };
      // Una sola definición de garantía, compartida con la propuesta del
      // taller (domain/garantiaEquipo.js): la fecha declarada manda y, si no
      // la hay, se muestra la derivada de la factura (12 meses, cláusula 8)
      // marcada como estimada. Quién aprueba no cambia por la estimada.
      const g = GarantiaEquipo.garantia(e);
      const txt = GarantiaEquipo.textoGarantia(g);
      if (!GarantiaEquipo.requiereExcepcion(g)) {
        return { ok: true, code: 'propio_garantia', label: `Propio · ${txt}` };
      }
      return { ok: true, code: 'propio_excepcion', label: `Propio · ${txt || 'sin garantía'}`,
               why: 'Se permite por servicio al cliente — requiere aprobación de administración.' };
    }
    return { ok: true, code: 'alquiler', label: e.propiedad === 'desconocida' ? 'Alquiler (propiedad por confirmar)' : 'Alquiler' };
  },

  // Seriales declarados a mano en el wizard de reemplazo: radios que el
  // cliente tiene y el sistema no conoce (2026-09-09). Viven junto a
  // `this.equipos` en la misma tabla; el índice de las filas sigue después.
  _wrExtras: [],
  _wrUnidad(ix) { return this.equipos[ix] || this._wrExtras[ix - this.equipos.length] || null; },

  async wizReemplazo() {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await this._cargarModelos();
    this._wrExtras = [];
    const filas = this._wrFilasHtml();
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Nueva solicitud de reemplazo — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        Marca los seriales a reemplazar (pueden ser de contratos distintos) e indica motivo y modelo.
        Al enviar, Bodega recibe el aviso; si hay un propio sin garantía, primero pasa por aprobación de administración.</p>
      <div class="cg-twrap" style="max-height:44vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th><th>Elegibilidad</th>
        </tr></thead><tbody id="wrCuerpo">${filas}</tbody></table></div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;">
        <input class="form-input" id="wrSerialNuevo" style="max-width:230px;" aria-label="Serial a declarar"
          placeholder="Serial dañado que no aparece…"
          onkeydown="if(event.key==='Enter'){event.preventDefault();Centro._wrAgregarSerial();}">
        ${this._selModelo('id="wrModeloNuevo" style="max-width:200px;" aria-label="Modelo del serial a declarar"')}
        <button type="button" class="btn btn-ghost cg-act" onclick="Centro._wrAgregarSerial()">+ Declarar serial</button>
        <span style="font-size:12px; color:var(--fg-4); flex:1; min-width:220px;">Si el sistema no lo conoce, queda declarado
          en la cuenta del cliente al enviar la solicitud — sin contrato, así que la cuenta seguirá pidiendo regularización.</span>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearReemplazo()">Enviar solicitud</button>
      </div>`);
  },

  // Cuerpo de la tabla del wizard: la flota del pool + los seriales que el
  // vendedor declaró a mano. Los índices son estables (los extras van al
  // final), así que lo ya tecleado se restaura tal cual al re-pintar.
  _wrFilasHtml() {
    const unidades = [...this.equipos, ...this._wrExtras];
    const filas = unidades.map((e, ix) => {
      const extra = ix >= this.equipos.length;
      const el = extra ? { ok: true, code: 'alquiler', label: 'Declarado por ti', why: 'El sistema no lo conocía: la ficha nace con esta solicitud, en campo y sin contrato.' } : this._eleg(e);
      return `<tr style="${el.ok ? '' : 'opacity:.5;'}">
        <td>${el.ok ? `<input type="checkbox" data-wsel="${ix}" ${extra ? 'checked' : ''} onchange="Centro._wizFila(${ix}, this.checked)">` : ''}</td>
        <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
        <td>${this.esc(e.modelo_label || '—')}</td>
        <td class="cg-mono" style="font-size:12px;">${extra ? '<span style="color:var(--fg-4);">sin contrato</span>' : this.esc(e.asignacion?.contrato_id || '—')}</td>
        <td style="font-size:12.5px;">${this.esc(el.label)}${el.why ? `<br><span style="color:var(--fg-4);font-size:11.5px;">${this.esc(el.why)}</span>` : ''}
          ${extra ? `<button type="button" class="btn btn-ghost" style="padding:1px 7px; margin-left:6px;" title="Quitar"
            onclick="Centro._wrQuitarSerial(${ix - this.equipos.length})">✕</button>` : ''}</td>
      </tr>
      <tr id="wcfg-${ix}" class="${extra ? '' : 'hidden'}"><td></td><td colspan="4" style="background:var(--surface-sunken, #EEF2F6);">
        <div style="display:flex; gap:10px; flex-wrap:wrap; padding:4px 0;">
          <select class="form-select" data-wmot="${ix}" style="max-width:280px;">
            <option value="">— Motivo —</option>
            ${this.MOTIVOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
          </select>
          ${this._selModelo(`data-wmod="${ix}" style="max-width:220px;"`, e.modelo_id, e.modelo_label)}
          <input class="form-input" data-wdet="${ix}" style="flex:1; min-width:180px;" placeholder="Detalle (opcional)">
        </div></td></tr>`;
    }).join('');
    return filas || '<tr><td colspan="5" class="cg-empty">El cliente no tiene equipos en campo — declara abajo el serial dañado.</td></tr>';
  },

  _wrRepintar() {
    const prev = [...document.querySelectorAll('#wrCuerpo [data-wsel]')].map(i => ({
      ix: Number(i.dataset.wsel), on: i.checked,
      mot: document.querySelector(`select[data-wmot="${i.dataset.wsel}"]`)?.value || '',
      mod: document.querySelector(`select[data-wmod="${i.dataset.wsel}"]`)?.value || '',
      det: document.querySelector(`input[data-wdet="${i.dataset.wsel}"]`)?.value || '',
    }));
    const cont = document.getElementById('wrCuerpo');
    if (!cont) return;
    cont.innerHTML = this._wrFilasHtml();
    for (const p of prev) {
      const chk = document.querySelector(`input[data-wsel="${p.ix}"]`);
      if (chk) { chk.checked = p.on; this._wizFila(p.ix, p.on); }
      const mot = document.querySelector(`select[data-wmot="${p.ix}"]`); if (mot && p.mot) mot.value = p.mot;
      const mod = document.querySelector(`select[data-wmod="${p.ix}"]`); if (mod && p.mod) mod.value = p.mod;
      const det = document.querySelector(`input[data-wdet="${p.ix}"]`); if (det) det.value = p.det;
    }
  },

  _wrQuitarSerial(i) {
    this._wrExtras.splice(i, 1);
    this._wrRepintar();
  },

  // Declarar un serial dañado que el sistema no conoce (Alberto 2026-09-09:
  // "otro caso: hay que reemplazar un equipo que no está en el sistema").
  // La ficha NO se crea desde aquí —las reglas no dejan a un vendedor crear
  // fichas del pool, y con razón— sino en el trigger al enviar la solicitud.
  async _wrAgregarSerial() {
    const inp = document.getElementById('wrSerialNuevo');
    const raw = (inp?.value || '').trim();
    if (!raw) return;
    const norm = EquiposPoolService.normalizarSerial(raw);
    if (!EquiposPoolService.esSerialValido(norm)) { Toast.show('Ese serial no parece válido', 'warn'); return; }
    const yaEnLista = [...this.equipos, ...this._wrExtras]
      .some(e => EquiposPoolService.normalizarSerial(e.serial || e.id) === norm);
    if (yaEnLista) { Toast.show(`${norm} ya está en la lista de arriba`, 'warn'); return; }
    let ficha = null;
    try { ficha = await EquiposPoolService.findBySerial(raw); } catch (_) { /* sin red: se declara igual */ }
    if (ficha) {
      // Existe pero no salió en la lista: está en bodega, en taller, con otro
      // cliente… Eso no se arregla declarándolo — se dice qué pasa.
      const L = EquiposPoolService.ESTADO_LABELS || {};
      const otro = ficha.asignacion?.cliente_id && ficha.asignacion.cliente_id !== this.cliente.id
        ? ` y figura con ${ficha.asignacion.cliente_nombre || 'otro cliente'}` : '';
      Toast.show(`${norm} sí está en el sistema (${L[ficha.estado] || ficha.estado}${otro}) — revísalo en Inventario antes de reemplazarlo`, 'warn');
      return;
    }
    const m = this._modeloDeSelect(document.getElementById('wrModeloNuevo'));
    if (!m) { Toast.show('Elige el modelo del serial que estás declarando', 'warn'); return; }
    this._wrExtras.push({ id: norm, serial: raw, serial_norm: norm, modelo_id: m.id, modelo_label: m.label,
      estado: 'en_cliente', propiedad: 'desconocida', asignacion: null, sin_ficha: true });
    if (inp) inp.value = '';
    this._wrRepintar();
    inp?.focus();
  },

  _wizFila(ix, on) {
    document.getElementById(`wcfg-${ix}`)?.classList.toggle('hidden', !on);
  },

  async crearReemplazo() {
    const seleccion = [...document.querySelectorAll('input[data-wsel]:checked')].map(i => Number(i.dataset.wsel));
    if (!seleccion.length) { Toast.show('Marca al menos un serial', 'warn'); return; }
    const items = [];
    for (const ix of seleccion) {
      const e = this._wrUnidad(ix);
      if (!e) continue;
      // Declarado a mano: no hay ficha todavía, la crea el trigger al enviar.
      const el = e.sin_ficha ? { code: 'alquiler' } : this._eleg(e);
      const motivo = document.querySelector(`select[data-wmot="${ix}"]`)?.value || '';
      if (!motivo) { Toast.show(`Indica el motivo del serial ${e.serial}`, 'warn'); return; }
      const contrato = this.contratos.find(c => c.id === e.asignacion?.contrato_doc_id);
      const modeloSel = this._modeloDeSelect(document.querySelector(`select[data-wmod="${ix}"]`));
      if (!modeloSel) { Toast.show(`Elige el modelo de reemplazo del serial ${e.serial} (lista de modelos)`, 'warn'); return; }
      items.push({
        serial_saliente: e.serial || e.id,
        pool_doc_id_saliente: e.sin_ficha ? null : e.id,
        ...(e.sin_ficha ? { saliente_sin_ficha: true } : {}),
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
      const gid = await GestionesService.crear({ ...Centro._estampaReg(),
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
      // El JSON para recepción se ofrece AQUÍ, que es cuando el vendedor tiene
      // el caso fresco y sabe a quién se lo va a mandar. Después queda siempre
      // a mano en el expediente ("JSON para recepción").
      if (await Modal.confirm({
        title: 'JSON para recepción',
        confirmLabel: 'Descargar', cancelLabel: 'Ahora no',
        message: `¿Descargar el <b>nombre, los grupos y el GPS</b> de ${items.length === 1 ? 'el radio que sale' : `los ${items.length} radios que salen`}, `
          + `para mandárselo a recepción?<br><br>Es lo que cada radio nuevo tiene que heredar. `
          + `Recepción también puede jalarlo sola desde el lote de POC — queda en el expediente por si lo necesitas después.`,
      })) await this.jsonReemplazoRecepcion(gid);
    } catch (e) { console.error(e); Toast.show('No se pudo crear la solicitud', 'bad'); }
  },

  // ── JSON del reemplazo para recepción (vendedores, 2026-09-10) ───────────
  // Lo que el radio nuevo tiene que heredar del que sustituye —nombre, grupos
  // y GPS—, en el mismo formato que el lote de POC ya sabe leer. Sale de la
  // ficha POC del saliente: la misma fuente que ese lote jala solo, pero
  // descargable, para que el vendedor se lo pueda mandar a recepción por
  // adelantado o por fuera del sistema.
  //
  // No lleva seriales ni Unit ID a propósito: el serial del que entra lo pone
  // bodega al asignar, y el Unit ID lo asigna el lote (consecutivo propio). El
  // orden de las filas es el de los ítems de la gestión.
  async jsonReemplazoRecepcion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || g.tipo !== 'reemplazo') { Toast.show('No se encontró la gestión.', 'bad'); return; }
    const items = (g.items || []).filter(it => String(it.serial_saliente || '').trim());
    if (!items.length) { Toast.show('Esta gestión no tiene seriales salientes declarados.', 'warn'); return; }
    if (typeof PocService === 'undefined') { Toast.show('No se pudo consultar POC desde esta pantalla.', 'bad'); return; }

    try {
      const cfgs = await PocService.configDelSaliente({
        clienteId: g.cliente_id || this.cliente?.id || null,
        clienteNombre: g.cliente_nombre || this.cliente?.nombre || '',
        salientes: items.map(it => it.serial_saliente),
        fresh: true,
      });

      const filas = items.map(it => {
        const cfg = cfgs.get(Serial.clave(it.serial_saliente)) || null;
        return {
          // cliente_id/cliente_nombre los usa el lote para auto-elegir cliente.
          cliente_id: g.cliente_id || '',
          cliente_nombre: g.cliente_nombre || '',
          radio_name: cfg?.radio_name || '',
          gps: cfg?.gps || false,
          grupos: cfg ? cfg.grupos : [],
          // El modelo que ENTRA (el solicitado), no el del saliente.
          modelo_id: it.modelo_solicitado_id || it.modelo_id || '',
          modelo_label: it.modelo_solicitado || it.modelo || '',
          // Referencia para quien lo lea; el lote de POC ignora estos dos.
          serial_saliente: it.serial_saliente,
          ficha_saliente: cfg ? (cfg.cerrada ? 'cerrada' : 'viva') : 'sin ficha en POC',
        };
      });

      const sin = filas.filter(f => !f.radio_name && !(f.grupos || []).length).length;
      if (sin && !await Modal.confirm({
        title: 'Salientes sin ficha en POC',
        confirmLabel: 'Descargar de todos modos',
        message: `${sin} de ${filas.length} radio(s) que salen no tienen ficha en POC con este cliente: van sin nombre ni grupos y recepción tendrá que llenarlos a mano.`,
      })) return;

      const blob = new Blob([JSON.stringify(filas, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `reemplazo-${gid}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      Toast.show(`JSON de ${filas.length} radio(s) descargado${sin ? ` — ${sin} sin datos del saliente` : ''}.`, sin ? 'warn' : 'ok');
    } catch (e) {
      console.error('[centro] JSON de reemplazo para recepción:', e);
      Toast.show('No se pudo leer la configuración de los radios salientes.', 'bad');
    }
  },

  // Modalidad de la línea: de quién es el equipo. Antes era un ganchito
  // "del cliente" que nadie marcaba y TODO salía como alquiler (Cerdas,
  // 2026-09-09): ahora es una elección obligatoria sin valor por defecto —
  // _lineasModelo devuelve modalidad null si no se eligió y los wizards
  // no dejan crear/aumentar hasta que cada línea la tenga.
  _selModalidad(pref, val, extra = '') {
    const v = (val === 'propio' || val === 'alquiler') ? val : '';
    return `<select class="form-select" data-${pref}-modalidad ${extra} style="width:150px; flex:none;"
        title="Alquiler = equipo de CECOMUNICA en renta · Del cliente = equipo propiedad del cliente (tarifa de servicio)">
        <option value="" ${v ? '' : 'selected'}>¿De quién es?</option>
        <option value="alquiler" ${v === 'alquiler' ? 'selected' : ''}>Alquiler</option>
        <option value="propio" ${v === 'propio' ? 'selected' : ''}>Del cliente</option>
      </select>`;
  },
  // Fila de línea modelo (+cantidad, +precio opcional) con el SELECT del catálogo.
  _lineaModeloHtml(pref, conPrecio) {
    return `<div style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
      ${this._selModelo(`data-${pref}-modelo style="flex:1;"`)}
      <input class="form-input" data-${pref}-cant type="number" min="1" value="1" style="width:86px;" title="Cantidad">
      ${conPrecio ? `<input class="form-input" data-${pref}-precio type="number" min="0" step="1" placeholder="$/mes" style="width:110px;" title="Precio mensual">
      ${this._selModalidad(pref)}` : ''}
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
      const gid = await GestionesService.crear({ ...Centro._estampaReg(),
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

  // `val` prellena la fila con un cargo YA guardado (edición del expediente).
  // Los seriales amarrados viajan en el data-attr para no perderse al releer:
  // un cargo de GPS pegado a 3 radios sigue pegado a esos 3 radios.
  _cargoLineaHtml(val = null) {
    const v = val || {};
    const opts = (this.cargosCat || []).map(c =>
      `<option value="${this.esc(c.id)}" ${v.cargo_id === c.id ? 'selected' : ''} data-monto="${Number(c.monto_default) || 0}" data-rec="${c.recurrente ? 1 : 0}">${this.esc(c.concepto || '')}</option>`).join('');
    const ser = Array.isArray(v.seriales) && v.seriales.length
      ? ` data-wac-seriales="${this.esc(JSON.stringify(v.seriales))}"` : '';
    return `<div class="wa-cargo" style="display:flex; gap:8px; margin-bottom:8px; align-items:center;"${ser}>
      <select class="form-select" data-wac-sel style="flex:1;" onchange="Centro._cargoSelChange(this)">
        <option value="">— cargo del catálogo —</option>${opts}</select>
      <input class="form-input" data-wac-cant type="number" min="1" value="${Math.max(1, Number(v.cantidad || 1))}" style="width:70px;" title="Cantidad" onchange="Centro._previewTarifario()">
      <input class="form-input" data-wac-monto type="number" min="0" step="1" placeholder="$" value="${v.monto != null && v.monto !== '' ? Number(v.monto) : ''}" style="width:100px;" onchange="Centro._previewTarifario()">
      <select class="form-select" data-wac-tipo style="width:110px;" onchange="Centro._previewTarifario()">
        <option value="unico" ${v.recurrente ? '' : 'selected'}>Único</option><option value="recurrente" ${v.recurrente ? 'selected' : ''}>Mensual</option></select>
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
  _previewTarifario() { this._aumPreview(); this._wcPreview(); this._wjPreview?.(); this._wePreview?.(); },

  // Lector genérico de líneas modelo·cantidad·precio (los data-attrs que
  // pinta _lineaModeloHtml). Lo comparten el aumento (wau) y el contrato (wcm).
  _lineasModelo(pref) {
    const selects = [...document.querySelectorAll(`select[data-${pref}-modelo]`)];
    const cants = [...document.querySelectorAll(`input[data-${pref}-cant]`)];
    const precios = [...document.querySelectorAll(`input[data-${pref}-precio]`)];
    const modalidades = [...document.querySelectorAll(`select[data-${pref}-modalidad]`)];
    return selects.map((s, i) => {
      const m = this._modeloDeSelect(s);
      // Modalidad por línea: 'propio' = equipo del cliente (tarifa de
      // servicio); 'alquiler' = equipo de CECOMUNICA en renta; null = el
      // vendedor todavía no dijo (los wizards lo exigen antes de guardar).
      const mod = modalidades[i]?.value;
      return m ? { modelo: m.label, modelo_id: m.id,
        cantidad: Math.max(1, Number(cants[i]?.value || 1)), precio: Number(precios[i]?.value || 0),
        modalidad: (mod === 'propio' || mod === 'alquiler') ? mod : null } : null;
    }).filter(Boolean);
  },
  _lineasSinModalidad(lineas) { return (lineas || []).filter(l => !l.modalidad).length; },
  MSG_SIN_MODALIDAD: 'Indica en cada línea si el equipo es alquiler o del cliente',
  _aumLineas() { return this._lineasModelo('wau'); },
  _aumCargos() {
    return [...document.querySelectorAll('.wa-cargo')].map(f => {
      const sel = f.querySelector('[data-wac-sel]');
      const opt = sel?.selectedOptions[0];
      // Seriales amarrados de un cargo ya guardado (solo en la edición del
      // expediente; en los wizards el data-attr no existe y no se escribe).
      let seriales = null;
      try { seriales = f.dataset.wacSeriales ? JSON.parse(f.dataset.wacSeriales) : null; } catch (e) { seriales = null; }
      return {
        cargo_id: sel?.value || '',
        concepto: opt ? (opt.textContent || '').trim() : '',
        cantidad: Math.max(1, Math.round(Number(f.querySelector('[data-wac-cant]')?.value)) || 1),
        monto: Math.max(0, Number(f.querySelector('[data-wac-monto]')?.value || 0)),
        recurrente: f.querySelector('[data-wac-tipo]')?.value === 'recurrente',
        ...(Array.isArray(seriales) && seriales.length ? { seriales } : {}),
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
    // Adenda a contrato EN PAPEL (opts.papel): no hay contrato interno que
    // elegir — el número va escrito a mano y la gestión vive sola.
    const esPapel = opts.papel === true;
    this._aumPapel = esPapel;
    if (!activos.length && !esPapel) { Toast.show('El cliente no tiene contratos vigentes', 'warn'); return; }
    // ITBMS por defecto: hereda del contrato destino; cliente exento manda.
    const cBase = esPapel ? null : (activos.find(c => c.id === preselId) || activos[0]);
    const itbmsDefault = this.cliente?.itbms_exento === true ? false : (cBase?.itbms_aplica !== false);
    // Modo REGULARIZACIÓN (2026-08-31, caso C COMUNICA: el flujo normal mandó
    // a Alberto a bodega por equipos que el cliente YA tenía): el anexo amarra
    // los sobrantes de la conciliación — prellenado con sus modelos, y B3 lo
    // aplica y CIERRA al firmarse, sin bodega, sin OS y sin entrega.
    this._aumRegulariza = null;
    // Dos fuentes de "equipos que el cliente YA tiene" (plan 2026-09-08 §4.3):
    //   · opts.regularizar   → sobrantes de la conciliación de ESE contrato.
    //   · opts.regularizarD1 → radios en campo sin contrato interno (D1 de la
    //     deuda de la cuenta); se amarran al contrato destino al firmarse.
    // En ambos casos el anexo es SOLO de regularización: sin bodega, sin OS,
    // sin entrega — por eso NO admite radios nuevos (candado en las líneas y
    // en crearAumento). Los nuevos van en un aumento normal aparte.
    if (opts.regularizar || opts.regularizarD1) {
      const sobr = opts.regularizarD1 ? [] : [...(cBase.regularizacion?.sin_linea_seriales || []),
                    ...(cBase.regularizacion?.sin_cupo_seriales || [])];
      const unidades = opts.regularizarD1
        ? this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id && !e.pendiente_devolucion)
        : sobr.map(s => this.equipos.find(e => (e.serial || e.id) === s)).filter(Boolean);
      // Sin radios sueltos NO se cierra la puerta (2026-09-09): la lista abre
      // vacía y el vendedor declara los seriales que el sistema no conoce.
      // Lo que sí necesita algo que mostrar es el camino por sobrantes de UN
      // contrato, que se entra desde su expediente.
      if (!unidades.length && !opts.regularizarD1) { Toast.show('Este contrato no tiene sobrantes de regularización', 'warn'); return; }
      this._aumRegulariza = unidades.map(u => ({
        pool_doc_id: u.id, serial: u.serial || u.id,
        modelo_id: u.modelo_id || null, modelo: u.modelo_label || u.modelo || '',
        modalidad: u.propiedad === 'cliente' ? 'propio' : 'alquiler',
      }));
    }
    // Ancla automática (cuenta fragmentada): el destino NO se pregunta — se
    // informa. Y la consolidación se OFRECE cuando conviene, sin imponerla.
    const est = this._cuentaEstado();
    // Aviso (plan 2026-09-08 §4.3, corregido tras la verificación): un aumento
    // NO mezcla radios que el cliente ya tiene con radios nuevos — el anexo de
    // regularización cierra sin bodega y los nuevos se quedarían sin OS. Se
    // ofrece el anexo aparte, precargado con los D1 de la cuenta.
    const d1 = esPapel || this._aumRegulariza ? [] : this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id && !e.pendiente_devolucion);
    const nudgeReg = d1.length
      ? `<div class="cg-senal warn" style="margin-bottom:10px; align-items:center;">
          <span><b>${d1.length} radio${d1.length === 1 ? '' : 's'}</b> ya está${d1.length === 1 ? '' : 'n'} con el cliente sin contrato
            (<span class="cg-mono">${d1.slice(0, 6).map(e => this.esc(e.serial || e.id)).join(', ')}${d1.length > 6 ? '…' : ''}</span>).
            Aquí van <b>solo los radios nuevos</b>; esos se regularizan con un anexo aparte, sin bodega.</span>
          <button class="btn btn-ghost" style="margin-left:auto; flex:none; padding:3px 11px; font-size:12px;"
            onclick="Centro.wizRegularizarCuenta()">Regularizar esos radios</button></div>`
      : '';
    const nudgeConsol = this._aumRegulariza ? '' : est.tipo === 'fragmentada' && !this._renovacionEnTramite()
      && (est.custodia || est.renovables.some(c => this._wcEnVentana(c)))
      ? `<div class="cg-senal warn" style="margin-bottom:10px; align-items:center;">
          <span>Esta cuenta tiene <b>${est.renovables.length} contrato(s)</b>${est.custodia ? ` y <b>${est.custodia} radio(s) sin contrato formal</b>` : ''} —
          si el cliente está por renovar, este es el momento de consolidarla.</span>
          <button class="btn btn-primary" style="margin-left:auto; flex:none; padding:3px 11px; font-size:12px;"
            onclick="Centro.wizContrato({renovarCuenta:true, agregar:true})">Mejor renovar la cuenta</button></div>` : '';
    // El aviso de consolidación baja al pie del formulario (2026-09-08): es
    // secundario y antes era la tercera caja antes del primer campo.
    const nudge = nudgeReg;
    const destinoHtml = esPapel
      ? `<div class="form-field" style="margin-bottom:10px; max-width:420px;">
          <label class="form-label" for="waContratoPapel">Número del contrato en papel</label>
          <input class="form-input cg-mono" id="waContratoPapel" maxlength="40" autocomplete="off"
            placeholder="p. ej. ALQ 2019-044 — tal cual está en el papel">
          <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Se escribe a mano porque el contrato marco
            <b>no está en el sistema</b>. La adenda cita este número y no crea ningún contrato.</p>
          <select id="waContrato" class="hidden"><option value="" selected></option></select></div>`
      : this._aumRegulariza
      ? `<div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Seriales de la CUENTA</label>
          <p style="margin:0 0 6px; font-size:13px;">Cubre <b>${this._aumRegulariza.length} radio(s)</b> que el cliente
            tiene en campo sin contrato — <b>toda la cuenta</b>, no un contrato en particular.</p>
          ${activos.length > 1
            ? `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <span style="font-size:12.5px; color:var(--fg-3);">Las líneas entran en el contrato:</span>
                <select class="form-select" id="waContrato" style="max-width:300px;">
                  ${activos.map(c => `<option value="${this.esc(c.id)}" ${c.id === cBase.id ? 'selected' : ''}>${this.esc(c.contrato_id || c.id)} · ${this.esc(c.tipo_contrato || '')}</option>`).join('')}
                </select>
                <span style="font-size:12px; color:var(--fg-4);">sale el de mayor facturación; cámbialo si prefieres otro</span>
              </div>`
            : `<p style="margin:0; font-size:13px;"><span style="color:var(--fg-3); font-size:12.5px;">Las líneas entran en el contrato</span>
                <span class="cg-mono">${this.esc(cBase.contrato_id || cBase.id)}</span></p>
               <select id="waContrato" class="hidden"><option value="${this.esc(cBase.id)}" selected></option></select>`}</div>`
      : opts.ancla
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
    // Prellenado de líneas: en regularización, los modelos de los sobrantes.
    // Líneas FIJAS: modelo y cantidad salen de los seriales MARCADOS; solo se
    // pone precio. Un anexo de regularización no lleva radios nuevos (no pasa
    // por bodega ni genera OS — verificación 2026-09-08).
    this._aumRegularizaTodos = this._aumRegulariza ? [...this._aumRegulariza] : null;
    this._aumRegDestino = {};
    (this._aumRegularizaTodos || []).forEach(u => { this._aumRegDestino[u.serial] = 'entra'; });
    const lineasIni = this._aumRegulariza ? this._aumLineasFijasHtml({}) : this._lineaModeloHtml('wau', true);
    // El vendedor declara la cuenta COMPLETA aquí (Alberto 2026-09-09: "el
    // vendedor quiere regularizar sin mandar al cliente a firma, para que
    // quede documentado qué tiene y la cuenta esté lista para el próximo
    // trámite"). Antes solo se podía desmarcar —el serial seguía colgado del
    // cliente como deuda— y lo que faltaba obligaba a irse a Regularizar
    // cuenta. Ahora: destino por serial y "+ Agregar serial" (con o sin ficha
    // en el sistema). La cuenta que motivó todo esto: FORTUNATO MANGRAVITA.
    const regSenal = this._aumRegulariza ? `<div class="cg-senal warn" style="margin-bottom:10px; display:block;">
          <div>Declara la cuenta COMPLETA: lo que el cliente <b>YA tiene</b> queda amarrado al contrato con el
            tramo desde <b>hoy</b> —<b>sin firma, sin bodega, sin orden de servicio y sin entrega</b>— y lo marcado
            <b>“no lo tiene”</b> sale de la cuenta (queda por clasificar).</div>
          <div id="waRegSeriales" style="margin-top:8px;">${this._aumRegSerialesHtml()}</div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px;">
            <input class="form-input" id="waRegSerialNuevo" placeholder="Serial que el cliente tiene y no aparece…"
              style="max-width:250px;" aria-label="Serial a agregar"
              onkeydown="if(event.key==='Enter'){event.preventDefault();Centro._aumRegAgregarSerial();}">
            ${this._selModelo('id="waRegModeloNuevo" style="max-width:210px;" aria-label="Modelo del serial a agregar"')}
            <button type="button" class="btn btn-ghost cg-act" onclick="Centro._aumRegAgregarSerial()">+ Agregar serial</button>
          </div>
          <div style="margin-top:6px; font-size:12px; color:var(--fg-3);"><span id="waRegN">${this._aumRegulariza.length}</span>
            de ${this._aumRegularizaTodos.length} entran al contrato. El modelo solo hace falta si el serial no está en el sistema.</div></div>` : '';
    const papelSenal = esPapel
      ? `<div class="cg-senal warn" style="margin-bottom:10px;">
          <span><b>Salida para seguir sin regularizar hoy.</b> La adenda agrega equipos al contrato viejo
          citando su número; no crea ningún contrato en el sistema. Al entregarse, cada equipo queda en
          <b>custodia con su tramo propio</b> y la cuenta sigue marcada <b>sin contrato formal</b>: hay que
          regularizarla con un contrato nuevo cuando se pueda.</span></div>` : '';
    this._abrirModalA({
      titulo: `${this._aumRegulariza ? 'Actualizar seriales del cliente' : esPapel ? 'Adenda a contrato en papel' : 'Aumento de equipos (enmienda)'} — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        ${this._aumRegulariza
          ? `Pone el sistema al día con los equipos que el cliente <b>ya tiene</b>: al aprobarse se amarran al
             contrato y las líneas entran con tarifa desde hoy. <b>Al cliente no se le envía nada a firmar</b> —
             si hiciera falta su firma, el camino es un contrato.`
          : esPapel
          ? `La adenda agrega equipos <b>con vigencia propia</b> a un contrato que solo existe <b>en papel</b>:
             el período corre desde la entrega, el documento cita el número del contrato viejo y
             <b>requiere la firma del cliente</b> antes de salir a bodega.`
          : `La enmienda agrega líneas <b>con vigencia propia</b>: el período del equipo
             nuevo corre desde su entrega y vence más tarde que el resto — el anexo lo deja explícito y
             <b>requiere la firma del cliente</b> antes de aplicarse.`}</p>
      ${regSenal}${papelSenal}${nudge}
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Destino del anexo</div>
        ${destinoHtml}
      </div>
      <div oninput="Centro._aumPreview()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Equipos y conceptos</div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
          <div id="waLineas">${lineasIni}</div>
          ${this._aumRegulariza
            ? `<p style="margin:4px 0 0; font-size:12px; color:var(--fg-3);">Solo los ${this._aumRegulariza.length} equipo(s) que ya están con el cliente. ¿Radios nuevos? Van en <b>Agregar equipos</b>, que sí pasa por bodega y entrega.</p>`
            : `<button class="btn btn-ghost cg-act"
            onclick="Centro._addLineaModelo('waLineas','wau',true); Centro._aumPreview()">+ Agregar otro modelo</button>`}</div>
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
        ${nudgeConsol ? `<div style="margin-top:12px;">${nudgeConsol}</div>` : ''}
      </div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearAumento()">Enviar a aprobación</button>`,
    });
    this._aumPreview();
  },

  // Número manual del contrato en papel — espejo de
  // functions/src/lib/adendaPapel.normalizarRefPapel (sin comillas, espacios
  // colapsados, mayúsculas) para que lo guardado sea lo mismo que se lee.
  _normRefPapel(texto) {
    return String(texto == null ? '' : texto).replace(/["'`]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  },

  async crearAumento() {
    const esPapel = this._aumPapel === true;
    const contratoDocId = document.getElementById('waContrato')?.value || '';
    const contrato = esPapel ? null : this.contratos.find(c => c.id === contratoDocId);
    const refPapel = esPapel ? this._normRefPapel(document.getElementById('waContratoPapel')?.value) : '';
    if (esPapel && !refPapel) { Toast.show('Escribe el número del contrato en papel', 'warn'); document.getElementById('waContratoPapel')?.focus(); return; }
    if (!esPapel && !contrato) { Toast.show('Elige el contrato destino', 'warn'); return; }
    const lineas = this._aumLineas();
    // Sin equipos pero CON cargos = un AJUSTE DE TARIFA (2026-09-02): en vez
    // de regañar, se redirige al wizard correcto — ahí se amarran los cargos
    // por serial y el flujo cierra sin bodega. En papel no hay contrato que
    // ajustar: la adenda necesita al menos un equipo.
    if (!lineas.length && this._aumCargos().length) {
      if (esPapel) { Toast.show('La adenda a contrato en papel necesita al menos un equipo — los cargos solos no tienen contrato al que aplicarse', 'warn'); return; }
      Toast.show('Solo cargos, sin equipos — eso es un Ajuste de tarifa: te llevo al wizard correcto', 'ok');
      this.wizAjuste(contratoDocId);
      return;
    }
    if (!lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
    if (lineas.some(l => !(l.precio > 0))) { Toast.show('Cada línea necesita su precio mensual', 'warn'); return; }
    if (this._lineasSinModalidad(lineas)) {
      Toast.show(this.MSG_SIN_MODALIDAD, 'warn');
      document.querySelector('select[data-wau-modalidad]:not([disabled])')?.focus();
      return;
    }
    // Candado (verificación 2026-09-08): un anexo de regularización cierra
    // sin bodega, OS ni entrega — si llevara radios nuevos, esos radios
    // nunca saldrían. Las cantidades tienen que ser exactamente los seriales.
    if (this._aumRegulariza) {
      if (!this._aumRegulariza.length) { Toast.show('Marca al menos un serial que el cliente sí tiene — si no tiene ninguno, decláralo en Regularizar cuenta', 'warn'); return; }
      const sinModelo = this._aumRegulariza.filter(u => !u.modelo_id && !u.modelo);
      if (sinModelo.length) { Toast.show(`Elige el modelo de ${sinModelo.map(u => u.serial).join(', ')}`, 'warn'); return; }
      const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
      if (total !== this._aumRegulariza.length) {
        Toast.show(`El anexo de regularización cubre exactamente ${this._aumRegulariza.length} equipo(s) que ya están con el cliente — los radios nuevos van en un aumento aparte`, 'warn');
        return;
      }
    }
    const meses = Number(document.getElementById('waMeses')?.value || 0);
    if (!(meses > 0)) { Toast.show('Indica la vigencia del tramo en meses', 'warn'); return; }
    const cargos = this._aumCargos();
    const itbmsAplica = document.getElementById('waItbms')?.checked !== false;
    const totales = this._totAumento(lineas, cargos, itbmsAplica);
    try {
      const gid = await GestionesService.crear({ ...Centro._estampaReg(),
        tipo: 'aumento',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_aprobacion',
        origen: { tipo: 'vendedor' },
        items: [],
        cierre: {},
        aprobacion: { requiere: true },
        aumento: {
          // Adenda a contrato en papel: sin contrato interno (null) y el
          // número manual como etiqueta; el flag lo leen los triggers.
          contrato_doc_id: contrato ? contrato.id : null,
          contrato_id: contrato ? (contrato.contrato_id || contrato.id) : refPapel,
          ...(esPapel ? { contrato_papel: true } : {}),
          lineas,
          cargos,
          itbms: { aplica: itbmsAplica, porcentaje: totales.itbms_porcentaje },
          totales,
          duracion_meses: meses,
          seriales_asignados: [],
          // Regularización: B3 amarra estos seriales (ya en campo) al
          // firmarse el anexo y cierra la gestión — sin bodega ni entrega.
          ...(this._aumRegulariza
            ? { es_regularizacion: true,
                regulariza_seriales: this._aumRegulariza.map(u => ({
                  pool_doc_id: u.pool_doc_id || null, serial: u.serial,
                  modelo_id: u.modelo_id || null, modelo: u.modelo || '',
                  ...(u.modalidad ? { modalidad: u.modalidad } : {}) })),
                // Los que el cliente NO tiene: al aplicarse el anexo salen de
                // la cuenta (por clasificar), igual que el destino 'no_tiene'
                // del plan por serial de una renovación.
                ...(this._aumRegNoTiene().length
                  ? { regulariza_no_tiene: this._aumRegNoTiene().map(u => ({
                      serial: u.serial, ...(u.pool_doc_id ? { pool_doc_id: u.pool_doc_id } : {}),
                      modelo_id: u.modelo_id || null, modelo: u.modelo || '' })) } : {}) } : {}),
        },
      });
      this._cerrarModal();
      this.gSel = gid;
      const nNoTiene = this._aumRegulariza ? this._aumRegNoTiene().length : 0;
      Toast.show(this._aumRegulariza
        ? `Actualización de seriales ${gid} enviada a aprobación — al aprobarse amarra ${this._aumRegulariza.length} equipo(s)${nNoTiene ? ` y suelta ${nNoTiene} de la cuenta` : ''}, sin firma del cliente`
        : esPapel
        ? `Adenda ${gid} al contrato en papel ${refPapel} enviada a aprobación comercial — la cuenta sigue pendiente de regularizar`
        : `Aumento ${gid} enviado a aprobación comercial`, 'ok');
      this._aumRegulariza = null;
      this._aumRegularizaTodos = null;
      this._aumRegDestino = {};
      this._aumPapel = false;
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear el aumento', 'bad'); }
  },

  /* ═════════ Wizard: ajuste de tarifa / servicios (2026-09-02) ═════════ */

  // Anexo SOLO-CARGOS (caso FORTALEZA: agregar "Servicio GPS" $5/mes a radios
  // concretos). Sin equipos nuevos → sin bodega, sin OS, sin entrega: al
  // firmarse el cliente, B3 aplica los cargos al contrato, estampa el servicio
  // en el pool de cada serial marcado y CIERRA la gestión — mismo patrón del
  // anexo de regularización. Los cargos recurrentes quedan AMARRADOS POR
  // SERIAL (cargo.seriales[]): la cantidad sale de la selección, y la baja de
  // un serial descuenta el cargo sola (onGestionWrite B2).
  async wizAjuste(preselId) {
    if (!this.puedeCrearGestion()) { Toast.show('Tu rol no crea gestiones desde aquí', 'warn'); return; }
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await this._cargarCargos();
    const activos = this.contratos.filter(c => this._esVigente(c));
    if (!activos.length) { Toast.show('El cliente no tiene contratos vigentes', 'warn'); return; }
    const cBase = activos.find(c => c.id === preselId) || this._cuentaAncla() || activos[0];
    const itbmsDefault = this.cliente?.itbms_exento === true ? false : (cBase?.itbms_aplica !== false);
    this._abrirModalA({
      titulo: `Ajuste de tarifa / servicios (anexo) — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        Agrega <b>cargos del catálogo</b> (servicios como GPS, o ajustes) a un contrato vigente —
        <b>sin equipos nuevos</b>: no pasa por bodega ni genera entrega. Requiere aprobación
        comercial y la <b>firma del cliente</b>; al firmarse se aplica y cierra solo.</p>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Contrato destino</div>
        <div class="form-field" style="margin-bottom:4px; max-width:340px;">
          <select class="form-select" id="wjContrato" onchange="Centro._wjSyncFlota()">
            ${activos.map(c => `<option value="${this.esc(c.id)}" ${c.id === cBase.id ? 'selected' : ''}>${this.esc(c.contrato_id || c.id)} · ${this.esc(c.tipo_contrato || '')}</option>`).join('')}
          </select></div>
      </div>
      <div oninput="Centro._wjPreview()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Tarifas de las líneas actuales
          <span class="hint">precio negociado — deja en blanco lo que no cambia</span></div>
        <div id="wjLineas"></div>
      </div>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">3</span> Cargos / servicios nuevos <span class="hint">opcional</span></div>
        <div id="wjCargos">${this._wjCargoRow()}</div>
        <button class="btn btn-ghost cg-act"
          onclick="document.getElementById('wjCargos').insertAdjacentHTML('beforeend', Centro._wjCargoRow())">+ Agregar cargo</button>
      </div>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">4</span> Totales</div>
        <label class="cg-toggle">
          <input type="checkbox" id="wjItbms" ${itbmsDefault ? 'checked' : ''} onchange="Centro._wjPreview()">
          Aplica ITBMS</label>
        <div id="wjTot" class="ds-card" style="padding:10px 14px; max-width:380px; margin-top:10px;"></div>
      </div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearAjuste()">Enviar a aprobación</button>`,
    });
    this._wjSyncFlota();
    this._wjPreview();
  },
  // Tarifas actuales del contrato destino, editables (renegociación de
  // precio, 2026-09-02): cada línea muestra su precio vigente y un campo
  // "nuevo" — vacío = sin cambio. Se aplica al firmarse el anexo.
  _wjSyncLineas() {
    const cont = document.getElementById('wjLineas');
    if (!cont) return;
    const cid = document.getElementById('wjContrato')?.value || '';
    const c = this.contratos.find(x => x.id === cid);
    const lineas = (c?.equipos || []);
    cont.innerHTML = lineas.length ? `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
        <th>Línea</th><th class="num">Cant.</th><th class="num">Precio actual</th><th class="num">Precio nuevo</th></tr></thead><tbody>
      ${lineas.map((l, i) => `<tr>
        <td>${this.esc(l.modelo || l.descripcion || '—')}${l.modalidad === 'propio' ? ' <span class="cg-venc vigente" style="font-size:10.5px;">del cliente</span>' : ''}</td>
        <td class="num">${Number(l.cantidad || 0)}</td>
        <td class="num">$${Number(l.precio || 0).toFixed(2)}</td>
        <td class="num"><input class="form-input num" type="number" min="0" step="1" placeholder="sin cambio"
          data-wj-nuevo data-idx="${i}" style="max-width:110px; padding:4px 8px; font-size:13px;"></td></tr>`).join('')}
    </tbody></table></div>`
      : `<p style="font-size:12.5px; color:var(--fg-3); margin:0;">El contrato no tiene líneas de equipos.</p>`;
  },
  _wjAjustes() {
    const cid = document.getElementById('wjContrato')?.value || '';
    const c = this.contratos.find(x => x.id === cid);
    return [...document.querySelectorAll('input[data-wj-nuevo]')].map(inp => {
      if (inp.value === '' || inp.value == null) return null;
      const i = Number(inp.dataset.idx);
      const l = (c?.equipos || [])[i];
      if (!l) return null;
      const nuevo = Math.max(0, Number(inp.value) || 0);
      if (nuevo === Number(l.precio || 0)) return null;
      return { idx: i, modelo_id: l.modelo_id || null, modelo: l.modelo || '',
        modalidad: l.modalidad || null, cantidad: Number(l.cantidad || 0),
        precio_anterior: Number(l.precio || 0), precio_nuevo: nuevo };
    }).filter(Boolean);
  },
  // Cambio de contrato destino: tarifas nuevas + las filas de cargos se
  // reinician (los pickers de radios dependen de la flota del destino).
  _wjSyncFlota() {
    this._wjSyncLineas();
    const cont = document.getElementById('wjCargos');
    if (cont) cont.innerHTML = this._wjCargoRow();
    this._wjPreview();
  },

  // Fila de cargo del AJUSTE (rediseño 2026-09-02: cero jerga — el CATÁLOGO
  // sabe si un cargo es por equipo, cargos.por_equipo). Al elegir "Servicio
  // GPS" la fila despliega "¿A cuáles radios?" ahí mismo; al elegir "Consola"
  // solo pide monto y cantidad. El vendedor nunca decide el amarre.
  _wjCargoRow() {
    const opts = (this.cargosCat || []).map(c =>
      `<option value="${this.esc(c.id)}" data-monto="${Number(c.monto_default) || 0}"
        data-rec="${c.recurrente ? 1 : 0}" data-poreq="${c.por_equipo ? 1 : 0}">${this.esc(c.concepto || '')}</option>`).join('');
    return `<div class="wj-cargo" style="border:1px solid var(--border-subtle); border-radius:8px; padding:8px 10px; margin-bottom:8px;">
      <div style="display:flex; gap:8px; align-items:center;">
        <select class="form-select" data-wjc-sel style="flex:1;" onchange="Centro._wjRowSel(this)">
          <option value="">— cargo del catálogo —</option>${opts}</select>
        <input class="form-input" data-wjc-cant type="number" min="1" value="1" style="width:70px;" title="Cantidad" onchange="Centro._wjPreview()">
        <input class="form-input" data-wjc-monto type="number" min="0" step="1" placeholder="$" style="width:100px;" onchange="Centro._wjPreview()">
        <select class="form-select" data-wjc-tipo style="width:110px;" onchange="Centro._wjPreview()">
          <option value="unico">Único</option><option value="recurrente">Mensual</option></select>
        <button type="button" class="btn btn-ghost" style="padding:4px 8px;" title="Quitar"
          onclick="this.closest('.wj-cargo').remove(); Centro._wjPreview()">✕</button>
      </div>
      <div data-wj-picker class="hidden" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-subtle);"></div>
    </div>`;
  },
  _wjRowSel(sel) {
    const fila = sel.closest('.wj-cargo');
    const opt = sel.selectedOptions[0];
    if (opt && opt.value) {
      const m = Number(opt.dataset.monto) || 0;
      const monto = fila.querySelector('[data-wjc-monto]');
      if (m && !monto.value) monto.value = m;
      fila.querySelector('[data-wjc-tipo]').value = opt.dataset.rec === '1' ? 'recurrente' : 'unico';
    }
    const picker = fila.querySelector('[data-wj-picker]');
    const cant = fila.querySelector('[data-wjc-cant]');
    if (opt?.dataset.poreq === '1') {
      const cid = document.getElementById('wjContrato')?.value || '';
      const flota = this.equipos.filter(e => e.asignacion?.contrato_doc_id === cid);
      picker.innerHTML = `<div style="font-size:12.5px; font-weight:600; margin-bottom:4px;">¿A cuáles radios aplica?</div>`
        + (flota.length ? `<div style="max-height:160px; overflow:auto;">${flota.map(e => `
          <label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:2px 0;">
            <input type="checkbox" data-wj-rs value="${this.esc(e.serial || e.id)}"
              onchange="Centro._wjRowSerial(this)" style="width:auto; margin:0;">
            <span class="cg-mono">${this.esc(e.serial || e.id)}</span>
            <span style="color:var(--fg-3);">${this.esc(e.modelo_label || '')}</span>
            ${(e.servicios || []).length ? `<span class="cg-venc vigente" style="font-size:10.5px;">${this.esc(e.servicios.join(', '))}</span>` : ''}
          </label>`).join('')}</div>`
        : `<p style="font-size:12.5px; color:var(--fg-3); margin:0;">El contrato no tiene seriales amarrados — el cargo irá con cantidad manual.</p>`);
      picker.classList.remove('hidden');
      if (flota.length) { cant.value = 0; cant.readOnly = true; }
    } else {
      picker.classList.add('hidden');
      picker.innerHTML = '';
      cant.readOnly = false;
      if (!(Number(cant.value) > 0)) cant.value = 1;
    }
    this._wjPreview();
  },
  _wjRowSerial(chk) {
    const fila = chk.closest('.wj-cargo');
    const n = [...fila.querySelectorAll('input[data-wj-rs]:checked')].length;
    const cant = fila.querySelector('[data-wjc-cant]');
    if (cant && cant.readOnly) cant.value = n;
    this._wjPreview();
  },
  _wjCargos() {
    return [...document.querySelectorAll('#wjCargos .wj-cargo')].map(f => {
      const sel = f.querySelector('[data-wjc-sel]');
      const opt = sel?.selectedOptions[0];
      if (!sel?.value) return null;
      const seriales = [...f.querySelectorAll('input[data-wj-rs]:checked')].map(i => i.value);
      return {
        cargo_id: sel.value,
        concepto: opt ? (opt.textContent || '').trim() : '',
        cantidad: Math.max(seriales.length ? seriales.length : 1,
          Math.round(Number(f.querySelector('[data-wjc-cant]')?.value)) || 1),
        monto: Math.max(0, Number(f.querySelector('[data-wjc-monto]')?.value || 0)),
        recurrente: f.querySelector('[data-wjc-tipo]')?.value === 'recurrente',
        por_equipo: opt?.dataset.poreq === '1',
        ...(seriales.length ? { seriales } : {}),
      };
    }).filter(c => c && c.monto > 0);
  },
  _wjPreview() {
    const cont = document.getElementById('wjTot');
    if (!cont) return;
    const t = this._totAumento([], this._wjCargos(), document.getElementById('wjItbms')?.checked !== false);
    const ajustes = this._wjAjustes();
    const delta = ajustes.reduce((s, a) => s + a.cantidad * (a.precio_nuevo - a.precio_anterior), 0);
    cont.innerHTML =
      (ajustes.length ? `<div style="display:flex; font-size:13px; padding:2px 0;">
        <span>Ajuste de tarifas (${ajustes.length} línea${ajustes.length === 1 ? '' : 's'})</span>
        <span class="num" style="margin-left:auto; ${delta >= 0 ? '' : 'color:var(--warn-deep, #92400E);'}">${delta >= 0 ? '+' : '−'}$${Math.abs(delta).toFixed(2)}/mes</span></div>` : '')
      + this._tarifarioHtml(t);
  },
  async crearAjuste() {
    const cid = document.getElementById('wjContrato')?.value || '';
    const contrato = this.contratos.find(c => c.id === cid);
    if (!contrato) { Toast.show('Elige el contrato destino', 'warn'); return; }
    // El catálogo decide el amarre: un cargo por_equipo (GPS) exige sus
    // radios marcados; los demás (consola) van al contrato sin serial.
    const cargosRaw = this._wjCargos();
    const sinRadios = cargosRaw.find(c => c.por_equipo && !(c.seriales || []).length);
    if (sinRadios) {
      Toast.show(`"${sinRadios.concepto}" aplica por equipo — marca los radios en su fila`, 'warn'); return;
    }
    const cargos = cargosRaw.map(({ por_equipo, ...c }) => c);
    const ajustes = this._wjAjustes();
    if (!cargos.length && !ajustes.length) {
      Toast.show('Agrega un cargo del catálogo o ajusta la tarifa de alguna línea', 'warn'); return;
    }
    const itbmsAplica = document.getElementById('wjItbms')?.checked !== false;
    const totales = this._totAumento([], cargos, itbmsAplica);
    try {
      const gid = await GestionesService.crear({ ...Centro._estampaReg(),
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
          lineas: [],
          cargos,
          itbms: { aplica: itbmsAplica, porcentaje: totales.itbms_porcentaje },
          totales,
          // El ajuste no crea tramo propio: hereda la vigencia del contrato
          // destino (2026-09-02 — el "? meses" venía de dejarla en null).
          duracion_meses: Number(contrato.duracion_meses)
            || Number(String(contrato.duracion || '').match(/\d+/)?.[0]) || null,
          seriales_asignados: [],
          es_ajuste: true,
          ...(ajustes.length ? { ajustes_precio: ajustes } : {}),
        },
      });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`Ajuste ${gid} enviado a aprobación — al firmarse el cliente, se aplica y cierra solo`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear el ajuste', 'bad'); }
  },

  /* ═════════ Wizard: nuevo contrato / renovación (Ola 7) ═════════ */

  // Contrato desde la ficha del cliente, sin pasar por el formulario clásico.
  // Escribe EXACTAMENTE el mismo doc (ContratoTarifario.construirDoc) con el
  // mismo correlativo y estado inicial, así que la aprobación, la solicitud de
  // seriales a bodega, el PDF y la activación por firmado corren igual.
  // opts: id de contrato (Renovar de la fila) · {renovarCuenta:true} (consolida
  // los que están en ventana; sin contratos = regularización vía legacy) · nada.
  // SERV (2026-09-01, decisión de Alberto): el contrato maestro de la cuenta
  // es de SERVICIO y puede MEZCLAR modalidades — la propiedad vive por línea
  // (modalidad) y por serial (pool/Anexo A). ALQ/PROP quedan como legacy: se
  // absorben al renovar. Los nuevos desde el Centro nacen SERV.
  TIPOS_CONTRATO: { SERV: 'Servicio', ALQ: 'Alquiler', PROP: 'Propio', DEMO: 'Demo', TEMP: 'Temporal' },

  // Líneas fijas del anexo de regularización a partir de los seriales
  // marcados (_aumRegulariza), fusionadas por modelo+modalidad. `precios`
  // conserva lo ya tecleado (clave modelo|modalidad) al re-pintar.
  _aumLineasFijasHtml(precios = {}) {
    const m = new Map();
    (this._aumRegulariza || []).forEach(u => {
      const k = (u.modelo_id || u.modelo) + '|' + (u.modalidad || 'alquiler');
      const g = m.get(k) || { modelo_id: u.modelo_id, modelo: u.modelo, modalidad: u.modalidad, cantidad: 0, precio: precios[k] ?? '' };
      g.cantidad++; m.set(k, g);
    });
    return [...m.values()].map(l => this._lineaModeloFija('wau', l)).join('');
  },
  // Los tres destinos posibles de un serial en el anexo de regularización.
  // 'pendiente' es el viejo "desmarcado": ni entra ni se suelta — sigue como
  // deuda de la cuenta, que a veces es lo honesto ("no sé si lo tiene").
  AUM_REG_DESTINOS: [
    ['entra', 'Lo tiene — entra al contrato'],
    ['no_tiene', 'El cliente NO lo tiene — sale de la cuenta'],
    ['pendiente', 'Dejarlo pendiente — sigue como deuda'],
  ],
  _aumRegSerialesHtml() {
    const filas = (this._aumRegularizaTodos || []).map((u, i) => {
      const d = this._aumRegDestino[u.serial] || 'entra';
      return `<tr>
        <td class="cg-mono">${this.esc(u.serial)}${u.nuevo ? ' <span style="color:var(--ok-deep, #065F46); font-size:11px;">agregado</span>' : ''}</td>
        <td style="font-size:12.5px;">${this.esc(u.modelo || '—')}${u.sinFicha ? ' <span style="color:var(--fg-4); font-size:11px;">sin ficha — se da de alta al aprobar</span>' : ''}</td>
        <td><select class="form-select" style="min-width:250px;" aria-label="Destino de ${this.esc(u.serial)}"
              onchange="Centro._aumRegDestinoSet('${this.esc(u.serial)}', this.value)">
          ${this.AUM_REG_DESTINOS.map(([v, l]) => `<option value="${v}" ${v === d ? 'selected' : ''}>${l}</option>`).join('')}
        </select></td>
        <td>${u.nuevo ? `<button type="button" class="btn btn-ghost" style="padding:2px 8px;" title="Quitar de la lista"
              onclick="Centro._aumRegQuitarAgregado(${i})">✕</button>` : ''}</td></tr>`;
    }).join('');
    return `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
      <th>Serial</th><th>Modelo</th><th>¿Lo tiene el cliente?</th><th></th></tr></thead>
      <tbody>${filas || '<tr><td colspan="4" class="cg-empty">Ningún serial declarado todavía.</td></tr>'}</tbody></table></div>`;
  },
  // Re-pinta seriales y líneas fijas conservando los precios tecleados.
  _aumRegRepintar() {
    const precios = {};
    for (const l of this._lineasModelo('wau')) precios[(l.modelo_id || l.modelo) + '|' + (l.modalidad || 'alquiler')] = l.precio || '';
    this._aumRegulariza = (this._aumRegularizaTodos || []).filter(u => (this._aumRegDestino[u.serial] || 'entra') === 'entra');
    const ser = document.getElementById('waRegSeriales');
    if (ser) ser.innerHTML = this._aumRegSerialesHtml();
    const cont = document.getElementById('waLineas');
    if (cont) cont.innerHTML = this._aumLineasFijasHtml(precios);
    const n = document.getElementById('waRegN');
    if (n) n.textContent = String(this._aumRegulariza.length);
    this._aumPreview();
  },
  _aumRegDestinoSet(serial, valor) {
    if (!this._aumRegularizaTodos) return;
    this._aumRegDestino[serial] = valor;
    this._aumRegRepintar();
  },
  _aumRegNoTiene() {
    return (this._aumRegularizaTodos || []).filter(u => this._aumRegDestino[u.serial] === 'no_tiene');
  },
  _aumRegQuitarAgregado(i) {
    const u = (this._aumRegularizaTodos || [])[i];
    if (!u || !u.nuevo) return;
    this._aumRegularizaTodos.splice(i, 1);
    delete this._aumRegDestino[u.serial];
    this._aumRegRepintar();
  },
  // Agrega al anexo un serial que el cliente tiene y la lista no trae. Si el
  // sistema no lo conoce, nace con el anexo (por eso el modelo es obligatorio
  // ahí); si ya tiene ficha con contrato, no se toca desde aquí.
  async _aumRegAgregarSerial() {
    if (!this._aumRegularizaTodos) return;
    const inp = document.getElementById('waRegSerialNuevo');
    const raw = (inp?.value || '').trim();
    if (!raw) return;
    const norm = EquiposPoolService.normalizarSerial(raw);
    if (!EquiposPoolService.esSerialValido(norm)) { Toast.show('Ese serial no parece válido', 'warn'); return; }
    if (this._aumRegularizaTodos.some(u => EquiposPoolService.normalizarSerial(u.serial) === norm)) {
      Toast.show(`${norm} ya está en la lista`, 'warn'); return;
    }
    let ficha = null;
    try { ficha = await EquiposPoolService.findBySerial(raw); } catch (_) { /* sin red: se agrega sin ficha */ }
    if (ficha?.estado === 'baja') { Toast.show(`${norm} está dado de BAJA — no se puede reactivar desde aquí`, 'bad'); return; }
    if (ficha?.asignacion?.contrato_doc_id) {
      Toast.show(`${norm} ya está amarrado al contrato ${ficha.asignacion.contrato_id || ''} — no hace falta regularizarlo`, 'warn');
      return;
    }
    const mSel = this._modeloDeSelect(document.getElementById('waRegModeloNuevo'));
    if (!ficha && !mSel) { Toast.show('Ese serial no está en el sistema: elige su modelo para darlo de alta', 'warn'); return; }
    const modelo = ficha ? { id: ficha.modelo_id || mSel?.id || null, label: ficha.modelo_label || mSel?.label || '' } : mSel;
    this._aumRegularizaTodos.push({
      pool_doc_id: ficha ? ficha.id : null,
      serial: ficha ? (ficha.serial || raw) : raw,
      serial_norm: norm,
      modelo_id: modelo.id || null, modelo: modelo.label || '',
      // La modalidad la manda la LÍNEA: se arranca con lo que diga la ficha
      // (si la hay) y el vendedor la corrige arriba si está mal.
      modalidad: ficha?.propiedad === 'cliente' ? 'propio' : 'alquiler',
      nuevo: true, sinFicha: !ficha,
    });
    this._aumRegDestino[ficha ? (ficha.serial || raw) : raw] = 'entra';
    if (inp) inp.value = '';
    this._aumRegRepintar();
    inp?.focus();
  },

  // Línea FIJA (anexo de regularización): el modelo y la cantidad salen de los
  // seriales y no se editan. El precio y la MODALIDAD sí: la modalidad venía
  // de `propiedad` de la ficha y estaba bloqueada, así que una marca falsa de
  // la migración ("del cliente") se colaba al anexo sin que el vendedor
  // pudiera corregirla — justo el caso FORTUNATO MANGRAVITA (2026-09-09).
  // Quien declara de quién es el equipo es la línea, no la ficha.
  _lineaModeloFija(pref, l) {
    const k = (l?.modelo_id || l?.modelo || '') + '|' + (l?.modalidad === 'propio' ? 'propio' : 'alquiler');
    return `<div style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
      ${this._selModelo(`data-${pref}-modelo disabled style="flex:1;"`, l?.modelo_id, l?.modelo)}
      <input class="form-input" data-${pref}-cant type="number" readonly value="${Math.max(1, Number(l?.cantidad || 1))}" style="width:86px; background:var(--surface-sunken, #EEF2F6);" title="Cantidad — fija por los seriales">
      <input class="form-input" data-${pref}-precio type="number" min="0" step="1" placeholder="$/mes" value="${l?.precio != null && l.precio !== '' ? Number(l.precio).toFixed(2) : ''}" style="width:110px;" title="Precio mensual">
      ${this._selModalidad(pref, l?.modalidad === 'propio' ? 'propio' : 'alquiler',
        `onchange="Centro._aumRegModalidad('${this.esc(k)}', this.value)"`)}
    </div>`;
  },

  // Cambiar "de quién es" una línea del anexo de regularización: la modalidad
  // baja a los seriales de esa línea (y a la lista completa, para que marcar y
  // desmarcar no la revierta) y las líneas se re-pintan conservando el precio.
  _aumRegModalidad(k, valor) {
    if (!this._aumRegulariza || (valor !== 'propio' && valor !== 'alquiler')) return;
    const clave = (u) => (u.modelo_id || u.modelo || '') + '|' + (u.modalidad === 'propio' ? 'propio' : 'alquiler');
    const precios = {};
    for (const l of this._lineasModelo('wau')) precios[(l.modelo_id || l.modelo) + '|' + (l.modalidad || 'alquiler')] = l.precio || '';
    const base = k.split('|')[0];
    precios[base + '|' + valor] = precios[k] ?? precios[base + '|' + valor] ?? '';
    for (const lista of [this._aumRegulariza, this._aumRegularizaTodos || []]) {
      lista.forEach(u => { if (clave(u) === k) u.modalidad = valor; });
    }
    const cont = document.getElementById('waLineas');
    if (cont) cont.innerHTML = this._aumLineasFijasHtml(precios);
    this._aumPreview();
  },

  _lineaModeloPre(pref, conPrecio, l) {
    return `<div style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
      ${this._selModelo(`data-${pref}-modelo style="flex:1;"`, l?.modelo_id, l?.modelo)}
      <input class="form-input" data-${pref}-cant type="number" min="1" value="${Math.max(1, Number(l?.cantidad || 1))}" style="width:86px;" title="Cantidad">
      ${conPrecio ? `<input class="form-input" data-${pref}-precio type="number" min="0" step="1" placeholder="$/mes" value="${l?.precio != null && l.precio !== '' ? Number(l.precio).toFixed(2) : ''}" style="width:110px;" title="Precio mensual">
      ${this._selModalidad(pref, l?.modalidad)}` : ''}
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
      // La modalidad separa la fusión: alquiler y equipo-del-cliente del
      // mismo modelo son líneas DISTINTAS (tarifas distintas) en SERV mixto.
      // Sin modalidad (legacy) se fusiona aparte y llega al wizard sin elegir.
      const mod = l.modalidad === 'propio' ? 'propio' : l.modalidad === 'alquiler' ? 'alquiler' : null;
      const k = (l.modelo_id || norm(l.modelo)) + '|' + (mod || '?');
      if (!l.modelo_id && !norm(l.modelo)) continue;
      const cur = out.get(k);
      if (!cur) out.set(k, { modelo_id: l.modelo_id || null, modelo: l.modelo || '', modalidad: mod,
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
    // Con una renovación en curso no se abre otra: se lleva al trámite.
    if (opts.renovarCuenta || opts.renovarDe) {
      const tram = this._renovacionEnTramite();
      if (tram) {
        Toast.show(`Ya hay una renovación en trámite (${tram.contrato_id || ''}) — te llevo al expediente`, 'warn');
        this.abrirGestion('ct-' + tram.id);
        return;
      }
    }
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
    // Contrato TEMPORAL (evento) desde el menú (2026-09-07): entra con el tipo
    // fijo en TEMP, sin origen ni plan — es independiente de la cuenta.
    const esTemp = !esRenov && !!opts.temporal;
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
      (c.equipos || []).forEach(l => lineas.push({ modelo_id: l.modelo_id, modelo: l.modelo,
        cantidad: l.cantidad, precio: l.precio,
        // Un origen PROP entero era "equipo del cliente" y uno ALQ, alquiler;
        // SERV lo trae por línea — y si no lo trae (legacy), queda SIN
        // modalidad para que el vendedor la declare (no se asume alquiler).
        modalidad: l.modalidad || (this._codigoTipo(c) === 'PROP' ? 'propio' : this._codigoTipo(c) === 'ALQ' ? 'alquiler' : null) }));
    }
    if (opts.renovarCuenta && custodia.length) {
      const porModelo = new Map();
      custodia.forEach(e => {
        // Propiedad desconocida → sin modalidad: la declara el vendedor.
        const mod = e.propiedad === 'cliente' ? 'propio' : (e.propiedad && e.propiedad !== 'desconocida') ? 'alquiler' : null;
        const k = (e.modelo_id || (e.modelo_label || '?')) + '|' + (mod || '?');
        const cur = porModelo.get(k) || { modelo_id: e.modelo_id || null, modelo: e.modelo_label || '', modalidad: mod, cantidad: 0, precio: '' };
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
      // Cuenta SIN contratos (legacyAuto): esto ES un contrato nuevo que
      // regulariza la custodia — llamarlo "renovar" confundía (2026-09-01).
      titulo: `${legacyAuto ? 'Nuevo contrato (regulariza la cuenta)'
        : opts.renovarCuenta ? 'Renovar cuenta (consolidación)'
        : esRenov ? 'Renovación' : esTemp ? 'Contrato temporal (evento)' : 'Nuevo contrato'} — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 14px; font-size:13px; color:var(--fg-3); max-width:72ch;">
        El contrato nace <b>pendiente de aprobación</b> con el mismo flujo de siempre (aprobación →
        seriales de bodega → firma → activo).
        ${opts.renovarCuenta && preIds.length > 1 ? `Esta renovación <b>consolida los ${preIds.length} contratos
        marcados en UNO solo</b>: al activarse quedan marcados como renovados y pasan al histórico de la ficha.` : ''}
        ${legacyAuto && custodia.length ? `La cuenta no tiene contratos vigentes pero
        <b>${custodia.length} equipo(s) siguen con el cliente</b> — este contrato nuevo los cubre
        y se amarran solos al activarse.` : ''}
        ${!legacyAuto && custodia.length ? `<b>${custodia.length} equipo(s) en campo sin
        contrato formal</b> — al renovar, la cuenta los cubre.` : ''}
        ${opts.agregar ? `<b>La última línea de equipos está en blanco para la venta nueva</b> — elige el modelo,
        cantidad y precio; bodega asignará los seriales solo de los equipos nuevos.` : ''}</p>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Datos del contrato <span class="hint">tipo · duración</span></div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end;">
          <div class="form-field" style="margin:0; max-width:170px;">
            <label class="form-label" for="wcTipo">Tipo</label>
            <select class="form-select" id="wcTipo" onchange="Centro._wcSyncTipo()">
              ${(esTemp ? ['TEMP'] : esRenov ? ['SERV'] : ['SERV', 'TEMP'])
                .map(k => `<option value="${k}" ${k === (esTemp ? 'TEMP' : 'SERV') ? 'selected' : ''}>${this.TIPOS_CONTRATO[k]}</option>`).join('')}
            </select></div>
          <div class="form-field" style="margin:0; max-width:210px;">
            <label class="form-label" for="wcMeses">Duración</label>
            <div style="display:flex; gap:6px;">
              <input class="form-input" type="number" id="wcMeses" min="1" value="${esTemp ? 7 : 18}" style="width:90px;">
              <!-- Días solo para TEMP (eventos cortos, caso FANLYC 2026-09-02:
                   "del 3 al 6 de septiembre" forzado a meses). _wcSyncTipo lo
                   muestra/oculta. -->
              <select class="form-select" id="wcDurUnidad" style="width:100px; ${esTemp ? '' : 'display:none;'}">
                <option value="meses" ${esTemp ? '' : 'selected'}>meses</option>
                <option value="dias" ${esTemp ? 'selected' : ''}>días</option>
              </select>
              <span id="wcDurMesesLbl" style="align-self:center; font-size:13px; color:var(--fg-3); ${esTemp ? 'display:none;' : ''}">meses</span>
            </div></div>
          <p style="margin:0 0 7px; font-size:12.5px; color:var(--fg-3);">
            ${legacyAuto ? 'Regulariza la cuenta: los equipos en campo se amarran a este contrato al activarse.'
              : esRenov ? 'Renovación de la cuenta — los orígenes marcados pasan al histórico al activarse.'
              : esTemp ? 'Contrato temporal por evento: termina con la devolución de los equipos — no renueva ni toca los demás contratos de la cuenta.'
              : 'Contrato nuevo.'}</p>
        </div>
        <!-- La acción NO se pregunta (2026-09-01, "el menú decide"): la fija
             el punto de entrada. Select oculto porque crearContrato y los
             triggers (onRenovacionActivada exige 'Renovación' para amarrar la
             custodia) leen de aquí; DEMO/TEMP mapean a 'No Aplica' en
             _wcSyncTipo, igual que siempre. Los DEMO van por su wizard. -->
        <select id="wcAccion" class="hidden" aria-hidden="true">
          <option value="Nuevo" ${!esRenov ? 'selected' : ''}>Nuevo</option>
          <option value="Renovación" ${esRenov ? 'selected' : ''}>Renovación</option>
          <option value="No Aplica">No Aplica</option>
        </select>
        <!-- "Sin equipo" y "refurbished" ya NO se preguntan (Alberto
             2026-09-04): se derivan del plan por serial del paso 2
             (TransicionPlan.derivarModalidad) y se muestran aquí. -->
        <div id="wcRenovBloque" class="${esRenov ? '' : 'hidden'}" style="margin-top:8px;">
          <div id="wcModalidad" style="font-size:12.5px; color:var(--fg-3);">La modalidad (sin equipo / con reemplazos / refurbished) sale de lo que declares por serial en el paso 2.</div>
        </div>
      </div>

      <div id="wcOrigenBloque" class="cg-paso ${esRenov ? '' : 'hidden'}">
        <div class="cg-paso-t"><span class="n">2</span> ${legacyAuto ? 'Origen de la cuenta' : 'Contratos que se renuevan'}
          <span class="hint">${legacyAuto ? 'sin contratos vigentes en el sistema — queda registrado contra la referencia' : opts.renovarCuenta ? 'preseleccionados — la consolidación los absorbe todos' : 'el origen define qué equipos transicionan'}</span></div>
        <div class="form-field" style="margin-bottom:10px;">
          ${origenChks || (legacyAuto ? '' : '<p style="font-size:13px; color:var(--fg-3); margin:0;">El cliente no tiene contratos vigentes en el sistema.</p>')}
          <label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:6px 0 0;">
            <input type="checkbox" id="wcLegacy" ${legacyAuto ? 'checked' : ''} onchange="Centro._wcSyncPlan()" style="width:auto; margin:0;">
            El contrato original es de papel / no está en el sistema</label>
          <input class="form-input" id="wcLegacyRef" placeholder="Referencia del contrato en papel…" aria-label="Referencia del contrato en papel"
            value="${legacyAuto ? 'Cuenta sin contrato en sistema — regularización' : ''}"
            style="margin-top:6px; max-width:420px; ${legacyAuto ? '' : 'display:none;'}">
        </div>
        <div class="form-field" style="margin-bottom:4px;">
          <label class="form-label">Seriales de la cuenta — qué pasa con cada equipo</label>
          <p style="margin:0 0 8px; font-size:12.5px; color:var(--fg-3); max-width:72ch;">
            Todo lo que el sistema cree que el cliente tiene, con su destino. Marca <b>“El cliente no lo
            tiene”</b> en lo que no está con él (queda por clasificar y sale de la cuenta) y <b>agrega</b> los
            seriales que sí tiene y no aparecen. Los que <b>continúan</b> entran al Anexo A que el cliente firma.</p>
          <div id="wcPlan" class="cg-twrap"></div>
        </div>
      </div>

      <div oninput="Centro._wcPreview(); Centro._wcConciliar()">
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

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">5</span> Representante legal</div>
        ${this._wcRepHtml()}
      </div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="wcGuardar" onclick="Centro.crearContrato()">Guardar contrato</button>`,
    });
    document.getElementById('wcLegacy')?.addEventListener('change', (e) => {
      const ref = document.getElementById('wcLegacyRef');
      if (ref) ref.style.display = e.target.checked ? '' : 'none';
    });
    this._wcRepMontar();
    this._wcPlanState = { destinos: {}, reemplazos: {}, refurb: {}, agregados: [] };
    // Precarga (plan 2026-09-08 §5): al regularizar/renovar la cuenta, los
    // radios en campo SIN contrato (D1) entran como "Continúa" — es lo que la
    // deuda dice que el cliente tiene. El vendedor los corrige si no es así;
    // los del contrato de origen siguen pidiendo destino explícito.
    if (opts.renovarCuenta) {
      for (const { u, fuente } of this._wcUnidadesCuenta(preIds)) {
        if (fuente === 'custodia') this._wcPlanState.destinos[u.id] = 'continua';
      }
    }
    this._wcSoloPlan = false;
    // TEMP fijo: la acción pasa a 'No Aplica' y se esconde el bloque de origen
    // (lo mismo que hace el select al cambiar a mano).
    if (esTemp) this._wcSyncTipo();
    this._wcSyncPlan();
    this._wcPreview();
  },

  _wcSyncTipo() {
    const tipo = document.getElementById('wcTipo')?.value || 'SERV';
    const acc = document.getElementById('wcAccion');
    if (!acc) return;
    if (tipo === 'DEMO' || tipo === 'TEMP') { acc.value = 'No Aplica'; acc.disabled = true; }
    else {
      acc.disabled = false;
      if (acc.value === 'No Aplica') acc.value = 'Nuevo';
    }
    // TEMP (evento) puede durar DÍAS: aparece el selector de unidad, con
    // días por defecto y un valor corto razonable; al volver a SERV, meses.
    const uni = document.getElementById('wcDurUnidad');
    const lbl = document.getElementById('wcDurMesesLbl');
    const num = document.getElementById('wcMeses');
    if (uni && lbl && num) {
      if (tipo === 'TEMP') {
        uni.style.display = ''; lbl.style.display = 'none';
        if (uni.value === 'meses' && Number(num.value) >= 12) { uni.value = 'dias'; num.value = 7; }
      } else {
        uni.style.display = 'none'; lbl.style.display = '';
        uni.value = 'meses';
        if (Number(num.value) < 12 && Number(num.value) <= 31) num.value = 18;
      }
    }
    const sel = { accion: acc.value, codigo_tipo: tipo };
    document.getElementById('wcOrigenBloque')?.classList.toggle('hidden', !OrigenContrato.aplica(sel));
    document.getElementById('wcRenovBloque')?.classList.toggle('hidden', acc.value !== 'Renovación');
    this._wcSyncPlan();
  },

  _wcOrigenIds() {
    return [...document.querySelectorAll('input[data-wco]:checked')].map(i => i.value);
  },

  /* ═════════ Plan de seriales de la renovación (2026-09-04) ═════════
   * Reclamo de Alberto (caso CENTRO CULTURAL CHINO PANAMEÑO): la renovación
   * no aclaraba QUÉ seriales siguen con el cliente. La tabla solo listaba las
   * fichas colgadas de un contrato de origen del sistema — y los contratos
   * viejos (legacy) no tienen seriales, así que salía vacía mientras el pool
   * tenía 22 fichas amarradas al cliente por la migración POC, sin verificar.
   *
   * Ahora la tabla es LA CUENTA COMPLETA: todo lo que el pool dice que el
   * cliente tiene (contrato de origen, custodia sin contrato, migración sin
   * verificar), con destino por serial — continúa / se devuelve / se
   * reemplaza / el cliente NO lo tiene — más los seriales que el vendedor
   * AGREGA porque el cliente sí los tiene y el sistema no lo sabía. Al
   * aprobarse, functions/src/lib/planRenovacion.js lo aplica: los
   * 'continúa' entran como filas del contrato (→ Anexo A), los 'no lo
   * tiene' se sueltan del cliente (→ por clasificar). */

  // Unidades del pool que el sistema le atribuye al cliente. `fuente` dice
  // de dónde viene la atribución (rastro para el aprobador y el kardex).
  _wcUnidadesCuenta(origenIds) {
    const ids = origenIds || [];
    return this.equipos
      .filter(e => ['en_cliente', 'asignado_contrato', 'por_clasificar'].includes(e.estado))
      .map(e => {
        const cid = e.asignacion?.contrato_doc_id || null;
        const fuente = e.estado === 'por_clasificar' || e.verificado === false && e.origen === 'migracion_poc' && !cid
          ? 'migracion' : cid ? 'origen' : 'custodia';
        return { u: e, fuente, deOrigen: !!cid && ids.includes(cid) };
      })
      // Primero las del origen que se renueva, luego custodia, luego migración.
      .sort((a, b) => (['origen', 'custodia', 'migracion'].indexOf(a.fuente) - ['origen', 'custodia', 'migracion'].indexOf(b.fuente))
        || String(a.u.serial || a.u.id).localeCompare(String(b.u.serial || b.u.id)));
  },

  _wcFuenteHtml(fuente, u) {
    if (fuente === 'origen') return `<span class="cg-mono">${this.esc(u.asignacion?.contrato_id || 'contrato')}</span>`;
    if (fuente === 'custodia') return '<span style="color:var(--fg-3);">en campo · sin contrato</span>';
    if (fuente === 'agregado') return '<span style="color:var(--ok-deep, #065F46);">agregado por ti</span>';
    return '<span style="color:var(--warn-deep, #92400E);" title="La ficha llegó de la migración POC y nadie la verificó con el cliente">migración · sin verificar</span>';
  },

  // Celda de destino de un serial: el destino es OBLIGATORIO (arranca en
  // "— elige —"; Alberto 2026-09-04: "este paso tiene que ser obligatorio
  // para el vendedor"). 'Se reemplaza' siempre está y pregunta POR QUÉ: uno
  // nuevo del mismo modelo o de OTRO modelo del catálogo. 'Continúa' ofrece
  // el check de refurbished por serial.
  _wcDestinoCelda(id, st = {}) {
    const opts = [['', '— elige —'], ['continua', 'Continúa'], ['reemplaza', 'Se reemplaza'], ['devuelve', 'Se devuelve'], ['no_tiene', 'El cliente no lo tiene']];
    const d = opts.some(o => o[0] === st.destino) ? st.destino : '';
    const modelos = (this.modelos || []).map(m => `<option value="${this.esc(m.id)}" ${st.reemplazo === m.id ? 'selected' : ''}>${this.esc(m.label)}</option>`).join('');
    return `<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
      <select class="form-select" data-wcp="${this.esc(id)}" onchange="Centro._wcDestinoChange(this)" style="min-width:170px; ${d ? '' : 'border-color:var(--warn, #F59E0B);'}">
        ${opts.map(([v, l]) => `<option value="${v}" ${v === d ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="form-select" data-wcpr="${this.esc(id)}" onchange="Centro._wcConciliar()" title="Por qué se reemplaza" style="min-width:190px; ${d === 'reemplaza' ? '' : 'display:none;'}">
        <option value="">por uno nuevo del mismo modelo</option>${modelos}</select>
      <label class="cg-toggle" data-wcpf-wrap="${this.esc(id)}" style="font-size:12px; padding:3px 8px; ${d === 'continua' ? '' : 'display:none;'}" title="Refurbished de batería, antena, clip y piezas para este radio">
        <input type="checkbox" data-wcpf="${this.esc(id)}" ${st.refurbished ? 'checked' : ''} onchange="Centro._wcConciliar()"> refurbished</label>
    </div>`;
  },
  // Los ids del pool son alfanuméricos (serial normalizado); el escape es
  // solo por si un doc sufijado (colisión __modelo) o un jsdom sin CSS.escape.
  _cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); },
  _wcDestinoChange(sel) {
    const id = sel.dataset.wcp;
    const q = (attr) => document.querySelector(`[${attr}="${this._cssEsc(id)}"]`);
    const r = q('data-wcpr'); if (r) r.style.display = sel.value === 'reemplaza' ? '' : 'none';
    const f = q('data-wcpf-wrap'); if (f) f.style.display = sel.value === 'continua' ? '' : 'none';
    sel.style.borderColor = sel.value ? '' : 'var(--warn, #F59E0B)';
    this._wcConciliar();
  },

  // Estado vivo del plan mientras el wizard está abierto: destino, modelo de
  // reemplazo y refurbished por pool_id (sobreviven a re-pintados) y seriales
  // agregados a mano.
  _wcPlanState: { destinos: {}, reemplazos: {}, refurb: {}, agregados: [] },
  _wcCapturarEstado() {
    const S = this._wcPlanState;
    document.querySelectorAll('select[data-wcp]').forEach(s => { S.destinos[s.dataset.wcp] = s.value; });
    document.querySelectorAll('select[data-wcpr]').forEach(s => { S.reemplazos[s.dataset.wcpr] = s.value; });
    document.querySelectorAll('input[data-wcpf]').forEach(i => { S.refurb[i.dataset.wcpf] = i.checked; });
    document.querySelectorAll('input[data-wcpaf]').forEach(i => { const a = S.agregados[Number(i.dataset.wcpaf)]; if (a) a.refurbished = i.checked; });
  },

  _wcSyncPlan() {
    const cont = document.getElementById('wcPlan');
    if (!cont) return;
    const sel = { accion: document.getElementById('wcAccion')?.value, codigo_tipo: document.getElementById('wcTipo')?.value };
    if (!TransicionPlan.aplica(sel)) { cont.innerHTML = ''; return; }
    // Recoge lo elegido antes de re-pintar (cambio de origen, de modalidad…).
    this._wcCapturarEstado();
    const S = this._wcPlanState;
    const ids = this._wcOrigenIds();
    const unidades = this._wcUnidadesCuenta(ids);
    const agregados = S.agregados;
    const filas = [
      ...unidades.map(({ u, fuente }) => `<tr>
        <td class="cg-mono">${this.esc(u.serial || u.id)}</td>
        <td>${this.esc(u.modelo_label || '—')}${u.propiedad === 'cliente' ? ' <span style="color:var(--fg-4); font-size:11px;">del cliente</span>' : ''}</td>
        <td style="font-size:12.5px;">${this._wcFuenteHtml(fuente, u)}</td>
        <td>${this._wcDestinoCelda(u.id, { destino: S.destinos[u.id] || '', reemplazo: S.reemplazos[u.id] || '', refurbished: !!S.refurb[u.id] })}</td></tr>`),
      ...agregados.map((a, i) => `<tr>
        <td class="cg-mono">${this.esc(a.serial)}</td>
        <td>${a.pool ? this.esc(a.modelo || '—') : this._selModelo(`data-wcpa-modelo="${i}" onchange="Centro._wcConciliar()" style="min-width:180px;"`, a.modelo_id, a.modelo)}
          ${a.aviso ? `<div style="font-size:11.5px; color:var(--warn-deep, #92400E);">${this.esc(a.aviso)}</div>` : ''}</td>
        <td style="font-size:12.5px;">${this._wcFuenteHtml('agregado', a)}</td>
        <td style="white-space:nowrap;"><span style="font-size:12.5px;">Continúa</span>
          <label class="cg-toggle" style="font-size:12px; padding:3px 8px; margin-left:6px;" title="Refurbished de batería, antena, clip y piezas para este radio">
            <input type="checkbox" data-wcpaf="${i}" ${a.refurbished ? 'checked' : ''} onchange="Centro._wcConciliar()"> refurbished</label>
          <button type="button" class="btn btn-ghost" style="padding:2px 8px; margin-left:6px;" title="Quitar"
            onclick="Centro._wcQuitarAgregado(${i})">✕</button></td></tr>`),
    ];
    const vacio = !filas.length;
    cont.innerHTML = `
      ${vacio ? `<p style="font-size:12.5px; color:var(--fg-3); margin:0 0 8px;">El sistema no le atribuye ningún serial a este cliente. Agrega abajo los que tiene, o confirma que la cuenta no tiene equipos con serial.</p>
          <label class="cg-toggle" style="margin-bottom:8px;"><input type="checkbox" id="wcSinSeriales" ${S.sinSeriales ? 'checked' : ''} onchange="Centro._wcPlanState.sinSeriales=this.checked; Centro._wcConciliar()"> Confirmo que el cliente no tiene equipos con serial que declarar</label>`
        : `<table class="cg-tabla"><thead><tr>
            <th>Serial</th><th>Modelo</th><th>Según el sistema</th><th>Destino <span style="font-weight:400; text-transform:none; letter-spacing:0;">(obligatorio en cada serial)</span></th></tr></thead>
          <tbody>${filas.join('')}</tbody></table>`}
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px;">
        <input class="form-input" id="wcSerialNuevo" placeholder="Serial que el cliente tiene y no aparece…" style="max-width:280px;"
          aria-label="Serial a agregar" onkeydown="if(event.key==='Enter'){event.preventDefault();Centro._wcAgregarSerial();}">
        <button type="button" class="btn btn-ghost cg-act" onclick="Centro._wcAgregarSerial()">+ Agregar serial</button>
        ${unidades.length ? `<span style="flex:1;"></span>
          <button type="button" class="btn btn-ghost cg-act" onclick="Centro._wcMarcarTodos('continua')">Todos continúan</button>
          <button type="button" class="btn btn-ghost cg-act" onclick="Centro._wcMarcarTodos('no_tiene')">Ninguno lo tiene</button>` : ''}
      </div>
      <div id="wcPlanConc" style="margin-top:8px;"></div>`;
    this._wcConciliar();
  },

  _wcMarcarTodos(destino) {
    document.querySelectorAll('select[data-wcp]').forEach(s => {
      if ([...s.options].some(o => o.value === destino)) { s.value = destino; this._wcDestinoChange(s); }
    });
    this._wcConciliar();
  },

  _wcQuitarAgregado(i) {
    this._wcPlanState.agregados.splice(i, 1);
    this._wcSyncPlan();
  },

  // Agrega un serial que el cliente tiene y el sistema no le atribuye. Se
  // busca en el pool: si existe, se toma su modelo y se AVISA dónde dice el
  // sistema que está (otro cliente, bodega, taller…) — se permite igual,
  // porque regularizar es justamente corregir eso, pero el aprobador lo ve.
  async _wcAgregarSerial() {
    const inp = document.getElementById('wcSerialNuevo');
    const raw = (inp?.value || '').trim();
    if (!raw) return;
    const norm = EquiposPoolService.normalizarSerial(raw);
    if (!EquiposPoolService.esSerialValido(norm)) { Toast.show('Ese serial no parece válido', 'warn'); return; }
    const ya = this._wcPlanState.agregados.some(a => a.serial_norm === norm)
      || this.equipos.some(e => e.id === norm || EquiposPoolService.normalizarSerial(e.serial) === norm);
    if (ya) { Toast.show(`${norm} ya está en la lista`, 'warn'); return; }
    let ficha = null;
    try { ficha = await EquiposPoolService.findBySerial(raw); } catch (_) { /* sin red: se agrega sin ficha */ }
    const L = EquiposPoolService.ESTADO_LABELS || {};
    let aviso = '';
    if (ficha) {
      const otro = ficha.asignacion?.cliente_id && ficha.asignacion.cliente_id !== this.cliente.id
        ? ` · asignado a ${ficha.asignacion.cliente_nombre || 'otro cliente'}${ficha.asignacion.contrato_id ? ` (${ficha.asignacion.contrato_id})` : ''}` : '';
      aviso = `Según el sistema: ${L[ficha.estado] || ficha.estado || '—'}${otro}`;
      if (ficha.estado === 'baja') { Toast.show(`${norm} está dado de BAJA — no se puede reactivar desde aquí`, 'bad'); return; }
    } else {
      aviso = 'Sin ficha en el pool: nace con este contrato — elige el modelo';
    }
    this._wcPlanState.agregados.push({
      serial: ficha ? (ficha.serial || raw) : raw, serial_norm: norm, pool: !!ficha, pool_id: ficha ? ficha.id : null,
      modelo_id: ficha?.modelo_id || null, modelo: ficha?.modelo_label || '',
      propiedad: ficha?.propiedad || null, aviso,
    });
    this._wcSyncPlan();
    document.getElementById('wcSerialNuevo')?.focus();
  },

  // Lee el plan tal como está en pantalla (o null si no aplica / vacío).
  _wcLeerPlan(origenIds) {
    const unidades = [...document.querySelectorAll('select[data-wcp]')].map(s => {
      const e = this.equipos.find(x => x.id === s.dataset.wcp);
      if (!e) return null;
      const cid = e.asignacion?.contrato_doc_id || null;
      const fuente = e.estado === 'por_clasificar' ? 'migracion' : cid ? 'origen' : 'custodia';
      const idSel = this._cssEsc(e.id);
      const rSel = document.querySelector(`select[data-wcpr="${idSel}"]`);
      const rm = s.value === 'reemplaza' && rSel?.value ? this._modeloDeSelect(rSel) : null;
      const refurbished = s.value === 'continua' && !!document.querySelector(`input[data-wcpf="${idSel}"]`)?.checked;
      return { pool_id: e.id, serial: e.serial || e.id, serial_norm: e.id,
        modelo_id: e.modelo_id || null, modelo: e.modelo_label || '', destino: s.value, fuente,
        modalidad: e.propiedad === 'cliente' ? 'propio' : 'alquiler',
        ...(rm ? { reemplazo_modelo_id: rm.id, reemplazo_modelo: rm.label } : {}),
        ...(refurbished ? { refurbished: true } : {}) };
    }).filter(Boolean);
    // Destino obligatorio: se cuenta lo que falta y esas filas NO entran al
    // plan (construirSerial las convertiría en 'devuelve' por defecto).
    this._wcSinDestino = unidades.filter(u => !u.destino).length;
    const conDestino = unidades.filter(u => u.destino);
    this._wcPlanState.agregados.forEach((a, i) => {
      let modelo_id = a.modelo_id, modelo = a.modelo;
      if (!a.pool) {
        const m = this._modeloDeSelect(document.querySelector(`select[data-wcpa-modelo="${i}"]`));
        modelo_id = m?.id || null; modelo = m?.label || '';
      }
      const refurbished = !!document.querySelector(`input[data-wcpaf="${i}"]`)?.checked;
      conDestino.push({ pool_id: a.pool_id, serial: a.serial, serial_norm: a.serial_norm, modelo_id, modelo,
        destino: 'continua', fuente: 'agregado', modalidad: a.propiedad === 'cliente' ? 'propio' : 'alquiler',
        ...(refurbished ? { refurbished: true } : {}) });
    });
    if (!conDestino.length) return null;
    return TransicionPlan.construirSerial(conDestino, origenIds || []);
  },

  // Aviso vivo: por línea, cuántos continúan + cuántos entran por reemplazo
  // vs. la cantidad de la línea. La línea tiene que cubrir al menos esos
  // (si no, la cuenta no cuadra — "Cuadrar" la iguala); lo que sobre son
  // radios NUEVOS (venta dentro de la renovación). De ahí se DERIVA la
  // modalidad: sin equipo / con reemplazos / con radios nuevos / refurbished.
  _wcConciliar() {
    const box = document.getElementById('wcPlanConc');
    if (!box) return { ok: true, sinDestino: 0 };
    const plan = this._wcLeerPlan(this._wcOrigenIds());
    const sinDestino = this._wcSinDestino || 0;
    const modBox = document.getElementById('wcModalidad');
    if (!plan) {
      box.innerHTML = sinDestino ? `<div style="color:var(--warn-deep, #92400E); font-size:12.5px;">Elige el destino de los ${sinDestino} serial(es).</div>` : '';
      if (modBox) modBox.textContent = 'La modalidad (sin equipo / con reemplazos / refurbished) sale de lo que declares por serial en el paso 2.';
      return { ok: !sinDestino, sinDestino, plan: null, sinLinea: [], faltaModelo: false, desajuste: false, modalidad: null, otraModalidad: [] };
    }
    const lineas = this._lineasModelo('wcm');
    const r = TransicionPlan.conciliarLineas(plan, lineas);
    const partes = [];
    let desajuste = false;
    r.porLinea.forEach(({ idx, continuan, reemplazan }) => {
      const l = lineas[idx];
      const cant = Number(l.cantidad || 0);
      const min = continuan + reemplazan;
      const ok = cant >= min;
      if (!ok) desajuste = true;
      const nuevos = Math.max(0, cant - min);
      partes.push(`<span style="${ok ? '' : 'color:var(--warn-deep, #92400E); font-weight:600;'}">${this.esc(l.modelo)}${l.modalidad === 'propio' ? ' (del cliente)' : ''}: ${continuan} continúa${continuan === 1 ? '' : 'n'}${reemplazan ? ` + ${reemplazan} reemplazo${reemplazan === 1 ? '' : 's'}` : ''}${nuevos ? ` + ${nuevos} nuevo${nuevos === 1 ? '' : 's'}` : ''} · línea ${cant}</span>`);
    });
    const faltaModelo = plan.unidades.some(u => u.fuente === 'agregado' && !u.modelo && !u.modelo_id);
    const sinLinea = r.sinLinea.length
      ? `<div style="color:var(--warn-deep, #92400E); font-size:12.5px; margin-top:4px;"><b>${r.sinLinea.length} serial(es) sin línea en el contrato</b>: ${r.sinLinea.map(u => this.esc(u.serial)).join(', ')} — agrega su modelo${r.sinLinea.some(u => u.destino === 'reemplaza') ? ' (el del reemplazo)' : ''} en “Equipos y tarifas” o cámbiales el destino.</div>` : '';
    // Seriales que entraron en una línea de OTRA modalidad (segundo pase de
    // conciliarLineas): se dice, no se bloquea. La ficha del pool suele venir
    // de una migración sin verificar y la línea es lo que el vendedor declara.
    const otraMod = this._wcOtraModalidadHtml(r.otraModalidad);
    const modalidad = TransicionPlan.derivarModalidad(plan, lineas);
    if (modBox) {
      modBox.innerHTML = `<b>${modalidad.sin_equipo ? 'Renovación sin equipo' : 'Renovación con equipo'}</b> — ${modalidad.continuan} continúa${modalidad.continuan === 1 ? '' : 'n'}${modalidad.reemplazos ? ` · ${modalidad.reemplazos} reemplazo${modalidad.reemplazos === 1 ? '' : 's'}` : ''}${modalidad.nuevos ? ` · ${modalidad.nuevos} radio${modalidad.nuevos === 1 ? '' : 's'} nuevo${modalidad.nuevos === 1 ? '' : 's'}` : ''} · refurbished: ${modalidad.refurbished ? `<b>sí</b> (${modalidad.refurbished_n})` : 'no'}`;
    }
    box.innerHTML = `
      ${sinDestino ? `<div style="color:var(--warn-deep, #92400E); font-size:12.5px; margin-bottom:4px;"><b>Faltan ${sinDestino} serial(es) por decidir</b> — cada uno necesita destino.</div>` : ''}
      <div style="font-size:12.5px; color:var(--fg-3);">${this.esc(TransicionPlan.resumen(plan))}</div>
      ${partes.length ? `<div style="display:flex; gap:14px; flex-wrap:wrap; font-size:12.5px; margin-top:4px;">${partes.join('')}
        ${desajuste && !this._wcSoloPlan ? `<button type="button" class="btn btn-ghost cg-act" onclick="Centro._wcCuadrar()">Cuadrar cantidades con los seriales</button>` : ''}</div>` : ''}
      ${sinLinea}${otraMod}
      ${faltaModelo ? '<div style="color:var(--warn-deep, #92400E); font-size:12.5px; margin-top:4px;">Elige el modelo de cada serial agregado sin ficha.</div>' : ''}`;
    return { ok: !sinDestino && !desajuste && !r.sinLinea.length && !faltaModelo, plan, desajuste, sinLinea: r.sinLinea, faltaModelo, sinDestino, modalidad, otraModalidad: r.otraModalidad || [] };
  },

  // Aviso (nunca bloqueo) de los seriales que cayeron en una línea de otra
  // modalidad: qué dice la ficha del pool, qué dice la línea y qué manda.
  _wcOtraModalidadHtml(lista) {
    if (!Array.isArray(lista) || !lista.length) return '';
    const como = (m) => m === 'propio' ? 'del cliente' : 'de alquiler';
    const grupos = new Map();
    for (const x of lista) {
      const k = `${x.ficha}→${x.linea}`;
      const g = grupos.get(k) || { ficha: x.ficha, linea: x.linea, seriales: [] };
      g.seriales.push(x.unidad.serial || x.unidad.serial_norm || '');
      grupos.set(k, g);
    }
    return [...grupos.values()].map(g => `<div style="color:var(--fg-3); font-size:12.5px; margin-top:4px;">
      <b>${g.seriales.length} serial(es) que el sistema tiene como equipo ${como(g.ficha)}</b> entran en una línea
      ${como(g.linea)}: ${this.esc(g.seriales.join(', '))}. Manda la línea del contrato — casi siempre la ficha viene
      de una migración que nadie verificó. Si de verdad son ${como(g.ficha)}, agrégales una línea con esa modalidad.</div>`).join('');
  },

  // ── Corregir los seriales de una renovación YA APROBADA, antes de la firma
  // (caso SERV20260904-01, Chino Panameño: se aprobó sin plan). Misma tabla
  // del wizard; solo se guarda `transicion_plan` — el trigger onPlanRenovacion
  // aplica la diferencia (filas del Anexo A, fichas que se sueltan). Tras la
  // firma no se ofrece: el Anexo A firmado queda congelado y cualquier cambio
  // va por anexo. Las líneas se muestran para conciliar, no se editan aquí. ──
  async wizSerialesRenovacion(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || c.accion !== 'Renovación') return;
    if (c.estado !== 'aprobado' || c.firmado) { Toast.show('Los seriales se corrigen con el contrato aprobado y antes de la firma', 'warn'); return; }
    if (!this.puedeCrearGestion()) { Toast.show('Tu rol no edita contratos desde aquí', 'warn'); return; }
    this._cerrarModal();
    await this._cargarModelos();
    const origenIds = Array.isArray(c.contrato_origen_ids) ? c.contrato_origen_ids : (c.contrato_origen_id ? [c.contrato_origen_id] : []);
    // Prefill desde el plan guardado.
    const plan = c.transicion_plan?.nivel === 'serial' ? c.transicion_plan : null;
    const destinos = {}; const reemplazos = {}; const refurb = {}; const agregados = [];
    (plan?.unidades || []).forEach(u => {
      if (u.fuente === 'agregado' || (u.pool_id && !this.equipos.some(e => e.id === u.pool_id))) {
        agregados.push({ serial: u.serial, serial_norm: u.serial_norm, pool: !!u.pool_id, pool_id: u.pool_id || null,
          modelo_id: u.modelo_id || null, modelo: u.modelo || '', propiedad: u.modalidad === 'propio' ? 'cliente' : null, aviso: '',
          refurbished: u.refurbished === true });
      } else if (u.pool_id) {
        destinos[u.pool_id] = u.destino;
        if (u.reemplazo_modelo_id) reemplazos[u.pool_id] = u.reemplazo_modelo_id;
        if (u.refurbished) refurb[u.pool_id] = true;
      }
    });
    this._wcPlanState = { destinos, reemplazos, refurb, agregados };
    this._wcSoloPlan = true;
    this._abrirModalA({
      titulo: `Seriales de la cuenta — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:72ch;">
        Renovación aprobada y sin firmar. Decide cada serial: continúa (con refurbished o no), se reemplaza
        (por uno nuevo igual o de otro modelo), se devuelve, o el cliente <b>no lo tiene</b> (sale de la cuenta y queda
        por clasificar); agrega los que le faltan al sistema. Al guardar, los que continúan pasan al Anexo A que el
        cliente firma. La modalidad de la renovación se deriva de aquí.</p>
      <div id="wcModalidad" style="font-size:12.5px; color:var(--fg-3); margin:0 0 10px;"></div>
      <select id="wcAccion" class="hidden" aria-hidden="true"><option value="Renovación" selected>Renovación</option></select>
      <select id="wcTipo" class="hidden" aria-hidden="true"><option value="${this.esc(c.codigo_tipo || 'SERV')}" selected></option></select>
      ${origenIds.map(o => `<input type="checkbox" data-wco value="${this.esc(o)}" checked class="hidden" aria-hidden="true">`).join('')}
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Líneas del contrato <span class="hint">solo lectura — para conciliar</span></div>
        <div id="wcLineas">${(c.equipos || []).map(l => this._lineaModeloPre('wcm', true, l)).join('')}</div>
      </div>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Seriales de la cuenta</div>
        <div id="wcPlan" class="cg-twrap"></div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._wcSoloPlan=false; Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="wcGuardarPlan" onclick="Centro.guardarPlanRenovacion('${this.esc(c.id)}')">Guardar seriales</button>`,
    });
    // Las líneas no se editan aquí (el contrato ya está aprobado).
    document.querySelectorAll('#wcLineas input, #wcLineas select, #wcLineas button').forEach(el => { el.disabled = true; });
    this._wcSyncPlan();
  },

  async guardarPlanRenovacion(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    const conc = this._wcConciliar();
    const plan = conc.plan || null;
    if (conc.sinDestino) { Toast.show(`⚠️ Faltan ${conc.sinDestino} serial(es) por decidir — elige el destino de cada uno`, 'warn'); return; }
    if (!plan) { Toast.show('Declara al menos un serial (o agrega los que el cliente tiene)', 'warn'); return; }
    const v = TransicionPlan.validar(plan);
    if (!v.ok) { Toast.show(`⚠️ ${v.mensaje}`, 'warn'); return; }
    if (conc.faltaModelo) { Toast.show('⚠️ Elige el modelo de cada serial agregado sin ficha', 'warn'); return; }
    if (conc.sinLinea.length) { Toast.show(`⚠️ ${conc.sinLinea.length} serial(es) sin línea en el contrato — cámbiales el destino o pide editar el contrato`, 'warn'); return; }
    const btn = document.getElementById('wcGuardarPlan');
    if (btn) btn.disabled = true;
    const m = conc.modalidad;
    // Un contrato aprobado "sin equipo" al que ahora se le declaran
    // reemplazos: bodega tiene que enterarse (la solicitud de seriales salió
    // al aprobar sin nada que pedir). Se avisa; el ajuste fino va por Almacén.
    const nuevoConEquipo = !!(c.renovacion_sin_equipo && m && !m.sin_equipo);
    try {
      await ContratosService.updateContrato(id, {
        transicion_plan: plan,
        renovacion_refurbished_componentes: !!(m && m.refurbished),
        ...(m && c.renovacion_sin_equipo !== m.sin_equipo ? {
          renovacion_sin_equipo: m.sin_equipo,
          renovacion_modalidad: m.sin_equipo ? 'Renovación sin equipo' : 'Renovación con equipo',
        } : {}),
        transicion_plan_actualizado_at: firebase.firestore.FieldValue.serverTimestamp(),
        transicion_plan_actualizado_por_uid: this.uid,
        fecha_modificacion: new Date(),
      });
      this._wcSoloPlan = false;
      this._cerrarModal();
      Toast.show(nuevoConEquipo
        ? 'Seriales guardados — la renovación pasa a CON equipo (reemplazos/nuevos): avisa a bodega que asigne esos seriales en Almacén · Asignar'
        : conc.desajuste
          ? 'Seriales guardados — ojo: alguna línea trae menos unidades que los seriales que continúan más los reemplazos (edita el contrato si aplica)'
          : 'Seriales guardados — el Anexo A se actualiza solo', (nuevoConEquipo || conc.desajuste) ? 'warn' : 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e); Toast.show('No se pudieron guardar los seriales', 'bad');
      if (btn) btn.disabled = false;
    }
  },

  _wcCuadrar() {
    const plan = this._wcLeerPlan(this._wcOrigenIds());
    if (!plan) return;
    const lineas = this._lineasModelo('wcm');
    const r = TransicionPlan.conciliarLineas(plan, lineas);
    const cants = [...document.querySelectorAll('input[data-wcm-cant]')];
    const selects = [...document.querySelectorAll('select[data-wcm-modelo]')];
    // _lineasModelo salta los selects sin modelo: mapea idx → input real.
    const reales = selects.map((s, i) => this._modeloDeSelect(s) ? i : -1).filter(i => i >= 0);
    r.porLinea.forEach(({ idx, continuan, reemplazan }) => {
      const inp = cants[reales[idx]];
      const min = continuan + reemplazan;
      if (inp && min > 0) inp.value = min;
    });
    this._wcPreview();
    this._wcConciliar();
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

  // ── Validación del representante legal (Zuleika, 2026-09-03) ─────────────
  // Se pedía solo en el formulario clásico; al retirarse nuevo-contrato.html
  // (2026-09-09) el control se habría perdido, así que vive aquí. Mismo
  // criterio y mismo módulo de dominio (js/domain/repValidacion.js): sin el
  // check, "Guardar contrato" queda deshabilitado.
  //
  // El problema que resuelve: contratos confeccionados y luego ANULADOS porque
  // el representante de la ficha ya no era el vigente.
  _wcRepHtml() {
    const c = this.cliente || {};
    const rep = (c.representante || '').trim();
    const ficha = `../clientes/centro.html?id=${encodeURIComponent(c.id || '')}`;
    return rep
      ? `<div>${this.esc(rep)}${c.representante_cedula ? ` — céd. ${this.esc(c.representante_cedula)}` : ''}</div>
         <div id="wcRepCtx" class="hint" style="margin:4px 0 8px;">Consultando la ficha…</div>
         <label class="cg-toggle">
           <input type="checkbox" id="wcRepValidado" onchange="Centro._wcRepGate()">
           Validé con el cliente que <b>${this.esc(rep)}</b> sigue siendo el representante legal.
         </label>`
      : `<div><b>⚠️ Este cliente no tiene representante legal registrado</b> — el contrato se imprime con ese espacio en blanco.</div>
         <label class="cg-toggle" style="margin-top:8px;">
           <input type="checkbox" id="wcRepValidado" onchange="Centro._wcRepGate()">
           Confirmé con el cliente quién es el representante legal vigente.
         </label>
         <div class="hint" style="margin-top:6px;"><a href="${ficha}">Completar la ficha</a></div>`;
  },

  _wcRepGate() {
    const btn = document.getElementById('wcGuardar');
    const chk = document.getElementById('wcRepValidado');
    if (!btn) return;
    btn.disabled = !(chk && chk.checked);
    btn.title = btn.disabled ? 'Marca la validación del representante legal para continuar' : '';
  },

  // Contexto que hace útil el check: la última validación estampada en la
  // ficha o el último cambio del representante en el historial. Best-effort:
  // sin dato legible, la línea queda en el texto neutro del dominio.
  async _wcRepMontar() {
    this._wcRepGate();
    const n = document.getElementById('wcRepCtx');
    if (!n) return;
    let hist = [];
    try {
      const qs = await firebase.firestore().collection('clientes').doc(this.cliente.id)
        .collection('historial').orderBy('at', 'desc').limit(30).get();
      hist = qs.docs.map((d) => d.data());
    } catch (_) { /* sin historial legible, la validación previa aún aplica */ }
    const r = RepValidacion.resumen(this.cliente, hist, Date.now());
    const nodo = document.getElementById('wcRepCtx');
    if (!nodo) return;                      // el modal se cerró o re-renderizó
    nodo.textContent = r.texto;
    nodo.dataset.tono = r.tono;
  },

  async crearContrato() {
    if (this._wcGuardando) return;
    // Segundo candado del check (el botón ya sale deshabilitado): esta función
    // es la única vía de creación y no debe depender de que la llamen bien.
    const chkRep = document.getElementById('wcRepValidado');
    if (!chkRep || !chkRep.checked) {
      Toast.show('⚠️ Valida el representante legal con el cliente antes de guardar.', 'warn');
      return;
    }
    const tipo = document.getElementById('wcTipo')?.value || '';
    const tipoNombre = this.TIPOS_CONTRATO[tipo] || tipo;
    const accion = document.getElementById('wcAccion')?.value || 'Nuevo';
    const durN = parseInt(document.getElementById('wcMeses')?.value || '0', 10);
    const durUnidad = (tipo === 'TEMP' && document.getElementById('wcDurUnidad')?.value === 'dias') ? 'dias' : 'meses';
    const meses = durUnidad === 'meses' ? durN : 0;
    if (!tipo) { Toast.show('Elige el tipo de contrato', 'warn'); return; }
    if (!(durN > 0)) { Toast.show(`Indica la duración en ${durUnidad === 'dias' ? 'días' : 'meses'}`, 'warn'); return; }

    const lineas = this._lineasModelo('wcm');
    if (!lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
    if (['SERV', 'ALQ', 'PROP'].includes(tipo) && lineas.some(l => !(l.precio > 0))) {
      Toast.show('Cada línea necesita su precio mensual', 'warn'); return;
    }
    if (['SERV', 'ALQ', 'PROP'].includes(tipo) && this._lineasSinModalidad(lineas)) {
      Toast.show(this.MSG_SIN_MODALIDAD, 'warn');
      document.querySelector('select[data-wcm-modalidad]:not([disabled])')?.focus();
      return;
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
    let modalidad = null;
    if (TransicionPlan.aplica(origenSel)) {
      // Paso OBLIGATORIO en toda renovación (Alberto 2026-09-04): cada
      // serial con destino, o la confirmación explícita de que no hay.
      const conc = this._wcConciliar();
      plan = conc.plan || null;
      if (conc.sinDestino) { Toast.show(`⚠️ Faltan ${conc.sinDestino} serial(es) por decidir — elige el destino de cada uno`, 'warn'); return; }
      if (!plan && !this._wcPlanState.sinSeriales) { Toast.show('⚠️ Declara los seriales de la cuenta (o confirma que el cliente no tiene equipos con serial)', 'warn'); return; }
      if (plan) {
        const vPlan = TransicionPlan.validar(plan);
        if (!vPlan.ok) { Toast.show(`⚠️ ${vPlan.mensaje}`, 'warn'); return; }
        if (conc.faltaModelo) { Toast.show('⚠️ Elige el modelo de cada serial agregado sin ficha', 'warn'); return; }
        if (conc.sinLinea.length) { Toast.show(`⚠️ ${conc.sinLinea.length} serial(es) sin línea en el contrato — agrega su modelo (o el del reemplazo) o cámbiales el destino`, 'warn'); return; }
        if (conc.desajuste) { Toast.show('⚠️ Alguna línea trae menos unidades que los seriales que continúan más los reemplazos — usa “Cuadrar cantidades”', 'warn'); return; }
        modalidad = conc.modalidad;
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
        // Derivadas del plan por serial (ya no se preguntan). Sin plan (la
        // cuenta no tiene seriales que declarar) es una renovación sin equipo
        // salvo que las líneas traigan unidades.
        renovacion_sin_equipo: accion === 'Renovación' && (modalidad ? modalidad.sin_equipo
          : !lineas.some(l => Number(l.cantidad) > 0)),
        renovacion_refurbished_componentes: !!(modalidad && modalidad.refurbished),
        origenSel,
        transicion_plan: plan,
        // El Centro produce el documento v2 (Anexo A por serial, firma
        // digital): el correo a activaciones enlaza a ese documento y no
        // adjunta el PDF del formato anterior (functions/lib/documentoContrato).
        documento_version: 'v2',
        // Quién validó con el cliente qué nombre al confeccionar (Zuleika
        // 2026-09-03). construirDoc le pone el `at`.
        representante_validacion: RepValidacion.construir(cli, { uid: this.uid, email: this.email || null }),
        reemplaza_seriales: null,
        duracion: durUnidad === 'dias' ? `${durN} día${durN === 1 ? '' : 's'}` : `${durN} meses`,
        duracion_meses: meses,
        ...(durUnidad === 'dias' ? { duracion_dias: durN } : {}),
        observaciones: document.getElementById('wcObs')?.value || '',
        equipos: lineas,
        cargos: [...document.querySelectorAll('#wcCargos .wa-cargo')].length ? this._aumCargos() : [],
        itbms_aplica: document.getElementById('wcItbms')?.checked !== false,
        creado_por_uid: this.uid,
      });

      // Estampa de regularización (plan 2026-09-08): el contrato nace sobre
      // una cuenta con deuda → queda dicho; DEMO/TEMP se estampan pero no
      // cuentan como puntuales (Regularizacion.esPuntual).
      Object.assign(contrato, Centro._estampaReg());
      const docRef = await ContratosService.addContrato(contrato);

      // La ficha recuerda la validación: el próximo contrato de este cliente
      // muestra "Validado por última vez hace N" en vez de pedir fe ciega.
      // Best-effort — el contrato ya quedó guardado y esto no debe estorbar.
      try {
        await firebase.firestore().collection('clientes').doc(cli.id).update({
          representante_validacion: {
            ...RepValidacion.construir(cli, { uid: this.uid, email: this.email || null }),
            at: firebase.firestore.FieldValue.serverTimestamp(),
          },
        });
      } catch (e) { console.warn('No se pudo estampar la validación del representante:', e); }

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
          // CTA al CENTRO (2026-08-28): el correo mandaba al módulo viejo a
          // aprobar; ahora aterriza en la ficha del cliente, donde "Ver" del
          // contrato ofrece "Aprobar contrato" y luego "Enviar para firma".
          ctaUrl: `${location.origin}/clientes/centro.html?id=${encodeURIComponent(contrato.cliente_id)}`,
          ctaLabel: 'Revisar y aprobar en el Centro',
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


  /* ═════════ Editor de contrato (2026-09-10) ═════════
     Vivía en contratos/editar-contrato.html, fuera del Centro: la ficha
     ofrecía "Editar…" y saltaba a otro módulo. Peor que la incomodidad: el
     editor aprendía de segundo y a mano todo lo que el wizard ya sabía (la
     modalidad por línea, el plan por serial), y ahí es donde salía el bug —
     un contrato editado hacia una forma que el wizard nunca habría producido.

     Comparte con el wizard los COMPONENTES (líneas de modelo, cargos, la
     aritmética de ContratoTarifario, el tarifario) pero NO su narrativa: crear
     habla de consolidación, custodia y plan por serial; editar es un formulario
     corto. Lo que se edita es lo mismo que editaba la página vieja: tipo,
     duración, líneas, cargos, ITBMS y observaciones.

     Lo que NO se toca al editar, a propósito:
       · la acción (Nuevo / Renovación) — se decide al crear;
       · el plan por serial — se corrige en "Seriales de la cuenta";
       · el correlativo, el cliente y el origen.
  */
  _weC: null,          // contrato en edición
  _weGuardando: false,

  async editarContrato(contratoDocId) {
    if (!canRole(this.rol, 'editar-contrato')) { Toast.show('Tu rol no edita contratos', 'warn'); return; }
    const c = this.contratos.find(x => x.id === contratoDocId)
      || await ContratosService.getContrato(contratoDocId);
    // Mismo criterio que aplicaba la página vieja al abrirse
    // (js/domain/contratoEdicion.js).
    const ed = ContratoEdicion.puedeEditarse(c);
    if (!ed.ok) { Toast.show(ed.texto, 'warn'); return; }

    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await Promise.all([this._cargarModelos(), this._cargarCargos()]);
    this._weC = c;

    // Tipo: el select ofrece Servicio y Temporal, pero un contrato viejo
    // (ALQ, PROP, REEMP…) conserva el suyo como opción "actual". Sin esto, un
    // tipo que no casaba caía en la primera opción y al guardar el contrato
    // cambiaba de tipo en silencio — el mismo cuidado que tenía la página vieja.
    const tipoActual = c.codigo_tipo || '';
    const tipos = ['SERV', 'TEMP'];
    const opcTipo = (tipoActual && !tipos.includes(tipoActual)
      ? `<option value="${this.esc(tipoActual)}" selected>${this.esc(this.TIPOS_CONTRATO[tipoActual] || c.tipo_contrato || tipoActual)} (actual)</option>` : '')
      + tipos.map(k => `<option value="${k}" ${k === tipoActual ? 'selected' : ''}>${this.TIPOS_CONTRATO[k]}</option>`).join('');

    const enDias = Number(c.duracion_dias) > 0;
    const durN = enDias ? Number(c.duracion_dias)
      : (Number(c.duracion_meses) > 0 ? Number(c.duracion_meses)
        : (parseInt(String(c.duracion || '').replace(/\D/g, ''), 10) || 12));

    // Modalidad por línea: los contratos anteriores al 2026-09-09 no la traen,
    // y como es obligatoria para guardar, editar un ALQ viejo para corregir una
    // observación obligaba a declararla en cada línea a mano — invitando a
    // marcar cualquier cosa con tal de pasar. Se DERIVA del tipo del contrato,
    // la misma inferencia que ya hace el wizard al copiar líneas de un origen:
    // un contrato entero ALQ era alquiler y uno PROP, equipo del cliente. Un
    // SERV (mixto por línea) sin modalidad sí se queda en blanco: ahí no hay
    // nada que inferir y el vendedor tiene que decirlo.
    const tipoC = this._codigoTipo(c);
    const modPorTipo = tipoC === 'PROP' ? 'propio' : tipoC === 'ALQ' ? 'alquiler' : null;
    const lineas = (c.equipos || []).map(l => ({
      modelo_id: l.modelo_id, modelo: l.modelo,
      cantidad: l.cantidad, precio: l.precio, modalidad: l.modalidad || modPorTipo,
    }));
    if (!lineas.length) lineas.push(null);

    // Plan por serial: no se edita aquí, pero SÍ manda sobre la modalidad de
    // la renovación (sin equipo / refurbished). Se muestra lo derivado.
    const esRenov = c.accion === 'Renovación';
    const plan = (c.transicion_plan?.nivel === 'serial' && Array.isArray(c.transicion_plan.unidades))
      ? c.transicion_plan : null;

    // Editar un contrato ya APROBADO en lo económico o el plazo lo devuelve a
    // pendiente de aprobación (Alberto 2026-09-04). Se avisa ANTES, no después.
    const avisoReap = ContratoEdicion.aplicaReaprobacion(c)
      ? `<div class="cg-nota" style="margin:0 0 14px; padding:10px 12px; border-left:3px solid var(--warn, #E0A93A); background:var(--soft-warn, #fdf4e1); font-size:13px;">
           Este contrato <b>ya está aprobado</b>. Si cambias precios, cargos, plazo o ITBMS vuelve a
           <b>pendiente de aprobación</b> y se le avisa a ventas. Corregir solo las observaciones no lo mueve.
         </div>` : '';

    this._abrirModalA({
      titulo: `Editar ${this.esc(c.contrato_id || c.id)} — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      ${avisoReap}
      <p style="margin:0 0 14px; font-size:13px; color:var(--fg-3); max-width:72ch;">
        Se corrigen tipo, duración, equipos, cargos y observaciones. La <b>acción</b>
        (${this.esc(c.accion || '—')}) se define al crear el contrato y no se cambia aquí; los
        <b>seriales</b> se corrigen en «Seriales de la cuenta».
      </p>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Datos del contrato <span class="hint">tipo · duración</span></div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end;">
          <div class="form-field" style="margin:0; max-width:190px;">
            <label class="form-label" for="weTipo">Tipo</label>
            <select class="form-select" id="weTipo">${opcTipo}</select></div>
          <div class="form-field" style="margin:0; max-width:210px;">
            <label class="form-label" for="weMeses">Duración</label>
            <div style="display:flex; gap:6px;">
              <input class="form-input" type="number" id="weMeses" min="1" value="${durN}" style="width:90px;">
              <select class="form-select" id="weDurUnidad" style="width:100px;">
                <option value="meses" ${enDias ? '' : 'selected'}>meses</option>
                <option value="dias" ${enDias ? 'selected' : ''}>días</option>
              </select>
            </div></div>
        </div>
        ${esRenov ? `<div id="weModalidad" style="margin-top:8px; font-size:12.5px; color:var(--fg-3);"></div>` : ''}
      </div>

      <div oninput="Centro._wePreview()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Equipos y tarifas</div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
          <div id="weLineas">${lineas.map(l => this._lineaModeloPre('wem', true, l)).join('')}</div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('weLineas').insertAdjacentHTML('beforeend', Centro._lineaModeloPre('wem', true)); Centro._wePreview()">+ Agregar otro modelo</button></div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Otros conceptos (cargos del catálogo — únicos o mensuales)</label>
          <div id="weCargos">${(c.cargos || []).map(x => this._cargoLineaHtml(x)).join('')}</div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('weCargos').insertAdjacentHTML('beforeend', Centro._cargoLineaHtml()); Centro._wePreview()">+ Agregar cargo</button></div>
        <label class="cg-toggle">
          <input type="checkbox" id="weItbms" ${c.itbms_aplica !== false ? 'checked' : ''} onchange="Centro._wePreview()">
          Aplica ITBMS${this.cliente?.itbms_exento === true ? ' <span style="color:var(--fg-4);">(cliente exento)</span>' : ''}
        </label>
        <div id="weTot" class="ds-card" style="padding:10px 14px; max-width:380px; margin-top:10px;"></div>
      </div>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">3</span> Observaciones <span class="hint">opcional</span></div>
        <textarea class="form-input" id="weObs" rows="2" style="resize:vertical;" aria-label="Observaciones">${this.esc(c.observaciones || '')}</textarea>
      </div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="weGuardar" onclick="Centro.guardarContratoEditado()">Guardar cambios</button>`,
    });
    this._wePlan = plan;
    this._wePreview();
  },

  // Modalidad derivada del plan por serial — misma regla que el wizard
  // (TransicionPlan.derivarModalidad); aquí solo se MUESTRA.
  _weModalidadDerivada(lineas) {
    if (!this._wePlan || !window.TransicionPlan) return null;
    return TransicionPlan.derivarModalidad(this._wePlan, lineas || []);
  },

  _wePreview() {
    const cont = document.getElementById('weTot');
    if (!cont) return;
    const lineas = this._lineasModelo('wem');
    const t = this._totAumento(lineas, this._aumCargos(),
      document.getElementById('weItbms')?.checked !== false);
    cont.innerHTML = this._tarifarioHtml(t);

    const m = document.getElementById('weModalidad');
    if (m) {
      const d = this._weModalidadDerivada(lineas);
      m.innerHTML = d
        ? `<b>${d.sin_equipo ? 'Renovación sin equipo' : 'Renovación con equipo'}</b> — derivado del plan por serial:
           ${d.continuan} continúa${d.continuan === 1 ? '' : 'n'}${d.reemplazos ? ` · ${d.reemplazos} reemplazo${d.reemplazos === 1 ? '' : 's'}` : ''}${d.nuevos ? ` · ${d.nuevos} nuevo${d.nuevos === 1 ? '' : 's'}` : ''}
           · refurbished: ${d.refurbished ? `sí (${d.refurbished_n})` : 'no'}.
           Los seriales se corrigen en «Seriales de la cuenta».`
        : 'La modalidad de la renovación sale del plan por serial de la cuenta.';
    }
  },

  async guardarContratoEditado() {
    if (this._weGuardando) return;
    const c = this._weC;
    if (!c) return;

    // Segundo candado: el criterio se re-evalúa contra el contrato en vivo.
    // Entre abrir el modal y guardar, alguien pudo mandarle el enlace de firma
    // o activarlo.
    const fresco = await ContratosService.getContrato(c.id);
    const ed = ContratoEdicion.puedeEditarse(fresco);
    if (!ed.ok) { Toast.show(ed.texto, 'bad'); this._cerrarModal(); await this.abrir(this.cliente.id, { push: false }); return; }

    const lineas = this._lineasModelo('wem');
    if (!lineas.length) { Toast.show('⚠️ El contrato necesita al menos una línea de equipos', 'warn'); return; }
    if (this._lineasSinModalidad(lineas)) { Toast.show(`⚠️ ${this.MSG_SIN_MODALIDAD}`, 'warn'); return; }

    const durN = Math.max(1, Number(document.getElementById('weMeses')?.value || 0));
    if (!(durN > 0)) { Toast.show('⚠️ Indica la duración', 'warn'); return; }
    const durUnidad = document.getElementById('weDurUnidad')?.value === 'dias' ? 'dias' : 'meses';
    const meses = durUnidad === 'dias' ? Math.max(1, Math.round(durN / 30)) : durN;

    const tipo = document.getElementById('weTipo')?.value || c.codigo_tipo || '';
    const tipoNombre = this.TIPOS_CONTRATO[tipo] || c.tipo_contrato || tipo;
    const itbmsAplica = document.getElementById('weItbms')?.checked !== false;
    const cargos = this._aumCargos();
    const t = ContratoTarifario.totales(lineas, cargos, itbmsAplica);

    // Modalidad de la renovación: con plan por serial se DERIVA; sin plan se
    // conserva lo que el contrato ya decía (aquí no se pregunta).
    const esRenov = c.accion === 'Renovación';
    const d = esRenov ? this._weModalidadDerivada(lineas) : null;
    const sinEquipo = esRenov ? (d ? d.sin_equipo : !!c.renovacion_sin_equipo) : false;
    const refurb = esRenov ? (d ? d.refurbished : !!c.renovacion_refurbished_componentes) : false;

    // La duración, en la MISMA forma en que se va a guardar. La página vieja
    // mandaba solo el string a requiereReaprobacion y dejaba fuera
    // duracion_meses/duracion_dias: como el comparador mira los tres, un
    // contrato del Centro (que sí trae duracion_meses) SIEMPRE salía con
    // "cambió la duración" — y corregir una observación mandaba el contrato de
    // vuelta a aprobación con correo a ventas. Aquí se comparan iguales.
    const durCampos = {
      duracion: durUnidad === 'dias' ? `${durN} día${durN === 1 ? '' : 's'}` : `${durN} meses`,
      duracion_meses: meses,
      ...(durUnidad === 'dias' ? { duracion_dias: durN } : {}),
    };

    // ¿Vuelve a aprobación? Misma pregunta y mismo dominio que la página vieja.
    const re = (ContratoEdicion.aplicaReaprobacion(fresco) && ContratoTarifario.requiereReaprobacion)
      ? ContratoTarifario.requiereReaprobacion(fresco, { equipos: lineas, cargos, ...durCampos, itbms_aplica: itbmsAplica })
      : { requiere: false, cambios: [] };

    this._weGuardando = true;
    const btn = document.getElementById('weGuardar');
    if (btn) btn.disabled = true;
    try {
      await ContratosService.updateContrato(c.id, {
        ...(re.requiere ? {
          estado: 'pendiente_aprobacion',
          reaprobacion: {
            motivo: `Edición tras aprobar: ${re.cambios.join(', ')}`,
            at: new Date(),
            por_uid: this.uid || null,
            aprobado_antes_por_uid: fresco.aprobado_por_uid || null,
            fecha_aprobacion_anterior: fresco.fecha_aprobacion || null,
            total_mensual_anterior: Number(fresco.total_mensual || 0),
          },
        } : {}),
        codigo_tipo: tipo,
        tipo_contrato: tipoNombre,
        renovacion_sin_equipo: sinEquipo,
        renovacion_refurbished_componentes: refurb,
        renovacion_modalidad: esRenov ? (sinEquipo ? 'Renovación sin equipo' : 'Renovación con equipo') : '',
        ...durCampos,
        observaciones: (document.getElementById('weObs')?.value || '').trim(),
        equipos: lineas.map(l => ({
          modelo_id: l.modelo_id, modelo: l.modelo, descripcion: 'Equipos de Comunicación',
          cantidad: l.cantidad, precio: l.precio, modalidad: l.modalidad,
        })),
        total_equipos: lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0),
        cargos,
        subtotal_equipos: t.equiposSub,
        cargos_recurrente: t.cargosRec,
        cargos_unico: t.cargosUni,
        subtotal: t.subtotal,
        itbms_aplica: t.itbmsAplica,
        itbms_porcentaje: t.itbmsPorc,
        itbms_monto: t.itbmsMonto,
        total_con_itbms: t.totalConITBMS,
        total: t.totalConITBMS,
        total_mensual: t.totalConITBMS,
        primer_pago: t.primerPago,
        fecha_modificacion: new Date(),
      });

      if (re.requiere) {
        // Aviso al aprobador — mismo buzón y mismo CTA que la página vieja.
        try {
          const filas = lineas.map(l => `<li>${this.esc(l.modelo)} – ${l.cantidad} × $${Number(l.precio || 0).toFixed(2)}</li>`).join('');
          await firebase.firestore().collection('mail_queue').add({
            to: 'ventas@cecomunica.com',
            cc: this.email || null,
            subject: `Contrato ${fresco.contrato_id || c.id} editado tras aprobar — requiere nueva aprobación`,
            preheader: `${fresco.cliente_nombre || ''}: cambió ${re.cambios.join(', ')}`,
            bodyContent: `
              <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Contrato editado después de aprobado</h2>
              <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                El contrato <b>${this.esc(fresco.contrato_id || c.id)}</b> de <b>${this.esc(fresco.cliente_nombre || '—')}</b>
                ya estaba aprobado y se editó: cambió <b>${this.esc(re.cambios.join(', '))}</b>.
                Volvió a <b>pendiente de aprobación</b>. Mensual anterior: $${Number(fresco.total_mensual || 0).toFixed(2)} →
                nuevo: <b>$${Number(t.totalConITBMS || 0).toFixed(2)}</b>.</p>
              <ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${filas}</ul>`,
            ctaUrl: `${location.origin}/clientes/centro.html?id=${encodeURIComponent(fresco.cliente_id || '')}`,
            ctaLabel: 'Revisar y aprobar en el Centro',
            meta: { source: 'centro-editar-contrato-reaprobacion', contrato_id: fresco.contrato_id || c.id, created_at: firebase.firestore.FieldValue.serverTimestamp() },
            status: 'queued',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        } catch (e) { console.warn('No se pudo encolar el aviso de reaprobación:', e); }
      }

      this._cerrarModal();
      Toast.show(re.requiere
        ? 'Cambios guardados — el contrato vuelve a pendiente de aprobación (se avisó a ventas)'
        : 'Cambios guardados', re.requiere ? 'warn' : 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo guardar: ' + ((e && e.message) || e), 'bad');
    } finally {
      this._weGuardando = false;
      const b = document.getElementById('weGuardar');
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
  // ACTIVO + 30 días de penalidad. El vencimiento se evalúa POR TRAMO del
  // ítem: la línea de un aumento tiene vigencia propia y puede seguir vigente
  // aunque el contrato base ya venció (y al revés).
  _penalidadBaja(items) {
    const por = new Map();
    for (const it of items) {
      const c = this.contratos.find(x => x.id === it.contrato_doc_id);
      if (!c) continue;
      const linea = (c.equipos || []).find(l => this._mismoModeloLinea(l, { modelo_id: it.modelo_id, modelo_label: it.modelo }));
      const precio = Number(linea?.precio || 0);
      const dias = this._diasA(linea?.vigencia?.fecha_vencimiento || c.fecha_vencimiento);
      const vencido = dias !== null && dias < 0;
      const cur = por.get(c.id) || { contrato_id: c.contrato_id || c.id, monto: 0, vencidas: 0, vigentes: 0, sinPrecio: false };
      cur.monto += precio * 3;   // 3 meses en cualquier caso, cobro inmediato
      if (vencido) cur.vencidas += 1; else cur.vigentes += 1;
      if (!precio) cur.sinPrecio = true;
      por.set(c.id, cur);
    }
    const lista = [...por.values()].map(p => {
      const partes = [];
      if (p.vigentes) partes.push(`${p.vigentes} no vencida(s): 3 meses de penalidad`);
      if (p.vencidas) partes.push(`${p.vencidas} vencida(s): 60 días de preaviso (servicio activo) + 30 de penalidad`);
      return {
        contrato_id: p.contrato_id,
        monto: Math.round(p.monto * 100) / 100,
        detalle: `${p.vigentes + p.vencidas} unid. · ${partes.join(' · ')}${p.sinPrecio ? ' · ⚠ línea sin precio' : ''}`,
      };
    });
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
      // La carta se sube ANTES de crear el doc (con el correlativo reservado):
      // el correo de aprobación sale en el onCreate y siempre decía "falta la
      // carta" aunque el wizard la adjuntara — ahora ya la ve adjunta.
      const gid = await GestionesService.reservarId('baja');
      let cartaPath = null;
      try {
        cartaPath = await GestionesService.subirCartaArchivo(gid, carta);
      } catch (e) {
        console.error(e);
        Toast.show('La carta NO subió — la gestión se crea igual: adjúntala desde el expediente', 'warn');
      }
      await GestionesService.crear({ ...Centro._estampaReg(),
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
        ...(cartaPath ? { carta_path: cartaPath } : {}),
        ...(termIds.length ? { terminacion_total_de: termIds } : {}),
      }, { id: gid });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`${termIds.length > 1 ? 'Terminación de la cuenta' : termIds.length ? 'Terminación total' : 'Baja'} ${gid} enviada a aprobación`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear la baja', 'bad'); }
  },
};
