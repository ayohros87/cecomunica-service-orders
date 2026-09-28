/**
 * admin-pii.js — PII retention preview + manual purge.
 *
 * Wires the UI for the `purgePIIRetention` callable Cloud Function.
 *
 * Workflow:
 *  1. Admin enters retention days (default 90, min 30 with warn if <60).
 *  2. Click "Buscar candidatos" → callable with { dryRun: true }, renders sample.
 *  3. Click "Ejecutar purga" → Modal.confirm with destructive warning →
 *     callable with { dryRun: false }, renders result.
 *
 * The callable enforces rol === 'administrador' server-side (after the
 * fix in purgePIIRetention.js — earlier versions compared with "admin"
 * literally which never matched). The frontend check is UX only.
 */
(function () {
  'use strict';

  const DEFAULT_RETENTION = 90;
  const MIN_RETENTION = 30;

  const state = {
    lastPreview: null,
    busy: false,
    purgeEnabled: true,   // local mirror of empresa/config.pii_purge_enabled
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  function getRetentionDays() {
    const input = $('inputRetentionDays');
    const n = Number(input?.value || DEFAULT_RETENTION);
    if (!Number.isFinite(n) || n < MIN_RETENTION) return DEFAULT_RETENTION;
    return Math.floor(n);
  }

  function setBusy(on) {
    state.busy = on;
    document.querySelectorAll('[data-action]').forEach(el => { el.disabled = on; });
    const spinner = $('busy');
    if (spinner) spinner.style.display = on ? '' : 'none';
  }

  function renderSample(result) {
    state.lastPreview = result;
    const meta = $('previewMeta');
    if (meta) {
      meta.innerHTML = `
        <strong>${result.candidates}</strong> candidatos
        de <strong>${result.scanned}</strong> archivos escaneados ·
        retención <strong>${result.retentionDays}</strong> días
        (corte: ${new Date(result.cutoff).toLocaleString('es-PA', { hour12: false })})
      `;
    }
    const list = $('previewList');
    if (!list) return;
    const sample = Array.isArray(result.sample) ? result.sample : [];
    if (!sample.length) {
      list.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-4);text-align:center;color:var(--fg-3);">No hay archivos con más de ${result.retentionDays} días.</div>`;
      refreshExecuteEnabled();
      return;
    }
    const rows = sample.map(s => {
      const created = new Date(s.created);
      const ageDays = Math.floor((Date.now() - created.getTime()) / 86400000);
      return `
        <tr>
          <td><code style="font-size:11px;">${s.file}</code></td>
          <td>${s.ordenId || '—'}</td>
          <td class="num">${ageDays} d</td>
          <td>${created.toLocaleString('es-PA', { hour12: false })}</td>
        </tr>`;
    }).join('');
    list.innerHTML = `<table class="admin-table">
      <thead><tr><th>Archivo</th><th>Orden</th><th class="num">Edad</th><th>Creado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    refreshExecuteEnabled();
  }

  function renderResult(result) {
    const out = $('execResult');
    if (!out) return;
    out.innerHTML = `
      <div class="alert-banner alert-success">
        <i data-lucide="shield-check"></i>
        <div>
          <span class="alert-title">Purga completada.</span>
          ${result.deleted} archivos eliminados · ${result.docsCleared} docs de orden limpiados
          ${result.errors ? ` · <strong>${result.errors} errores</strong>` : ''}
        </div>
      </div>`;
    if (window.lucide) lucide.createIcons();
  }

  function renderError(err) {
    const out = $('execResult');
    if (!out) return;
    const msg = err?.message || err?.code || String(err);
    out.innerHTML = `
      <div class="alert-banner alert-error">
        <i data-lucide="alert-octagon"></i>
        <div>
          <span class="alert-title">Error.</span>
          <code>${msg}</code>
        </div>
      </div>`;
    if (window.lucide) lucide.createIcons();
  }

  async function doPreview() {
    if (state.busy) return;
    setBusy(true);
    setText('previewMeta', 'Buscando candidatos…');
    $('previewList').innerHTML = '';
    $('execResult').innerHTML = '';
    try {
      const fn = firebase.functions().httpsCallable('purgePIIRetention');
      const res = await fn({ dryRun: true, retentionDays: getRetentionDays() });
      renderSample(res.data || {});
    } catch (err) {
      console.error('[admin/pii] preview:', err);
      if (window.Toast) Toast.show('Error: ' + (err.message || err.code), 'bad');
      setText('previewMeta', 'Error consultando candidatos.');
    } finally {
      setBusy(false);
    }
  }

  async function doExecute() {
    if (state.busy || !state.lastPreview) return;
    const n = state.lastPreview.candidates;
    if (!n) return;
    const ok = await Modal.confirm({
      title: 'Confirmar purga de PII',
      message: `Se borrarán <strong>${n}</strong> fotos de identificación con más de <strong>${state.lastPreview.retentionDays}</strong> días. ` +
               `Esta acción es <strong>irreversible</strong>. Las órdenes correspondientes mantendrán el registro de la purga ` +
               `(identificacion_purged_at + identificacion_purged_by). ¿Continuar?`,
      danger: true,
      confirmLabel: 'Sí, purgar ahora',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;

    setBusy(true);
    $('execResult').innerHTML = '';
    try {
      const fn = firebase.functions().httpsCallable('purgePIIRetention');
      const res = await fn({ dryRun: false, retentionDays: getRetentionDays() });
      renderResult(res.data || {});
      // Re-preview to reflect the purge.
      await doPreview();
    } catch (err) {
      console.error('[admin/pii] execute:', err);
      renderError(err);
    } finally {
      setBusy(false);
    }
  }

  function applyToggleVisual() {
    const btn = $('btnToggleEnabled');
    const hint = $('toggleHint');
    if (!btn) return;
    btn.classList.toggle('is-on', state.purgeEnabled);
    btn.setAttribute('aria-pressed', String(state.purgeEnabled));
    const label = btn.querySelector('.label-text');
    if (label) label.textContent = state.purgeEnabled ? 'Habilitada' : 'Deshabilitada';
    if (hint) {
      hint.innerHTML = state.purgeEnabled
        ? 'Se pueden borrar fotos. <strong>Buscar candidatos siempre funciona</strong>, aunque la deshabilites.'
        : '<strong style="color:#b91c1c;">El borrado está bloqueado.</strong> "Purgar ahora" no funcionará y el servidor también lo rechaza.';
    }
    refreshExecuteEnabled();
  }

  function refreshExecuteEnabled() {
    const exec = $('btnExecute');
    if (!exec) return;
    const noCandidates = !state.lastPreview || state.lastPreview.candidates === 0;
    exec.disabled = noCandidates || !state.purgeEnabled || state.busy;
    exec.title = !state.purgeEnabled
      ? 'La purga está deshabilitada (interruptor de arriba)'
      : (noCandidates ? 'Sin candidatos para purgar' : 'Ejecutar purga');
  }

  async function loadToggleState() {
    try {
      const cfg = await EmpresaService.getConfig();
      state.purgeEnabled = cfg.pii_purge_enabled !== false;
    } catch (err) {
      console.warn('[admin/pii] loadToggleState:', err);
      state.purgeEnabled = true; // fail-open on read — server gate is the real guard
    }
    applyToggleVisual();
  }

  async function togglePurgeEnabled() {
    const next = !state.purgeEnabled;
    // Se confirma en los DOS sentidos (auditoría UX 2026-09-28): activar es lo
    // que abre la puerta a borrar fotos, y antes pasaba con un solo clic.
    const ok = next
      ? await Modal.confirm({
          title: 'Habilitar la purga',
          message: 'Con la purga habilitada, un administrador puede <strong>borrar para siempre</strong> las fotos de cédula más viejas que la retención. Las fotos borradas no se recuperan. ¿Habilitarla?',
          danger: true,
          confirmLabel: 'Habilitar',
        })
      : await Modal.confirm({
          title: 'Deshabilitar la purga',
          message: 'Nadie podrá borrar fotos de cédula hasta que se vuelva a habilitar (la búsqueda de candidatos sigue funcionando). ¿Continuar?',
          danger: true,
          confirmLabel: 'Deshabilitar',
        });
    if (!ok) return;
    const btn = $('btnToggleEnabled');
    if (btn) btn.disabled = true;
    try {
      await EmpresaService.setConfig({ pii_purge_enabled: next });
      try {
        await EmpresaService.registrarAdminAudit('config', {
          origen: 'privacidad',
          cambios: [{ campo: 'pii_purge_enabled', antes: !next, despues: next }],
        });
      } catch (e) { console.warn('[admin/pii] admin_audit:', e); }
      state.purgeEnabled = next;
      applyToggleVisual();
      if (window.Toast) Toast.show(next ? 'Purga habilitada.' : 'Purga deshabilitada.', 'ok');
    } catch (err) {
      console.error('[admin/pii] toggle:', err);
      if (window.Toast) Toast.show('Error: ' + (err.message || err.code), 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireUI() {
    $('btnPreview')?.addEventListener('click', doPreview);
    $('btnExecute')?.addEventListener('click', doExecute);
    $('btnToggleEnabled')?.addEventListener('click', togglePurgeEnabled);

    const input = $('inputRetentionDays');
    if (input) {
      input.value = DEFAULT_RETENTION;
      input.addEventListener('change', () => {
        const warn = $('retentionWarn');
        const n = Number(input.value);
        if (warn) warn.style.display = (n < 60 ? '' : 'none');
      });
    }

    loadToggleState();
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
