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
    { key: 'email_recepcion_entregas', label: 'Buzón de recepción (entregas)',
      type: 'email',
      hint: 'Correo único que recibe copia de cada nota de entrega (recepción lleva el control). Vacío = no se copia a recepción.' },
    { key: 'cotizacion_aprobacion_to', label: 'Aprobadores de cotización (notificación)',
      type: 'user-picker', emptyHint: 'se notificará a ventas@cecomunica.com',
      hint: 'Usuarios que reciben la solicitud de aprobación cuando se prepara una cotización. Filtra por rol y selecciona uno o varios. Vacío = se notifica a ventas@cecomunica.com.' },
    { key: 'email_solicitud_seriales', label: 'Inventario — Solicitud de seriales',
      type: 'user-picker', emptyHint: 'se usa inventario@cecomunica.com',
      hint: 'Usuarios que reciben el correo "Solicitud de seriales" cuando se aprueba un contrato con equipos. Selecciona uno o varios. Vacío = se usa inventario@cecomunica.com.' },
    { key: 'seriales_recordatorio_dias', label: 'Recordatorio de seriales (días)',
      type: 'int', min: 1, max: 30,
      hint: 'Cada cuántos días se le recuerda a inventario un contrato con seriales pendientes (hasta 4 veces). El badge "Seriales pendientes" en la lista queda como recordatorio permanente.' },
  ];

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Cargado una vez en load() para alimentar los campos tipo 'user-picker'.
  let _users = [];

  const ROL_LABELS = {
    administrador: 'Administrador', gerente: 'Gerente', vendedor: 'Vendedor',
    recepcion: 'Recepción', tecnico: 'Técnico', tecnico_operativo: 'Técnico operativo',
    jefe_taller: 'Jefe de taller', inventario: 'Inventario', contabilidad: 'Contabilidad', vista: 'Vista',
  };
  const rolLabel = (r) => ROL_LABELS[r] || (r || '—');

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function renderForm(current) {
    const form = $('configForm');
    if (!form) return;
    form.innerHTML = FIELDS.map(f => {
      const v = current[f.key];
      let input;
      if (f.type === 'user-picker') {
        input = renderUserPicker(f.key, Array.isArray(v) ? v : [], f.emptyHint);
      } else if (f.type === 'emails') {
        const text = Array.isArray(v) ? v.join('\n') : '';
        input = `<textarea id="fld-${f.key}" class="form-input" rows="3" style="font-family:inherit;font-size:13px;">${text}</textarea>`;
      } else if (f.type === 'email') {
        const val = (typeof v === 'string' ? v : '');
        input = `<input type="email" id="fld-${f.key}" class="form-input" value="${val}" placeholder="recepcion@cecomunica.com" style="width:280px;">`;
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

  // ── user-picker: lista filtrable de usuarios activos (multi-selección) ──────
  // Guarda un array de emails. Pre-marca los que ya estaban configurados.
  function renderUserPicker(key, selectedEmails, emptyHint) {
    const sel = new Set((selectedEmails || []).map(e => String(e).toLowerCase()));
    const usables = _users
      .filter(u => u.activo !== false && EMAIL_RE.test(String(u.email || '')))
      .sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email)));

    if (!usables.length) {
      return `<div id="fld-${key}" class="up-root ts" data-empty="1" style="color:var(--fg-3);">
        No se pudieron cargar usuarios (o ninguno tiene email). Recarga la página.</div>`;
    }

    const roles = [...new Set(usables.map(u => u.rol).filter(Boolean))].sort();
    const rolOpts = ['<option value="">Todos los roles</option>']
      .concat(roles.map(r => `<option value="${esc(r)}">${esc(rolLabel(r))}</option>`)).join('');

    const items = usables.map(u => {
      const checked = sel.has(String(u.email).toLowerCase()) ? 'checked' : '';
      return `<label class="up-item" data-rol="${esc(u.rol || '')}" data-search="${esc((u.nombre || '') + ' ' + (u.email || '')).toLowerCase()}"
          style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border-subtle,#eee);cursor:pointer;font-size:13px;">
        <input type="checkbox" value="${esc(u.email)}" ${checked} style="width:16px;height:16px;">
        <span style="flex:1;">${esc(u.nombre || u.email)}</span>
        <span class="ts" style="white-space:nowrap;">${esc(u.email)} · ${esc(rolLabel(u.rol))}</span>
      </label>`;
    }).join('');

    return `<div id="fld-${key}" class="up-root" data-key="${key}" data-empty-hint="${esc(emptyHint || 'se notificará a ventas@cecomunica.com')}">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <select class="form-input up-filter-rol" style="width:200px;">${rolOpts}</select>
        <input type="text" class="form-input up-filter-q" placeholder="Buscar nombre o email…" style="flex:1;min-width:180px;">
      </div>
      <div class="up-list" style="max-height:260px;overflow:auto;border:1px solid var(--border-subtle,#e5e7eb);border-radius:8px;">${items}</div>
      <div class="ts up-count" style="margin-top:6px;"></div>
    </div>`;
  }

  function wireUserPickers() {
    document.querySelectorAll('.up-root[data-key]').forEach(root => {
      const filterRol = root.querySelector('.up-filter-rol');
      const filterQ   = root.querySelector('.up-filter-q');
      const items     = [...root.querySelectorAll('.up-item')];
      const countEl   = root.querySelector('.up-count');

      const apply = () => {
        const r = (filterRol?.value || '').trim();
        const q = (filterQ?.value || '').trim().toLowerCase();
        items.forEach(it => {
          const okRol = !r || it.dataset.rol === r;
          const okQ   = !q || (it.dataset.search || '').includes(q);
          it.style.display = (okRol && okQ) ? '' : 'none';
        });
        updateCount();
      };
      const emptyHint = root.getAttribute('data-empty-hint') || 'se notificará a ventas@cecomunica.com';
      const updateCount = () => {
        const total = items.filter(i => i.querySelector('input').checked).length;
        if (countEl) countEl.textContent = total ? `${total} seleccionado${total === 1 ? '' : 's'}` : `Sin selección — ${emptyHint}`;
      };

      filterRol?.addEventListener('change', apply);
      filterQ?.addEventListener('input', apply);
      root.addEventListener('change', e => { if (e.target.matches('input[type="checkbox"]')) updateCount(); });
      updateCount();
    });
  }

  function readForm() {
    const out = {};
    const errors = {};
    for (const f of FIELDS) {
      const el = $('fld-' + f.key);
      if (!el) continue;
      const raw = el.value;
      if (f.type === 'user-picker') {
        // Si la lista no cargó, no tocar el valor guardado (setConfig hace merge).
        if (el.dataset.empty === '1') continue;
        const emails = [...el.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value.trim()).filter(Boolean);
        const uniq = [...new Set(emails.map(e => e.toLowerCase()))];
        if (uniq.length > 20) errors[f.key] = 'Máximo 20 aprobadores.';
        out[f.key] = uniq;
        continue;
      } else if (f.type === 'bool') {
        out[f.key] = !!el.checked;
        continue;
      } else if (f.type === 'emails') {
        const list = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (list.length > 10) errors[f.key] = 'Máximo 10 emails.';
        const bad = list.find(s => !EMAIL_RE.test(s));
        if (bad) errors[f.key] = `Email inválido: ${bad}`;
        out[f.key] = list;
      } else if (f.type === 'email') {
        const val = (raw || '').trim();
        if (val && !EMAIL_RE.test(val)) errors[f.key] = `Email inválido: ${val}`;
        out[f.key] = val;
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
      const [cfg] = await Promise.all([
        EmpresaService.getConfig(),
        (async () => { try { _users = await UsuariosAdminService.listAll(); } catch (e) { console.warn('[admin/config] no se pudieron cargar usuarios:', e); _users = []; } })(),
      ]);
      renderForm(cfg);
      wireUserPickers();
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
