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
        const permitido = [ROLES.ADMIN, ROLES.GERENTE, ROLES.VENDEDOR, ROLES.RECEPCION];
        if (!u || !permitido.includes(this.rol)) {
          document.body.innerHTML = "<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>";
          return;
        }
        // El vendedor arranca en SU cartera; el resto ve todo.
        this.cartera = (this.rol === ROLES.VENDEDOR) ? 'mios' : 'todos';
        this._wire();
        const id = new URLSearchParams(location.search).get('id');
        if (id) await this.abrir(id, { push: false });
        else await this.cargarLista(true);
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

  setCartera(v) { this.cartera = v; this.cargarLista(true); },

  async cargarLista(reset) {
    if (reset) { this.cursor = null; document.getElementById('cgLista').innerHTML = ''; }
    document.getElementById('segMios').classList.toggle('is-on', this.cartera === 'mios');
    document.getElementById('segTodos').classList.toggle('is-on', this.cartera === 'todos');
    try {
      const { docs, lastDoc } = await ClientesService.listClientesPage({
        term: this.term, cursorDoc: this.cursor, limit: 30,
      });
      this.cursor = lastDoc;
      // "Mi cartera" filtra en cliente sobre la página traída: con carteras de
      // decenas de clientes es suficiente; el scoping por reglas llega después.
      const visibles = this.cartera === 'mios'
        ? docs.filter(c => c.vendedor_asignado === this.uid)
        : docs;
      const cont = document.getElementById('cgLista');
      if (reset && !visibles.length && !lastDoc) {
        cont.innerHTML = `<div class="ds-card cg-vacio">${this.term
          ? 'Ningún cliente coincide con la búsqueda.'
          : (this.cartera === 'mios' ? 'No tienes clientes asignados todavía.' : 'Sin clientes registrados.')}</div>`;
      } else {
        cont.insertAdjacentHTML('beforeend', visibles.map(c => this._filaCliente(c)).join(''));
      }
      document.getElementById('btnMas').classList.toggle('hidden', !lastDoc);
      const n = cont.querySelectorAll('.cg-row').length;
      document.getElementById('cgResumen').textContent =
        `${n} cliente${n === 1 ? '' : 's'}${this.cartera === 'mios' ? ' en tu cartera' : ''}${lastDoc ? ' (hay más)' : ''}`;
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

      // Carga en paralelo: contratos + flota + gestiones.
      const db = firebase.firestore();
      const [conSnap, equipos, gestiones] = await Promise.all([
        db.collection('contratos').where('cliente_id', '==', clienteId).get(),
        EquiposPoolService.listarPorCliente(clienteId),
        GestionesService.listarPorCliente(clienteId),
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

  pintarKpis() {
    const activos = this.contratos.filter(c => c.estado === 'activo');
    const enTaller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado)).length;
    const abiertas = (this.gestiones || []).filter(g => GestionesService.ABIERTAS.includes(g.estado)).length;
    document.getElementById('fKpis').innerHTML = [
      [activos.length, 'Contratos activos'],
      [this.equipos.length, 'Equipos en campo'],
      [abiertas, 'Gestiones abiertas'],
      [enTaller, 'En taller / revisión'],
    ].map(([v, l]) => `<div class="cg-kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  },

  pintarSenales() {
    const out = [];
    for (const c of this.contratos) {
      if (c.estado !== 'activo') continue;
      const v = this._vencInfo(c);
      if (!v) continue;
      if (v.estado === 'vencido') {
        out.push({ tipo: 'bad', txt: `El contrato ${c.contrato_id || c.id} venció hace ${-v.dias} día(s) — coordinar renovación o terminación.` });
      } else if (v.estado === 'por_vencer') {
        out.push({ tipo: 'warn', txt: `El contrato ${c.contrato_id || c.id} vence en ${v.dias} día(s) — iniciar renovación.` });
      }
    }
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
          style="width:15px;height:15px;flex:none;margin-top:2px;"></i><span>${this.esc(s.txt)}</span></div>`).join('')
      : '';
  },

  _unidadesActivas(c) {
    const total = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    return Math.max(0, total - Number(c.baja_cancelado_total || 0));
  },

  pintarContratos() {
    const cont = document.getElementById('fContratos');
    if (!this.contratos.length) { cont.innerHTML = '<div class="cg-vacio">Sin contratos registrados.</div>'; return; }
    const filas = this.contratos.map(c => {
      const v = c.estado === 'activo' ? this._vencInfo(c) : null;
      const vence = v
        ? `${this._fmtFecha(c.fecha_vencimiento)} <span class="cg-venc ${v.estado}">${v.estado === 'vencido' ? 'vencido' : (v.estado === 'por_vencer' ? `en ${v.dias} d` : 'vigente')}</span>`
        : (c.estado === 'activo' ? '<span style="color:var(--fg-4);">sin fecha</span>' : '—');
      const renovar = v && v.estado !== 'vigente'
        ? `<a class="btn btn-primary" style="padding:4px 11px;font-size:12.5px;" href="../contratos/nuevo-contrato.html">Renovar</a>` : '';
      return `<tr>
        <td class="cg-mono"><a href="../contratos/editar-contrato.html?id=${encodeURIComponent(c.id)}">${this.esc(c.contrato_id || c.id)}</a></td>
        <td>${this.esc(c.tipo_contrato || c.codigo_tipo || '—')}</td>
        <td>${this.esc(c.estado || '—')}</td>
        <td style="text-align:right;">${this._unidadesActivas(c)}</td>
        <td>${vence}</td>
        <td style="text-align:right; white-space:nowrap;">${renovar}
          <a class="btn btn-ghost" style="padding:4px 9px;font-size:12.5px;" href="../contratos/editar-contrato.html?id=${encodeURIComponent(c.id)}">Abrir ›</a></td></tr>`;
    }).join('');
    cont.innerHTML = `<table class="cg-tabla"><thead><tr>
      <th>Contrato</th><th>Tipo</th><th>Estado</th><th style="text-align:right;">Unid.</th><th>Vence</th><th></th>
      </tr></thead><tbody>${filas}</tbody></table>`;
  },

  pintarEquipos() {
    const cont = document.getElementById('fEquipos');
    const q = (document.getElementById('fEqFiltro')?.value || '').trim().toUpperCase();
    const lista = this.equipos.filter(e => !q ||
      `${e.serial || ''} ${e.modelo_label || ''} ${e.asignacion?.contrato_id || ''}`.toUpperCase().includes(q));
    if (!lista.length) {
      cont.innerHTML = `<div class="cg-vacio">${this.equipos.length ? 'Ningún equipo coincide con el filtro.' : 'Sin equipos asignados en el inventario.'}</div>`;
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
      <td style="text-align:right;"><a class="btn btn-ghost" style="padding:4px 9px;font-size:12.5px;"
        href="../inventario/equipos.html?serial=${encodeURIComponent(e.serial || e.id)}">Kardex ›</a></td></tr>`).join('');
    cont.innerHTML = `<table class="cg-tabla"><thead><tr>
      <th>Serial</th><th>Modelo</th><th>Situación</th><th>Contrato</th><th></th>
      </tr></thead><tbody>${filas}</tbody></table>`;
  },

  pintarGestiones() {
    const cont = document.getElementById('fGestiones');
    if (!(this.gestiones || []).length) {
      cont.innerHTML = `<div class="cg-vacio">Sin gestiones registradas todavía.
        Los expedientes de reemplazo y demo se crean aquí a partir de la Ola 2;
        mientras tanto, usa el menú "Nueva gestión" para los flujos actuales.</div>`;
      return;
    }
    cont.innerHTML = this.gestiones.map(g => `
      <div class="cg-row" style="cursor:default;">
        <div style="min-width:0;"><div class="n cg-mono" style="font-size:13px;">${this.esc(g.id)}</div>
          <div class="s">${this.esc(GestionesService.tipoLabel(g.tipo))} · ${(g.items || []).length} ítem(s)</div></div>
        <span style="margin-left:auto; font-size:12.5px; font-weight:600; color:var(--fg-2);">
          ${this.esc(GestionesService.estadoLabel(g.estado))}</span>
      </div>`).join('');
  },

  /* ═════════ Menú "Nueva gestión" ═════════ */

  toggleMenu(e) {
    e.stopPropagation();
    document.getElementById('cgMenu').classList.toggle('hidden');
  },

  armarMenu() {
    const activos = this.contratos.filter(c => c.estado === 'activo');
    const bajas = activos.length
      ? activos.map(c => `<a href="../contratos/cancelaciones.html?contrato=${encodeURIComponent(c.id)}">
          Baja / terminación — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span></a>`).join('')
      : `<button class="off" type="button">Baja de equipos (sin contratos activos)</button>`;
    document.getElementById('cgMenu').innerHTML = `
      <div class="hd">Equipos</div>
      <button class="off" type="button" title="Llega con la Ola 2 del plan de gestiones">Reemplazo — próximamente</button>
      <button class="off" type="button" title="Llega con la Ola 2 del plan de gestiones">Demo — próximamente</button>
      ${bajas}
      <div class="hd">Comercial</div>
      <a href="../cotizaciones/index.html">Nueva cotización</a>
      <a href="../contratos/nuevo-contrato.html">Nuevo contrato / aumento</a>
      <div class="hd">Cliente</div>
      <a href="./index.html">Editar datos del cliente</a>`;
  },
};
