/**
 * admin-auditoria.js — timeline of recent audit events.
 *
 * Renders a chronological list of:
 *  - Order transitions (ASIGNAR, COMPLETAR, ENTREGAR — from os_logs)
 *  - Contract transitions (APROBAR, ANULAR — from fecha_* fields;
 *    REEMPLAZAR_FIRMADO — from firmado_historial[])
 *  - PII purges (PURGAR_ID — from identificacion_purged_at)
 *
 * Filters: by type (chips), by free text (id/cliente), by person and by date
 * range — all client-side over what was loaded (auditoría UX 2026-09-28).
 * User UIDs are resolved to names via UsuariosService.getUsuariosByIds in batch.
 */
(function () {
  'use strict';

  const state = {
    events: [],
    filtered: [],
    // Mismos tipos que los chips activos del HTML (auditoría UX 2026-09-28:
    // 'usuario' faltaba y el chip "Usuarios" se veía activo sin filtrar).
    types: new Set(['orden', 'contrato', 'pii', 'usuario', 'config', 'datos']),
    text: '',
    persona: '',
    desde: null,   // ms, inicio del día
    hasta: null,   // ms, fin del día
    userMap: Object.create(null),
  };

  const ACTION_META = {
    ASIGNAR:                { icon: 'user-check',  color: '#2563eb', label: 'Asignar técnico' },
    COMPLETAR:              { icon: 'check-circle', color: '#15803d', label: 'Completar orden' },
    ENTREGAR:               { icon: 'truck',       color: '#0f766e', label: 'Entregar orden' },
    CERRAR_ENTRADA:         { icon: 'package-check', color: '#15803d', label: 'Cerrar entrada' },
    DEVOLUCION_ACUSE:       { icon: 'pen-line',    color: '#0f766e', label: 'Acuse de recepción firmado' },
    // Cambiar el serial de un equipo re-apunta el inventario: rojo, no gris.
    EDITAR_SERIAL:          { icon: 'scan-line',   color: '#b45309', label: 'Editar serial de un equipo' },
    CORREGIR_SERIAL:        { icon: 'scan-line',   color: '#b45309', label: 'Corregir serial (script)' },
    APROBAR:                { icon: 'badge-check', color: '#15803d', label: 'Aprobar contrato' },
    ANULAR:                 { icon: 'x-octagon',   color: '#b91c1c', label: 'Anular contrato' },
    REEMPLAZAR_FIRMADO:     { icon: 'refresh-cw',  color: '#b45309', label: 'Reemplazar contrato firmado' },
    PURGAR_ID:              { icon: 'shield-x',    color: '#7c2d12', label: 'Purgar foto ID' },
    USUARIO_CREATE:         { icon: 'user-plus',   color: '#15803d', label: 'Crear usuario' },
    USUARIO_UPDATE_ROL:     { icon: 'shield',      color: '#2563eb', label: 'Cambiar rol' },
    USUARIO_DEACTIVATE:     { icon: 'user-x',      color: '#b91c1c', label: 'Desactivar usuario' },
    USUARIO_REACTIVATE:     { icon: 'user-check',  color: '#15803d', label: 'Reactivar usuario' },
    USUARIO_RESET_PASSWORD: { icon: 'key',         color: '#7c2d12', label: 'Reset de contraseña' },
    CONFIG_GUARDAR:         { icon: 'sliders-horizontal', color: '#2563eb', label: 'Cambiar configuración' },
    FUSION_CLIENTES:        { icon: 'git-merge',   color: '#b45309', label: 'Fusionar clientes duplicados' },
    BACKFILL:               { icon: 'database',    color: '#7c2d12', label: 'Ejecutar migración de datos' },
  };

  // Qué es la referencia de cada tipo de evento (antes todo lo que no era
  // contrato decía "Orden", también los usuarios).
  const REF_LABEL = {
    orden: 'Orden', contrato: 'Contrato', pii: 'Foto de cédula de la orden',
    usuario: 'Usuario', config: 'Pantalla', datos: '',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  function fmtTs(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('es-PA', { hour12: false });
  }

  function userLabel(uid, fallback) {
    if (!uid) return fallback || 'sistema';
    const u = state.userMap[uid];
    if (!u) return fallback || (uid.slice(0, 8) + '…');
    return u.nombre || u.email || fallback || uid.slice(0, 8) + '…';
  }

  function renderTimeline() {
    const el = $('timeline');
    if (!el) return;

    if (!state.filtered.length) {
      el.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-4);text-align:center;color:var(--fg-3);">Sin eventos para los filtros actuales.</div>`;
      setText('countShowing', 'Mostrando 0');
      return;
    }

    const html = state.filtered.slice(0, 200).map(e => {
      const meta = ACTION_META[e.action] || { icon: 'circle', color: 'var(--fg-3)', label: e.action };
      const refLink = e.link
        ? `<a href="${escapeHtml(e.link)}" style="color:inherit;text-decoration:underline;">${escapeHtml(e.refLabel)}</a>`
        : escapeHtml(e.refLabel);
      return `
        <div class="audit-row">
          <div class="audit-icon" style="color:${meta.color}"><i data-lucide="${meta.icon}"></i></div>
          <div class="audit-body">
            <div class="audit-head">
              <span class="audit-action">${meta.label}</span>
              <span class="audit-ref">${REF_LABEL[e.type] ?? ''} <strong>${refLink}</strong></span>
              ${e.cliente ? `<span class="audit-cliente">— ${escapeHtml(e.cliente)}</span>` : ''}
            </div>
            <div class="audit-sub">
              <span>${fmtTs(e.ts)}</span>
              <span>·</span>
              <span>por <strong>${escapeHtml(userLabel(e.by, e.byNombre))}</strong></span>
              ${e.meta ? `<span>·</span><span>${escapeHtml(e.meta)}</span>` : ''}
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
    const persona = state.persona.toLowerCase();
    state.filtered = state.events.filter(e => {
      if (!state.types.has(e.type)) return false;
      if (state.desde != null && (e.ts || 0) < state.desde) return false;
      if (state.hasta != null && (e.ts || 0) > state.hasta) return false;
      if (persona) {
        // Persona = quien hizo la acción: nombre, correo o uid.
        const u = e.by ? state.userMap[e.by] : null;
        const hay = [e.by, e.byNombre, e.byEmail, u?.nombre, u?.email]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(persona)) return false;
      }
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

    const persona = $('personaInput');
    if (persona) {
      let t = null;
      persona.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { state.persona = persona.value.trim(); applyFilters(); }, 200);
      });
    }
    // Fechas en hora local (Panamá): desde = 00:00, hasta = 23:59:59.
    const diaMs = (v, fin) => {
      if (!v) return null;
      const [y, m, d] = v.split('-').map(Number);
      return fin ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
    };
    $('fechaDesde')?.addEventListener('change', (e) => { state.desde = diaMs(e.target.value, false); applyFilters(); });
    $('fechaHasta')?.addEventListener('change', (e) => { state.hasta = diaMs(e.target.value, true); applyFilters(); });

    // ?tipo=config (desde Configuración): solo ese tipo activo.
    const tipoQs = new URLSearchParams(location.search).get('tipo');
    if (tipoQs && document.querySelector(`.chip[data-type="${CSS.escape(tipoQs)}"]`)) {
      state.types = new Set([tipoQs]);
      document.querySelectorAll('.chip[data-type]').forEach(c => c.classList.toggle('is-active', c.dataset.type === tipoQs));
    }

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
