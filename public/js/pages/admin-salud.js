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
          { key: 'origen', label: 'Origen' },
          { key: 'error', label: 'Error' },
          { key: 'action', label: '', align: 'right' },
        ],
        failed.map(m => {
          const direct = m.failed_direct_send === true;
          const origenLabel = direct
            ? `<span class="pill" style="background:#fef3c7;color:#92400e;border-color:#fde68a;" title="Enviado directo via sendEmail() — el retry no recupera el payload original">${m.source || 'direct-send'}</span>`
            : `<span class="pill" title="Encolado via mail_queue — retry re-procesa">${m.template || 'queued'}</span>`;
          const action = direct
            ? `<span class="ts" title="Direct-send: el payload no está en el doc, no es retryable desde aquí">—</span>`
            : `<button class="btn btn-ghost btn-sm" data-mail-retry="${m.id}" title="Reintentar este envío"><i data-lucide="refresh-cw"></i></button>`;
          return {
            createdAt: fmtTs(m.createdAt),
            to: Array.isArray(m.to) ? m.to.join(', ') : (m.to || '—'),
            origen: origenLabel,
            error: `<code style="font-size:11px;color:#991b1b;">${(m.error || '').toString().slice(0, 140)}</code>`,
            action,
          };
        }),
        'No hay envíos fallidos registrados.');

      // Wire per-row retry buttons.
      document.querySelectorAll('[data-mail-retry]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.mailRetry;
          btn.disabled = true;
          try {
            await MailQueueService.retry(id);
            if (window.Toast) Toast.show('Re-encolado. Esperando procesado…', 'ok');
            setTimeout(() => loadMailQueue(), 1500);
          } catch (err) {
            if (window.Toast) Toast.show('Error: ' + (err.message || err.code), 'bad');
            btn.disabled = false;
          }
        });
      });

      // Show/hide bulk retry button. Solo incluye queued failures —
      // direct-send no tiene payload para reintentar.
      const bulkBtn = $('btnRetryAll');
      if (bulkBtn) {
        const retryables = failed.filter(m => m.failed_direct_send !== true);
        bulkBtn.style.display = retryables.length > 0 ? '' : 'none';
        bulkBtn.dataset.ids = JSON.stringify(retryables.map(m => m.id));
      }

      setText('countMailStuck', String(stuck.length));
      setText('countMailFailed', String(failed.length));
      if (window.lucide) lucide.createIcons();
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

  // Conciliación semanal del pool de equipos (cron conciliacionPool, L5).
  async function loadConciliacionPool() {
    try {
      const doc = await firebase.firestore().collection('admin_reportes').doc('conciliacion_pool').get();
      if (!doc.exists) {
        renderTable('tblConcPool', [{ key: 'chequeo', label: 'Chequeo' }], [],
          'Aún no corre la primera conciliación (lunes 06:40).');
        return;
      }
      const r = doc.data();
      // El contador de apagados explica por qué el total es chico: los devices
      // POC desactivados son el rastro del cliente anterior, no drift.
      const apagados = Number(r.poc_apagados_ignorados || 0);
      setText('concPoolFecha', r.at
        ? `Último corte: ${fmtTs(r.at)} · ${r.total || 0} caso(s)`
          + (apagados ? ` · ${apagados.toLocaleString('es-PA')} device(s) POC apagados ignorados` : '')
        : '—');
      const filas = [
        { chequeo: 'Serial de contrato vigente sin ficha (o asignada a otro)', n: r.A_contrato_sin_ficha || 0, m: r.A_muestras },
        { chequeo: 'En taller con la orden ya cerrada', n: r.B_taller_orden_cerrada || 0, m: r.B_muestras },
        { chequeo: 'Device POC activo sin ninguna ficha del serial', n: r.C_poc_sin_ficha || 0, m: r.C_sin_ficha_muestras },
        { chequeo: 'Device POC activo con ficha, pero sin enlace', n: r.C_poc_sin_enlace || 0, m: r.C_muestras },
        { chequeo: 'Asignada a contrato ANULADO sin devolución', n: r.D_asignada_a_anulado || 0, m: r.D_muestras },
        { chequeo: 'Vendido con enlace de orden colgante', n: r.E_vendido_orden_cerrada || 0, m: r.E_muestras },
        { chequeo: 'Mismo serial ACTIVO en POC con dos clientes', n: r.F_serial_dos_clientes || 0, m: r.F_muestras },
      ].map(f => ({
        chequeo: f.chequeo,
        casos: String(f.n),
        muestras: (f.m || []).slice(0, 6).map(x => x.serial || x.device || '').filter(Boolean).join(', ') || '—',
      }));
      renderTable('tblConcPool', [
        { key: 'chequeo', label: 'Chequeo' },
        { key: 'casos', label: 'Casos', align: 'right' },
        { key: 'muestras', label: 'Muestras' },
      ], filas, 'Sin drift detectado.');
    } catch (err) {
      console.error('[admin/salud] conciliacion pool:', err);
    }
  }

  async function loadAll() {
    setText('lastUpdate', 'Cargando…');
    await Promise.all([loadMailQueue(), loadUsuarios(), loadOrdenesSalud(), loadConciliacionPool()]);
    setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
    if (window.lucide) lucide.createIcons();
  }

  function wireToolbar() {
    const refresh = $('btnRefresh');
    if (refresh) refresh.addEventListener('click', () => loadAll());

    const bulkBtn = $('btnRetryAll');
    if (bulkBtn) {
      bulkBtn.addEventListener('click', async () => {
        const ids = JSON.parse(bulkBtn.dataset.ids || '[]');
        if (!ids.length) return;
        if (!window.Modal) { return; }
        const ok = await Modal.confirm({
          title: 'Reintentar todos',
          message: `Se re-encolarán <strong>${ids.length}</strong> emails fallidos. Cada uno se procesará de inmediato. ¿Continuar?`,
          confirmLabel: 'Reintentar',
        });
        if (!ok) return;
        bulkBtn.disabled = true;
        try {
          const res = await MailQueueService.retryMany(ids);
          if (window.Toast) Toast.show(`Re-encolados: ${res.ok} ok, ${res.failed} fallidos`, res.failed ? 'warn' : 'ok');
          setTimeout(() => loadMailQueue(), 2000);
        } finally {
          bulkBtn.disabled = false;
        }
      });
    }
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
