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
        this._wire();
        const params = new URLSearchParams(location.search);
        const id = params.get('id');
        this.gSel = params.get('g') || null;   // deep-link al expediente (correos)
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

  esVendedor() { return this.rol === ROLES.VENDEDOR; },

  setCartera(v) {
    if (this.esVendedor()) return;   // el vendedor no sale de su cartera
    this.cartera = v;
    this.cargarLista(true);
  },

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
      ['derivacion', 'Fin de facturación aplicado', 'Derivado en cada contrato + devolución por serial'],
      ['entrada', 'Entrada de los equipos', 'Check-in de la devolución; inspección antes de disposición'],
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
      cont.innerHTML = `<div class="cg-vacio">Sin gestiones registradas todavía —
        crea la primera con el botón "Nueva gestión".</div>`;
      return;
    }
    cont.innerHTML = this.gestiones.map(g => {
      const done = ['asignacion', 'programacion', 'entrega', 'entrada']
        .filter(k => g.cierre?.[k] === true).length;
      const fecha = g.fecha_solicitud?.toDate ? g.fecha_solicitud.toDate().toLocaleDateString('es-PA') : '—';
      const abierta = this.gSel === g.id;
      return `
      <div class="cg-row" role="button" tabindex="0" onclick="Centro.toggleGestion('${this.esc(g.id)}')"
           onkeydown="if(event.key==='Enter')this.click()" style="${abierta ? 'border-color:var(--accent);' : ''}">
        <div style="min-width:0;"><div class="n cg-mono" style="font-size:13px;">${this.esc(g.id)}</div>
          <div class="s">${this.esc(GestionesService.tipoLabel(g.tipo))} · ${g.tipo === 'demo'
            ? this.esc((g.demo?.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`).join(', ') || '—')
            : `${(g.items || []).length} serial(es)`} · ${fecha}</div></div>
        <span class="num" style="margin-left:auto; font-size:12px; color:var(--fg-3);">${done}/4</span>
        <span style="font-size:12.5px; font-weight:600; color:var(--fg-2);">
          ${this.esc(GestionesService.estadoLabel(g.estado))}</span>
        <span class="arr">${abierta ? '▾' : '›'}</span>
      </div>
      ${abierta ? this._detalleGestion(g) : ''}`;
    }).join('');
  },

  _detalleGestion(g) {
    const defs = this.CIERRE_DEFS[g.tipo] || this.CIERRE_DEFS.reemplazo;
    const check = defs.map(([k, t, s]) => `
      <div style="display:flex; gap:9px; align-items:flex-start; margin-bottom:7px;">
        <span style="width:18px;height:18px;border-radius:5px;flex:none;display:grid;place-items:center;
          ${g.cierre?.[k] ? 'background:#1FA56B;color:#fff;' : 'border:1.5px solid var(--border-default);'}
          font-size:12px;">${g.cierre?.[k] ? '✓' : ''}</span>
        <span style="font-size:13px;"><b>${t}</b><br><span style="color:var(--fg-3);font-size:12px;">${s}</span></span>
      </div>`).join('');

    const ordenes = [
      ...((g.ordenes?.programacion_ids || (g.ordenes?.programacion_id ? [g.ordenes.programacion_id] : []))
        .map(id => ({ id, tipo: 'PROGRAMACIÓN' }))),
      ...(g.ordenes?.devolucion_id ? [{ id: g.ordenes.devolucion_id, tipo: 'DEVOLUCIÓN' }] : []),
      ...(g.ordenes?.entrada_id ? [{ id: g.ordenes.entrada_id, tipo: 'ENTRADA' }] : []),
    ];
    const osHtml = ordenes.length
      ? `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">${ordenes.map(o =>
          `<a class="btn btn-ghost" style="padding:4px 11px;font-size:12.5px;"
             href="../ordenes/editar-orden.html?id=${encodeURIComponent(o.id)}">
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
        </tbody></table></div>
        ${g.anexo_firmado_path ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:8px 0 0;">✓ Anexo firmado registrado (${this.esc(g.anexo_firmado_por || '')})</p>` : ''}
        ${asignando
          ? `<div style="margin-top:10px;">${Array.from({ length: total }, (_, ix) => `
              <input class="form-input" style="max-width:200px;padding:5px 9px;font-size:13px;margin:0 6px 6px 0;display:inline-block;"
                data-gaum="${ix}" placeholder="Serial ${ix + 1}…" value="${this.esc(asignados[ix]?.serial || '')}">`).join('')}
             <div style="margin-top:6px;"><button class="btn btn-primary" onclick="Centro.guardarAsignacionAumento('${this.esc(g.id)}')">
               Guardar asignación</button></div></div>`
          : (asignados.length ? `<p style="font-size:13px; margin:8px 0 0;"><b>Seriales:</b>
              ${asignados.map(s => `<span class="cg-mono">${this.esc(s.serial)}</span>`).join(', ')}</p>` : '')}`;
    } else if (g.tipo === 'baja') {
      const pen = g.penalidad_estimada;
      cuerpo = `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
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
          <p style="font-size:13px; margin:10px 0 4px;"><b>Penalidad estimada por contrato</b>
            <span style="color:var(--fg-4);">(no vencido: 3 meses de mensualidad · vencido: 30 días)</span></p>
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
          ? `<div>${Array.from({ length: total }, (_, ix) => `
              <input class="form-input" style="max-width:200px;padding:5px 9px;font-size:13px;margin:0 6px 6px 0;display:inline-block;"
                data-gdemo="${ix}" placeholder="Serial ${ix + 1}…" value="${this.esc(asignados[ix]?.serial || '')}">`).join('')}
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
      aprobacion = `<div class="cg-senal warn" style="margin:10px 0 0;">
           <span>${esBaja
             ? 'Baja esperando aprobación (una sola, con el desglose por contrato a la izquierda).'
             : esAumento
               ? 'Aumento esperando aprobación comercial — al aprobar, se imprime el anexo para la firma del cliente.'
               : 'Excepción por servicio al cliente (propio sin garantía) — requiere aprobación de administración.'}</span>
           ${puede ? `<span style="margin-left:auto; display:flex; gap:8px;">
             <button class="btn btn-primary" style="padding:4px 12px;font-size:12.5px;"
               onclick="Centro.${fnAprobar}('${this.esc(g.id)}')">Aprobar</button>
             <button class="btn btn-ghost" style="padding:4px 10px;font-size:12.5px;" onclick="Centro.anularGestion('${this.esc(g.id)}')">Rechazar</button>
           </span>` : ''}</div>`;
    } else if (g.estado === 'pendiente_firma' && g.tipo === 'aumento') {
      aprobacion = `<div class="cg-senal info" style="margin:10px 0 0;">
           <span><b>Esperando la firma del cliente.</b> Imprime el anexo (deja explícito el período propio
             del equipo nuevo), recoge la firma y sube el archivo firmado — recién entonces el sistema
             aplica las líneas y avisa a Bodega.</span>
           ${this.puedeCrearGestion() ? `<span style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
             <a class="btn btn-ghost" style="padding:4px 11px;font-size:12.5px;" target="_blank"
                href="./anexo-aumento.html?g=${encodeURIComponent(g.id)}">Imprimir anexo</a>
             <label class="btn btn-primary" style="padding:4px 12px;font-size:12.5px; cursor:pointer;">Subir firmado
               <input type="file" accept="application/pdf,image/*" style="display:none;"
                 onchange="Centro.subirAnexo('${this.esc(g.id)}', this.files[0])"></label>
           </span>` : ''}</div>`;
    }
    const anular = (this.puedeAprobar() || this.rol === ROLES.GERENTE)
      && !['cerrada', 'anulada', 'pendiente_aprobacion'].includes(g.estado)
      && !g.cierre?.entrega
      ? `<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;color:var(--fg-4);"
           onclick="Centro.anularGestion('${this.esc(g.id)}')">Anular gestión</button>`
      : '';

    return `<div class="ds-card" style="padding:var(--sp-4); margin:-4px 0 10px; border-top:none;">
      <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:16px;">
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
      Toast.show('Gestión anulada', 'ok');
      await this.recargarGestiones();
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
    const activos = this.contratos.filter(c => c.estado === 'activo');
    const terminaciones = activos.map(c => `<a href="../contratos/cancelaciones.html?contrato=${encodeURIComponent(c.id)}">
          Terminación total — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span></a>`).join('');
    document.getElementById('cgMenu').innerHTML = `
      <div class="hd">Equipos</div>
      <button type="button" onclick="Centro.wizReemplazo()">Reemplazo de equipo</button>
      <button type="button" onclick="Centro.wizDemo()">Demo de equipos</button>
      <button type="button" onclick="Centro.wizBaja()">Baja de equipos (por serial)</button>
      ${activos.length ? '<button type="button" onclick="Centro.wizAumento()">Aumento de equipos (enmienda)</button>' : ''}
      ${terminaciones}
      <div class="hd">Comercial</div>
      <a href="../cotizaciones/index.html">Nueva cotización</a>
      <a href="../contratos/nuevo-contrato.html">Nuevo contrato</a>
      <div class="hd">Cliente</div>
      <a href="./index.html">Editar datos del cliente</a>`;
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
    m.innerHTML = `<div class="cg-modal">${html}</div>`;
    m.classList.remove('hidden');
    m.onclick = (e) => { if (e.target === m) this._cerrarModal(); };
    document.addEventListener('keydown', this._escModal);
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
        </tr></thead><tbody>${filas || '<tr><td colspan="5" class="cg-vacio">El cliente no tiene equipos en campo.</td></tr>'}</tbody></table></div>
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

  async wizAumento() {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await this._cargarModelos();
    const activos = this.contratos.filter(c => c.estado === 'activo');
    if (!activos.length) { Toast.show('El cliente no tiene contratos activos', 'warn'); return; }
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Aumento de equipos (enmienda) — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        La enmienda agrega líneas al contrato existente <b>con vigencia propia</b>: el período del equipo
        nuevo corre desde su entrega y vence más tarde que el resto — el anexo lo deja explícito y
        <b>requiere la firma del cliente</b> antes de aplicarse.</p>
      <div class="form-field" style="margin-bottom:10px; max-width:340px;">
        <label class="form-label">Contrato destino</label>
        <select class="form-select" id="waContrato">
          ${activos.map(c => `<option value="${this.esc(c.id)}">${this.esc(c.contrato_id || c.id)} · ${this.esc(c.tipo_contrato || '')}</option>`).join('')}
        </select></div>
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
        <div id="waLineas">${this._lineaModeloHtml('wau', true)}</div>
        <button class="btn btn-ghost" style="padding:4px 10px; font-size:12.5px;"
          onclick="Centro._addLineaModelo('waLineas','wau',true)">+ Agregar otro modelo</button></div>
      <div class="form-field" style="margin-bottom:12px; max-width:220px;">
        <label class="form-label">Vigencia del tramo (meses)</label>
        <input class="form-input" type="number" id="waMeses" min="1" value="18"></div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearAumento()">Enviar a aprobación</button>
      </div>`);
  },

  async crearAumento() {
    const contratoDocId = document.getElementById('waContrato')?.value || '';
    const contrato = this.contratos.find(c => c.id === contratoDocId);
    if (!contrato) { Toast.show('Elige el contrato destino', 'warn'); return; }
    const selects = [...document.querySelectorAll('select[data-wau-modelo]')];
    const cants = [...document.querySelectorAll('input[data-wau-cant]')];
    const precios = [...document.querySelectorAll('input[data-wau-precio]')];
    const lineas = selects.map((s, i) => {
      const m = this._modeloDeSelect(s);
      return m ? {
        modelo: m.label, modelo_id: m.id,
        cantidad: Math.max(1, Number(cants[i]?.value || 1)),
        precio: Number(precios[i]?.value || 0),
      } : null;
    }).filter(Boolean);
    if (!lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
    if (lineas.some(l => !(l.precio > 0))) { Toast.show('Cada línea necesita su precio mensual', 'warn'); return; }
    const meses = Number(document.getElementById('waMeses')?.value || 0);
    if (!(meses > 0)) { Toast.show('Indica la vigencia del tramo en meses', 'warn'); return; }
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

  // Penalidad estimada según el tramo de cada ítem (decisión §8.4): contrato
  // no vencido → 3 meses de mensualidad de la línea; vencido → 30 días (~1
  // mensualidad; la factura corriente + prorrateo exactos los emite finanzas).
  _penalidadBaja(items) {
    const por = new Map();
    for (const it of items) {
      const c = this.contratos.find(x => x.id === it.contrato_doc_id);
      if (!c) continue;
      const linea = (c.equipos || []).find(l =>
        (l.modelo_id && it.modelo_id && l.modelo_id === it.modelo_id) ||
        String(l.modelo || '').trim().toUpperCase() === String(it.modelo || '').trim().toUpperCase());
      const precio = Number(linea?.precio || 0);
      const dias = this._diasA(c.fecha_vencimiento);
      const vencido = dias !== null && dias < 0;
      const cur = por.get(c.id) || { contrato_id: c.contrato_id || c.id, monto: 0, unidades: 0, vencido, sinPrecio: false };
      cur.monto += vencido ? precio : precio * 3;
      cur.unidades += 1;
      if (!precio) cur.sinPrecio = true;
      por.set(c.id, cur);
    }
    const lista = [...por.values()].map(p => ({
      contrato_id: p.contrato_id,
      monto: Math.round(p.monto * 100) / 100,
      detalle: `${p.unidades} unid. · ${p.vencido ? 'contrato vencido: 30 días' : 'no vencido: 3 meses de mensualidad'}${p.sinPrecio ? ' · ⚠ línea sin precio' : ''}`,
    }));
    return { por_contrato: lista, total: Math.round(lista.reduce((s, p) => s + p.monto, 0) * 100) / 100 };
  },

  wizBaja() {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    const elegibles = this.equipos.filter(e =>
      ['en_cliente', 'asignado_contrato'].includes(e.estado) && e.asignacion?.contrato_doc_id);
    const finMes = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); })();
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Baja de equipos — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        Marca los seriales a dar de baja (pueden ser de contratos distintos — una sola aprobación con el
        desglose). El sistema calcula la penalidad por tramo y, al aprobarse, deriva el fin de facturación
        en cada contrato y crea la orden de devolución por serial.</p>
      <div class="cg-twrap" style="max-height:38vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th>
        </tr></thead><tbody>
        ${elegibles.map((e, ix) => `<tr>
          <td><input type="checkbox" data-bsel="${this.equipos.indexOf(e)}" onchange="Centro._bajaPreview()"></td>
          <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
          <td>${this.esc(e.modelo_label || '—')}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(e.asignacion?.contrato_id || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="cg-vacio">Sin equipos con contrato en campo.</td></tr>'}
      </tbody></table></div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
        <select class="form-select" id="wbMotivo" style="max-width:250px;">
          <option value="">— Motivo —</option>
          ${this.MOTIVOS_BAJA.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
        </select>
        <input class="form-input" id="wbDet" style="flex:1; min-width:180px;" placeholder="Detalle (opcional)">
        <label style="display:flex; align-items:center; gap:6px; font-size:13px;">Fin de facturación
          <input class="form-input" type="date" id="wbFin" value="${finMes}" style="width:150px;"></label>
      </div>
      <div id="wbPen" style="margin-top:12px;"></div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearBaja()">Enviar a aprobación</button>
      </div>`);
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
      };
    });
  },

  _bajaPreview() {
    const items = this._bajaItemsSeleccion();
    const pen = this._penalidadBaja(items);
    document.getElementById('wbPen').innerHTML = items.length ? `
      <p style="font-size:13px; margin:0 0 4px;"><b>Penalidad estimada</b>
        <span style="color:var(--fg-4);">(no vencido: 3 meses · vencido: 30 días)</span></p>
      ${pen.por_contrato.map(p => `<div style="display:flex; gap:10px; font-size:13px; padding:2px 0;">
        <span class="cg-mono">${this.esc(p.contrato_id)}</span>
        <span style="color:var(--fg-3);">${this.esc(p.detalle)}</span>
        <b style="margin-left:auto;" class="num">$${p.monto.toFixed(2)}</b></div>`).join('')}
      <div style="display:flex; font-size:13.5px; border-top:1px solid var(--border-subtle); padding-top:4px;">
        <b>Total estimado</b><b style="margin-left:auto;" class="num">$${pen.total.toFixed(2)}</b></div>` : '';
  },

  async crearBaja() {
    const base = this._bajaItemsSeleccion();
    if (!base.length) { Toast.show('Marca al menos un serial', 'warn'); return; }
    const motivo = document.getElementById('wbMotivo')?.value || '';
    if (!motivo) { Toast.show('Indica el motivo de la baja', 'warn'); return; }
    const detalle = document.getElementById('wbDet')?.value.trim() || '';
    const fin = document.getElementById('wbFin')?.value || '';
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
      });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`Baja ${gid} enviada a aprobación`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear la baja', 'bad'); }
  },
};
