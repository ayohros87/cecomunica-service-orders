/**
 * admin-financiero.js — financial dashboard + monthly ITBMS export.
 *
 * Computes KPIs across cotizaciones (pipeline) and contratos activos
 * (facturado) for the selected month, with comparativa vs mes anterior.
 *
 * Export ITBMS XLSX (SheetJS) — 3 sheets:
 *   1. Resumen — totales por día
 *   2. Detalle — una fila por cotización/contrato con cliente, fecha,
 *      subtotal, ITBMS, total
 *   3. Por cliente — agrupado
 *
 * Uses CotizacionTotales (if loaded) for line-level math. Falls back to
 * doc-level subtotal/itbms/total if the items array isn't shaped right.
 */
(function () {
  'use strict';

  const state = {
    year:  new Date().getFullYear(),
    month: new Date().getMonth(), // 0-11
    cot:   [],  // cotizaciones del mes
    cotPrev: [],
    ctActivos: [],
    ctActivosPrev: [],
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
  function fmtMoney(n) {
    return Number(n || 0).toLocaleString('es-PA', { style: 'currency', currency: 'USD' });
  }

  function monthRange(year, month) {
    const from = new Date(year, month, 1, 0, 0, 0);
    const to   = new Date(year, month + 1, 1, 0, 0, 0);
    return { from, to };
  }

  function inRange(d, from, to) {
    if (!d) return false;
    const ms = d.toMillis ? d.toMillis() : (d instanceof Date ? d.getTime() : new Date(d).getTime());
    return ms >= from.getTime() && ms < to.getTime();
  }

  function totalsFor(doc) {
    // Cotización shape: tries domain helper first, falls back to flat fields.
    if (window.CotizacionTotales && Array.isArray(doc?.items)) {
      const t = CotizacionTotales.calcTotales(doc);
      return { subtotal: t.base, itbms: t.itbms, total: t.total };
    }
    const subtotal = Number(doc.subtotal || doc.subtotal_total || 0);
    const itbms    = Number(doc.itbms    || doc.itbms_total    || 0);
    const total    = Number(doc.total    || (subtotal + itbms));
    return { subtotal, itbms, total };
  }

  function pickFecha(doc) {
    // Prioriza fecha de cierre/conversión sobre fecha de creación.
    return doc.fecha_conversion || doc.fecha_aprobacion || doc.fecha || doc.fecha_creacion;
  }

  async function loadMonth(year, month) {
    const { from, to } = monthRange(year, month);
    const db = firebase.firestore();

    // Cotizaciones cerradas (estado=aprobada o convertida) con fecha en el mes.
    const cotSnap = await db.collection('cotizaciones')
      .orderBy('fecha_creacion', 'desc')
      .limit(1000)
      .get();
    const cot = [];
    cotSnap.forEach(d => {
      const c = d.data();
      if (c.deleted === true) return;
      const estado = (c.estado || '').toLowerCase();
      if (estado !== 'aprobada' && estado !== 'convertida') return;
      const fecha = pickFecha(c);
      const dt = fecha?.toMillis ? new Date(fecha.toMillis()) : (typeof fecha === 'string' ? new Date(fecha) : null);
      if (!dt || !inRange(dt, from, to)) return;
      const t = totalsFor(c);
      cot.push({ id: d.id, ...c, _date: dt, _totals: t });
    });

    // Contratos activos en el mes (aprobados en el rango).
    const ctRes = await ContratosService.listContratos({ limit: 1000 });
    const ctActivos = (ctRes?.docs || []).filter(c => {
      if (c.estado !== 'activo' && c.estado !== 'aprobado') return false;
      const fa = c.fecha_aprobacion;
      if (!fa) return false;
      const dt = fa.toMillis ? new Date(fa.toMillis()) : new Date(fa);
      return inRange(dt, from, to);
    }).map(c => ({ ...c, _totals: totalsFor(c) }));

    return { cot, ctActivos };
  }

  function sum(items, key = 'total') {
    return items.reduce((s, it) => s + Number(it._totals?.[key] || 0), 0);
  }

  function delta(curr, prev) {
    if (!prev) return { sign: curr ? 1 : 0, pct: null };
    const pct = ((curr - prev) / prev) * 100;
    return { sign: Math.sign(curr - prev), pct };
  }

  function renderDelta(curr, prev) {
    const d = delta(curr, prev);
    if (d.pct == null) return curr ? '<span class="ts" style="color:#15803d;">▲ nuevo</span>' : '<span class="ts">—</span>';
    const arrow = d.sign > 0 ? '▲' : d.sign < 0 ? '▼' : '·';
    const color = d.sign > 0 ? '#15803d' : d.sign < 0 ? '#b91c1c' : 'var(--fg-3)';
    return `<span class="ts" style="color:${color};">${arrow} ${Math.abs(d.pct).toFixed(1)}% vs mes anterior</span>`;
  }

  async function loadAll() {
    setText('lastUpdate', 'Cargando…');
    const sel = $('selMonth');
    if (sel) {
      const [y, m] = sel.value.split('-').map(Number);
      state.year = y; state.month = m - 1;
    }
    // Previous month
    let prevY = state.year, prevM = state.month - 1;
    if (prevM < 0) { prevM = 11; prevY--; }

    try {
      const [curr, prev] = await Promise.all([
        loadMonth(state.year, state.month),
        loadMonth(prevY,      prevM),
      ]);
      state.cot          = curr.cot;
      state.ctActivos    = curr.ctActivos;
      state.cotPrev      = prev.cot;
      state.ctActivosPrev = prev.ctActivos;

      // Pipeline = cotizaciones enviadas + aprobadas (no convertidas) globalmente.
      const pipeRes = await CotizacionesService.listCotizaciones({ limit: 500 });
      const pipe = (pipeRes?.docs || []).filter(c => c.deleted !== true && ['enviada', 'aprobada'].includes((c.estado || '').toLowerCase()));
      const pipeTotal = pipe.reduce((s, c) => s + totalsFor(c).total, 0);

      // KPIs
      const facturadoMes = sum(state.cot) + sum(state.ctActivos);
      const itbmsMes     = sum(state.cot, 'itbms') + sum(state.ctActivos, 'itbms');
      const tickets      = state.cot.length + state.ctActivos.length;
      const ticketAvg    = tickets ? facturadoMes / tickets : 0;

      const facturadoPrev = sum(state.cotPrev) + sum(state.ctActivosPrev);
      const itbmsPrev     = sum(state.cotPrev, 'itbms') + sum(state.ctActivosPrev, 'itbms');

      // Conversion rate: cotizaciones convertidas / cotizaciones enviadas en el mes.
      const enviadasMes = state.cot.length;
      const convertidasMes = state.cot.filter(c => (c.estado || '').toLowerCase() === 'convertida').length;
      const convRate = enviadasMes ? (convertidasMes / enviadasMes) * 100 : 0;

      setText('kpiFacturadoValue', fmtMoney(facturadoMes));
      $('kpiFacturadoSub').innerHTML = renderDelta(facturadoMes, facturadoPrev);

      setText('kpiITBMSValue', fmtMoney(itbmsMes));
      $('kpiITBMSSub').innerHTML = renderDelta(itbmsMes, itbmsPrev);

      setText('kpiPipelineValue', fmtMoney(pipeTotal));
      $('kpiPipelineSub').textContent = `${pipe.length} cotizaciones abiertas`;

      setText('kpiTicketValue', fmtMoney(ticketAvg));
      $('kpiTicketSub').textContent = `${tickets} transacciones`;

      // Tabla resumen por día
      renderDailyTable();
      // Top clientes
      renderTopClientes();

      setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
    } catch (err) {
      console.error('[admin/financiero]', err);
      if (window.Toast) Toast.show('Error: ' + (err.message || err.code), 'bad');
    }
  }

  function renderDailyTable() {
    const all = [...state.cot, ...state.ctActivos.map(c => ({ ...c, _date: c.fecha_aprobacion?.toDate?.() || new Date(c.fecha_aprobacion) }))];
    const byDay = Object.create(null);
    for (const it of all) {
      const d = it._date?.toLocaleDateString?.('es-PA') || '—';
      if (!byDay[d]) byDay[d] = { subtotal: 0, itbms: 0, total: 0, n: 0 };
      byDay[d].subtotal += it._totals.subtotal;
      byDay[d].itbms    += it._totals.itbms;
      byDay[d].total    += it._totals.total;
      byDay[d].n++;
    }
    const rows = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => `<tr>
        <td>${d}</td>
        <td class="num">${v.n}</td>
        <td class="num">${fmtMoney(v.subtotal)}</td>
        <td class="num">${fmtMoney(v.itbms)}</td>
        <td class="num"><strong>${fmtMoney(v.total)}</strong></td>
      </tr>`).join('');
    const el = $('tblDaily');
    if (el) {
      el.innerHTML = rows
        ? `<table class="admin-table"><thead><tr><th>Día</th><th class="num">N</th><th class="num">Subtotal</th><th class="num">ITBMS</th><th class="num">Total</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty-state-hint" style="padding:var(--sp-3);text-align:center;color:var(--fg-3);">Sin actividad en el mes.</div>`;
    }
  }

  function renderTopClientes() {
    const all = [...state.cot, ...state.ctActivos];
    const byClient = Object.create(null);
    for (const it of all) {
      const nombre = it.cliente_nombre || it.clienteNombre || '(sin cliente)';
      if (!byClient[nombre]) byClient[nombre] = 0;
      byClient[nombre] += it._totals.total;
    }
    const rows = Object.entries(byClient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n, t]) => `<tr><td>${n}</td><td class="num"><strong>${fmtMoney(t)}</strong></td></tr>`).join('');
    const el = $('tblTopClientes');
    if (el) {
      el.innerHTML = rows
        ? `<table class="admin-table"><thead><tr><th>Cliente</th><th class="num">Facturado</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty-state-hint" style="padding:var(--sp-3);text-align:center;color:var(--fg-3);">Sin facturación en el mes.</div>`;
    }
  }

  function exportItbmsXLSX() {
    if (typeof XLSX === 'undefined') {
      if (window.Toast) Toast.show('SheetJS no cargado.', 'bad');
      return;
    }
    const all = [...state.cot, ...state.ctActivos];
    if (!all.length) {
      if (window.Toast) Toast.show('Sin datos para exportar.', 'warn');
      return;
    }

    // Hoja 1: Resumen por día
    const byDay = Object.create(null);
    for (const it of all) {
      const d = it._date?.toLocaleDateString?.('es-PA') || '—';
      if (!byDay[d]) byDay[d] = { subtotal: 0, itbms: 0, total: 0, n: 0 };
      byDay[d].subtotal += it._totals.subtotal;
      byDay[d].itbms    += it._totals.itbms;
      byDay[d].total    += it._totals.total;
      byDay[d].n++;
    }
    const resumen = [['Día', 'N', 'Subtotal', 'ITBMS', 'Total']]
      .concat(Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => [d, v.n, v.subtotal, v.itbms, v.total]));

    // Hoja 2: Detalle
    const detalle = [['Tipo', 'ID', 'Fecha', 'Cliente', 'Estado', 'Subtotal', 'ITBMS', 'Total']];
    for (const it of state.cot) {
      detalle.push([
        'Cotización',
        it.numero || it.id,
        it._date?.toLocaleDateString?.('es-PA') || '—',
        it.cliente_nombre || it.clienteNombre || '—',
        it.estado || '—',
        it._totals.subtotal, it._totals.itbms, it._totals.total,
      ]);
    }
    for (const it of state.ctActivos) {
      const dt = it.fecha_aprobacion?.toDate?.() || new Date(it.fecha_aprobacion);
      detalle.push([
        'Contrato',
        it.contrato_id || it.id,
        dt.toLocaleDateString('es-PA'),
        it.cliente_nombre || it.clienteNombre || '—',
        it.estado || '—',
        it._totals.subtotal, it._totals.itbms, it._totals.total,
      ]);
    }

    // Hoja 3: Por cliente
    const byClient = Object.create(null);
    for (const it of all) {
      const nombre = it.cliente_nombre || it.clienteNombre || '(sin cliente)';
      if (!byClient[nombre]) byClient[nombre] = { subtotal: 0, itbms: 0, total: 0, n: 0 };
      byClient[nombre].subtotal += it._totals.subtotal;
      byClient[nombre].itbms    += it._totals.itbms;
      byClient[nombre].total    += it._totals.total;
      byClient[nombre].n++;
    }
    const porCliente = [['Cliente', 'N', 'Subtotal', 'ITBMS', 'Total']]
      .concat(Object.entries(byClient).sort((a, b) => b[1].total - a[1].total).map(([n, v]) => [n, v.n, v.subtotal, v.itbms, v.total]));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen),    'Resumen');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle),    'Detalle');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(porCliente), 'Por cliente');

    const yyyy = state.year;
    const mm = String(state.month + 1).padStart(2, '0');
    XLSX.writeFile(wb, `cecomunica_itbms_${yyyy}-${mm}.xlsx`);
  }

  function populateMonthSelect() {
    const sel = $('selMonth');
    if (!sel) return;
    const now = new Date();
    const opts = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('es-PA', { year: 'numeric', month: 'long' });
      opts.push(`<option value="${v}">${label}</option>`);
    }
    sel.innerHTML = opts.join('');
  }

  function wireToolbar() {
    populateMonthSelect();
    $('selMonth')?.addEventListener('change', () => loadAll());
    $('btnRefresh')?.addEventListener('click', () => loadAll());
    $('btnExport')?.addEventListener('click', () => exportItbmsXLSX());
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
