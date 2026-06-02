/**
 * admin-auditoria.js — timeline of recent audit events.
 *
 * Renders a chronological list of:
 *  - Order transitions (ASIGNAR, COMPLETAR, ENTREGAR — from os_logs)
 *  - Contract transitions (APROBAR, ANULAR — from fecha_* fields)
 *  - PII purges (PURGAR_ID — from identificacion_purged_at)
 *
 * Filters: by type (chips), by free text (id/cliente).
 * User UIDs are resolved to names via UsuariosService.getUsuariosByIds in batch.
 */
(function () {
  'use strict';

  const state = {
    events: [],
    filtered: [],
    types: new Set(['orden', 'contrato', 'pii']),
    text: '',
    userMap: Object.create(null),
  };

  const ACTION_META = {
    ASIGNAR:                { icon: 'user-check',  color: '#2563eb', label: 'Asignar técnico' },
    COMPLETAR:              { icon: 'check-circle', color: '#15803d', label: 'Completar orden' },
    ENTREGAR:               { icon: 'truck',       color: '#0f766e', label: 'Entregar orden' },
    APROBAR:                { icon: 'badge-check', color: '#15803d', label: 'Aprobar contrato' },
    ANULAR:                 { icon: 'x-octagon',   color: '#b91c1c', label: 'Anular contrato' },
    PURGAR_ID:              { icon: 'shield-x',    color: '#7c2d12', label: 'Purgar foto ID' },
    USUARIO_CREATE:         { icon: 'user-plus',   color: '#15803d', label: 'Crear usuario' },
    USUARIO_UPDATE_ROL:     { icon: 'shield',      color: '#2563eb', label: 'Cambiar rol' },
    USUARIO_DEACTIVATE:     { icon: 'user-x',      color: '#b91c1c', label: 'Desactivar usuario' },
    USUARIO_REACTIVATE:     { icon: 'user-check',  color: '#15803d', label: 'Reactivar usuario' },
    USUARIO_RESET_PASSWORD: { icon: 'key',         color: '#7c2d12', label: 'Reset de contraseña' },
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  function fmtTs(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('es-PA', { hour12: false });
  }

  function userLabel(uid) {
    if (!uid) return 'sistema';
    const u = state.userMap[uid];
    if (!u) return uid.slice(0, 8) + '…';
    return u.nombre || u.email || uid.slice(0, 8) + '…';
  }

  function renderTimeline() {
    const el = $('timeline');
    if (!el) return;

    if (!state.filtered.length) {
      el.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-4);text-align:center;color:var(--fg-3);">Sin eventos para los filtros actuales.</div>`;
      return;
    }

    const html = state.filtered.slice(0, 200).map(e => {
      const meta = ACTION_META[e.action] || { icon: 'circle', color: 'var(--fg-3)', label: e.action };
      const refLink = e.link
        ? `<a href="${e.link}" style="color:inherit;text-decoration:underline;">${e.refLabel}</a>`
        : e.refLabel;
      return `
        <div class="audit-row">
          <div class="audit-icon" style="color:${meta.color}"><i data-lucide="${meta.icon}"></i></div>
          <div class="audit-body">
            <div class="audit-head">
              <span class="audit-action">${meta.label}</span>
              <span class="audit-ref">${e.type === 'contrato' ? 'Contrato' : 'Orden'} <strong>${refLink}</strong></span>
              ${e.cliente ? `<span class="audit-cliente">— ${e.cliente}</span>` : ''}
            </div>
            <div class="audit-sub">
              <span>${fmtTs(e.ts)}</span>
              <span>·</span>
              <span>por <strong>${userLabel(e.by)}</strong></span>
              ${e.meta ? `<span>·</span><span>${e.meta}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = html;
    setText('countShowing', `Mostrando ${Math.min(state.filtered.length, 200)} de ${state.filtered.length}`);
    if (window.lucide) lucide.createIcons();
  }

  function applyFilters() {
    const txt = state.text.toLowerCase();
    state.filtered = state.events.filter(e => {
      if (!state.types.has(e.type)) return false;
      if (!txt) return true;
      return (e.refLabel || '').toLowerCase().includes(txt) ||
             (e.cliente  || '').toLowerCase().includes(txt) ||
             (e.action   || '').toLowerCase().includes(txt);
    });
    renderTimeline();
  }

  async function resolveUsers() {
    const uids = Array.from(new Set(state.events.map(e => e.by).filter(Boolean)));
    if (!uids.length) return;
    try {
      const users = await UsuariosService.getUsuariosByIds(uids);
      users.forEach(u => { state.userMap[u.id] = u; });
    } catch (err) {
      console.warn('[admin/auditoria] resolveUsers:', err);
    }
  }

  async function loadAll() {
    setText('lastUpdate', 'Cargando…');
    try {
      state.events = await AuditoriaService.getTimelineEvents({ limitPerSource: 300 });
      await resolveUsers();
      applyFilters();
      setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
      setText('countTotal', `${state.events.length} eventos cargados`);
    } catch (err) {
      console.error('[admin/auditoria]', err);
      if (window.Toast) Toast.show('Error cargando auditoría: ' + (err.message || err.code || err), 'bad');
    }
  }

  function wireToolbar() {
    const refresh = $('btnRefresh');
    if (refresh) refresh.addEventListener('click', () => loadAll());

    document.querySelectorAll('.chip[data-type]').forEach(chip => {
      chip.addEventListener('click', () => {
        const t = chip.dataset.type;
        if (state.types.has(t)) state.types.delete(t);
        else state.types.add(t);
        chip.classList.toggle('is-active', state.types.has(t));
        applyFilters();
      });
    });

    const search = $('searchInput');
    if (search) {
      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.text = search.value.trim();
          applyFilters();
        }, 200);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        if (window.Toast) Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      wireToolbar();
      loadAll();
    });
  });
})();
