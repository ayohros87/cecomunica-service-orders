/**
 * admin-config.js — editor for empresa/config (admin-tunable parameters).
 *
 * Loads current values via EmpresaService.getConfig() (defaults applied),
 * presents an editable form grouped by section, validates client-side, saves
 * via setConfig().
 *
 * The defaults live in EmpresaService.CONFIG_DEFAULTS — single source of
 * truth shared with consumers (see empresaService.js comment).
 */
(function () {
  'use strict';

  // Secciones temáticas (orden = orden de render + del nav). Cada campo declara
  // su `section`; un campo con section desconocida cae en la última.
  const SECTIONS = [
    { key: 'facturacion', label: 'Facturación y cotizaciones', icon: 'calculator' },
    { key: 'correos',     label: 'Correos y notificaciones',   icon: 'mail',
      // Panorama para el admin: qué correos son fijos (se mandan solos) y dónde
      // se configuran los que no viven en esta sección. HTML literal propio.
      intro: `
        <p style="margin:0 0 8px;"><b>Cada campo dice qué correo afecta y quién lo recibe.</b>
        Estos correos se envían <b>solos, sin configuración</b> (destinatarios automáticos):</p>
        <ul style="margin:0 0 8px 18px; padding:0; line-height:1.7;">
          <li><b>Contrato creado</b> → ventas@cecomunica.com + quien lo creó</li>
          <li><b>Enmiendas de baja</b> (creada/aprobada/rechazada/cerrada) → aprobadores y solicitante</li>
          <li><b>Cambio de serial</b> → inventario + vendedor + quien lo solicitó</li>
          <li><b>Anulación de contrato</b> → quien anuló + quien elaboró el contrato</li>
          <li><b>Equipos por devolver</b> (al registrar transición y recordatorio semanal de los lunes) → vendedor del cliente + recepción + ventas@cecomunica.com</li>
        </ul>
        <p style="margin:0;">Otros correos se configuran en su propia sección:
        <b>solicitud de seriales</b> en “Seriales”, <b>aprobadores de cotización</b> en “Facturación y cotizaciones”.</p>` },
    { key: 'inventario',  label: 'Inventario y piezas',        icon: 'package' },
    { key: 'seriales',    label: 'Seriales',                   icon: 'hash' },
    { key: 'operacion',   label: 'Operación',                  icon: 'activity' },
    { key: 'pii',         label: 'Privacidad (PII)',           icon: 'shield' },
  ];

  const FIELDS = [
    { key: 'itbms_rate',                section: 'facturacion', label: 'Tasa ITBMS',
      type: 'rate', min: 0,     max: 0.25,  step: 0.001,
      hint: 'Rango 0–25% (0.07 = 7%). Cambia inmediatamente cálculos en cotizaciones, contratos y órdenes.' },
    { key: 'cotizacion_validez_dias',   section: 'facturacion', label: 'Validez por defecto de cotización (días)',
      type: 'int',  min: 1,     max: 365,
      hint: 'Aplicado a cotizaciones nuevas. No afecta las ya creadas.' },
    { key: 'cotizacion_aprobacion_to', section: 'facturacion', label: 'Aprobadores de cotización (notificación)',
      type: 'user-picker', emptyHint: 'se notificará a ventas@cecomunica.com',
      hint: 'Usuarios que reciben la solicitud de aprobación cuando se prepara una cotización. Filtra por rol y selecciona uno o varios. Vacío = se notifica a ventas@cecomunica.com.' },
    { key: 'cotizaciones_supervisores', section: 'facturacion', label: 'Supervisión de cotizaciones (ver todas)',
      type: 'user-picker', emptyHint: 'solo admin, gerente y jefe de taller ven todas',
      hint: 'Usuarios habilitados a VER todas las cotizaciones (listado y detalle) sin importar su rol — p.ej. coordinación de ventas. Es acceso de solo lectura: no otorga edición, aprobación ni envío.' },

    { key: 'mail_bcc_cotizacion', section: 'correos', label: 'Cotización enviada al cliente → copia oculta (BCC)',
      type: 'emails',
      hint: 'Uno por línea. Cada cotización que se envía al cliente lleva copia oculta a estos correos (el cliente no los ve). Útil para que coordinación de ventas reciba cada propuesta al momento.' },
    { key: 'mail_cc_orden_completada', section: 'correos', label: 'Orden de servicio completada → copias (CC)',
      type: 'emails',
      hint: 'Uno por línea. Se añaden en copia al correo que avisa que una orden quedó COMPLETADA (en oficina).' },
    { key: 'mail_cc_contrato_aprobado', section: 'correos', label: 'Contrato aprobado (PDF interno) → copias (CC)',
      type: 'emails',
      hint: 'Uno por línea. Se añaden en copia al correo interno "Contrato APROBADO" (el del PDF que va a activaciones con copia al vendedor). No aplica al reenvío manual del PDF al cliente.' },
    { key: 'email_recepcion_entregas', section: 'correos', label: 'Nota de ENTREGA al cliente → copia a recepción',
      type: 'email',
      hint: 'Correo único que recibe copia de cada nota de entrega de una orden (recepción lleva el control de lo que sale). No confundir con "equipos devueltos" (campo siguiente). Vacío = no se copia.' },
    { key: 'email_recepcion', section: 'correos', label: 'Equipos DEVUELTOS por el cliente → recepción',
      type: 'user-picker', emptyHint: 'se notifica a todos los usuarios con rol Recepción',
      hint: 'Quién de recepción recibe: (1) la orden de ENTRADA que se crea sola cuando un cliente devuelve equipos (baja o anulación), y (2) los avisos de equipos pendientes de devolución (transiciones de renovación/reemplazo + recordatorio semanal). El vendedor del cliente siempre va incluido. Vacío = todos los usuarios con rol Recepción.' },
    { key: 'email_taller', section: 'correos', label: 'Avisos al taller (jefe de taller) → CC',
      type: 'user-picker', emptyHint: 'no se copia al taller',
      hint: 'Usuarios que reciben copia de: orden COMPLETADA, cada nota de entrega, y las órdenes de ENTRADA (equipos devueltos que hay que inspeccionar). Típicamente el jefe de taller — filtra por ese rol para encontrarlo rápido. Vacío = no se copia al taller.' },

    { key: 'stock_minimo_default',      section: 'inventario', label: 'Stock mínimo por defecto (piezas nuevas)',
      type: 'int',  min: 0,     max: 1000,
      hint: 'Placeholder usado al crear una pieza nueva. No modifica las existentes.' },
    { key: 'piezas_categorias', section: 'inventario', label: 'Categorías de piezas',
      type: 'lines',
      hint: 'Una por línea. Alimentan el selector de categoría en Piezas y Tarifas y los grupos del catálogo al cotizar una orden. Quitar una categoría no toca las piezas que ya la tienen (se conservan como valor legacy).' },

    { key: 'email_solicitud_seriales', section: 'seriales', label: 'Solicitud de seriales (notificación)',
      type: 'user-picker', emptyHint: 'se usa inventario@cecomunica.com',
      hint: 'Usuarios que reciben el correo "Solicitud de seriales" cuando se aprueba un contrato con equipos. Selecciona uno o varios. Vacío = se usa inventario@cecomunica.com.' },
    { key: 'seriales_recordatorio_dias', section: 'seriales', label: 'Recordatorio de seriales (días)',
      type: 'int', min: 1, max: 30,
      hint: 'Cada cuántos días se le recuerda a inventario un contrato con seriales pendientes (hasta 4 veces). El badge "Seriales pendientes" en la lista queda como recordatorio permanente.' },
    { key: 'seriales_editores_extra', section: 'seriales', label: 'Editar seriales tras "asignados" (además de admin)',
      type: 'user-picker', emptyHint: 'solo administradores',
      hint: 'Cuando los seriales de un contrato quedan "asignados", la pantalla se bloquea en solo-lectura para evitar cambios accidentales. Los administradores siempre pueden reabrir y editar; aquí puedes habilitar usuarios específicos (aunque no sean admin) para reabrir y editar seriales ya asignados. Vacío = solo administradores.' },

    { key: 'orden_stale_dias',          section: 'operacion', label: 'Días para marcar orden como "sin movimiento"',
      type: 'int',  min: 3,     max: 60,
      hint: 'Umbral usado en el panel de Operación para flag de stale.' },

    { key: 'pii_retention_dias',        section: 'pii', label: 'Retención PII (días)',
      type: 'int',  min: 30,    max: 730,
      hint: 'Días antes de purgar fotos de identificación. Verifica con legal antes de bajar de 60.' },
    { key: 'pii_purge_enabled',         section: 'pii', label: 'Purga PII habilitada',
      type: 'bool',
      hint: 'Kill-switch global: cuando está apagado, el callable purgePIIRetention rechaza ejecuciones reales (preview sigue funcionando). También editable desde admin/pii.html.' },
  ];

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Cargado una vez en load() para alimentar los campos tipo 'user-picker'.
  let _users = [];

  // Cambios sin guardar: alimenta la barra sticky y el aviso al salir.
  let dirty = false;

  const ROL_LABELS = {
    administrador: 'Administrador', gerente: 'Gerente', vendedor: 'Vendedor',
    recepcion: 'Recepción', tecnico: 'Técnico', tecnico_operativo: 'Técnico operativo',
    jefe_taller: 'Jefe de taller', inventario: 'Inventario', contabilidad: 'Contabilidad', vista: 'Vista',
  };
  const rolLabel = (r) => ROL_LABELS[r] || (r || '—');

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
  function esc(s) { return FMT.esc(s); } // helper canónico (core/formatting.js)

  // ── Render: nav de secciones + tarjetas por sección ────────────────────────
  function renderForm(current) {
    const form = $('configForm');
    if (!form) return;

    const bySection = new Map(SECTIONS.map(s => [s.key, []]));
    const fallback = SECTIONS[SECTIONS.length - 1].key;
    FIELDS.forEach(f => (bySection.get(f.section) || bySection.get(fallback)).push(f));

    form.innerHTML = SECTIONS.map(s => {
      const fields = bySection.get(s.key) || [];
      if (!fields.length) return '';
      return `
        <section class="cfg-section" id="sec-${s.key}">
          <div class="cfg-section-head">
            <i data-lucide="${s.icon}"></i>
            <h2>${esc(s.label)}</h2>
          </div>
          ${s.intro ? `<div class="ts cfg-section-intro" style="margin:0 0 var(--sp-3); padding:12px 14px; border:1px solid var(--border-subtle,#e5e7eb); border-radius:10px; background:var(--surface-sunken,#f8fafc); color:var(--fg-2); line-height:1.6;">${s.intro}</div>` : ''}
          <div class="cfg-section-body">
            ${fields.map(f => fieldHtml(current, f)).join('')}
          </div>
        </section>`;
    }).join('');

    renderNav();
  }

  function renderNav() {
    const nav = $('configNav');
    if (!nav) return;
    nav.innerHTML = SECTIONS
      .filter(s => FIELDS.some(f => f.section === s.key))
      .map(s => `<a href="#sec-${s.key}"><i data-lucide="${s.icon}"></i> ${esc(s.label)}</a>`)
      .join('');
  }

  function fieldHtml(current, f) {
    const v = current[f.key];
    let input;
    if (f.type === 'user-picker') {
      input = renderUserPicker(f.key, Array.isArray(v) ? v : [], f.emptyHint);
    } else if (f.type === 'emails' || f.type === 'lines') {
      const text = Array.isArray(v) ? v.join('\n') : '';
      const rows = f.type === 'lines' ? 6 : 3;
      input = `<textarea id="fld-${f.key}" class="form-input" rows="${rows}" style="font-family:inherit;font-size:13px;">${esc(text)}</textarea>`;
    } else if (f.type === 'email') {
      const val = (typeof v === 'string' ? v : '');
      input = `<input type="email" id="fld-${f.key}" class="form-input" value="${esc(val)}" placeholder="recepcion@cecomunica.com" style="max-width:320px;">`;
    } else if (f.type === 'rate') {
      input = `<input type="number" id="fld-${f.key}" class="form-input" min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v)}" style="width:140px;">`;
    } else if (f.type === 'bool') {
      const checked = v === true ? 'checked' : '';
      input = `<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;"><input type="checkbox" id="fld-${f.key}" ${checked} style="width:18px;height:18px;"> Habilitada</label>`;
    } else {
      input = `<input type="number" id="fld-${f.key}" class="form-input" min="${f.min}" max="${f.max}" step="1" value="${esc(v)}" style="width:140px;">`;
    }
    return `
      <div class="form-field cfg-field">
        <label class="form-label" for="fld-${f.key}">${esc(f.label)}</label>
        ${input}
        <div class="ts cfg-hint">${esc(f.hint)}</div>
        <div class="ts fld-error" data-for="${f.key}" style="display:none;color:#b91c1c;margin-top:4px;"></div>
      </div>`;
  }

  // ── user-picker compacto: resumen con chips + panel plegable ───────────────
  // Guarda un array de emails. Los checkboxes siguen siendo la fuente de verdad
  // (readForm lee :checked); los chips son solo una vista del estado marcado.
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
      return `<label class="up-item" data-rol="${esc(u.rol || '')}" data-search="${esc((u.nombre || '') + ' ' + (u.email || '')).toLowerCase()}">
        <input type="checkbox" value="${esc(u.email)}" ${checked}>
        <span class="up-name">${esc(u.nombre || u.email)}</span>
        <span class="ts up-item-meta">${esc(u.email)} · ${esc(rolLabel(u.rol))}</span>
      </label>`;
    }).join('');

    return `<div id="fld-${key}" class="up-root is-collapsed" data-key="${key}" data-empty-hint="${esc(emptyHint || 'se notificará a ventas@cecomunica.com')}">
      <div class="up-summary">
        <div class="up-chips"></div>
        <button type="button" class="btn btn-ghost btn-sm up-toggle"><i data-lucide="pencil"></i> Editar</button>
      </div>
      <div class="up-panel">
        <div class="up-filters">
          <select class="form-input up-filter-rol" style="width:200px;">${rolOpts}</select>
          <input type="text" class="form-input up-filter-q" placeholder="Buscar nombre o email…" style="flex:1;min-width:180px;">
        </div>
        <div class="up-list">${items}</div>
        <div class="ts up-count" style="margin-top:6px;"></div>
      </div>
    </div>`;
  }

  function wireUserPickers() {
    document.querySelectorAll('.up-root[data-key]').forEach(root => {
      const filterRol = root.querySelector('.up-filter-rol');
      const filterQ   = root.querySelector('.up-filter-q');
      const items     = [...root.querySelectorAll('.up-item')];
      const countEl   = root.querySelector('.up-count');
      const chipsEl   = root.querySelector('.up-chips');
      const emptyHint = root.getAttribute('data-empty-hint') || 'se notificará a ventas@cecomunica.com';

      const applyFilter = () => {
        const r = (filterRol?.value || '').trim();
        const q = (filterQ?.value || '').trim().toLowerCase();
        items.forEach(it => {
          const okRol = !r || it.dataset.rol === r;
          const okQ   = !q || (it.dataset.search || '').includes(q);
          it.style.display = (okRol && okQ) ? '' : 'none';
        });
      };

      const refresh = () => {
        const checked = items.filter(i => i.querySelector('input').checked);
        if (countEl) countEl.textContent = checked.length ? `${checked.length} seleccionado${checked.length === 1 ? '' : 's'}` : `Sin selección — ${emptyHint}`;
        if (chipsEl) {
          chipsEl.innerHTML = checked.length
            ? checked.map(it => {
                const email = it.querySelector('input').value;
                const name = it.querySelector('.up-name')?.textContent || email;
                return `<span class="up-chip"><span>${esc(name)}</span><button type="button" class="up-chip-x" data-email="${esc(email)}" title="Quitar">×</button></span>`;
              }).join('')
            : `<span class="up-empty">${esc(emptyHint)}</span>`;
        }
      };

      root.querySelector('.up-toggle')?.addEventListener('click', () => {
        root.classList.toggle('is-collapsed');
        if (!root.classList.contains('is-collapsed')) setTimeout(() => filterQ?.focus(), 30);
      });
      filterRol?.addEventListener('change', applyFilter);
      filterQ?.addEventListener('input', applyFilter);
      root.addEventListener('change', e => { if (e.target.matches('input[type="checkbox"]')) refresh(); });
      // Quitar un chip = desmarcar el checkbox correspondiente.
      chipsEl?.addEventListener('click', e => {
        const btn = e.target.closest('.up-chip-x');
        if (!btn) return;
        const cb = items.map(i => i.querySelector('input')).find(c => c.value === btn.dataset.email);
        if (cb) { cb.checked = false; refresh(); markDirty(); }
      });

      refresh();
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
        if (uniq.length > 20) errors[f.key] = 'Máximo 20 usuarios.';
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
      } else if (f.type === 'lines') {
        // Lista de strings libres (una por línea), deduplicada conservando orden.
        const list = [...new Set(raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
        if (list.length > 30) errors[f.key] = 'Máximo 30 líneas.';
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
    if (firstField) {
      // Abre el user-picker si el error está adentro, para que el foco se vea.
      firstField.closest('.up-root')?.classList.remove('is-collapsed');
      firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstField.focus({ preventScroll: true });
    }
  }

  // ── Cambios sin guardar ────────────────────────────────────────────────────
  function markDirty() { if (!dirty) { dirty = true; updateDirtyUI(); } }
  function clearDirty() { dirty = false; updateDirtyUI(); }
  function updateDirtyUI() {
    $('cfgSavebar')?.classList.toggle('is-visible', dirty);
    $('btnSave')?.classList.toggle('has-changes', dirty);
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
      clearDirty();
      const meta = $('configMeta');
      if (meta) {
        const ts = cfg.updated_at;
        const who = cfg.updated_by;
        meta.innerHTML = ts
          ? `Última edición: ${new Date(ts.toMillis ? ts.toMillis() : ts).toLocaleString('es-PA', { hour12: false })} por <code>${esc(who || '—')}</code>`
          : 'Sin ediciones registradas (usando valores por defecto).';
      }
      setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
      if (typeof lucide !== 'undefined') lucide.createIcons();
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
      clearDirty();
      if (window.Toast) Toast.show('Configuración guardada.', 'ok');
      await load();
    } catch (err) {
      console.error('[admin/config] save:', err);
      if (window.Toast) Toast.show('Error guardando: ' + (err.message || err.code || err), 'bad');
    }
  }

  async function descartar() {
    if (!dirty) return;
    const ok = await Modal.confirm({
      title: 'Descartar cambios',
      message: 'Se perderán los cambios sin guardar y se recargarán los valores actuales. ¿Continuar?',
      danger: true,
      confirmLabel: 'Descartar',
    });
    if (!ok) return;
    await load();
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
    $('btnSaveBar')?.addEventListener('click', save);
    $('btnDiscardBar')?.addEventListener('click', descartar);
    $('btnReload')?.addEventListener('click', async () => {
      if (dirty && !await Modal.confirm({ title: 'Recargar', message: 'Hay cambios sin guardar. ¿Recargar y descartarlos?', danger: true, confirmLabel: 'Recargar' })) return;
      load();
    });
    $('btnExport')?.addEventListener('click', exportSnapshot);

    // Marca "sucio" ante cualquier edición dentro del formulario.
    const form = $('configForm');
    if (form) {
      form.addEventListener('input', markDirty);
      form.addEventListener('change', markDirty);
    }

    // Aviso del navegador al salir con cambios pendientes.
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // Nav de secciones: scroll suave respetando el offset del topbar sticky.
    $('configNav')?.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#sec-"]');
      if (!a) return;
      e.preventDefault();
      document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      load();
    });
  });
})();
