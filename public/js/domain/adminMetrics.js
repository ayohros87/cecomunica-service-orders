/**
 * adminMetrics.js — pure helpers for the admin panel KPIs.
 * No DOM, no Firestore. Safe to unit-test in isolation.
 */
(function () {
  'use strict';

  function groupByStatus(items, getStatusFn) {
    const out = Object.create(null);
    for (const it of items || []) {
      const k = getStatusFn(it) || '__sin_estado__';
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  function countWhere(items, predicate) {
    let n = 0;
    for (const it of items || []) { if (predicate(it)) n++; }
    return n;
  }

  // Normalize a Firestore Timestamp / Date / ISO string / millis to a Date.
  function toDate(v) {
    if (!v) return null;
    if (v.toDate && typeof v.toDate === 'function') return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d; }
    return null;
  }

  function daysBetween(a, b) {
    const ad = toDate(a); const bd = toDate(b);
    if (!ad || !bd) return null;
    return Math.floor((bd - ad) / 86400000);
  }

  function ageInDays(value, now = new Date()) {
    return daysBetween(value, now);
  }

  // Returns N days until expiry (negative = expired). Null if input is bad.
  function daysUntilExpiry(fecha, validezDias, now = new Date()) {
    const f = toDate(fecha);
    if (!f || typeof validezDias !== 'number') return null;
    const expiry = new Date(f.getTime() + validezDias * 86400000);
    return Math.ceil((expiry - now) / 86400000);
  }

  // Buckets items by age band. Returns { lt: { '7': n, '30': n, '90': n }, gt90: n }.
  function bucketByAge(items, getDateFn, bands = [7, 30, 90], now = new Date()) {
    const sorted = [...bands].sort((a, b) => a - b);
    const out = { lt: Object.create(null), gtMax: 0 };
    for (const b of sorted) out.lt[String(b)] = 0;
    for (const it of items || []) {
      const age = ageInDays(getDateFn(it), now);
      if (age == null) continue;
      let placed = false;
      for (const b of sorted) {
        if (age <= b) { out.lt[String(b)]++; placed = true; break; }
      }
      if (!placed) out.gtMax++;
    }
    return out;
  }

  // Catálogo de tipos de alerta: cada uno define qué métrica leer y cómo
  // comparar contra el threshold. Para añadir uno nuevo, registrarlo aquí
  // y exponerlo en el editor de admin/alertas.html.
  //
  // Cada alerta en empresa/config.alertas[] tiene la forma:
  //   { id, kind, threshold, severity: 'info'|'warning'|'error', message?, enabled }
  //
  // metrics es un objeto plano con keys: ordenes_abiertas, contratos_pendientes,
  // cotizaciones_vencen, poc_activos. Lo arma admin-index.js tras loadAll().
  const ALERT_KINDS = {
    ordenes_abiertas_gt:    { metric: 'ordenes_abiertas',    op: '>', label: 'Órdenes abiertas mayor que…' },
    ordenes_abiertas_lt:    { metric: 'ordenes_abiertas',    op: '<', label: 'Órdenes abiertas menor que…' },
    contratos_pendientes_gt: { metric: 'contratos_pendientes', op: '>', label: 'Contratos pendientes mayor que…' },
    cotizaciones_vencen_gt: { metric: 'cotizaciones_vencen', op: '>', label: 'Cotizaciones por vencer mayor que…' },
    poc_activos_lt:         { metric: 'poc_activos',         op: '<', label: 'PoC activos menor que… (shrinkage)' },
  };

  function evaluateAlertas(alertas, metrics) {
    const triggered = [];
    for (const a of (alertas || [])) {
      if (a.enabled === false) continue;
      const meta = ALERT_KINDS[a.kind];
      if (!meta) continue;
      const value = Number(metrics?.[meta.metric] ?? 0);
      const threshold = Number(a.threshold ?? 0);
      const hit = meta.op === '>' ? value > threshold : value < threshold;
      if (!hit) continue;
      triggered.push({
        ...a,
        severity: a.severity || 'warning',
        currentValue: value,
        threshold,
        message: a.message ||
          `${meta.label} ${threshold} (actual: ${value})`,
      });
    }
    return triggered;
  }

  // True if `date` falls within the [since, now] window.
  function isWithinWindow(date, sinceMs, now = Date.now()) {
    const d = toDate(date);
    if (!d) return false;
    const t = d.getTime();
    return t >= sinceMs && t <= now;
  }

  // Hours since `date`. null if invalid.
  function ageInHours(date, now = new Date()) {
    const d = toDate(date);
    if (!d) return null;
    return Math.floor((now.getTime() - d.getTime()) / 3600000);
  }

  window.AdminMetrics = {
    groupByStatus,
    countWhere,
    toDate,
    daysBetween,
    ageInDays,
    ageInHours,
    daysUntilExpiry,
    bucketByAge,
    isWithinWindow,
    ALERT_KINDS,
    evaluateAlertas,
  };
})();
