/**
 * admin-usuarios.js — users portal for the admin panel.
 *
 * Lists all users with filter + search, supports inline rol change,
 * deactivate/reactivate, password reset link generation, and "Nuevo
 * usuario" modal for invites.
 *
 * All mutations go through manageUser callable (UsuariosAdminService).
 * The server-side enforces auth + safety (no self-demotion, no last-admin
 * removal). UI also disables actions on self where appropriate.
 */
(function () {
  'use strict';

  const ROL_OPTIONS = [
    ROLES.ADMIN,
    ROLES.GERENTE,
    ROLES.VENDEDOR,
    ROLES.RECEPCION,
    ROLES.TECNICO,
    ROLES.TECNICO_OPERATIVO,
    ROLES.JEFE_TALLER,
    ROLES.INVENTARIO,
    ROLES.CONTABILIDAD,
    ROLES.VISTA,
  ];

  const state = {
    all: [],
    filtered: [],
    filterRol: '',
    search: '',
    callerUid: null,
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  function escapeHtml(s) { return FMT.esc(s); } // helper canónico (core/formatting.js)

  // Nombre legible y qué ve cada rol (auditoría UX 2026-09-28: antes se
  // mostraban las claves crudas, "tecnico_operativo").
  const rolLabel = (r) => AdminMetrics.rolLabel(r);
  const rolDesc = (r) => AdminMetrics.ROL_DESCRIPCIONES[r] || '';
  const FILTRO_SIN_ROL = '__sinrol__';
  const tieneRolValido = (u) => !!u.rol && ROL_OPTIONS.includes(u.rol);

  function rolOptions(sel) {
    return ROL_OPTIONS.map(r =>
      `<option value="${r}" title="${escapeHtml(rolDesc(r))}"${sel === r ? ' selected' : ''}>${escapeHtml(rolLabel(r))}</option>`).join('');
  }

  function applyFilters() {
    const q = state.search.toLowerCase();
    state.filtered = state.all.filter(u => {
      if (state.filterRol === FILTRO_SIN_ROL) { if (tieneRolValido(u)) return false; }
      else if (state.filterRol && u.rol !== state.filterRol) return false;
      if (!q) return true;
      return (u.nombre || '').toLowerCase().includes(q) ||
             (u.email  || '').toLowerCase().includes(q) ||
             (u.uid    || '').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    const el = $('tblUsuarios');
    if (!el) return;
    if (!state.filtered.length) {
      el.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-4);text-align:center;color:var(--fg-3);">Sin usuarios para los filtros actuales.</div>`;
      setText('countShowing', `0 de ${state.all.length}`);
      return;
    }
    const rows = state.filtered.map(u => {
      const isSelf = u.uid === state.callerUid;
      const activo = u.activo !== false;
      // Sin rol (o con uno que no existe): opción vacía seleccionada. Antes el
      // navegador marcaba la primera opción y el usuario se veía como
      // "administrador" (auditoría UX 2026-09-28).
      const sinRol = !tieneRolValido(u);
      const rolDropdown = `<select class="form-input form-input-sm" data-action="rol" data-uid="${u.uid}" style="font-size:12px;padding:3px 6px;${sinRol ? 'border-color:var(--warning,#d97706);' : ''}" title="${escapeHtml(rolDesc(u.rol))}">
        ${sinRol ? `<option value="" selected>— sin rol —${u.rol ? ` (${escapeHtml(u.rol)})` : ''}</option>` : ''}
        ${rolOptions(u.rol)}
      </select>`;
      const actBtn = activo
        ? `<button class="btn btn-ghost btn-sm" data-action="deactivate" data-uid="${u.uid}" ${isSelf ? 'disabled title="No puedes desactivarte a ti mismo"' : 'title="Desactivar"'}><i data-lucide="user-x"></i></button>`
        : `<button class="btn btn-ghost btn-sm" data-action="reactivate" data-uid="${u.uid}" title="Reactivar"><i data-lucide="user-check"></i></button>`;
      const resetBtn = `<button class="btn btn-ghost btn-sm" data-action="reset" data-uid="${u.uid}" title="Generar link de reset de contraseña"><i data-lucide="key"></i></button>`;
      return `
        <tr ${activo ? '' : 'style="opacity:0.6;"'}>
          <td>${escapeHtml(u.nombre || '—')}${isSelf ? ' <span class="pill" style="font-size:10px;">tú</span>' : ''}</td>
          <td><code style="font-size:11px;">${escapeHtml(u.email || u.correo || '—')}</code></td>
          <td>${rolDropdown}</td>
          <td><button class="btn btn-ghost btn-sm" data-action="cargo" data-uid="${u.uid}" title="Cargo con el que firma las cotizaciones"
                style="font-size:12px;${u.cargo ? '' : 'color:var(--fg-3);'}">${escapeHtml(u.cargo || 'Poner cargo')}</button></td>
          <td>${activo ? '<span class="pill" style="background:#d1fae5;color:#065f46;border-color:#a7f3d0;">activo</span>' : '<span class="pill" style="background:#fee2e2;color:#991b1b;border-color:#fecaca;">desactivado</span>'}</td>
          <td><code style="font-size:10px;color:var(--fg-3);">${u.uid.slice(0, 12)}…</code></td>
          <td style="text-align:right;white-space:nowrap;">${resetBtn} ${actBtn}</td>
        </tr>`;
    }).join('');
    el.innerHTML = `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Cargo (firma)</th><th>Estado</th><th>UID</th><th style="text-align:right;">Acciones</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
    setText('countShowing', `${state.filtered.length} de ${state.all.length}`);
    if (window.lucide) lucide.createIcons();
    wireRowActions();
  }

  function wireRowActions() {
    document.querySelectorAll('[data-action="rol"]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const uid = sel.dataset.uid;
        const newRol = sel.value;
        const u = state.all.find(x => x.uid === uid);
        const oldRol = u?.rol;
        // El valor visible del select cuando no tenía rol es '' (la opción
        // "— sin rol —"), no el rol crudo inválido.
        const oldSel = tieneRolValido(u) ? oldRol : '';
        if (!newRol || newRol === oldRol) { sel.value = oldSel; return; }
        const ok = await Modal.confirm({
          title: 'Cambiar rol',
          message: `Cambiar el rol de <strong>${escapeHtml(u.nombre || u.email)}</strong> de <strong>${escapeHtml(rolLabel(oldRol))}</strong> a <strong>${escapeHtml(rolLabel(newRol))}</strong>.<br><span style="color:var(--fg-3);font-size:13px;">${escapeHtml(rolLabel(newRol))} ve: ${escapeHtml(rolDesc(newRol))}</span>`,
          confirmLabel: 'Cambiar',
        });
        if (!ok) { sel.value = oldSel; return; }
        try {
          await UsuariosAdminService.updateRol(uid, newRol);
          u.rol = newRol;
          Toast.show('Rol actualizado.', 'ok');
          renderTable();
        } catch (err) {
          Toast.show('Error: ' + (err.message || err.code), 'bad');
          sel.value = oldSel;
        }
      });
    });

    document.querySelectorAll('[data-action="cargo"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const u = state.all.find(x => x.uid === uid);
        const v = await Modal.prompt({
          title: 'Cargo con el que firma',
          message: `Así aparece bajo el nombre de ${u?.nombre || u?.email || 'la persona'} en las cotizaciones que firma. Déjalo vacío para usar el de su rol.`,
          defaultValue: u?.cargo || '',
          placeholder: 'Ej.: Jefa de Taller',
          confirmLabel: 'Guardar',
        });
        if (v === null || v === undefined) return;
        try {
          await UsuariosAdminService.updateCargo(uid, v);
          if (u) u.cargo = String(v).trim();
          Toast.show('Cargo actualizado. Aplica a las cotizaciones que se creen desde ahora.', 'ok');
          renderTable();
        } catch (err) {
          Toast.show('Error: ' + (err.message || err.code), 'bad');
        }
      });
    });

    document.querySelectorAll('[data-action="deactivate"]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const u = state.all.find(x => x.uid === uid);
        const ok = await Modal.confirm({
          title: 'Desactivar usuario',
          message: `Desactivar a <strong>${escapeHtml(u.nombre || u.email)}</strong>. No podrá iniciar sesión hasta que sea reactivado.`,
          danger: true,
          confirmLabel: 'Desactivar',
        });
        if (!ok) return;
        try {
          await UsuariosAdminService.deactivate(uid);
          Toast.show('Usuario desactivado.', 'ok');
          await load();
        } catch (err) {
          Toast.show('Error: ' + (err.message || err.code), 'bad');
        }
      });
    });

    document.querySelectorAll('[data-action="reactivate"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        try {
          await UsuariosAdminService.reactivate(uid);
          Toast.show('Usuario reactivado.', 'ok');
          await load();
        } catch (err) {
          Toast.show('Error: ' + (err.message || err.code), 'bad');
        }
      });
    });

    document.querySelectorAll('[data-action="reset"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const u = state.all.find(x => x.uid === uid);
        const ok = await Modal.confirm({
          title: 'Generar link de reset',
          message: `Se generará un link único para que <strong>${escapeHtml(u.email)}</strong> establezca una nueva contraseña. Debes copiárselo y enviárselo.`,
          confirmLabel: 'Generar',
        });
        if (!ok) return;
        try {
          const res = await UsuariosAdminService.resetPassword(uid);
          await showResetLinkModal(u.email, res.resetLink);
        } catch (err) {
          Toast.show('Error: ' + (err.message || err.code), 'bad');
        }
      });
    });
  }

  async function showResetLinkModal(email, link) {
    await Modal.sheet({
      title: 'Link de reset', icon: 'key', size: 'md',
      html: `
        <p style="margin:0 0 12px;">Envía este link a <strong>${escapeHtml(email)}</strong>:</p>
        <textarea readonly style="width:100%;height:90px;font-family:monospace;font-size:11px;padding:8px;border:1px solid var(--border-default);border-radius:6px;">${escapeHtml(link)}</textarea>`,
      buttons: [{ action: 'cerrar', label: 'Cerrar' }, { action: 'copiar', label: 'Copiar al portapapeles', primary: true, icon: 'copy' }],
      onAction: async (a) => {
        if (a !== 'copiar') return null;
        try { await navigator.clipboard.writeText(link); Toast.show('Link copiado.', 'ok'); }
        catch { Toast.show('No se pudo copiar — selecciona y copia manualmente.', 'warn'); }
        return false;
      },
    });
  }

  async function openCreateModal() {
    const r = await Modal.sheet({
      title: 'Nuevo usuario', icon: 'user-plus', size: 'sm',
      html: `
        <div class="form-field" style="margin-bottom:12px;">
          <label class="form-label">Nombre</label>
          <input id="nu-nombre" class="form-input" type="text" autocomplete="off" required>
        </div>
        <div class="form-field" style="margin-bottom:12px;">
          <label class="form-label">Email</label>
          <input id="nu-email" class="form-input" type="email" autocomplete="off" required>
        </div>
        <div class="form-field">
          <label class="form-label">Rol</label>
          <select id="nu-rol" class="form-input">
            ${rolOptions(ROLES.VENDEDOR)}
          </select>
          <div id="nu-rol-desc" class="ts" style="margin-top:4px;color:var(--fg-3);">${escapeHtml(rolDesc(ROLES.VENDEDOR))}</div>
        </div>
        <div id="nu-err" style="color:#b91c1c;font-size:13px;margin-top:8px;display:none;"></div>`,
      buttons: [{ action: 'cancel', label: 'Cancelar' }, { action: 'crear', label: 'Crear', primary: true, icon: 'user-plus' }],
      onMount: (root) => {
        root.querySelector('#nu-nombre')?.focus();
        const selRol = root.querySelector('#nu-rol');
        selRol?.addEventListener('change', () => {
          const d = root.querySelector('#nu-rol-desc');
          if (d) d.textContent = rolDesc(selRol.value);
        });
      },
      onAction: async (a, root) => {
        if (a !== 'crear') return null;
        const nombre = root.querySelector('#nu-nombre').value.trim();
        const email  = root.querySelector('#nu-email').value.trim();
        const rol    = root.querySelector('#nu-rol').value;
        const errEl  = root.querySelector('#nu-err');
        errEl.style.display = 'none';
        if (!nombre || !email)    { errEl.textContent = 'Nombre y email son requeridos.'; errEl.style.display = ''; return false; }
        if (!email.includes('@')) { errEl.textContent = 'Email inválido.';                errEl.style.display = ''; return false; }
        try {
          const res = await UsuariosAdminService.create({ email, nombre, rol });
          return { email, resetLink: res.resetLink || null };
        } catch (err) {
          errEl.textContent = err.message || err.code || String(err);
          errEl.style.display = '';
          return false;
        }
      },
    });
    if (!r || typeof r !== 'object') return;
    Toast.show('Usuario creado.', 'ok');
    if (r.resetLink) await showResetLinkModal(r.email, r.resetLink);
    await load();
  }

  async function load() {
    setText('lastUpdate', 'Cargando…');
    try {
      state.all = await UsuariosAdminService.listAll();
      // Sort: active first, then alphabetical by nombre.
      state.all.sort((a, b) => {
        const aa = a.activo !== false ? 0 : 1;
        const bb = b.activo !== false ? 0 : 1;
        if (aa !== bb) return aa - bb;
        return (a.nombre || a.email || '').localeCompare(b.nombre || b.email || '');
      });
      applyFilters();
      setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
    } catch (err) {
      console.error('[admin/usuarios]', err);
      Toast.show('Error cargando usuarios: ' + (err.message || err.code), 'bad');
    }
  }

  function wireToolbar() {
    $('btnRefresh')?.addEventListener('click', () => load());
    $('btnNuevo')?.addEventListener('click', openCreateModal);

    $('filterRol')?.addEventListener('change', (e) => {
      state.filterRol = e.target.value;
      applyFilters();
    });
    const sel = $('filterRol');
    if (sel) {
      sel.innerHTML = `<option value="">Todos los roles</option>` +
        `<option value="${FILTRO_SIN_ROL}">— Sin rol —</option>` +
        ROL_OPTIONS.map(r => `<option value="${r}">${escapeHtml(rolLabel(r))}</option>`).join('');
      // ?filtro=sinrol llega desde el aviso de la portada y desde Salud
      // (auditoría UX 2026-09-28).
      const filtro = new URLSearchParams(location.search).get('filtro');
      if (filtro === 'sinrol') { sel.value = FILTRO_SIN_ROL; state.filterRol = FILTRO_SIN_ROL; }
    }

    const search = $('searchInput');
    if (search) {
      let t = null;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { state.search = search.value.trim(); applyFilters(); }, 200);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      state.callerUid = firebase.auth().currentUser?.uid || null;
      wireToolbar();
      load();
    });
  });
})();
