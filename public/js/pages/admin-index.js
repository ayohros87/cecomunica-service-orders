/**
 * admin-index.js — coordinator for the admin landing panel (KPIs + alerts).
 *
 * Lifecycle:
 *  1. Auth gate: requires ROLES.ADMIN, redirects otherwise.
 *  2. First load: fires loadAll() to populate the 4 stat cards.
 *  3. Refresh: manual button + optional 5-min auto-refresh (pauses on hidden tab).
 *
 * Uses AdminMetrics for pure aggregation; all I/O via existing services.
 */
(function () {
  'use strict';

  // 5 min, no 60s (2026-09-02, factura de agosto): con "Auto" encendido cada
  // ciclo baja ~4,000 docs (órdenes + contratos + cotizaciones + POC +
  // usuarios). A 60s eran ~240k lecturas/hora por pestaña abierta.
  const AUTO_REFRESH_MS = 300_000;

  // Los estados salen de AdminMetrics (auditoría UX 2026-09-28): el Set local
  // traía estados que no existen y el KPI contaba solo POR ASIGNAR.

  const state = {
    autoOn: false,
    timer: null,
    loading: false,
    lastLoadAt: null,
    metrics: {},  // {ordenes_abiertas, contratos_pendientes, cotizaciones_vencen, poc_activos}
  };

  function $(id) { return document.getElementById(id); }

  function setStat(id, value, sub) {
    const el = $(id);
    if (!el) return;
    const v = el.querySelector('.value');
    const s = el.querySelector('.sub');
    if (v) {
      v.textContent = value;
      v.classList.remove('is-loading');
    }
    if (s && sub != null) s.innerHTML = sub;
    el.classList.remove('is-error');
  }

  function setStatError(id, msg) {
    const el = $(id);
    if (!el) return;
    el.classList.add('is-error');
    const v = el.querySelector('.value');
    const s = el.querySelector('.sub');
    if (v) { v.textContent = msg || 'Error'; v.classList.remove('is-loading'); }
    if (s) s.textContent = '';
  }

  function setLoadingAll() {
    document.querySelectorAll('.stat-card .value').forEach(v => {
      v.classList.add('is-loading');
      v.textContent = '—';
    });
    document.querySelectorAll('.stat-card .sub').forEach(s => s.innerHTML = '&nbsp;');
  }

  function fmtTs(d) {
    if (!d) return '—';
    return d.toLocaleTimeString('es-PA', { hour12: false });
  }

  function renderBanner(kind, html) {
    const wrap = $('alertBanners');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = `alert-banner alert-${kind}`;
    div.innerHTML = `<i data-lucide="${kind === 'error' ? 'alert-octagon' : kind === 'warning' ? 'alert-triangle' : 'info'}"></i><div>${html}</div>`;
    wrap.appendChild(div);
  }

  function clearBanners() {
    const wrap = $('alertBanners');
    if (wrap) wrap.innerHTML = '';
  }

  // Conteo server-side (1 lectura facturada por agregado) en vez de bajar la
  // colección entera (2026-09-30): los cuatro KPIs bajaban ~9,300 docs por
  // carga, y se repetían con "Actualizar" y con el Auto de 5 min.
  // Verificado contra producción ese día: mismos números que el cálculo
  // sobre los documentos (órdenes 65/82/1239, contratos 49/203/109, POC
  // 3203/4590, cotizaciones 10/11/32).
  const contar = async (q) => (await q.count().get()).data().count;
  // total(q) − marcadas(q): las órdenes viejas no traen `eliminado` (ni todas
  // las fichas de POC `deleted`), así que no se puede filtrar "!= true" en el
  // servidor sin perderlas.
  const menos = (campo) => async (q) =>
    (await Promise.all([contar(q), contar(q.where(campo, '==', true))])).reduce((a, b) => a - b);
  const vivas = menos('eliminado');
  const sinCerradas = menos('deleted');

  async function loadOrdenesKPI() {
    try {
      const O = firebase.firestore().collection('ordenes_de_servicio');
      const abiertosQ = O.where('estado_reparacion', 'in', [...AdminMetrics.ESTADOS_ABIERTOS]);
      // Sin DEVOLUCION (2026-09-02): vive en "POR ASIGNAR" pero es un circuito
      // aparte (recuperación de equipos), no una orden de taller abierta.
      const [abiertasTodas, abiertasDev, completadas, entregadas] = await Promise.all([
        vivas(abiertosQ),
        vivas(abiertosQ.where('tipo_de_servicio', '==', 'DEVOLUCION')),
        vivas(O.where('estado_reparacion', '==', AdminMetrics.ESTADO_COMPLETADO)),
        vivas(O.where('estado_reparacion', '==', AdminMetrics.ESTADO_ENTREGADO)),
      ]);
      const abiertas = Math.max(0, abiertasTodas - abiertasDev);
      state.metrics.ordenes_abiertas = abiertas;
      setStat('kpiOrdenes', abiertas.toLocaleString('es-PA'),
        `<span class="tag">${completadas}</span> en oficina sin entregar · <span class="tag">${entregadas}</span> entregadas`);
    } catch (err) {
      console.error('[admin] ordenes KPI:', err);
      setStatError('kpiOrdenes');
    }
  }

  async function loadContratosKPI() {
    try {
      const C = firebase.firestore().collection('contratos');
      // Sin borrados (auditoría de módulos 2026-09-30, 08 R1): los 49
      // "pendientes" de la portada eran todos `deleted: true` — el home
      // (AprobacionesService) decía 0. Misma resta que el KPI de órdenes.
      const [pendientes, aprobados, activos] = await Promise.all(
        ['pendiente_aprobacion', 'aprobado', 'activo'].map(e => sinCerradas(C.where('estado', '==', e))));
      state.metrics.contratos_pendientes = pendientes;
      setStat('kpiContratos', pendientes.toLocaleString('es-PA'),
        `<span class="tag">${aprobados}</span> aprobados · <span class="tag">${activos}</span> activos`);
    } catch (err) {
      console.error('[admin] contratos KPI:', err);
      setStatError('kpiContratos');
    }
  }

  async function loadCotizacionesKPI() {
    try {
      // Solo enviadas/aprobadas: son las únicas que cuenta
      // contarCotizacionesPorVencer (antes se bajaban las últimas 500).
      const snap = await firebase.firestore().collection('cotizaciones')
        .where('estado', 'in', ['enviada', 'aprobada']).get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.deleted !== true);
      // Misma cuenta que "Probar" en alertas (auditoría UX 2026-09-28).
      const { porVencer: vencenPronto, vencidas, enviadas } =
        AdminMetrics.contarCotizacionesPorVencer(items, new Date());
      const venc = vencidas > 0
        ? `<span class="tag bad">${vencidas}</span> vencidas · <span class="tag warn">${vencenPronto}</span> en 7 días`
        : `<span class="tag warn">${vencenPronto}</span> en 7 días · <span class="tag">${enviadas}</span> enviadas`;
      state.metrics.cotizaciones_vencen = vencenPronto;
      setStat('kpiCotizaciones', vencenPronto.toLocaleString('es-PA'), venc);
    } catch (err) {
      console.error('[admin] cotizaciones KPI:', err);
      setStatError('kpiCotizaciones');
    }
  }

  async function loadPocKPI() {
    try {
      // Conteos en vez de las 6,498 fichas (~6.5 MB). "Con SIM" se quitó: es
      // un O entre sim_number y sim_phone y contarlo exige un índice
      // compuesto nuevo; el detalle vive en POC.
      const P = firebase.firestore().collection('poc_devices');
      const [activos, total] = await Promise.all([sinCerradas(P.where('activo', '==', true)), sinCerradas(P)]);
      state.metrics.poc_activos = activos;
      setStat('kpiPoc', activos.toLocaleString('es-PA'),
        `<span class="tag">${total}</span> totales`);
    } catch (err) {
      console.error('[admin] poc KPI:', err);
      setStatError('kpiPoc');
    }
  }

  async function checkBanners(usuariosEnVuelo = null) {
    clearBanners();
    try {
      const usuarios = await (usuariosEnVuelo || firebase.firestore().collection('usuarios').get());
      const sinRol = usuarios.docs.filter(d => !d.data().rol);
      const badge = $('usuariosSinRolBadge');
      if (badge) {
        badge.textContent = sinRol.length ? `${sinRol.length} sin rol` : '';
        badge.style.display = sinRol.length ? '' : 'none';
      }
      if (sinRol.length > 0) {
        // Enlace a Usuarios ya filtrado (auditoría UX 2026-09-28): antes
        // mandaba a la consola de Firestore aunque la pantalla existe.
        renderBanner('warning',
          `<span class="alert-title">${sinRol.length} usuario(s) sin rol asignado.</span> ` +
          `No pueden trabajar hasta tener uno. <a href="usuarios.html?filtro=sinrol">Asignarles un rol</a>.`);
      }
    } catch (err) {
      console.warn('[admin] banner usuarios:', err);
    }

    // Alertas configurables — evalúa empresa/config.alertas[] contra state.metrics.
    try {
      const alertas = window.EMPRESA_CONFIG?.alertas || [];
      const triggered = AdminMetrics.evaluateAlertas(alertas, state.metrics);
      for (const t of triggered) {
        const kind = (t.severity === 'error') ? 'error'
                   : (t.severity === 'info')  ? 'info'
                                              : 'warning';
        renderBanner(kind, `<span class="alert-title">${t.message}</span>`);
      }
    } catch (err) {
      console.warn('[admin] alertas configurables:', err);
    }

    // Refresh icons after appending.
    if (window.lucide) lucide.createIcons();
  }

  async function loadAll() {
    if (state.loading) return;
    state.loading = true;
    setLoadingAll();
    try {
      // KPIs y la lectura de usuarios (banner "sin rol") en paralelo
      // (2026-09-30); las alertas configurables se evalúan al final porque
      // necesitan state.metrics.
      const usuariosEnVuelo = firebase.firestore().collection('usuarios').get();
      usuariosEnVuelo.catch(() => {});
      await Promise.all([
        loadOrdenesKPI(),
        loadContratosKPI(),
        loadCotizacionesKPI(),
        loadPocKPI(),
      ]);
      await checkBanners(usuariosEnVuelo);
      state.lastLoadAt = new Date();
      const ts = $('lastUpdate');
      if (ts) ts.textContent = `Actualizado ${fmtTs(state.lastLoadAt)}`;
    } finally {
      state.loading = false;
    }
  }

  function scheduleAuto() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (!state.autoOn) return;
    state.timer = setInterval(() => {
      if (document.hidden) return;
      loadAll();
    }, AUTO_REFRESH_MS);
  }

  function wireToolbar() {
    const refresh = $('btnRefresh');
    if (refresh) refresh.addEventListener('click', () => loadAll());

    // El atajo Cmd/Ctrl+K ahora lo bindea layout.js para TODAS las páginas
    // (auditoría A2); llamar además SearchPalette.init() aquí duplicaba el
    // listener y el toggle se anulaba a sí mismo (abrir+cerrar en un golpe).
    if (window.SearchPalette) {
      $('btnSearch')?.addEventListener('click', () => SearchPalette.open());
    }

    const auto = $('btnAuto');
    if (auto) {
      auto.addEventListener('click', () => {
        state.autoOn = !state.autoOn;
        auto.classList.toggle('is-on', state.autoOn);
        auto.setAttribute('aria-pressed', String(state.autoOn));
        const label = auto.querySelector('.label-text');
        if (label) label.textContent = state.autoOn ? `Auto ${AUTO_REFRESH_MS / 1000}s` : 'Auto';
        scheduleAuto();
      });
    }

    // Pause/resume on tab visibility — auto-refresh only ticks while visible.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.autoOn) loadAll();
    });
  }

  function initAdmin() {
    wireToolbar();
    loadAll();
  }

  // Entry point — guard then init.
  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        if (window.Toast) Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      initAdmin();
    });
  });

  // Expose for sub-pages that want to re-trigger
  window.AdminIndex = { loadAll };
})();
