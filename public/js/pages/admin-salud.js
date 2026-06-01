/**
 * admin-salud.js — system health diagnostics for the admin panel.
 *
 * Checks:
 *  - mail_queue: stuck (>1h), failed (with error), 24h summary
 *  - usuarios: sin rol, rol no canónico
 *  - ordenes sin searchTokens (post-backfill gap)
 *  - top órdenes por tamaño de os_logs (cap awareness)
 */
(function () {
  'use strict';

  const VALID_ROLES = new Set(Object.values(ROLES));

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  function renderTable(targetId, headers, rows, emptyMsg = 'Sin registros.') {
    const el = $(targetId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-3);text-align:center;color:var(--fg-3);font-size:13px;">${emptyMsg}</div>`;
      return;
    }
    const thead = headers.map(h => `<th${h.align === 'right' ? ' class="num"' : ''}>${h.label}</th>`).join('');
    const tbody = rows.map(r => '<tr>' + headers.map(h => {
      const v = r[h.key];
      const cls = h.align === 'right' ? ' class="num"' : '';
      return `<td${cls}>${v == null ? '' : v}</td>`;
    }).join('') + '</tr>').join('');
    el.innerHTML = `<table class="admin-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  }

  function fmtTs(v) {
    const d = AdminMetrics.toDate(v);
    if (!d) return '—';
    return d.toLocaleString('es-PA', { hour12: false });
  }

  function ageHours(v) {
    const d = AdminMetrics.toDate(v);
    if (!d) return null;
    return Math.floor((Date.now() - d.getTime()) / (60 * 60 * 1000));
  }

  // ────────── Mail Queue ──────────

  async function loadMailQueue() {
    try {
      const [stuck, failed, summary] = await Promise.all([
        MailQueueService.listStuck({ olderThanMs: 60 * 60 * 1000, limit: 50 }),
        MailQueueService.listFailed({ limit: 50 }),
        MailQueueService.countRecent({ withinMs: 24 * 60 * 60 * 1000 }),
      ]);

      setText('mailSummary',
        `Últimas 24 h: ${summary.sent} enviados · ${summary.pending} pendientes · ${summary.failed} con error (total ${summary.total})`);

      renderTable('tblMailStuck',
        [
          { key: 'createdAt', label: 'Encolado' },
          { key: 'ageHours', label: 'Edad', align: 'right' },
          { key: 'to', label: 'Para' },
          { key: 'template', label: 'Template' },
          { key: 'subject', label: 'Asunto' },
        ],
        stuck.map(m => ({
          createdAt: fmtTs(m.createdAt),
          ageHours: ageHours(m.createdAt) + ' h',
          to: Array.isArray(m.to) ? m.to.join(', ') : (m.to || '—'),
          template: m.template || '—',
          subject: m.subject || '—',
        })),
        'No hay emails atascados (> 1 h sin procesar).');

      renderTable('tblMailFailed',
        [
          { key: 'createdAt', label: 'Encolado' },
          { key: 'to', label: 'Para' },
          { key: 'template', label: 'Template' },
          { key: 'error', label: 'Error' },
        ],
        failed.map(m => ({
          createdAt: fmtTs(m.createdAt),
          to: Array.isArray(m.to) ? m.to.join(', ') : (m.to || '—'),
          template: m.template || '—',
          error: `<code style="font-size:11px;color:#991b1b;">${(m.error || '').toString().slice(0, 140)}</code>`,
        })),
        'No hay envíos fallidos registrados.');

      setText('countMailStuck', String(stuck.length));
      setText('countMailFailed', String(failed.length));
    } catch (err) {
      console.error('[admin/salud] mail:', err);
      setText('mailSummary', 'Error consultando mail_queue: ' + (err.message || err.code || err));
    }
  }

  // ────────── Usuarios ──────────

  async function loadUsuarios() {
    try {
      const snap = await firebase.firestore().collection('usuarios').get();
      const all = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      const sinRol = all.filter(u => !u.rol);
      const rolNoCanonico = all.filter(u => u.rol && !VALID_ROLES.has(u.rol));

      renderTable('tblUsuariosSinRol',
        [
          { key: 'uid', label: 'UID' },
          { key: 'email', label: 'Email' },
          { key: 'nombre', label: 'Nombre' },
        ],
        sinRol.map(u => ({
          uid: `<code style="font-size:11px;">${u.uid}</code>`,
          email: u.email || u.correo || '—',
          nombre: u.nombre || '—',
        })),
        'Todos los usuarios tienen rol asignado.');

      renderTable('tblUsuariosRolInvalido',
        [
          { key: 'uid', label: 'UID' },
          { key: 'email', label: 'Email' },
          { key: 'rol', label: 'Rol almacenado' },
        ],
        rolNoCanonico.map(u => ({
          uid: `<code style="font-size:11px;">${u.uid}</code>`,
          email: u.email || u.correo || '—',
          rol: `<code style="color:#991b1b;">${u.rol}</code>`,
        })),
        'Todos los roles existentes están en el enum ROLES.');

      setText('countSinRol', String(sinRol.length));
      setText('countRolInvalido', String(rolNoCanonico.length));
      setText('totalUsuarios', `${all.length} usuarios registrados`);
    } catch (err) {
      console.error('[admin/salud] usuarios:', err);
    }
  }

  // ────────── Órdenes ──────────

  async function loadOrdenesSalud() {
    try {
      const all = await OrdenesService.listAll();
      const sinTokens = all.filter(o =>
        o.eliminado !== true &&
        (!Array.isArray(o.searchTokens) || o.searchTokens.length === 0));
      setText('countSinTokens', String(sinTokens.length));

      // Top órdenes por tamaño de os_logs (atención al cap de 1 MiB / ~20k entries).
      const withLogs = all
        .filter(o => Array.isArray(o.os_logs) && o.os_logs.length > 0)
        .map(o => ({ id: o.ordenId, n: o.os_logs.length, numero: o.numero_orden, cliente: o.cliente_nombre || o.clienteNombre || '—' }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 10);

      renderTable('tblOrdenesGrandes',
        [
          { key: 'numero', label: 'N° Orden' },
          { key: 'cliente', label: 'Cliente' },
          { key: 'n', label: 'Entradas os_logs', align: 'right' },
        ],
        withLogs.map(o => ({
          numero: o.numero || `<code>${o.id}</code>`,
          cliente: o.cliente,
          n: o.n.toLocaleString('es-PA'),
        })),
        'Sin órdenes con os_logs registrados.');
    } catch (err) {
      console.error('[admin/salud] ordenes:', err);
    }
  }

  async function loadAll() {
    setText('lastUpdate', 'Cargando…');
    await Promise.all([loadMailQueue(), loadUsuarios(), loadOrdenesSalud()]);
    setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
    if (window.lucide) lucide.createIcons();
  }

  function wireToolbar() {
    const refresh = $('btnRefresh');
    if (refresh) refresh.addEventListener('click', () => loadAll());
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        if (window.Toast) Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      wireToolbar();
      loadAll();
    });
  });
})();
