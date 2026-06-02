/**
 * verComoPicker.js — modal picker for "Ver como otro rol" (impersonation visual).
 *
 * Solo afecta visualmente qué tarjetas se ven en el home. NO impersona Auth
 * ni cambia queries ni reglas — el admin sigue siendo admin para Firestore.
 *
 * API:
 *   AdminVerComo.open()  — abre el modal
 *   AdminVerComo.close() — cierra el modal
 */
(function () {
  'use strict';

  // Lista de roles. Excluye 'administrador' porque ver-como-admin = vista normal.
  const ROLES_LIST = [
    { key: 'recepcion',         label: 'Recepción',         desc: 'Acceso operativo: órdenes, PoC, contratos, clientes' },
    { key: 'vendedor',          label: 'Vendedor',          desc: 'Acceso comercial: clientes, cotizaciones, contratos' },
    { key: 'tecnico',           label: 'Técnico',           desc: 'Acceso a órdenes y PoC (lectura)' },
    { key: 'tecnico_operativo', label: 'Técnico operativo', desc: 'Solo órdenes asignadas' },
    { key: 'inventario',        label: 'Inventario',        desc: 'Solo inventario y piezas' },
    { key: 'jefe_taller',       label: 'Jefe de taller',    desc: 'Supervisión taller' },
    { key: 'gerente',           label: 'Gerente',           desc: 'Lectura amplia para reportes' },
    { key: 'vista',             label: 'Vista',             desc: 'Solo lectura general' },
  ];

  let overlay = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function open() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px;">
        <div class="sheet-header">
          <h3 class="sheet-title"><i data-lucide="eye"></i> Ver el home como otro rol</h3>
        </div>
        <div class="sheet-body" style="padding:16px;">
          <p style="margin:0 0 12px;font-size:13px;color:var(--fg-3);">
            Esta vista es <strong>solo visual</strong>: filtra qué tarjetas se muestran en el home. No cambia tus permisos, queries ni reglas — sigues siendo administrador para Firestore.
          </p>
          <div id="vc-list" style="display:flex;flex-direction:column;gap:6px;"></div>
        </div>
        <div class="footer">
          <button class="btn btn-ghost" data-vc-action="close">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const list = overlay.querySelector('#vc-list');
    list.innerHTML = ROLES_LIST.map(r => `
      <a class="admin-launcher" href="../index.html?as=${encodeURIComponent(r.key)}" style="text-decoration:none;">
        <span class="ico"><i data-lucide="user"></i></span>
        <span class="meta">
          <span class="t">${escapeHtml(r.label)} <code style="font-size:11px;color:var(--fg-3);font-weight:400;margin-left:6px;">${r.key}</code></span>
          <span class="s">${escapeHtml(r.desc)}</span>
        </span>
      </a>`).join('');

    overlay.querySelector('[data-vc-action="close"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', _esc);
    if (window.lucide) lucide.createIcons();
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', _esc);
  }

  function _esc(e) { if (e.key === 'Escape') close(); }

  window.AdminVerComo = { open, close };
})();
