/**
 * admin-backfills.js — UI runner for admin-only data backfills.
 *
 * Each "Run" button invokes the runBackfill callable with {action, dryRun}.
 * Result is rendered inline below the button with counters.
 *
 * Auditoría UX 2026-09-28: "Ejecutar" queda deshabilitado hasta correr la
 * vista previa (dry-run) de esa migración en esta sesión; cada tarjeta dice
 * que no se puede deshacer y muestra la última ejecución real (quién, cuándo,
 * resultado), guardada en empresa/backfills_estado y en admin_audit.
 */
(function () {
  'use strict';

  const DOC_ESTADO = 'backfills_estado';
  const SS_KEY = 'ccBackfillsDry:v1';
  // Migraciones con vista previa corrida en esta sesión.
  const dryOk = new Set();
  let estado = {};

  function leerDrySesion() {
    try { JSON.parse(sessionStorage.getItem(SS_KEY) || '[]').forEach(a => dryOk.add(a)); } catch (_) { /* sin storage */ }
  }
  function guardarDrySesion() {
    try { sessionStorage.setItem(SS_KEY, JSON.stringify([...dryOk])); } catch (_) { /* sin storage */ }
  }

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
      ['Skip (inactivos)',    data.skippedInactivos],
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
      ? `Vista previa lista — habría escrito ${data.written} documentos (${data.elapsedSec} s). Ya puedes ejecutarla.`
      : `Migración completa — ${data.written} documentos actualizados en ${data.elapsedSec} s.`;

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
      if (!dryOk.has(action)) {
        Toast.show('Primero corre la vista previa de esta migración.', 'warn');
        return;
      }
      const ok = await Modal.confirm({
        title: 'Ejecutar migración',
        message: `Vas a ejecutar <strong>${escapeHtml(tituloDe(action))}</strong> escribiendo en la base de datos. Correrla otra vez no duplica nada, pero <strong>lo que escriba no se puede deshacer</strong> desde aquí. Puede tardar varios minutos. ¿Continuar?`,
        confirmLabel: 'Ejecutar',
        danger: true,
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
      if (dryRun) { dryOk.add(action); guardarDrySesion(); }
      else await registrarEjecucion(action, res.data || {});
    } catch (err) {
      console.error('[admin/backfills]', err);
      renderError(action, err);
    } finally {
      document.querySelectorAll(`[data-bf-action="${action}"]`).forEach(b => b.disabled = false);
      actualizarBotonEjecutar(action);
    }
  }

  function tituloDe(action) {
    const card = document.querySelector(`[data-bf-action="${action}"]`)?.closest('.ds-card');
    return card?.querySelector('.title')?.textContent.trim() || action;
  }

  function actualizarBotonEjecutar(action) {
    const btn = document.querySelector(`[data-bf-action="${action}"][data-bf-mode="run"]`);
    if (!btn) return;
    const ok = dryOk.has(action);
    btn.disabled = !ok;
    btn.title = ok ? 'Escribe en la base de datos' : 'Corre primero la vista previa (dry-run)';
  }

  // Última ejecución real: empresa/backfills_estado.{action} + admin_audit.
  async function registrarEjecucion(action, data) {
    const resultado = {
      escaneados: data.scanned ?? null, escritos: data.written ?? null,
      errores: data.errors ?? null, segundos: data.elapsedSec ?? null,
    };
    try {
      const por = await EmpresaService._quien();
      await firebase.firestore().collection('empresa').doc(DOC_ESTADO).set({
        [action]: { por, fecha: firebase.firestore.FieldValue.serverTimestamp(), resultado },
      }, { merge: true });
      estado[action] = { por, fecha: new Date(), resultado };
      renderUltima(action);
    } catch (e) {
      console.warn('[admin/backfills] no se guardó la última ejecución:', e);
      Toast.show('La migración corrió, pero no se pudo guardar el registro de la ejecución.', 'warn');
    }
    EmpresaService.registrarAdminAudit('backfill', {
      backfill: action, nombre: tituloDe(action), resultado,
      resumen: `${resultado.escritos ?? 0} escritos · ${resultado.errores ?? 0} errores`,
    }).catch(e => console.warn('[admin/backfills] admin_audit:', e));
  }

  function renderUltima(action) {
    const el = $(`last-${action}`);
    if (!el) return;
    const e = estado[action];
    if (!e) { el.textContent = 'Nunca se ha ejecutado desde esta pantalla.'; return; }
    const f = e.fecha?.toDate ? e.fecha.toDate() : (e.fecha instanceof Date ? e.fecha : null);
    const quien = e.por?.nombre || e.por?.email || 'alguien';
    const r = e.resultado || {};
    el.textContent = `Última ejecución: ${f ? f.toLocaleString('es-PA', { hour12: false }) : '—'} por ${quien} · ${r.escritos ?? 0} escritos, ${r.errores ?? 0} errores.`;
  }

  // Agrega a cada tarjeta el aviso "no se puede deshacer" y la línea de la
  // última ejecución (una sola vez, desde aquí para no repetir HTML 8 veces).
  function decorarTarjetas() {
    document.querySelectorAll('[data-bf-mode="run"]').forEach(btn => {
      const action = btn.dataset.bfAction;
      const fila = btn.parentElement;
      if (!fila || $(`last-${action}`)) return;
      // Vista previa como acción principal; Ejecutar ya no se destaca.
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-danger');
      fila.querySelector('[data-bf-mode="dry"]')?.classList.replace('btn-ghost', 'btn-primary');
      const aviso = document.createElement('div');
      aviso.className = 'ts';
      aviso.style.cssText = 'margin-top:8px;color:var(--fg-2);';
      aviso.innerHTML = '<strong>No se puede deshacer.</strong> "Ejecutar" se habilita después de correr la vista previa en esta sesión.';
      const ultima = document.createElement('div');
      ultima.className = 'ts';
      ultima.id = `last-${action}`;
      ultima.style.cssText = 'margin-top:4px;color:var(--fg-3);';
      ultima.textContent = 'Cargando última ejecución…';
      fila.after(aviso, ultima);
      actualizarBotonEjecutar(action);
    });
  }

  async function cargarEstado() {
    try { estado = (await EmpresaService.getDoc(DOC_ESTADO)) || {}; }
    catch (e) { console.warn('[admin/backfills] estado:', e); estado = {}; }
    document.querySelectorAll('[data-bf-mode="run"]').forEach(b => renderUltima(b.dataset.bfAction));
  }

  function wireUI() {
    leerDrySesion();
    decorarTarjetas();
    cargarEstado();
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
