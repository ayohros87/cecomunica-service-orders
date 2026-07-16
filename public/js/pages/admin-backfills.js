/**
 * admin-backfills.js — UI runner for admin-only data backfills.
 *
 * Each "Run" button invokes the runBackfill callable with {action, dryRun}.
 * Result is rendered inline below the button with counters.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) { return FMT.esc(s); } // helper canónico (+ escapa " y ', antes faltaban)

  function renderResult(action, dryRun, data) {
    const target = $(`result-${action}`);
    if (!target) return;
    const counters = [
      ['Escaneados',         data.scanned],
      ['Skip (eliminadas)',  data.skippedDeleted],
      ['Skip (sin cambios)', data.skippedUnchanged],
      // marcarSerialesLegacy:
      ['Skip (no act/aprob)', data.skippedEstado],
      ['Skip (ya con estado)', data.skippedYaEstado],
      ['Pendientes update',  data.toWrite],
      // linkClienteId:
      ['Ya con id',          data.yaLinked],
      ['Enlazados',          data.linked],
      ['Enlazados (exacto)',  data.linkedExacto],
      ['Enlazados (prefijo)', data.linkedPrefijo],
      ['Ambiguos',           data.ambiguos],
      ['Ambiguos (distintos)', data.ambiguosDistintos],
      ['Huérfanos',          data.huerfanos],
      ['Huérfanos (distintos)', data.huerfanosDistintos],
      // linkContratoPoc:
      ['Ya vinculados',       data.yaVinculados],
      ['Vinculados',          data.vinculados],
      ['Sin contrato en pool', data.sinContrato],
      ['Sospechosos',         data.sospechosos],
      ['Sin serial',          data.sinSerial],
      // seedPoolEquipos:
      ['Creados (contratos)', data.creados?.contratos],
      ['Creados (PoC)',       data.creados?.poc],
      ['Creados (órdenes)',   data.creados?.ordenes],
      ['Ya en pool',          data.yaExistia],
      ['Colisiones serial',   data.colisiones],
      ['PoC enlazados',       data.pocEnlazados],
      ['Órdenes viejas skip', data.ordenesViejasSaltadas],
      ['Inválidos',           data.invalidos],
      ['Escritos',           data.written],
      ['Errores',            data.errors],
    ].filter(([_, v]) => v != null).map(([k, v]) => `<span class="pill" style="margin-right:6px;">${k}: <strong>${v}</strong></span>`).join('');

    const severity = (data.errors > 0) ? 'warning' : 'success';
    const icon     = (data.errors > 0) ? 'alert-triangle' : 'check-circle';
    const titulo   = dryRun
      ? `Dry-run completo — habría escrito ${data.written} docs en ${data.elapsedSec}s.`
      : `Backfill completo — ${data.written} docs actualizados en ${data.elapsedSec}s.`;

    target.innerHTML = `
      <div class="alert-banner alert-${severity}" style="margin:0 0 var(--sp-2);">
        <i data-lucide="${icon}"></i>
        <div><span class="alert-title">${titulo}</span></div>
      </div>
      <div style="font-size:12px;">${counters}</div>
      ${renderHuerfanos(data.detalle)}`;
    if (window.lucide) lucide.createIcons();
  }

  // Muestra ejemplos de nombres huérfanos (sin cliente) por colección, para linkClienteId.
  function renderHuerfanos(detalle) {
    if (!detalle) return '';
    const bloques = Object.entries(detalle).map(([col, d]) => {
      const ej = (d.muestraHuerfanos || d.muestra || []);
      if (!ej.length) return '';
      const titulo = d.titulo || `${col} — ${d.huerfanos ?? ej.length} sin enlazar`;
      return `<div style="margin-top:8px;"><span class="ts">${escapeHtml(titulo)}, ej.:</span><br>` +
        ej.map(n => `<code style="font-size:11px;">${escapeHtml(n)}</code>`).join(', ') + `</div>`;
    }).join('');
    return bloques;
  }

  function renderError(action, err) {
    const target = $(`result-${action}`);
    if (!target) return;
    const msg = err?.message || err?.code || String(err);
    target.innerHTML = `
      <div class="alert-banner alert-error" style="margin:0;">
        <i data-lucide="alert-octagon"></i>
        <div><span class="alert-title">Error.</span> <code>${escapeHtml(msg)}</code></div>
      </div>`;
    if (window.lucide) lucide.createIcons();
  }

  async function runBackfill(action, mode, btn) {
    const dryRun = (mode === 'dry');

    if (!dryRun) {
      const ok = await Modal.confirm({
        title: 'Ejecutar backfill',
        message: `Vas a ejecutar <code>${action}</code> en modo <strong>escritura</strong>. La operación es idempotente (re-ejecutable sin riesgo) pero puede tardar varios minutos en colecciones grandes. ¿Continuar?`,
        confirmLabel: 'Ejecutar',
      });
      if (!ok) return;
    }

    // Disable all action buttons for this action while running.
    document.querySelectorAll(`[data-bf-action="${action}"]`).forEach(b => b.disabled = true);
    const target = $(`result-${action}`);
    if (target) target.innerHTML = '<div class="empty-state-hint" style="padding:var(--sp-2);color:var(--fg-3);">Ejecutando…</div>';

    try {
      const fn = firebase.functions().httpsCallable('runBackfill');
      const res = await fn({ action, dryRun });
      renderResult(action, dryRun, res.data || {});
    } catch (err) {
      console.error('[admin/backfills]', err);
      renderError(action, err);
    } finally {
      document.querySelectorAll(`[data-bf-action="${action}"]`).forEach(b => b.disabled = false);
    }
  }

  function wireUI() {
    document.querySelectorAll('[data-bf-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        runBackfill(btn.dataset.bfAction, btn.dataset.bfMode, btn);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        if (window.Toast) Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      wireUI();
    });
  });
})();
