/**
 * admin-alertas.js — editor visual de empresa/config.alertas[].
 *
 * Cada alerta: { id, kind, threshold, severity, message?, enabled }
 * Renderiza tabla de alertas existentes con campos editables in-place,
 * "Agregar" para crear nueva (con UUID local), "Eliminar" por fila,
 * "Guardar todo" persiste el array completo via EmpresaService.setConfig.
 *
 * Botón "Probar contra métricas actuales" carga los KPIs del panel admin
 * para mostrar qué alertas dispararían ahora mismo.
 */
(function () {
  'use strict';

  const KIND_CHOICES = Object.entries(AdminMetrics.ALERT_KINDS).map(([k, m]) => ({ value: k, label: m.label }));
  const SEVERITY_CHOICES = [
    { value: 'info',    label: 'Info' },
    { value: 'warning', label: 'Aviso' },
    { value: 'error',   label: 'Error' },
  ];

  const state = {
    alertas: [],
    dirty: false,
  };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uuid() {
    return 'a-' + Math.random().toString(36).slice(2, 10);
  }

  function markDirty() {
    state.dirty = true;
    const btn = $('btnSave');
    if (btn) { btn.classList.add('btn-primary'); btn.disabled = false; }
  }

  function renderTable() {
    const el = $('tblAlertas');
    if (!el) return;
    if (!state.alertas.length) {
      el.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-4);text-align:center;color:var(--fg-3);">No hay alertas configuradas. Click "Agregar" para crear la primera.</div>`;
      return;
    }
    const kindOpts = (sel) => KIND_CHOICES.map(c => `<option value="${c.value}"${c.value === sel ? ' selected' : ''}>${c.label}</option>`).join('');
    const sevOpts  = (sel) => SEVERITY_CHOICES.map(c => `<option value="${c.value}"${c.value === sel ? ' selected' : ''}>${c.label}</option>`).join('');
    const rows = state.alertas.map((a, i) => `
      <tr data-i="${i}" ${a.enabled === false ? 'style="opacity:.55;"' : ''}>
        <td><input type="checkbox" data-field="enabled" ${a.enabled !== false ? 'checked' : ''} style="width:18px;height:18px;"></td>
        <td><select class="form-input form-input-sm" data-field="kind" style="font-size:12px;padding:3px 6px;">${kindOpts(a.kind)}</select></td>
        <td><input type="number" class="form-input form-input-sm" data-field="threshold" value="${Number(a.threshold) || 0}" style="font-size:12px;padding:3px 6px;width:90px;"></td>
        <td><select class="form-input form-input-sm" data-field="severity" style="font-size:12px;padding:3px 6px;">${sevOpts(a.severity || 'warning')}</select></td>
        <td><input type="text" class="form-input form-input-sm" data-field="message" value="${escapeHtml(a.message || '')}" placeholder="(auto)" style="font-size:12px;padding:3px 6px;width:100%;"></td>
        <td style="text-align:right;"><button class="btn btn-ghost btn-sm" data-action="delete" title="Eliminar"><i data-lucide="trash-2"></i></button></td>
      </tr>`).join('');
    el.innerHTML = `<table class="admin-table">
      <thead><tr><th>Activa</th><th>Tipo</th><th>Umbral</th><th>Severidad</th><th>Mensaje (opcional)</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    wireRowEvents();
    if (window.lucide) lucide.createIcons();
  }

  function wireRowEvents() {
    document.querySelectorAll('#tblAlertas [data-field]').forEach(el => {
      el.addEventListener('change', () => {
        const tr = el.closest('tr');
        const i  = Number(tr?.dataset.i);
        if (Number.isNaN(i)) return;
        const field = el.dataset.field;
        const value = (field === 'enabled') ? el.checked
                    : (field === 'threshold') ? Number(el.value)
                                              : el.value;
        state.alertas[i][field] = value;
        markDirty();
        if (field === 'enabled') {
          tr.style.opacity = value ? '' : '0.55';
        }
      });
    });
    document.querySelectorAll('#tblAlertas [data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const i  = Number(tr?.dataset.i);
        if (Number.isNaN(i)) return;
        const ok = await Modal.confirm({
          title: 'Eliminar alerta',
          message: 'La regla se borrará al guardar. ¿Continuar?',
          danger: true,
          confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        state.alertas.splice(i, 1);
        markDirty();
        renderTable();
      });
    });
  }

  function addAlert() {
    state.alertas.push({
      id:        uuid(),
      kind:      'ordenes_abiertas_gt',
      threshold: 50,
      severity:  'warning',
      message:   '',
      enabled:   true,
    });
    markDirty();
    renderTable();
  }

  async function load() {
    try {
      const cfg = await EmpresaService.getConfig();
      state.alertas = Array.isArray(cfg.alertas) ? cfg.alertas.map(a => ({ ...a })) : [];
      state.dirty = false;
      renderTable();
    } catch (err) {
      console.error('[admin/alertas] load:', err);
      Toast.show('Error cargando alertas: ' + (err.message || err.code), 'bad');
    }
  }

  async function save() {
    const ok = await Modal.confirm({
      title: 'Guardar alertas',
      message: `Vas a sobrescribir <code>empresa/config.alertas</code> con ${state.alertas.length} reglas. Las nuevas se aplican en cuanto un admin recargue el panel. ¿Continuar?`,
      confirmLabel: 'Guardar',
    });
    if (!ok) return;
    try {
      await EmpresaService.setConfig({ alertas: state.alertas });
      state.dirty = false;
      Toast.show('Alertas guardadas.', 'ok');
    } catch (err) {
      console.error('[admin/alertas] save:', err);
      Toast.show('Error guardando: ' + (err.message || err.code), 'bad');
    }
  }

  // Carga las métricas reales para mostrar qué alertas dispararían ahora.
  // No persiste nada — solo lee KPIs.
  async function testAlerts() {
    const out = $('testResult');
    if (out) out.innerHTML = '<div class="empty-state-hint" style="padding:var(--sp-2);color:var(--fg-3);">Cargando métricas…</div>';
    try {
      const [ordSnap, ctRes, cotRes, pocAll] = await Promise.all([
        OrdenesService.listAll(),
        ContratosService.listContratos({ limit: 1000 }),
        CotizacionesService.listCotizaciones({ limit: 500 }),
        PocService.getPocDevices(),
      ]);
      const ESTADOS_ABIERTOS = new Set(['POR ASIGNAR','EN PROCESO','DIAGNÓSTICO','EN ESPERA','LISTA','PROGRAMACIÓN','ESTIMACIÓN','RECEPCIONADA']);
      const ordenes_abiertas = (ordSnap || []).filter(o => o.eliminado !== true && ESTADOS_ABIERTOS.has((o.estado_reparacion || '').toUpperCase())).length;
      const contratos_pendientes = (ctRes?.docs || []).filter(c => c.estado === 'pendiente_aprobacion').length;
      const ahora = new Date();
      const cotizaciones_vencen = (cotRes?.docs || []).filter(c => {
        if (c.deleted === true) return false;
        const e = (c.estado || '').toLowerCase();
        if (e !== 'enviada' && e !== 'aprobada') return false;
        const d = AdminMetrics.daysUntilExpiry(c.fecha, c.validezDias || c.validez_dias || 15, ahora);
        return d != null && d <= 7;
      }).length;
      const poc_activos = (pocAll || []).filter(d => d.activo === true && d.deleted !== true).length;

      const metrics = { ordenes_abiertas, contratos_pendientes, cotizaciones_vencen, poc_activos };
      const triggered = AdminMetrics.evaluateAlertas(state.alertas, metrics);

      const metricsHtml = `<div style="font-size:12px;color:var(--fg-3);margin-bottom:var(--sp-2);">
        Métricas actuales — Órdenes abiertas: <strong>${ordenes_abiertas}</strong> ·
        Contratos pendientes: <strong>${contratos_pendientes}</strong> ·
        Cotizaciones por vencer: <strong>${cotizaciones_vencen}</strong> ·
        PoC activos: <strong>${poc_activos}</strong>
      </div>`;
      const list = triggered.length
        ? triggered.map(t => `<div class="alert-banner alert-${t.severity === 'error' ? 'error' : t.severity === 'info' ? 'info' : 'warning'}" style="margin:0 0 var(--sp-1);"><i data-lucide="bell"></i><div>${t.message}</div></div>`).join('')
        : `<div class="alert-banner alert-success" style="margin:0;"><i data-lucide="check-circle"></i><div>Ninguna alerta dispara con las métricas actuales.</div></div>`;
      if (out) out.innerHTML = metricsHtml + list;
      if (window.lucide) lucide.createIcons();
    } catch (err) {
      console.error('[admin/alertas] test:', err);
      if (out) out.innerHTML = `<div class="alert-banner alert-error"><i data-lucide="alert-octagon"></i><div>Error: <code>${escapeHtml(err.message || err.code)}</code></div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  function wireUI() {
    $('btnAdd')?.addEventListener('click', addAlert);
    $('btnSave')?.addEventListener('click', save);
    $('btnReload')?.addEventListener('click', load);
    $('btnTest')?.addEventListener('click', testAlerts);
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      wireUI();
      load();
    });
  });
})();
