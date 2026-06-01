/**
 * admin-operacion.js — detailed operational view for the admin panel.
 *
 * Shows tables for:
 *  - Órdenes by estado_reparacion (with counts + percentages)
 *  - Top técnicos by órdenes asignadas
 *  - Contratos por estado
 *  - Cotizaciones por estado + las que vencen pronto
 *  - Inventario de piezas con stock bajo
 */
(function () {
  'use strict';

  const STALE_DAYS = 10;
  const COT_VENCE_DAYS = 7;

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  function renderTable(targetId, headers, rows) {
    const el = $(targetId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-3);text-align:center;color:var(--fg-3);font-size:13px;">Sin registros para mostrar.</div>`;
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

  // ────────── Órdenes ──────────

  async function loadOrdenesPorEstado() {
    const all = await OrdenesService.listAll();
    const live = all.filter(o => o.eliminado !== true);
    const groups = AdminMetrics.groupByStatus(live, o => (o.estado_reparacion || 'SIN ESTADO').toUpperCase());
    const total = live.length || 1;
    const rows = Object.entries(groups)
      .sort((a, b) => b[1] - a[1])
      .map(([estado, n]) => ({
        estado: `<span class="pill">${estado}</span>`,
        n,
        pct: `${((n / total) * 100).toFixed(1)}%`,
      }));
    renderTable('tblOrdenesPorEstado',
      [{ key: 'estado', label: 'Estado' }, { key: 'n', label: 'N', align: 'right' }, { key: 'pct', label: '%', align: 'right' }],
      rows);
    setText('totalOrdenes', `${live.length.toLocaleString('es-PA')} órdenes activas`);

    // Stale: open orders not updated in > STALE_DAYS días.
    const now = new Date();
    const stale = live.filter(o => {
      const est = (o.estado_reparacion || '').toUpperCase();
      if (est === 'ENTREGADA' || est === 'COMPLETADA') return false;
      const updated = o.updatedAt || o.fecha_actualizacion || o.fecha_modificacion || o.fecha_entrada || o.fecha_creacion;
      const age = AdminMetrics.ageInDays(updated, now);
      return age != null && age >= STALE_DAYS;
    });
    setText('countStale', stale.length.toString());
    return live;
  }

  async function loadOrdenesPorTecnico(live) {
    const byTec = Object.create(null);
    for (const o of live) {
      const est = (o.estado_reparacion || '').toUpperCase();
      if (est === 'ENTREGADA' || est === 'COMPLETADA') continue;
      const t = o.tecnico_asignado || 'Sin asignar';
      byTec[t] = (byTec[t] || 0) + 1;
    }
    const rows = Object.entries(byTec)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tec, n]) => ({ tecnico: tec, n }));
    renderTable('tblOrdenesPorTecnico',
      [{ key: 'tecnico', label: 'Técnico' }, { key: 'n', label: 'Abiertas', align: 'right' }],
      rows);
  }

  // ────────── Contratos ──────────

  async function loadContratos() {
    const res = await ContratosService.listContratos({ limit: 1000 });
    const items = res?.docs || [];
    const groups = AdminMetrics.groupByStatus(items, c => c.estado || 'sin_estado');
    const rows = Object.entries(groups)
      .sort((a, b) => b[1] - a[1])
      .map(([estado, n]) => ({ estado: `<span class="pill">${estado}</span>`, n }));
    renderTable('tblContratos',
      [{ key: 'estado', label: 'Estado' }, { key: 'n', label: 'N', align: 'right' }],
      rows);
    setText('totalContratos', `${items.length.toLocaleString('es-PA')} contratos`);
  }

  // ────────── Cotizaciones ──────────

  async function loadCotizaciones() {
    const res = await CotizacionesService.listCotizaciones({ limit: 500 });
    const items = (res?.docs || []).filter(c => c.deleted !== true);
    const groups = AdminMetrics.groupByStatus(items, c => (c.estado || 'sin_estado').toLowerCase());
    const rows = Object.entries(groups)
      .sort((a, b) => b[1] - a[1])
      .map(([estado, n]) => ({ estado: `<span class="pill">${estado}</span>`, n }));
    renderTable('tblCotizaciones',
      [{ key: 'estado', label: 'Estado' }, { key: 'n', label: 'N', align: 'right' }],
      rows);

    // Vencen pronto.
    const ahora = new Date();
    const venc = [];
    for (const c of items) {
      const e = (c.estado || '').toLowerCase();
      if (e !== 'enviada' && e !== 'aprobada') continue;
      const d = AdminMetrics.daysUntilExpiry(c.fecha, c.validezDias || 15, ahora);
      if (d == null) continue;
      if (d <= COT_VENCE_DAYS) venc.push({ ...c, dias: d });
    }
    venc.sort((a, b) => a.dias - b.dias);
    const vencRows = venc.slice(0, 20).map(c => ({
      id: c.id,
      cliente: c.cliente_nombre || c.clienteNombre || c.clienteId || '—',
      estado: `<span class="pill">${(c.estado || '').toLowerCase()}</span>`,
      dias: c.dias < 0
        ? `<span style="color:#b91c1c;font-weight:600">vencida (${Math.abs(c.dias)}d)</span>`
        : `${c.dias}d`,
    }));
    renderTable('tblCotizacionesVencen',
      [
        { key: 'id', label: 'ID' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'estado', label: 'Estado' },
        { key: 'dias', label: 'Vence en', align: 'right' },
      ],
      vencRows);
    setText('countVencen', String(venc.length));
  }

  // ────────── Inventario crítico ──────────

  async function loadInventarioCritico() {
    try {
      const all = await PiezasService.getPiezas();
      // Stock bajo: cantidad <= min_stock (si min_stock > 0). Si no hay min_stock,
      // umbral por defecto = 5.
      const DEFAULT_MIN = 5;
      const criticas = all.filter(p => {
        const cant = Number(p.cantidad || 0);
        const min = Number(p.min_stock || DEFAULT_MIN);
        return cant <= min;
      });
      criticas.sort((a, b) => (Number(a.cantidad || 0) - Number(b.cantidad || 0)));
      const rows = criticas.slice(0, 30).map(p => ({
        marca: p.marca || '—',
        nombre: p.nombre || p.descripcion || '—',
        cantidad: Number(p.cantidad || 0),
        min: Number(p.min_stock || DEFAULT_MIN),
      }));
      renderTable('tblPiezasCriticas',
        [
          { key: 'marca', label: 'Marca' },
          { key: 'nombre', label: 'Pieza' },
          { key: 'cantidad', label: 'Stock', align: 'right' },
          { key: 'min', label: 'Mínimo', align: 'right' },
        ],
        rows);
      setText('countPiezasCriticas', String(criticas.length));
    } catch (err) {
      console.warn('[admin/operacion] piezas:', err);
      setText('countPiezasCriticas', 'n/d');
    }
  }

  async function loadAll() {
    try {
      const live = await loadOrdenesPorEstado();
      await Promise.all([
        loadOrdenesPorTecnico(live),
        loadContratos(),
        loadCotizaciones(),
        loadInventarioCritico(),
      ]);
      setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
      if (window.lucide) lucide.createIcons();
    } catch (err) {
      console.error('[admin/operacion] loadAll:', err);
      if (window.Toast) Toast.show('Error cargando datos: ' + (err.message || err.code || err), 'bad');
    }
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
