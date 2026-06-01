/**
 * admin-index.js — coordinator for the admin landing panel (KPIs + alerts).
 *
 * Lifecycle:
 *  1. Auth gate: requires ROLES.ADMIN, redirects otherwise.
 *  2. First load: fires loadAll() to populate the 4 stat cards.
 *  3. Refresh: manual button + optional 60s auto-refresh (pauses on hidden tab).
 *
 * Uses AdminMetrics for pure aggregation; all I/O via existing services.
 */
(function () {
  'use strict';

  const AUTO_REFRESH_MS = 60_000;

  const ESTADOS_ABIERTOS = new Set([
    'POR ASIGNAR', 'EN PROCESO', 'DIAGNÓSTICO', 'EN ESPERA', 'LISTA',
    'PROGRAMACIÓN', 'ESTIMACIÓN', 'RECEPCIONADA',
  ]);

  const state = {
    autoOn: false,
    timer: null,
    loading: false,
    lastLoadAt: null,
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

  async function loadOrdenesKPI() {
    try {
      const all = await OrdenesService.listAll();
      const live = all.filter(o => o.eliminado !== true);
      const abiertas = AdminMetrics.countWhere(live, o => ESTADOS_ABIERTOS.has((o.estado_reparacion || '').toUpperCase()));
      const completadas = AdminMetrics.countWhere(live, o => (o.estado_reparacion || '').toUpperCase() === 'COMPLETADA');
      const entregadas = AdminMetrics.countWhere(live, o => (o.estado_reparacion || '').toUpperCase() === 'ENTREGADA');
      setStat('kpiOrdenes', abiertas.toLocaleString('es-PA'),
        `<span class="tag">${completadas}</span> completadas · <span class="tag">${entregadas}</span> entregadas`);
    } catch (err) {
      console.error('[admin] ordenes KPI:', err);
      setStatError('kpiOrdenes');
    }
  }

  async function loadContratosKPI() {
    try {
      const all = await ContratosService.listContratos({ limit: 1000 });
      const items = Array.isArray(all) ? all : (all?.contratos || []);
      const pendientes = AdminMetrics.countWhere(items, c => c.estado === 'pendiente_aprobacion');
      const aprobados = AdminMetrics.countWhere(items, c => c.estado === 'aprobado');
      const activos = AdminMetrics.countWhere(items, c => c.estado === 'activo');
      setStat('kpiContratos', pendientes.toLocaleString('es-PA'),
        `<span class="tag">${aprobados}</span> aprobados · <span class="tag">${activos}</span> activos`);
    } catch (err) {
      console.error('[admin] contratos KPI:', err);
      setStatError('kpiContratos');
    }
  }

  async function loadCotizacionesKPI() {
    try {
      const result = await CotizacionesService.listCotizaciones({ limit: 500 });
      const items = result?.items || result?.cotizaciones || (Array.isArray(result) ? result : []);
      const ahora = new Date();
      let vencenPronto = 0; let vencidas = 0; let enviadas = 0;
      for (const c of items) {
        const estado = (c.estado || '').toLowerCase();
        if (estado === 'enviada') enviadas++;
        if (estado === 'enviada' || estado === 'aprobada') {
          const d = AdminMetrics.daysUntilExpiry(c.fecha, c.validezDias || c.validez_dias || 15, ahora);
          if (d == null) continue;
          if (d < 0) vencidas++;
          else if (d <= 7) vencenPronto++;
        }
      }
      const venc = vencidas > 0
        ? `<span class="tag bad">${vencidas}</span> vencidas · <span class="tag warn">${vencenPronto}</span> en 7 días`
        : `<span class="tag warn">${vencenPronto}</span> en 7 días · <span class="tag">${enviadas}</span> enviadas`;
      setStat('kpiCotizaciones', vencenPronto.toLocaleString('es-PA'), venc);
    } catch (err) {
      console.error('[admin] cotizaciones KPI:', err);
      setStatError('kpiCotizaciones');
    }
  }

  async function loadPocKPI() {
    try {
      const all = await PocService.getPocDevices();
      const items = Array.isArray(all) ? all : [];
      const activos = AdminMetrics.countWhere(items, d => d.activo === true && d.deleted !== true);
      const conSim = AdminMetrics.countWhere(items, d => d.activo === true && d.deleted !== true && d.sim);
      const total = AdminMetrics.countWhere(items, d => d.deleted !== true);
      setStat('kpiPoc', activos.toLocaleString('es-PA'),
        `<span class="tag">${conSim}</span> con SIM · <span class="tag">${total}</span> totales`);
    } catch (err) {
      console.error('[admin] poc KPI:', err);
      setStatError('kpiPoc');
    }
  }

  async function checkBanners() {
    clearBanners();
    try {
      const usuarios = await firebase.firestore().collection('usuarios').get();
      const sinRol = usuarios.docs.filter(d => !d.data().rol);
      if (sinRol.length > 0) {
        renderBanner('warning',
          `<span class="alert-title">${sinRol.length} usuario(s) sin rol asignado.</span> ` +
          `Edita estos documentos en la consola de Firestore (colección <code>usuarios</code>) para asignarles un rol.`);
      }
    } catch (err) {
      console.warn('[admin] banner usuarios:', err);
    }
    // Refresh icons after appending.
    if (window.lucide) lucide.createIcons();
  }

  async function loadAll() {
    if (state.loading) return;
    state.loading = true;
    setLoadingAll();
    try {
      await Promise.all([
        loadOrdenesKPI(),
        loadContratosKPI(),
        loadCotizacionesKPI(),
        loadPocKPI(),
        checkBanners(),
      ]);
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
