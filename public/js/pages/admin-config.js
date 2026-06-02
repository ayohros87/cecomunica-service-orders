/**
 * admin-config.js — editor for empresa/config (admin-tunable parameters).
 *
 * Loads current values via EmpresaService.getConfig() (defaults applied),
 * presents an editable form, validates client-side, saves via setConfig().
 *
 * The defaults live in EmpresaService.CONFIG_DEFAULTS — single source of
 * truth shared with consumers (see empresaService.js comment).
 */
(function () {
  'use strict';

  const FIELDS = [
    { key: 'itbms_rate',                label: 'Tasa ITBMS',
      type: 'rate', min: 0,     max: 0.25,  step: 0.001,
      hint: 'Rango 0–25% (0.07 = 7%). Cambia inmediatamente cálculos en cotizaciones, contratos y órdenes.' },
    { key: 'cotizacion_validez_dias',   label: 'Validez por defecto de cotización (días)',
      type: 'int',  min: 1,     max: 365,
      hint: 'Aplicado a cotizaciones nuevas. No afecta las ya creadas.' },
    { key: 'pii_retention_dias',        label: 'Retención PII (días)',
      type: 'int',  min: 30,    max: 730,
      hint: 'Días antes de purgar fotos de identificación. Verifica con legal antes de bajar de 60.' },
    { key: 'pii_purge_enabled',         label: 'Purga PII habilitada',
      type: 'bool',
      hint: 'Kill-switch global: cuando está apagado, el callable purgePIIRetention rechaza ejecuciones reales (preview sigue funcionando). También editable desde admin/pii.html.' },
    { key: 'stock_minimo_default',      label: 'Stock mínimo por defecto (piezas nuevas)',
      type: 'int',  min: 0,     max: 1000,
      hint: 'Placeholder usado al crear una pieza nueva. No modifica las existentes.' },
    { key: 'orden_stale_dias',          label: 'Días para marcar orden como "sin movimiento"',
      type: 'int',  min: 3,     max: 60,
      hint: 'Umbral usado en el panel de Operación para flag de stale.' },
    { key: 'mail_cc_orden_completada', label: 'Copia (CC) — Emails al completar orden',
      type: 'emails',
      hint: 'Uno por línea. Se añaden a cada email de "orden completada".' },
    { key: 'mail_cc_contrato_aprobado', label: 'Copia (CC) — Emails al aprobar contrato',
      type: 'emails',
      hint: 'Uno por línea. Se añaden a cada email de aprobación de contrato.' },
  ];

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  function renderForm(current) {
    const form = $('configForm');
    if (!form) return;
    form.innerHTML = FIELDS.map(f => {
      const v = current[f.key];
      let input;
      if (f.type === 'emails') {
        const text = Array.isArray(v) ? v.join('\n') : '';
        input = `<textarea id="fld-${f.key}" class="form-input" rows="3" style="font-family:inherit;font-size:13px;">${text}</textarea>`;
      } else if (f.type === 'rate') {
        input = `<input type="number" id="fld-${f.key}" class="form-input" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" style="width:140px;">`;
      } else if (f.type === 'bool') {
        const checked = v === true ? 'checked' : '';
        input = `<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;"><input type="checkbox" id="fld-${f.key}" ${checked} style="width:18px;height:18px;"> Habilitada</label>`;
      } else {
        input = `<input type="number" id="fld-${f.key}" class="form-input" min="${f.min}" max="${f.max}" step="1" value="${v}" style="width:140px;">`;
      }
      return `
        <div class="form-field" style="margin-bottom:var(--sp-4);">
          <label class="form-label" for="fld-${f.key}">${f.label}</label>
          ${input}
          <div class="ts" style="margin-top:4px;">${f.hint}</div>
          <div class="ts fld-error" data-for="${f.key}" style="display:none;color:#b91c1c;margin-top:4px;"></div>
        </div>`;
    }).join('');
  }

  function readForm() {
    const out = {};
    const errors = {};
    for (const f of FIELDS) {
      const el = $('fld-' + f.key);
      if (!el) continue;
      const raw = el.value;
      if (f.type === 'bool') {
        out[f.key] = !!el.checked;
        continue;
      } else if (f.type === 'emails') {
        const list = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (list.length > 10) errors[f.key] = 'Máximo 10 emails.';
        const bad = list.find(s => !EMAIL_RE.test(s));
        if (bad) errors[f.key] = `Email inválido: ${bad}`;
        out[f.key] = list;
      } else if (f.type === 'rate') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < f.min || n > f.max) errors[f.key] = `Debe estar entre ${f.min} y ${f.max}.`;
        out[f.key] = Math.round(n * 1000) / 1000;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < f.min || n > f.max) errors[f.key] = `Entero entre ${f.min} y ${f.max}.`;
        out[f.key] = n;
      }
    }
    return { values: out, errors };
  }

  function showErrors(errors) {
    document.querySelectorAll('.fld-error').forEach(el => { el.style.display = 'none'; el.textContent = ''; });
    let firstField = null;
    for (const key in errors) {
      const el = document.querySelector(`.fld-error[data-for="${key}"]`);
      if (el) { el.style.display = ''; el.textContent = errors[key]; }
      if (!firstField) firstField = $('fld-' + key);
    }
    if (firstField) firstField.focus();
  }

  async function load() {
    setText('lastUpdate', 'Cargando…');
    try {
      const cfg = await EmpresaService.getConfig();
      renderForm(cfg);
      const meta = $('configMeta');
      if (meta) {
        const ts = cfg.updated_at;
        const who = cfg.updated_by;
        meta.innerHTML = ts
          ? `Última edición: ${new Date(ts.toMillis ? ts.toMillis() : ts).toLocaleString('es-PA', { hour12: false })} por <code>${who || '—'}</code>`
          : 'Sin ediciones registradas (usando valores por defecto).';
      }
      setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
    } catch (err) {
      console.error('[admin/config] load:', err);
      if (window.Toast) Toast.show('Error cargando configuración: ' + (err.message || err.code || err), 'bad');
    }
  }

  async function save() {
    const { values, errors } = readForm();
    if (Object.keys(errors).length) {
      showErrors(errors);
      if (window.Toast) Toast.show('Corrige los errores antes de guardar.', 'bad');
      return;
    }
    const ok = await Modal.confirm({
      title: 'Guardar configuración',
      message: 'Los nuevos valores se aplicarán de inmediato a las nuevas operaciones. ¿Continuar?',
      confirmLabel: 'Guardar',
    });
    if (!ok) return;
    try {
      await EmpresaService.setConfig(values);
      if (window.Toast) Toast.show('Configuración guardada.', 'ok');
      await load();
    } catch (err) {
      console.error('[admin/config] save:', err);
      if (window.Toast) Toast.show('Error guardando: ' + (err.message || err.code || err), 'bad');
    }
  }

  async function exportSnapshot() {
    try {
      const config     = await EmpresaService.getDoc('config');
      const operadores = await EmpresaService.getDoc('operadores').catch(() => null);
      const snapshot = {
        exported_at: new Date().toISOString(),
        exported_by: firebase.auth().currentUser?.email || firebase.auth().currentUser?.uid || 'unknown',
        defaults:    EmpresaService.CONFIG_DEFAULTS,
        config:      config || null,
        operadores:  operadores || null,
      };
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const ts   = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `cecomunica_empresa_config_${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (window.Toast) Toast.show('Snapshot descargado.', 'ok');
    } catch (err) {
      console.error('[admin/config] export:', err);
      if (window.Toast) Toast.show('Error: ' + (err.message || err.code), 'bad');
    }
  }

  function wireUI() {
    $('btnSave')?.addEventListener('click', save);
    $('btnReload')?.addEventListener('click', load);
    $('btnExport')?.addEventListener('click', exportSnapshot);
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        if (window.Toast) Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      wireUI();
      load();
    });
  });
})();
