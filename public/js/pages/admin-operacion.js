/**
 * admin-operacion.js — daily-standup view of operations.
 *
 * Three zones:
 *   1. "Lo que pasó" — event counts within the selected window (24 h / 7 d).
 *      Uses existing timestamps on each doc (fecha_entrada, fecha_aprobacion,
 *      enviada_en, etc.). No new queries.
 *   2. "Requiere atención" — prioritized action items derived from the same
 *      data. Three severities: alta / media / baja. Each item links to the
 *      target doc for the admin to act.
 *   3. "Referencia" — the old static tables, collapsed into <details>.
 *
 * Thresholds (configurable via empresa/config + the alertas page later):
 *   - sin_asignar_horas:        24
 *   - completada_sin_entregar_dias: 5
 *   - contrato_pendiente_dias:  7
 *   - orden_stale_dias:         empresa/config.orden_stale_dias (10 fallback)
 *   - piezas_stock_critico:     1 (< 2 unidades)
 */
(function () {
  'use strict';

  const HOURS_24 = 24 * 60 * 60 * 1000;
  const DAYS_7   = 7  * 24 * 60 * 60 * 1000;

  // Defaults — overridden at runtime by EMPRESA_CONFIG if loaded.
  const STALE_DAYS_DEFAULT              = 10;
  const STALE_MAX_DIAS_DEFAULT          = 30;   // > N días estancada = legacy noise, no alerta
  const SIN_ASIGNAR_HORAS_DEFAULT       = 24;
  const SIN_ASIGNAR_MAX_DIAS_DEFAULT    = 30;   // > N días = legacy noise, no alerta
  const COMPLETADA_SIN_ENTREGAR_DEFAULT = 5;
  const CONTRATO_PENDIENTE_DIAS_DEFAULT = 7;
  const PIEZAS_STOCK_CRITICO_DEFAULT    = 1;

  const COT_VENCE_DAYS = 7;

  function staleDays()         { return Number(window.EMPRESA_CONFIG?.orden_stale_dias)             || STALE_DAYS_DEFAULT; }
  function staleMaxDias()      { return Number(window.EMPRESA_CONFIG?.orden_stale_max_dias)         || STALE_MAX_DIAS_DEFAULT; }
  function sinAsignarHoras()   { return Number(window.EMPRESA_CONFIG?.orden_sin_asignar_horas)     || SIN_ASIGNAR_HORAS_DEFAULT; }
  function sinAsignarMaxDias() { return Number(window.EMPRESA_CONFIG?.orden_sin_asignar_max_dias)  || SIN_ASIGNAR_MAX_DIAS_DEFAULT; }
  function completadaSinEntregarDias() { return Number(window.EMPRESA_CONFIG?.completada_sin_entregar_dias) || COMPLETADA_SIN_ENTREGAR_DEFAULT; }
  function contratoPendienteDias() { return Number(window.EMPRESA_CONFIG?.contrato_pendiente_dias) || CONTRATO_PENDIENTE_DIAS_DEFAULT; }
  function piezasStockCritico() { return Number(window.EMPRESA_CONFIG?.piezas_stock_critico_threshold) || PIEZAS_STOCK_CRITICO_DEFAULT; }

  const state = {
    windowMs: HOURS_24,
    windowLabel: '24 h',
    data: null,  // { ordenes, contratos, cotizaciones, clientes, poc, piezas }
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
  function escapeHtml(s) { return FMT.esc(s); } // helper canónico (core/formatting.js)

  // ────────── Data loaders ──────────

  async function loadAllData() {
    const [ordenes, ctRes, cotRes, clientesAll, pocAll, piezasAll] = await Promise.all([
      OrdenesService.listAll().catch(e => { console.warn('[op] ordenes', e); return []; }),
      ContratosService.listContratos({ limit: 1000 }).catch(e => { console.warn('[op] contratos', e); return null; }),
      CotizacionesService.listCotizaciones({ limit: 500 }).catch(e => { console.warn('[op] cotizaciones', e); return null; }),
      ClientesService.listClientes({ limit: 1000 }).catch(e => { console.warn('[op] clientes', e); return null; }),
      PocService.getPocDevices().catch(e => { console.warn('[op] poc', e); return []; }),
      PiezasService.getPiezas().catch(e => { console.warn('[op] piezas', e); return []; }),
    ]);
    return {
      ordenes:     (ordenes || []).filter(o => o.eliminado !== true),
      contratos:   (ctRes?.docs || []).filter(c => c.deleted !== true),
      cotizaciones: (cotRes?.docs || []).filter(c => c.deleted !== true),
      clientes:    clientesAll?.docs || (Array.isArray(clientesAll) ? clientesAll : []),
      poc:         (pocAll || []).filter(d => d.deleted !== true),
      piezas:      piezasAll || [],
    };
  }

  // ────────── Zone 1: Lo que pasó ──────────

  function computeRecent(d, sinceMs) {
    const within = (date) => AdminMetrics.isWithinWindow(date, sinceMs);

    const ordenes_recibidas  = AdminMetrics.countWhere(d.ordenes, o => within(o.fecha_entrada));
    const ordenes_asignadas  = AdminMetrics.countWhere(d.ordenes, o => within(o.fecha_asignacion));
    const ordenes_completadas = AdminMetrics.countWhere(d.ordenes, o => within(o.fecha_completada));
    const ordenes_entregadas = AdminMetrics.countWhere(d.ordenes, o => within(o.fecha_entrega));

    const contratos_nuevos    = AdminMetrics.countWhere(d.contratos, c => within(c.fecha_creacion));
    const contratos_aprobados = AdminMetrics.countWhere(d.contratos, c => within(c.fecha_aprobacion));
    const contratos_anulados  = AdminMetrics.countWhere(d.contratos, c => within(c.fecha_anulacion));

    const cot_enviadas    = AdminMetrics.countWhere(d.cotizaciones, c => within(c.enviada_en));
    const cot_aprobadas   = AdminMetrics.countWhere(d.cotizaciones, c => within(c.fecha_aprobacion));
    const cot_convertidas = AdminMetrics.countWhere(d.cotizaciones, c => within(c.fecha_conversion));
    const cot_rechazadas  = AdminMetrics.countWhere(d.cotizaciones, c => within(c.fecha_rechazo));

    const clientes_nuevos = AdminMetrics.countWhere(d.clientes, c => within(c.fecha_creacion));
    const poc_nuevos      = AdminMetrics.countWhere(d.poc,      p => within(p.created_at));

    return {
      ordenes_recibidas, ordenes_asignadas, ordenes_completadas, ordenes_entregadas,
      contratos_nuevos, contratos_aprobados, contratos_anulados,
      cot_enviadas, cot_aprobadas, cot_convertidas, cot_rechazadas,
      clientes_nuevos, poc_nuevos,
    };
  }

  function renderRecent(r) {
    const el = $('zoneRecent');
    if (!el) return;
    const card = (icon, label, value, sub = '', linkHref = null) => {
      const inner = `
        <div class="recent-icon"><i data-lucide="${icon}"></i></div>
        <div class="recent-body">
          <div class="recent-label">${label}</div>
          <div class="recent-value">${value.toLocaleString('es-PA')}</div>
          ${sub ? `<div class="recent-sub">${sub}</div>` : ''}
        </div>`;
      return linkHref
        ? `<a href="${linkHref}" class="recent-card">${inner}</a>`
        : `<div class="recent-card">${inner}</div>`;
    };

    const contratoSub = `${r.contratos_aprobados} aprobado${r.contratos_aprobados !== 1 ? 's' : ''} · ${r.contratos_anulados} anulado${r.contratos_anulados !== 1 ? 's' : ''}`;
    const cotSub      = `${r.cot_enviadas} env · ${r.cot_aprobadas} apr · ${r.cot_convertidas} conv · ${r.cot_rechazadas} rech`;

    el.innerHTML = `
      <div class="recent-grid">
        ${card('inbox',       'Órdenes recibidas',     r.ordenes_recibidas, '', '../ordenes/index.html')}
        ${card('user-check',  'Órdenes asignadas',     r.ordenes_asignadas)}
        ${card('check-circle','Órdenes completadas',   r.ordenes_completadas)}
        ${card('truck',       'Órdenes entregadas',    r.ordenes_entregadas)}
        ${card('file-text',   'Contratos nuevos',      r.contratos_nuevos, contratoSub, '../contratos/index.html')}
        ${card('receipt',     'Cotizaciones',          r.cot_enviadas + r.cot_aprobadas + r.cot_convertidas + r.cot_rechazadas, cotSub, '../cotizaciones/index.html')}
        ${card('users',       'Clientes nuevos',       r.clientes_nuevos, '', '../clientes/index.html')}
        ${card('radio-tower', 'Equipos PoC añadidos',  r.poc_nuevos, '', '../POC/index.html')}
      </div>`;
    if (window.lucide) lucide.createIcons();
  }

  // ────────── Zone 2: Requiere atención ──────────

  function computeAtencion(d) {
    const now = new Date();
    const ESTADOS_TERMINAL = new Set(['ENTREGADA', 'COMPLETADA']);

    // ALTA — Órdenes sin asignar entre [N horas, M días]. Las > M días son
    // legacy noise (probablemente nunca se trabajaron, asignarlas hoy contamina
    // métricas) — quedan fuera del alert para no enmascarar las accionables
    // nuevas. Limpieza histórica es trabajo aparte (ver herramienta pendiente).
    const horas       = sinAsignarHoras();
    const maxHoras    = sinAsignarMaxDias() * 24;
    const sinAsignar = d.ordenes.filter(o => {
      const est = (o.estado_reparacion || '').toUpperCase();
      if (ESTADOS_TERMINAL.has(est)) return false;
      const tieneTec = !!(o.tecnico_asignado || o.tecnico_uid);
      if (tieneTec) return false;
      const age = AdminMetrics.ageInHours(o.fecha_entrada || o.fecha_creacion, now);
      return age != null && age >= horas && age <= maxHoras;
    }).sort((a, b) => (AdminMetrics.ageInHours(b.fecha_entrada || b.fecha_creacion, now) || 0) -
                      (AdminMetrics.ageInHours(a.fecha_entrada || a.fecha_creacion, now) || 0));

    // ALTA — Cotizaciones vencidas sin cerrar (estado=enviada o aprobada AND days < 0)
    const cotVencidas = d.cotizaciones.filter(c => {
      const e = (c.estado || '').toLowerCase();
      if (e !== 'enviada' && e !== 'aprobada') return false;
      const dleft = AdminMetrics.daysUntilExpiry(c.fecha, c.validezDias || c.validez_dias || 15, now);
      return dleft != null && dleft < 0;
    }).sort((a, b) => (AdminMetrics.daysUntilExpiry(a.fecha, a.validezDias || 15, now) || 0) -
                      (AdminMetrics.daysUntilExpiry(b.fecha, b.validezDias || 15, now) || 0));

    // MEDIA — Órdenes estancadas en rango [orden_stale_dias, orden_stale_max_dias].
    // > max_dias se considera legacy noise (orden olvidada hace meses, no
    // accionable) — se omite para no enmascarar las estancadas recientes.
    const stale     = staleDays();
    const staleMax  = staleMaxDias();
    const ordenesEstancadas = d.ordenes.filter(o => {
      const est = (o.estado_reparacion || '').toUpperCase();
      if (ESTADOS_TERMINAL.has(est)) return false;
      const updated = o.updatedAt || o.fecha_actualizacion || o.fecha_modificacion || o.fecha_entrada;
      const age = AdminMetrics.ageInDays(updated, now);
      return age != null && age >= stale && age <= staleMax;
    }).sort((a, b) => (AdminMetrics.ageInDays(b.fecha_actualizacion || b.fecha_entrada, now) || 0) -
                      (AdminMetrics.ageInDays(a.fecha_actualizacion || a.fecha_entrada, now) || 0));

    // MEDIA — Contratos pendientes de aprobación > N días
    const ctDias = contratoPendienteDias();
    const contratosLentos = d.contratos.filter(c => {
      if (c.estado !== 'pendiente_aprobacion') return false;
      const age = AdminMetrics.ageInDays(c.fecha_creacion, now);
      return age != null && age >= ctDias;
    }).sort((a, b) => (AdminMetrics.ageInDays(b.fecha_creacion, now) || 0) -
                      (AdminMetrics.ageInDays(a.fecha_creacion, now) || 0));

    // MEDIA — Órdenes COMPLETADAS sin entregar > N días
    const ctEntDias = completadaSinEntregarDias();
    const completadasSinEntregar = d.ordenes.filter(o => {
      const est = (o.estado_reparacion || '').toUpperCase();
      if (est !== 'COMPLETADA') return false;
      const ageC = AdminMetrics.ageInDays(o.fecha_completada || o.fecha_actualizacion, now);
      return ageC != null && ageC >= ctEntDias;
    }).sort((a, b) => (AdminMetrics.ageInDays(b.fecha_completada || b.fecha_actualizacion, now) || 0) -
                      (AdminMetrics.ageInDays(a.fecha_completada || a.fecha_actualizacion, now) || 0));

    // BAJA — Piezas con stock <= umbral
    const piezasUmbral = piezasStockCritico();
    const piezasCriticas = d.piezas.filter(p => Number(p.cantidad || 0) <= piezasUmbral)
      .sort((a, b) => Number(a.cantidad || 0) - Number(b.cantidad || 0));

    return { sinAsignar, cotVencidas, ordenesEstancadas, contratosLentos, completadasSinEntregar, piezasCriticas };
  }

  function attRow({ title, sub, link, badge }) {
    return `<li class="att-row">
      <div class="att-main">
        <div class="att-title">${title}</div>
        <div class="att-sub">${sub}</div>
      </div>
      ${badge ? `<span class="att-badge">${badge}</span>` : ''}
      ${link ? `<a href="${link}" class="att-cta">Abrir <i data-lucide="arrow-right"></i></a>` : ''}
    </li>`;
  }

  function attGroup(severity, items) {
    if (!items.length) return '';
    const meta = {
      alta:  { color: '#b91c1c', icon: 'alert-octagon',   label: 'ALTA',  bg: '#fee2e2', border: '#fecaca' },
      media: { color: '#b45309', icon: 'alert-triangle',  label: 'MEDIA', bg: '#fef3c7', border: '#fde68a' },
      baja:  { color: '#15803d', icon: 'info',            label: 'BAJA',  bg: '#d1fae5', border: '#a7f3d0' },
    }[severity];
    return `<div class="att-group">
      <div class="att-group-head" style="color:${meta.color};">
        <i data-lucide="${meta.icon}"></i>
        <span class="att-group-label">${meta.label}</span>
        <span class="att-group-count">(${items.length} item${items.length !== 1 ? 's' : ''})</span>
      </div>
      <ul class="att-list">${items.join('')}</ul>
    </div>`;
  }

  function renderAtencion(a) {
    const el = $('zoneAtencion');
    if (!el) return;

    const horas = sinAsignarHoras();
    const stale = staleDays();
    const ctDias = contratoPendienteDias();
    const ctEntDias = completadaSinEntregarDias();
    const umbralStock = piezasStockCritico();
    const now = new Date();

    const altaItems = [];

    // Sin asignar entre N horas y M días
    const maxDias = sinAsignarMaxDias();
    if (a.sinAsignar.length) {
      altaItems.push(`<li class="att-section-header">${a.sinAsignar.length} orden${a.sinAsignar.length !== 1 ? 'es' : ''} sin técnico (entre ${horas} h y ${maxDias} días — las más viejas son legacy y se omiten)</li>`);
      for (const o of a.sinAsignar.slice(0, 5)) {
        const age = AdminMetrics.ageInHours(o.fecha_entrada || o.fecha_creacion, now);
        altaItems.push(attRow({
          title: `${escapeHtml(o.numero_orden || o.ordenId)} <span class="att-cliente">— ${escapeHtml(o.cliente_nombre || o.clienteNombre || '—')}</span>`,
          sub:   `Recibida hace ${age} h`,
          link:  `../ordenes/editar-orden.html?id=${encodeURIComponent(o.ordenId)}`,
          badge: '<span style="color:#b91c1c;">sin técnico</span>',
        }));
      }
      if (a.sinAsignar.length > 5) altaItems.push(`<li class="att-more">y ${a.sinAsignar.length - 5} más…</li>`);
    }

    // Cotizaciones vencidas
    if (a.cotVencidas.length) {
      altaItems.push(`<li class="att-section-header">${a.cotVencidas.length} cotización${a.cotVencidas.length !== 1 ? 'es' : ''} vencida${a.cotVencidas.length !== 1 ? 's' : ''} sin cerrar</li>`);
      for (const c of a.cotVencidas.slice(0, 5)) {
        const dleft = AdminMetrics.daysUntilExpiry(c.fecha, c.validezDias || 15, now);
        altaItems.push(attRow({
          title: `${escapeHtml(c.cotizacion_id || c.id)} <span class="att-cliente">— ${escapeHtml(c.cliente_nombre || c.clienteNombre || '—')}</span>`,
          sub:   `Vencida hace ${Math.abs(dleft)} día${Math.abs(dleft) !== 1 ? 's' : ''} (estado: ${c.estado})`,
          link:  `../cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(c.id)}`,
          badge: '<span style="color:#b91c1c;">vencida</span>',
        }));
      }
      if (a.cotVencidas.length > 5) altaItems.push(`<li class="att-more">y ${a.cotVencidas.length - 5} más…</li>`);
    }

    const mediaItems = [];

    // Órdenes estancadas
    const staleMax = staleMaxDias();
    if (a.ordenesEstancadas.length) {
      mediaItems.push(`<li class="att-section-header">${a.ordenesEstancadas.length} orden${a.ordenesEstancadas.length !== 1 ? 'es' : ''} estancada${a.ordenesEstancadas.length !== 1 ? 's' : ''} (sin movimiento entre ${stale} y ${staleMax} días — las más viejas son legacy y se omiten)</li>`);
      for (const o of a.ordenesEstancadas.slice(0, 5)) {
        const age = AdminMetrics.ageInDays(o.fecha_actualizacion || o.fecha_entrada, now);
        mediaItems.push(attRow({
          title: `${escapeHtml(o.numero_orden || o.ordenId)} <span class="att-cliente">— ${escapeHtml(o.cliente_nombre || o.clienteNombre || '—')}</span>`,
          sub:   `Estado: ${escapeHtml(o.estado_reparacion || '—')} · sin movimiento ${age}d`,
          link:  `../ordenes/editar-orden.html?id=${encodeURIComponent(o.ordenId)}`,
        }));
      }
      if (a.ordenesEstancadas.length > 5) mediaItems.push(`<li class="att-more">y ${a.ordenesEstancadas.length - 5} más…</li>`);
    }

    // Contratos pendientes lentos
    if (a.contratosLentos.length) {
      mediaItems.push(`<li class="att-section-header">${a.contratosLentos.length} contrato${a.contratosLentos.length !== 1 ? 's' : ''} pendiente${a.contratosLentos.length !== 1 ? 's' : ''} &gt; ${ctDias} días</li>`);
      for (const c of a.contratosLentos.slice(0, 5)) {
        const age = AdminMetrics.ageInDays(c.fecha_creacion, now);
        mediaItems.push(attRow({
          title: `${escapeHtml(c.contrato_id || c.id)} <span class="att-cliente">— ${escapeHtml(c.cliente_nombre || c.clienteNombre || '—')}</span>`,
          sub:   `Creado hace ${age} días, sin aprobar`,
          link:  `../contratos/editar-contrato.html?id=${encodeURIComponent(c.id)}`,
        }));
      }
      if (a.contratosLentos.length > 5) mediaItems.push(`<li class="att-more">y ${a.contratosLentos.length - 5} más…</li>`);
    }

    // Completadas sin entregar
    if (a.completadasSinEntregar.length) {
      mediaItems.push(`<li class="att-section-header">${a.completadasSinEntregar.length} orden${a.completadasSinEntregar.length !== 1 ? 'es' : ''} completada${a.completadasSinEntregar.length !== 1 ? 's' : ''} sin entregar &gt; ${ctEntDias} días</li>`);
      for (const o of a.completadasSinEntregar.slice(0, 5)) {
        const age = AdminMetrics.ageInDays(o.fecha_completada || o.fecha_actualizacion, now);
        mediaItems.push(attRow({
          title: `${escapeHtml(o.numero_orden || o.ordenId)} <span class="att-cliente">— ${escapeHtml(o.cliente_nombre || o.clienteNombre || '—')}</span>`,
          sub:   `Completada hace ${age} días`,
          link:  `../ordenes/editar-orden.html?id=${encodeURIComponent(o.ordenId)}`,
        }));
      }
      if (a.completadasSinEntregar.length > 5) mediaItems.push(`<li class="att-more">y ${a.completadasSinEntregar.length - 5} más…</li>`);
    }

    const bajaItems = [];
    if (a.piezasCriticas.length) {
      bajaItems.push(`<li class="att-section-header">${a.piezasCriticas.length} pieza${a.piezasCriticas.length !== 1 ? 's' : ''} con stock ≤ ${umbralStock} (rotura inminente)</li>`);
      for (const p of a.piezasCriticas.slice(0, 5)) {
        bajaItems.push(attRow({
          title: `${escapeHtml(p.nombre || p.descripcion || '—')} <span class="att-cliente">— ${escapeHtml(p.marca || '')}</span>`,
          sub:   `Stock actual: ${Number(p.cantidad || 0)}`,
          link:  `../inventario/piezas.html`,
        }));
      }
      if (a.piezasCriticas.length > 5) bajaItems.push(`<li class="att-more">y ${a.piezasCriticas.length - 5} más…</li>`);
    }

    const total = a.sinAsignar.length + a.cotVencidas.length + a.ordenesEstancadas.length + a.contratosLentos.length + a.completadasSinEntregar.length + a.piezasCriticas.length;

    if (!total) {
      el.innerHTML = `<div class="alert-banner alert-success" style="margin:0;"><i data-lucide="check-circle"></i><div><span class="alert-title">Todo en orden.</span> Ningún ítem requiere atención bajo los umbrales actuales.</div></div>`;
      setText('countAttention', '0 items');
      if (window.lucide) lucide.createIcons();
      return;
    }

    el.innerHTML =
      attGroup('alta',  altaItems) +
      attGroup('media', mediaItems) +
      attGroup('baja',  bajaItems);
    setText('countAttention', `${total} item${total !== 1 ? 's' : ''}`);
    if (window.lucide) lucide.createIcons();
  }

  // ────────── Zone 3: Referencia (legacy tables) ──────────

  function renderTable(targetId, headers, rows) {
    const el = $(targetId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-3);text-align:center;color:var(--fg-3);font-size:13px;">Sin registros.</div>`;
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

  function renderReferencia(d) {
    // Órdenes por estado
    const groupsOrd = AdminMetrics.groupByStatus(d.ordenes, o => (o.estado_reparacion || 'SIN ESTADO').toUpperCase());
    const totalOrd = d.ordenes.length || 1;
    const rowsOrd = Object.entries(groupsOrd)
      .sort((a, b) => b[1] - a[1])
      .map(([e, n]) => ({ estado: `<span class="pill">${e}</span>`, n, pct: `${((n / totalOrd) * 100).toFixed(1)}%` }));
    renderTable('tblOrdenesPorEstado',
      [{ key: 'estado', label: 'Estado' }, { key: 'n', label: 'N', align: 'right' }, { key: 'pct', label: '%', align: 'right' }],
      rowsOrd);

    // Por técnico (top 10 abiertos)
    const ESTADOS_TERMINAL = new Set(['ENTREGADA', 'COMPLETADA']);
    const byTec = Object.create(null);
    for (const o of d.ordenes) {
      const est = (o.estado_reparacion || '').toUpperCase();
      if (ESTADOS_TERMINAL.has(est)) continue;
      const t = o.tecnico_asignado || 'Sin asignar';
      byTec[t] = (byTec[t] || 0) + 1;
    }
    const rowsTec = Object.entries(byTec).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tec, n]) => ({ tecnico: tec, n }));
    renderTable('tblOrdenesPorTecnico',
      [{ key: 'tecnico', label: 'Técnico' }, { key: 'n', label: 'Abiertas', align: 'right' }],
      rowsTec);

    // Devoluciones de equipos — el tiquete de recuperación previo a ENTRADA.
    // KPIs: abiertas con edad y unidades pendientes; cerradas (90 días) con
    // ciclo de recuperación y desenlace recibido vs excepción.
    (function renderDevoluciones() {
      const el = $('tblDevoluciones');
      if (!el) return;
      const devs = d.ordenes.filter(o => (o.tipo_de_servicio || '') === 'DEVOLUCION' && !o.eliminado);
      if (!devs.length) {
        el.innerHTML = `<div class="empty-state-hint" style="padding:var(--sp-3);text-align:center;color:var(--fg-3);font-size:13px;">Sin devoluciones registradas todavía.</div>`;
        return;
      }
      const pendDe = (o) => {
        const pendSer = (o.devolucion?.esperados || []).filter(e => !e.resolucion).length;
        const pendMod = (o.devolucion?.esperados_por_modelo || [])
          .reduce((s, m) => s + Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0)), 0);
        return pendSer + pendMod;
      };
      const abiertas = devs.filter(o => (o.estado_reparacion || '').toUpperCase() !== 'CERRADA (DEVOLUCION)')
        .map(o => ({ o, dias: AdminMetrics.ageInDays(o.fecha_creacion) ?? 0, pend: pendDe(o) }))
        .sort((a, b) => b.dias - a.dias);
      const cerradas90 = devs.filter(o => (o.estado_reparacion || '').toUpperCase() === 'CERRADA (DEVOLUCION)'
        && (AdminMetrics.ageInDays(o.fecha_completado || o.fecha_creacion) ?? 999) <= 90);
      let recib = 0, excep = 0, cicloSum = 0, cicloN = 0;
      cerradas90.forEach(o => {
        (o.devolucion?.esperados || []).forEach(e => {
          if (e.resolucion === 'recibido' || e.resolucion === 'nunca_salio') recib++;
          else if (e.resolucion === 'no_devuelve') excep++;
        });
        const ini = AdminMetrics.ageInDays(o.fecha_creacion), fin = AdminMetrics.ageInDays(o.fecha_completado);
        if (ini != null && fin != null && ini >= fin) { cicloSum += (ini - fin); cicloN++; }
      });
      const kpis = `
        <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin-bottom:var(--sp-2);">
          <span><b>${abiertas.length}</b> abiertas · <b>${abiertas.reduce((s, a) => s + a.pend, 0)}</b> unidades sin resolver</span>
          <span>Cerradas 90d: <b>${cerradas90.length}</b> · ciclo promedio <b>${cicloN ? (cicloSum / cicloN).toFixed(1) : '—'}</b> días</span>
          <span>Desenlace 90d: <b>${recib}</b> resueltas · <b>${excep}</b> excepciones</span>
        </div>`;
      const filas = abiertas.slice(0, 20).map(({ o, dias, pend }) => `
        <tr>
          <td><span class="pill">${escapeHtml(o.numero_orden || o.id || '')}</span></td>
          <td>${escapeHtml(o.cliente_nombre || '—')}</td>
          <td>${escapeHtml(o.contrato?.contrato_id || '—')}</td>
          <td>${o.devolucion?.modo === 'confirmacion' ? 'confirmación' : 'recuperación'}</td>
          <td style="text-align:right;">${pend}</td>
          <td style="text-align:right;"><b>${dias}</b></td>
        </tr>`).join('');
      el.innerHTML = kpis + (abiertas.length
        ? `<table class="admin-table"><thead><tr><th>Orden</th><th>Cliente</th><th>Contrato</th><th>Modo</th><th style="text-align:right;">Pend.</th><th style="text-align:right;">Días</th></tr></thead><tbody>${filas}</tbody></table>`
        : `<div class="empty-state-hint" style="padding:var(--sp-2);color:var(--fg-3);font-size:13px;">Sin devoluciones abiertas.</div>`);
    })();

    // Contratos por estado
    const groupsCt = AdminMetrics.groupByStatus(d.contratos, c => c.estado || 'sin_estado');
    const rowsCt = Object.entries(groupsCt).sort((a, b) => b[1] - a[1]).map(([e, n]) => ({ estado: `<span class="pill">${e}</span>`, n }));
    renderTable('tblContratos',
      [{ key: 'estado', label: 'Estado' }, { key: 'n', label: 'N', align: 'right' }],
      rowsCt);

    // Cotizaciones por estado
    const groupsCot = AdminMetrics.groupByStatus(d.cotizaciones, c => (c.estado || 'sin_estado').toLowerCase());
    const rowsCot = Object.entries(groupsCot).sort((a, b) => b[1] - a[1]).map(([e, n]) => ({ estado: `<span class="pill">${e}</span>`, n }));
    renderTable('tblCotizaciones',
      [{ key: 'estado', label: 'Estado' }, { key: 'n', label: 'N', align: 'right' }],
      rowsCot);

    // Inventario crítico (todas las piezas bajo 5 o min_stock)
    const DEFAULT_MIN = 5;
    const criticas = d.piezas.filter(p => {
      const cant = Number(p.cantidad || 0);
      const min = Number(p.min_stock || DEFAULT_MIN);
      return cant <= min;
    }).sort((a, b) => Number(a.cantidad || 0) - Number(b.cantidad || 0));
    const rowsPie = criticas.slice(0, 30).map(p => ({
      marca: escapeHtml(p.marca || '—'),
      nombre: escapeHtml(p.nombre || p.descripcion || '—'),
      cantidad: Number(p.cantidad || 0),
      min: Number(p.min_stock || DEFAULT_MIN),
    }));
    renderTable('tblPiezasCriticas',
      [{ key: 'marca', label: 'Marca' }, { key: 'nombre', label: 'Pieza' }, { key: 'cantidad', label: 'Stock', align: 'right' }, { key: 'min', label: 'Mínimo', align: 'right' }],
      rowsPie);
  }

  // ────────── Main ──────────

  async function loadAll() {
    setText('lastUpdate', 'Cargando…');
    try {
      state.data = await loadAllData();
      const since = Date.now() - state.windowMs;
      const recent = computeRecent(state.data, since);
      renderRecent(recent);
      const atencion = computeAtencion(state.data);
      renderAtencion(atencion);
      renderReferencia(state.data);
      setText('lastUpdate', `Actualizado ${new Date().toLocaleTimeString('es-PA', { hour12: false })}`);
    } catch (err) {
      console.error('[admin/operacion]', err);
      if (window.Toast) Toast.show('Error: ' + (err.message || err.code), 'bad');
    }
  }

  function wireToolbar() {
    $('btnRefresh')?.addEventListener('click', () => loadAll());

    document.querySelectorAll('[data-window]').forEach(btn => {
      btn.addEventListener('click', () => {
        const w = btn.dataset.window;
        state.windowMs   = (w === '7d') ? DAYS_7 : HOURS_24;
        state.windowLabel = (w === '7d') ? '7 días' : '24 h';
        document.querySelectorAll('[data-window]').forEach(b => b.classList.toggle('is-on', b === btn));
        setText('windowLabel', state.windowLabel);
        // Re-render zone 1 only if data already loaded (no need to refetch).
        if (state.data) {
          const since = Date.now() - state.windowMs;
          renderRecent(computeRecent(state.data, since));
        }
      });
    });
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
