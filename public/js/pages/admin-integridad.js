/**
 * admin-integridad.js — data integrity checks for the admin panel.
 *
 * Each check returns { severity, count, items, columns, msg }. Only
 * diagnostic — no auto-correction in v1; fixes are made in each module's
 * native page (linked from each row).
 *
 * Cost: each check reads at most one collection (bounded by listAll() and
 * already-paginated services). Manual refresh only.
 */
(function () {
  'use strict';

  const SEV_META = {
    error:   { color: '#b91c1c', icon: 'alert-octagon', label: 'Error' },
    warning: { color: '#b45309', icon: 'alert-triangle', label: 'Aviso' },
    info:    { color: '#2563eb', icon: 'info',          label: 'Info' },
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
  function escapeHtml(s) { return FMT.esc(s); } // helper canónico (+ escapa comilla simple, antes faltaba)

  function ageDays(v) {
    const d = AdminMetrics.toDate(v);
    if (!d) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  // ─────────── Checks ───────────

  async function checkOrdenesSinContrato() {
    const all = await OrdenesService.listAll();
    const withCt = all.filter(o => o.eliminado !== true && o.contrato_id);
    if (!withCt.length) return { severity: 'error', count: 0, items: [] };

    const db = firebase.firestore();
    // Check existence in batches of 30 by contratoId.
    const uniqueCtIds = Array.from(new Set(withCt.map(o => o.contrato_id)));
    const existing = new Set();
    for (let i = 0; i < uniqueCtIds.length; i += 30) {
      const slice = uniqueCtIds.slice(i, i + 30);
      // contratos can be queried by contrato_id (the user-facing CT-YYYY-NNN)
      const snap = await db.collection('contratos').where('contrato_id', 'in', slice).get();
      snap.forEach(d => existing.add(d.data().contrato_id));
    }
    const orphans = withCt.filter(o => !existing.has(o.contrato_id));
    return {
      severity: 'error',
      count: orphans.length,
      columns: [
        { key: 'numero', label: 'N° Orden' },
        { key: 'contrato_id', label: 'contrato_id (huérfano)' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'link', label: '', align: 'right' },
      ],
      items: orphans.slice(0, 50).map(o => ({
        numero: o.numero_orden || `<code>${o.ordenId}</code>`,
        contrato_id: `<code style="color:#991b1b;">${escapeHtml(o.contrato_id)}</code>`,
        cliente: escapeHtml(o.cliente_nombre || o.clienteNombre || '—'),
        link: `<a href="../ordenes/editar-orden.html?id=${encodeURIComponent(o.ordenId)}" class="btn btn-ghost btn-sm">Abrir</a>`,
      })),
    };
  }

  async function checkClientesSinContacto() {
    const all = await ClientesService.listClientes({ limit: 1000 });
    const items = all?.docs || (Array.isArray(all) ? all : []);
    const bad = items.filter(c => !c.email && !c.correo && !c.telefono);
    return {
      severity: 'warning',
      count: bad.length,
      columns: [
        { key: 'nombre', label: 'Nombre' },
        { key: 'ruc', label: 'RUC' },
        { key: 'link', label: '', align: 'right' },
      ],
      items: bad.slice(0, 50).map(c => ({
        nombre: escapeHtml(c.nombre || c.empresa || '—'),
        ruc: escapeHtml(c.ruc || '—'),
        link: `<a href="../clientes/editar.html?id=${encodeURIComponent(c.id)}" class="btn btn-ghost btn-sm">Abrir</a>`,
      })),
    };
  }

  async function checkPocSinSerial() {
    const all = await PocService.getPocDevices();
    const bad = (all || []).filter(d => d.deleted !== true && !d.serial);
    return {
      severity: 'error',
      count: bad.length,
      columns: [
        { key: 'radio_name', label: 'Nombre' },
        { key: 'unit_id', label: 'Unit ID' },
        { key: 'sim', label: 'SIM' },
        { key: 'link', label: '', align: 'right' },
      ],
      items: bad.slice(0, 50).map(d => ({
        radio_name: escapeHtml(d.radio_name || '—'),
        unit_id: escapeHtml(d.unit_id || '—'),
        sim: escapeHtml(d.sim || '—'),
        link: `<a href="../POC/index.html?focus=${encodeURIComponent(d.id)}" class="btn btn-ghost btn-sm">Abrir</a>`,
      })),
    };
  }

  async function checkOrdenesEntregadasSinFirma() {
    const all = await OrdenesService.listAll();
    const bad = all.filter(o => {
      const est = (o.estado_reparacion || '').toUpperCase();
      return o.eliminado !== true && est === 'ENTREGADA' && !o.firma_url && !o.firma_storage_path;
    });
    return {
      severity: 'warning',
      count: bad.length,
      columns: [
        { key: 'numero', label: 'N° Orden' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'fecha', label: 'Entregada' },
        { key: 'link', label: '', align: 'right' },
      ],
      items: bad.slice(0, 50).map(o => ({
        numero: o.numero_orden || `<code>${o.ordenId}</code>`,
        cliente: escapeHtml(o.cliente_nombre || o.clienteNombre || '—'),
        fecha: o.fecha_entrega ? new Date(o.fecha_entrega.toMillis ? o.fecha_entrega.toMillis() : o.fecha_entrega).toLocaleDateString('es-PA') : '—',
        link: `<a href="../ordenes/editar-orden.html?id=${encodeURIComponent(o.ordenId)}" class="btn btn-ghost btn-sm">Abrir</a>`,
      })),
    };
  }

  async function checkContratosVencidos() {
    const res = await ContratosService.listContratos({ limit: 1000 });
    const items = res?.docs || [];
    const now = new Date();
    const vencidos = items.filter(c => {
      if (c.estado !== 'activo') return false;
      const fv = c.fecha_vencimiento;
      if (!fv) return false;
      const d = fv.toMillis ? new Date(fv.toMillis()) : new Date(fv);
      return d < now;
    });
    return {
      severity: 'info',
      count: vencidos.length,
      columns: [
        { key: 'contrato_id', label: 'Contrato' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'diasVencido', label: 'Días vencido', align: 'right' },
        { key: 'link', label: '', align: 'right' },
      ],
      items: vencidos.slice(0, 50).map(c => {
        const fv = c.fecha_vencimiento.toMillis ? new Date(c.fecha_vencimiento.toMillis()) : new Date(c.fecha_vencimiento);
        return {
          contrato_id: escapeHtml(c.contrato_id || c.id),
          cliente: escapeHtml(c.cliente_nombre || c.clienteNombre || '—'),
          diasVencido: Math.floor((now - fv) / 86400000),
          link: `<a href="../contratos/editar-contrato.html?id=${encodeURIComponent(c.id)}" class="btn btn-ghost btn-sm">Abrir</a>`,
        };
      }),
    };
  }

  async function checkCotizacionesAprobadasSinVincular() {
    const res = await CotizacionesService.listCotizaciones({ limit: 500 });
    const items = (res?.docs || []).filter(c => c.deleted !== true);
    const bad = items.filter(c => {
      if ((c.estado || '').toLowerCase() !== 'aprobada') return false;
      const age = ageDays(c.fecha_aprobacion || c.fecha_actualizacion || c.fecha);
      if (age == null) return false;
      if (age < 30) return false;
      return !c.contrato_id && !c.ordenes_vinculadas?.length;
    });
    return {
      severity: 'info',
      count: bad.length,
      columns: [
        { key: 'numero', label: 'Cotización' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'edad', label: 'Antigüedad', align: 'right' },
        { key: 'link', label: '', align: 'right' },
      ],
      items: bad.slice(0, 50).map(c => ({
        numero: escapeHtml(c.numero || c.id),
        cliente: escapeHtml(c.cliente_nombre || c.clienteNombre || '—'),
        edad: `${ageDays(c.fecha_aprobacion || c.fecha)} d`,
        link: `<a href="../cotizaciones/editar-cotizacion.html?id=${encodeURIComponent(c.id)}" class="btn btn-ghost btn-sm">Abrir</a>`,
      })),
    };
  }

  // ─────────── Render ───────────

  function renderCheck(id, title, description, result) {
    const el = $(id);
    if (!el) return;
    const meta = SEV_META[result.severity] || SEV_META.info;
    const summary = result.count === 0
      ? `<div class="alert-banner alert-success" style="margin:0;"><i data-lucide="check-circle"></i><div>Sin hallazgos.</div></div>`
      : `<div class="alert-banner alert-${result.severity === 'error' ? 'error' : result.severity === 'warning' ? 'warning' : 'info'}" style="margin:0;">
          <i data-lucide="${meta.icon}"></i>
          <div><span class="alert-title">${result.count} ${result.count === 1 ? 'caso' : 'casos'}.</span> Mostrando primeros ${Math.min(result.count, 50)}.</div>
        </div>`;
    let table = '';
    if (result.items?.length) {
      const headers = result.columns.map(c => `<th${c.align === 'right' ? ' class="num"' : ''}>${c.label}</th>`).join('');
      const rows = result.items.map(r => '<tr>' + result.columns.map(c => `<td${c.align === 'right' ? ' class="num"' : ''}>${r[c.key] == null ? '' : r[c.key]}</td>`).join('') + '</tr>').join('');
      table = `<table class="admin-table" style="margin-top:var(--sp-2);"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    el.innerHTML = `
      <div class="admin-section-head">
        <span class="title" style="font-size:14px;">${title}</span>
        <span class="hint">${description}</span>
      </div>
      ${summary}
      ${table}`;
    if (window.lucide) lucide.createIcons();
  }

  function renderSkeleton(id, title, description) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = `
      <div class="admin-section-head">
        <span class="title" style="font-size:14px;">${title}</span>
        <span class="hint">${description}</span>
      </div>
      <div class="empty-state-hint" style="padding:var(--sp-3);text-align:center;color:var(--fg-3);">Ejecutando…</div>`;
  }

  function renderError(id, title, description, err) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = `
      <div class="admin-section-head">
        <span class="title" style="font-size:14px;">${title}</span>
        <span class="hint">${description}</span>
      </div>
      <div class="alert-banner alert-error"><i data-lucide="alert-octagon"></i><div>Error: <code>${escapeHtml(err.message || err.code || String(err))}</code></div></div>`;
    if (window.lucide) lucide.createIcons();
  }

  // Run all checks. Each is wrapped in try/catch so one failure doesn't
  // hide the others.
  async function runAll() {
    setText('lastUpdate', 'Ejecutando checks…');

    const checks = [
      ['chk1', 'Órdenes con contrato_id huérfano',         'La orden referencia un contrato que no existe en la colección',           checkOrdenesSinContrato],
      ['chk2', 'Clientes sin email ni teléfono',           'Imposible contactarlos por canales digitales',                            checkClientesSinContacto],
      ['chk3', 'Equipos PoC sin serial',                   'Inventariados pero sin serial trazable',                                  checkPocSinSerial],
      ['chk4', 'Órdenes "entregadas" sin firma',           'Marcadas como entregadas pero no tienen firma_url ni firma_storage_path', checkOrdenesEntregadasSinFirma],
      ['chk5', 'Contratos activos vencidos',               'estado=activo pero fecha_vencimiento ya pasó',                            checkContratosVencidos],
      ['chk6', 'Cotizaciones aprobadas sin vincular >30d', 'Aprobadas pero no se convirtieron en orden/contrato',                     checkCotizacionesAprobadasSinVincular],
    ];

    // Render all skeletons upfront so the page shows progress.
    checks.forEach(([id, title, desc]) => renderSkeleton(id, title, desc));

    // Run sequentially to keep cost predictable.
    let totalIssues = 0;
    for (const [id, title, desc, fn] of checks) {
      try {
        const res = await fn();
        renderCheck(id, title, desc, res);
        totalIssues += res.count;
      } catch (err) {
        console.error(`[admin/integridad] ${id}:`, err);
        renderError(id, title, desc, err);
      }
    }
    setText('totalIssues', totalIssues > 0
      ? `${totalIssues} ${totalIssues === 1 ? 'hallazgo' : 'hallazgos'} totales`
      : 'Sin hallazgos');
    setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
  }

  async function rebuildContractCache() {
    const raw = ($('inputContratoId')?.value || '').trim();
    if (!raw) {
      Toast.show('Ingresa al menos un doc ID.', 'warn');
      return;
    }
    const ids = raw.split(/[\s,]+/).filter(Boolean);
    if (ids.length > 50) {
      Toast.show('Máximo 50 contratos por ejecución.', 'bad');
      return;
    }
    const out = $('rebuildResult');
    if (out) out.innerHTML = '<div class="empty-state-hint" style="padding:var(--sp-2);color:var(--fg-3);">Ejecutando…</div>';
    try {
      const fn = firebase.functions().httpsCallable('rebuildContractCache');
      const res = ids.length === 1
        ? await fn({ contratoId: ids[0] })
        : await fn({ contratoIds: ids });
      const data = res.data || {};
      const rows = (data.results || []).map(r => `
        <tr>
          <td><code style="font-size:11px;">${escapeHtml(r.contratoId)}</code></td>
          <td>${r.success
            ? '<span class="pill" style="background:#d1fae5;color:#065f46;border-color:#a7f3d0;">ok</span>'
            : `<span class="pill" style="background:#fee2e2;color:#991b1b;border-color:#fecaca;">error</span> <code style="font-size:11px;color:#991b1b;">${escapeHtml(r.error || '—')}</code>`}</td>
        </tr>`).join('');
      if (out) out.innerHTML = `
        <div class="alert-banner alert-${data.ok ? 'success' : 'warning'}" style="margin:0 0 var(--sp-2);">
          <i data-lucide="${data.ok ? 'check-circle' : 'alert-triangle'}"></i>
          <div><span class="alert-title">${data.recomputed}/${data.total} recomputados.</span></div>
        </div>
        <table class="admin-table"><thead><tr><th>Contrato</th><th>Resultado</th></tr></thead><tbody>${rows}</tbody></table>`;
      if (window.lucide) lucide.createIcons();
    } catch (err) {
      console.error('[admin/integridad] rebuild:', err);
      if (out) out.innerHTML = `
        <div class="alert-banner alert-error" style="margin:0;">
          <i data-lucide="alert-octagon"></i>
          <div><code>${escapeHtml(err.message || err.code || String(err))}</code></div>
        </div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  function wireToolbar() {
    $('btnRefresh')?.addEventListener('click', () => runAll());
    $('btnRebuild')?.addEventListener('click', () => rebuildContractCache());
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        if (window.Toast) Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      wireToolbar();
      runAll();
    });
  });
})();
