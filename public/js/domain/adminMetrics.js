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

  // ── Estados de ordenes_de_servicio (auditoría UX 2026-09-28) ────────────
  // Fuente única para el panel: la portada, las alertas, Operación e
  // Integridad tenían cada uno su Set con estados que no existen ('EN PROCESO',
  // 'COMPLETADA', 'ENTREGADA'…) y los KPI contaban solo POR ASIGNAR. Los
  // abiertos son los mismos que PendientesDomain.ESTADOS_ABIERTOS
  // (domain/pendientes.js); se copian aquí para que el dominio siga siendo
  // puro y testeable sin cargar el otro archivo.
  const ESTADOS_ABIERTOS = Object.freeze(['POR ASIGNAR', 'RECIBIDO EN MOSTRADOR', 'ASIGNADO']);
  const ESTADO_COMPLETADO = 'COMPLETADO (EN OFICINA)';
  const ESTADO_ENTREGADO = 'ENTREGADO AL CLIENTE';
  const ESTADOS_CERRADOS = Object.freeze([
    ESTADO_ENTREGADO,
    'CERRADA (VISITA)', 'CERRADA (DEVOLUCION)', 'CERRADA (ENTRADA)', 'CERRADA (SIN RETIRAR)',
    'ANULADA',
  ]);
  const SET_ABIERTOS = new Set(ESTADOS_ABIERTOS);
  const SET_CERRADOS = new Set(ESTADOS_CERRADOS);

  function estadoDe(o) { return String((o && o.estado_reparacion) || '').trim().toUpperCase(); }
  function esAbierta(o) { return SET_ABIERTOS.has(estadoDe(o)); }
  function esCompletadaSinEntregar(o) { return estadoDe(o) === ESTADO_COMPLETADO; }
  function esEntregada(o) { return estadoDe(o) === ESTADO_ENTREGADO; }
  function esCerrada(o) { return SET_CERRADOS.has(estadoDe(o)); }
  // Ya no es trabajo del taller: completada en oficina o cerrada.
  function esFueraDeTaller(o) { return esCompletadaSinEntregar(o) || esCerrada(o); }
  function esDevolucion(o) { return String((o && o.tipo_de_servicio) || '').toUpperCase() === 'DEVOLUCION'; }

  // KPI "Órdenes abiertas" de la portada y de "Probar" en alertas: mismo
  // criterio en los dos (sin eliminadas y sin DEVOLUCION, que es un circuito
  // aparte que nunca se asigna).
  function contarOrdenesAbiertas(ordenes) {
    return countWhere(ordenes, o => o && o.eliminado !== true && esAbierta(o) && !esDevolucion(o));
  }

  // Cotizaciones enviadas/aprobadas: "por vencer" = vencen en 0..7 días; las
  // ya vencidas van aparte. La portada y "Probar" usan esta misma cuenta
  // (antes "Probar" metía las vencidas dentro de "por vencer").
  function contarCotizacionesPorVencer(items, now = new Date(), dias = 7) {
    let porVencer = 0; let vencidas = 0; let enviadas = 0;
    for (const c of items || []) {
      if (!c || c.deleted === true) continue;
      const e = String(c.estado || '').toLowerCase();
      if (e === 'enviada') enviadas++;
      if (e !== 'enviada' && e !== 'aprobada') continue;
      const d = daysUntilExpiry(c.fecha, c.validezDias || c.validez_dias || 15, now);
      if (d == null) continue;
      if (d < 0) vencidas++;
      else if (d <= dias) porVencer++;
    }
    return { porVencer, vencidas, enviadas };
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
  // `sujeto` arma el mensaje legible: "Hay 52 órdenes abiertas; el umbral
  // es 50" (auditoría UX 2026-09-28: antes decía "Órdenes abiertas mayor
  // que… 50 (actual: 52)").
  const ALERT_KINDS = {
    ordenes_abiertas_gt:    { metric: 'ordenes_abiertas',    op: '>', label: 'Órdenes abiertas mayor que…', sujeto: 'órdenes abiertas' },
    ordenes_abiertas_lt:    { metric: 'ordenes_abiertas',    op: '<', label: 'Órdenes abiertas menor que…', sujeto: 'órdenes abiertas' },
    contratos_pendientes_gt: { metric: 'contratos_pendientes', op: '>', label: 'Contratos pendientes mayor que…', sujeto: 'contratos pendientes de aprobación' },
    cotizaciones_vencen_gt: { metric: 'cotizaciones_vencen', op: '>', label: 'Cotizaciones por vencer mayor que…', sujeto: 'cotizaciones por vencer en 7 días' },
    poc_activos_lt:         { metric: 'poc_activos',         op: '<', label: 'PoC activos menor que… (merma)', sujeto: 'equipos PoC activos' },
  };

  function mensajeAlerta(meta, value, threshold) {
    const cual = meta.op === '>' ? 'el máximo es' : 'el mínimo es';
    return `Hay ${Number(value).toLocaleString('es-PA')} ${meta.sujeto}; ${cual} ${Number(threshold).toLocaleString('es-PA')}.`;
  }

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
        message: a.message || mensajeAlerta(meta, value, threshold),
      });
    }
    return triggered;
  }

  // ── Roles con nombre legible (auditoría UX 2026-09-28) ─────────────────
  // Antes vivía solo en admin-config.js y Usuarios mostraba las claves crudas
  // ("tecnico_operativo"). Una sola lista para todo el panel.
  const ROL_LABELS = Object.freeze({
    administrador: 'Administrador', gerente: 'Gerente', vendedor: 'Vendedor',
    recepcion: 'Recepción', tecnico: 'Técnico', tecnico_operativo: 'Técnico operativo',
    jefe_taller: 'Jefe de taller', inventario: 'Inventario', contabilidad: 'Contabilidad', vista: 'Vista',
  });
  // Qué ve cada rol, en una línea (para quien asigna el rol).
  // Qué ve cada rol, en una línea (para quien asigna el rol). Sale de los
  // módulos de js/core/modulos.js; si cambias allá, revisa aquí.
  const ROL_DESCRIPCIONES = Object.freeze({
    administrador: 'Todo el sistema, incluido este panel.',
    gerente: 'Órdenes, PoC, almacén, clientes, contratos y cotizaciones; aprueba.',
    vendedor: 'Órdenes, registro de ventas, clientes, contratos y cotizaciones.',
    recepcion: 'Órdenes, PoC, clientes, contratos y facturación pendiente.',
    tecnico: 'Órdenes del taller y PoC.',
    tecnico_operativo: 'Solo órdenes.',
    jefe_taller: 'Órdenes, PoC y cotizaciones de servicio.',
    inventario: 'Almacén, inventario, equipos y piezas.',
    contabilidad: 'Finanzas y facturación.',
    vista: 'Consulta de órdenes y PoC.',
  });
  function rolLabel(r) { return ROL_LABELS[r] || (r || '— sin rol —'); }

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
    mensajeAlerta,
    ESTADOS_ABIERTOS,
    ESTADOS_CERRADOS,
    ESTADO_COMPLETADO,
    ESTADO_ENTREGADO,
    esAbierta,
    esCompletadaSinEntregar,
    esEntregada,
    esCerrada,
    esFueraDeTaller,
    esDevolucion,
    contarOrdenesAbiertas,
    contarCotizacionesPorVencer,
    ROL_LABELS,
    ROL_DESCRIPCIONES,
    rolLabel,
  };
})();
