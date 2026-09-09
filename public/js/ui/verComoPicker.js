/**
 * verComoPicker.js — picker "Ver como otro rol" (impersonación visual).
 *
 * Solo afecta visualmente qué tarjetas se ven en el home. NO impersona Auth
 * ni cambia queries ni reglas — el admin sigue siendo admin para Firestore.
 * Hoja del kit (Modal.sheet, 2026-09-08).
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

  let api = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function open() {
    if (api) return;
    Modal.sheet({
      title: 'Ver el home como otro rol', icon: 'eye', size: 'md',
      html: `
        <p style="margin:0 0 12px;font-size:13px;color:var(--fg-3);">
          Esta vista es <strong>solo visual</strong>: filtra qué tarjetas se muestran en el home. No cambia tus permisos, queries ni reglas — sigues siendo administrador para Firestore.
        </p>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${ROLES_LIST.map(r => `
          <a class="admin-launcher" href="../index.html?as=${encodeURIComponent(r.key)}" style="text-decoration:none;">
            <span class="ico"><i data-lucide="user"></i></span>
            <span class="meta">
              <span class="t">${escapeHtml(r.label)} <code style="font-size:11px;color:var(--fg-3);font-weight:400;margin-left:6px;">${r.key}</code></span>
              <span class="s">${escapeHtml(r.desc)}</span>
            </span>
          </a>`).join('')}
        </div>`,
      buttons: [{ action: 'cerrar', label: 'Cancelar' }],
      onMount: (root, a) => { api = a; },
    }).then(() => { api = null; });
  }

  function close() { if (api) api.close(null); }

  window.AdminVerComo = { open, close };
})();
