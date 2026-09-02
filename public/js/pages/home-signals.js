/* =============================================================
   HomeSignals — fila de señales accionables del home.
   PLAN_REDISENO_COMMAND_CENTER.md §3 (F1).

   Reglas de visibilidad (en este orden):
     1. La señal declara el módulo del que proviene; solo se muestra
        si MODULOS.puedeVer(rolEfectivo, modulo) — misma fuente que
        las tarjetas del home. El rol efectivo respeta el modo
        "Ver como" del admin (solo visual).
     2. Piso real: firestore.rules (documentado en senalesService.js).
        Si una consulta falla por permisos, la tarjeta se quita en
        silencio — el home nunca se rompe por una señal.

   Los conteos los ejecuta SenalesService (capa de servicios; las
   páginas no llaman db.collection() directamente — ARQUITECTURA §3.5).
   Cache en sessionStorage con TTL 5 min por (uid, rol efectivo).
   ============================================================= */

window.HomeSignals = (() => {

  const TTL_MS = 5 * 60 * 1000;
  const CACHE_PREFIX = 'ccHomeSignals:v1';

  // Estados canónicos de ordenes_de_servicio (ver APP.ESTADOS en
  // ordenes-state.js — no se carga en el home; literales a propósito).
  const EST = {
    POR_ASIGNAR: 'POR ASIGNAR',
    MOSTRADOR: 'RECIBIDO EN MOSTRADOR',
    ASIGNADO: 'ASIGNADO',
    COMPLETADO: 'COMPLETADO (EN OFICINA)',
  };

  // Catálogo. `modulo` = gate de visibilidad; `count(ctx)` → Promise<number>.
  const SIGNALS = {
    S1: {
      modulo: 'ordenes', icon: 'alert-circle', alert: true, moreIsBad: true,
      label: 'Órdenes por asignar', sub: 'requieren asignar técnico',
      href: 'ordenes/index.html?estado=POR%20ASIGNAR',
      // soloTaller: la DEVOLUCION vive en "POR ASIGNAR" pero jamás se asigna
      // (2026-09-02) — sin esto la señal contaba trabajo que no existe.
      count: () => SenalesService.countOrdenesPorEstado(EST.POR_ASIGNAR, { soloTaller: true }),
    },
    S2: {
      modulo: 'ordenes', icon: 'inbox',
      label: 'Recibidas en mostrador', sub: 'pendientes de procesar',
      href: 'ordenes/index.html?estado=RECIBIDO%20EN%20MOSTRADOR',
      count: () => SenalesService.countOrdenesPorEstado(EST.MOSTRADOR),
    },
    S3: {
      modulo: 'ordenes', icon: 'hammer',
      label: 'En taller (asignadas)', sub: 'en manos de técnicos',
      href: 'ordenes/index.html?estado=ASIGNADO',
      count: () => SenalesService.countOrdenesPorEstado(EST.ASIGNADO),
    },
    S4: {
      modulo: 'ordenes', icon: 'package-check',
      label: 'Completadas (en oficina)', sub: 'terminadas en el taller',
      href: 'ordenes/index.html?estado=COMPLETADO%20(EN%20OFICINA)',
      count: () => SenalesService.countOrdenesPorEstado(EST.COMPLETADO),
    },
    // El subconjunto de S4 que NO puede entregarse: el candado de QC lo
    // impide hasta que el jefe de taller firme. S4 decía "listas para
    // entregar" y contaba también estas.
    S4Q: {
      modulo: 'ordenes', icon: 'clipboard-check',
      label: 'Esperando control de calidad', sub: 'no pueden entregarse aún',
      href: 'ordenes/index.html?qc=1',
      count: () => SenalesService.countOrdenesQcPendiente(),
      items: () => SenalesService.listQcCola(),
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> <span class="pend-id">${esc(r.id)}</span> · ${esc(r.motivo)}`,
        dias: r.dias,
        cta: { label: 'Abrir orden', href: `ordenes/editar-orden.html?id=${encodeURIComponent(r.id)}` },
      }),
      vacio: 'Nada en cola. El taller está al día.',
    },
    // ── Detectores de la bandeja de pendientes (plan 2026-08-21) ──
    // "Listas para entregar": el eslabón humano más débil del ciclo — la
    // orden queda COMPLETADA con QC aprobado y nadie la marca ENTREGADO
    // (67 acumuladas al medirlo). Reemplaza a S4 para recepción: S4 era el
    // total de completadas (dato de estado), esta es SU cola accionable —
    // mismo razonamiento con el que S15 desplazó a S11.
    ENT: {
      modulo: 'ordenes', icon: 'package-check', alert: true, moreIsBad: true,
      label: 'Listas para entregar', sub: 'QC listo, falta marcar la entrega',
      href: 'ordenes/index.html?estado=COMPLETADO%20(EN%20OFICINA)',
      count: () => SenalesService.countListasParaEntregar(),
      items: () => SenalesService.listListasParaEntregar(),
      posponer: true, curso: true,
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> <span class="pend-id">${esc(r.id)}</span>`
          + ` · ${r.equipos} equipo${r.equipos === 1 ? '' : 's'} · ${esc(r.tipo)}`,
        dias: r.dias,
        // Deep-link ?entrega= abre el modal de entrega directamente
        // (el mismo que usan los correos de onComplete).
        cta: { label: 'Registrar entrega', href: `ordenes/index.html?entrega=${encodeURIComponent(r.id)}` },
      }),
      vacio: 'Todo lo terminado está entregado.',
    },
    // "Sin movimiento": abiertas y paradas dentro de la ventana accionable
    // (empresa/config.orden_stale_dias). Reemplaza a S3 para admin y jefe de
    // taller: "en taller (asignadas)" era un dato de estado; esta es la cola.
    EST: {
      modulo: 'ordenes', icon: 'hourglass', moreIsBad: true,
      label: 'Órdenes sin movimiento', sub: 'abiertas y paradas',
      href: 'ordenes/index.html',
      count: () => SenalesService.countEstancadas(),
      items: () => SenalesService.listEstancadas(),
      posponer: true, curso: true,
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> <span class="pend-id">${esc(r.id)}</span>`
          + ` · ${esc(r.estado.toLowerCase())}${r.tecnico ? ' · ' + esc(r.tecnico) : ''}`,
        dias: r.dias,
        cta: { label: 'Abrir orden', href: `ordenes/editar-orden.html?id=${encodeURIComponent(r.id)}` },
      }),
      vacio: 'Ninguna orden parada. Buen ritmo.',
    },
    S5: {
      modulo: 'ordenes', icon: 'wrench',
      label: 'Mis órdenes asignadas', sub: 'en tu cola de trabajo',
      href: 'ordenes/index.html?mias=1&estado=ASIGNADO',
      count: (ctx) => SenalesService.countMisOrdenes(ctx.uid, EST.ASIGNADO),
    },
    S4P: {
      modulo: 'ordenes', icon: 'package-check',
      label: 'Mis completadas (en oficina)', sub: 'trabajadas por ti',
      href: 'ordenes/index.html?mias=1&estado=COMPLETADO%20(EN%20OFICINA)',
      count: (ctx) => SenalesService.countMisOrdenes(ctx.uid, EST.COMPLETADO),
    },
    S6: {
      modulo: 'cotizaciones', icon: 'file-clock',
      label: 'Cotizaciones enviadas', sub: 'esperando respuesta del cliente',
      href: 'cotizaciones/index.html?estado=enviada',
      count: () => SenalesService.countCotizacionesPorEstado('enviada'),
    },
    S7: {
      modulo: 'cotizaciones', icon: 'file-clock',
      label: 'Mis cotizaciones activas', sub: 'borradores y enviadas',
      href: 'cotizaciones/index.html',
      count: (ctx) => SenalesService.countMisCotizacionesActivas(ctx.uid),
    },
    S8: {
      modulo: 'contratos', icon: 'file-check-2',
      label: 'Contratos por activar', sub: 'aprobados, esperando equipos',
      href: 'contratos/index.html?estado=aprobado',
      count: () => SenalesService.countContratosPorEstado('aprobado'),
    },
    S10: {
      modulo: 'contratos', icon: 'stamp', moreIsBad: true,
      label: 'Contratos por aprobar', sub: 'esperando gerencia',
      href: 'contratos/index.html?estado=pendiente_aprobacion',
      count: () => SenalesService.countContratosPorEstado('pendiente_aprobacion'),
    },
    // Pendiente del plan original ("no contable server-side"): contable desde
    // que la app estampa `requiere_aprobacion` al guardar (auditoría A10).
    SAP: {
      modulo: 'cotizaciones', icon: 'file-check', moreIsBad: true,
      label: 'Cotizaciones por aprobar', sub: 'fuera de política, esperando visto bueno',
      href: 'cotizaciones/index.html?estado=borrador',
      count: () => SenalesService.countCotizacionesPorAprobar(),
    },
    // Nota: "cotizaciones fuera de umbral por aprobar" NO es contable
    // server-side hoy — requiereAprobacion se calcula al vuelo
    // (CotizacionTotales) y no se persiste en el doc. Si se quiere esa
    // señal, primero hay que estampar el flag al guardar (feature aparte).
    S9: {
      modulo: 'piezas', icon: 'puzzle',
      label: 'Piezas sin stock', sub: 'reponer inventario',
      href: 'inventario/piezas.html',
      count: () => SenalesService.countPiezasSinStock(),
    },
    // Pool de equipos serializados (PLAN_CICLO_VIDA_EQUIPOS.md, Fase A). Los
    // href aterrizan en la pestaña/filtro EXACTOS de la señal (deep-links).
    S11: {
      modulo: 'equipos', icon: 'warehouse',
      label: 'Equipos en bodega', sub: 'disponibles para asignar',
      href: 'inventario/equipos.html?tab=en_bodega',
      count: () => SenalesService.countEquiposPoolPorEstado('en_bodega'),
    },
    S12: {
      modulo: 'equipos', icon: 'search-check', moreIsBad: true,
      label: 'Equipos por verificar', sub: 'creados por migración automática',
      href: 'inventario/equipos.html?tab=todos&verificar=1',
      count: () => SenalesService.countEquiposPoolSinVerificar(),
    },
    S13: {
      modulo: 'equipos', icon: 'package-search', moreIsBad: true,
      label: 'Devueltos por inspeccionar', sub: 'regresaron de cliente, esperan inspección',
      href: 'inventario/equipos.html?tab=devuelto_revision',
      count: () => SenalesService.countEquiposPoolPorEstado('devuelto_revision'),
      items: () => SenalesService.listCuarentena(),
      curso: true,
      row: (r, esc) => ({
        txt: `<span class="pend-id">${esc(r.serial)}</span> <b>${esc(r.modelo)}</b>`
          + (r.cliente && r.cliente !== '—' ? ` · venía de ${esc(r.cliente)}` : ''),
        dias: r.dias,
        cta: { label: 'Abrir en el pool', href: 'inventario/equipos.html?tab=devuelto_revision' },
      }),
      vacio: 'Cuarentena al día: todo lo devuelto ya pasó inspección.',
    },
    S14: {
      modulo: 'equipos', icon: 'map-pin-off', moreIsBad: true,
      label: 'Equipos por clasificar', sub: 'ubicación sin contrato ni orden que la respalde',
      href: 'inventario/equipos.html?tab=por_clasificar',
      count: () => SenalesService.countEquiposPoolPorEstado('por_clasificar'),
    },
    // Bandeja de bodega (Almacén · Hoy): el trabajo que nace en un contrato y
    // que hasta ahora solo llegaba por correo. El gate acepta el módulo nuevo
    // o el viejo para no perder la señal a mitad de la migración.
    S15: {
      modulo: ['almacen', 'pendientes'], icon: 'scan-barcode', alert: true, moreIsBad: true,
      label: 'Seriales por asignar', sub: 'contratos aprobados esperando bodega',
      href: 'almacen/index.html',
      count: () => SenalesService.countSerialesPorAsignar(),
    },
  };

  // Rol efectivo → señales (máx. 4). Cada señal pasa ADEMÁS por el gate de
  // módulo, así un error en esta lista nunca muestra datos de un módulo
  // que el rol no ve.
  // admin y jefe_taller ven S4Q (esperando QC) en lugar de S4 (completadas):
  // son los dos roles que pueden firmar el QC, así que la cola bloqueada es
  // accionable para ellos mientras que el total de completadas no lo es.
  // Recepción conserva S4 — entrega, pero no puede desbloquear.
  const POR_ROL = {
    // SAP (cotizaciones por aprobar) reemplaza a S6 (enviadas) para los
    // APROBADORES: lo que espera SU firma pesa más que lo que espera al
    // cliente. El vendedor conserva S7 (sus activas, que incluye enviadas).
    // EST (sin movimiento) desplaza a S3 para admin/jefe_taller, y ENT
    // (listas para entregar) a S4 para recepción: en ambos casos sale un
    // dato de estado y entra una cola con gente esperando — el mismo
    // razonamiento con el que S15 desplazó a S11. S3 y S4 siguen accesibles
    // desde la lista de órdenes (chips por estado).
    administrador:     ['S1', 'EST', 'S4Q', 'SAP'],
    gerente:           ['S1', 'S10', 'SAP', 'S8'],
    jefe_taller:       ['S1', 'EST', 'S4Q', 'SAP'],
    recepcion:         ['S1', 'S2', 'ENT', 'S8'],
    vendedor:          ['S7', 'S8', 'S1', 'S4'],
    tecnico:           ['S5', 'S4P'],
    tecnico_operativo: ['S5', 'S4P'],
    // S14 (por clasificar) entra en lugar de S12 (por verificar): la ubicación
    // desconocida es un atraso accionable, mientras que "por verificar" es una
    // marca blanda — y su entrada bajó al marcar verificadas las ENTRADAs.
    // S12 sigue accesible desde Equipos por serial (filtro "sin verificar").
    // S15 (seriales por asignar) desplaza a S11 (equipos en bodega): S11 es un
    // dato de estado —ya está en los KPI de Inventario— y S15 es una cola con
    // gente esperando. El tope de la fila son 4 señales.
    inventario:        ['S15', 'S13', 'S14', 'S9'],
    vista:             ['S1', 'S3', 'S4'],
    contabilidad:      [],
  };

  function _cacheKey(uid, rol) { return `${CACHE_PREFIX}:${uid}:${rol}`; }

  function _readCache(uid, rol) {
    try {
      const raw = sessionStorage.getItem(_cacheKey(uid, rol));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.t > TTL_MS) return null;
      return data.counts || null;
    } catch { return null; }
  }

  function _writeCache(uid, rol, counts) {
    try {
      sessionStorage.setItem(_cacheKey(uid, rol), JSON.stringify({ t: Date.now(), counts }));
    } catch { /* storage lleno/bloqueado: sin cache */ }
  }

  /* ---- Delta diario ("▲ N vs ayer") ----
     Snapshot por día en localStorage (aproximación por navegador): la
     primera visita del día guarda los conteos como snapshot de HOY y
     rota el anterior. El delta solo se muestra si el snapshot previo
     es exactamente de AYER. */
  const SNAP_KEY = (uid, rol) => `ccSignalsSnap:v1:${uid}:${rol}`;

  function _localDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Rota el snapshot si cambió el día y devuelve los conteos de ayer (o null). */
  function _rotateSnapshot(uid, rol, counts) {
    try {
      const key = SNAP_KEY(uid, rol);
      const raw = localStorage.getItem(key);
      const snap = raw ? JSON.parse(raw) : null;
      const today = _localDate();
      if (!snap || snap.today?.date !== today) {
        localStorage.setItem(key, JSON.stringify({
          today: { date: today, counts },
          prev: snap?.today || null,
        }));
        return (snap?.today?.date === _localDate(-1)) ? snap.today.counts : null;
      }
      return (snap.prev?.date === _localDate(-1)) ? snap.prev.counts : null;
    } catch { return null; }
  }

  function _applyDeltas(mount, ids, counts, prevCounts) {
    if (!prevCounts) return;
    ids.forEach(id => {
      if (typeof counts[id] !== 'number' || typeof prevCounts[id] !== 'number') return;
      const diff = counts[id] - prevCounts[id];
      if (diff === 0) return;
      const tile = mount.querySelector(`[data-signal="${id}"] .kpi__delta`);
      if (!tile) return;
      const up = diff > 0;
      // Para señales de backlog (moreIsBad) subir es malo (rojo) y bajar bueno.
      const cls = SIGNALS[id].moreIsBad ? (up ? 'down' : 'up') : '';
      tile.innerHTML = `<span class="${cls}">${up ? '▲' : '▼'} ${Math.abs(diff)} vs ayer</span> · ${SIGNALS[id].sub}`;
    });
  }

  function _tileHtml(id, sig) {
    // Con `items` la tarjeta se ABRE aquí mismo en filas (bandeja de
    // pendientes) en vez de navegar; el chevron lo anuncia. El href se
    // conserva como "Abrir en su módulo" dentro del panel.
    const abre = typeof sig.items === 'function';
    return `
<a class="kpi${sig.alert ? ' kpi--alert' : ''}${abre ? ' kpi--abre' : ''} is-loading" href="${sig.href}" data-signal="${id}"${abre ? ' aria-expanded="false" role="button"' : ''}>
  <div class="kpi__label"><i data-lucide="${sig.icon}"></i> ${sig.label}${abre ? ' <span class="kpi__chev" aria-hidden="true">▾</span>' : ''}</div>
  <div class="kpi__val num" data-signal-val="${id}">—</div>
  <div class="kpi__delta">${sig.sub}</div>
</a>`;
  }

  /* ══ Bandeja de pendientes: la señal es el encabezado de sus filas ══════
     (plan Pendientes, fase 2-3). Clic en una señal con `items` la abre AQUÍ
     — antes navegaba a una lista que carga las 40 órdenes más recientes,
     donde lo pendiente (viejo por definición) no aparecía. Un solo panel a
     la vez; las filas llegan del servidor al expandir (memo 5 min en
     SenalesService, compartida con el conteo).

     Posponer (señales con `posponer: true`): mini-formulario inline — el
     home no carga modal.js y no va a cargarlo por esto. El estado queda en
     el DOCUMENTO FUENTE (pendiente_snooze) y lo respetan esta bandeja y el
     correo diario. */

  const MAX_FILAS_PANEL = 40;
  let _panelAbierto = null;   // id de la señal abierta

  function _esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[m]));
  }

  function _injectStyles() {
    if (document.getElementById('ccPendStyles')) return;
    const st = document.createElement('style');
    st.id = 'ccPendStyles';
    st.textContent = `
      .kpi--abre { cursor: pointer; }
      .kpi__chev { font-size: 10px; opacity: .55; margin-left: 2px; transition: transform .15s; display: inline-block; }
      .kpi[aria-expanded="true"] .kpi__chev { transform: rotate(180deg); }
      .kpi[aria-expanded="true"] { outline: 2px solid var(--accent, #0091D7); outline-offset: -2px; }
      .pend-panel { margin: 10px 0 4px; border: 1px solid var(--border-default, #DBE3ED);
        border-radius: 10px; background: var(--surface-card, #fff); overflow: hidden; }
      .pend-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px;
        font-size: 13px; font-weight: 700; border-bottom: 1px solid var(--border-subtle, #E9EFF5); }
      .pend-head .pend-n { background: var(--surface-sunken, #F1F5F9); border-radius: 999px;
        padding: 0 8px; font-size: 12px; font-weight: 600; }
      .pend-head a { margin-left: auto; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
      .pend-fila { display: flex; align-items: center; gap: 10px; padding: 8px 14px;
        border-bottom: 1px solid var(--border-subtle, #E9EFF5); font-size: 13.5px; }
      .pend-fila:last-child { border-bottom: none; }
      .pend-txt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pend-id { font-family: var(--mono, ui-monospace, monospace); font-size: 12px; color: var(--accent, #0091D7); }
      .pend-dias { flex: none; font-family: var(--mono, ui-monospace, monospace); font-size: 12px;
        color: var(--fg-3, #6B819A); white-space: nowrap; font-variant-numeric: tabular-nums; }
      .pend-dias.warn { color: #B45309; font-weight: 700; }
      .pend-dias.bad { color: #B91C1C; font-weight: 700; }
      .pend-cta { flex: none; font-size: 12px; font-weight: 600; white-space: nowrap;
        padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border-default, #DBE3ED);
        background: var(--surface-sunken, #F6F8FB); text-decoration: none; color: inherit; }
      .pend-cta:hover { border-color: var(--accent, #0091D7); color: var(--accent, #0091D7); }
      .pend-snz-btn { flex: none; font-size: 11.5px; background: none; border: none; cursor: pointer;
        color: var(--fg-3, #6B819A); text-decoration: underline; padding: 2px 4px; }
      .pend-snz-form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 6px 14px 10px 26px;
        border-bottom: 1px solid var(--border-subtle, #E9EFF5); background: var(--surface-sunken, #F8FAFC); }
      .pend-snz-form input[type=number] { width: 58px; }
      .pend-snz-form input[type=text] { flex: 1 1 180px; min-width: 140px; }
      .pend-snz-form input { font: inherit; font-size: 12.5px; padding: 4px 8px;
        border: 1px solid var(--border-default, #DBE3ED); border-radius: 6px; }
      .pend-snz-form button { font: inherit; font-size: 12px; font-weight: 600; padding: 4px 10px;
        border-radius: 6px; border: 1px solid var(--border-default, #DBE3ED); cursor: pointer; }
      .pend-snz-form .ok { background: var(--accent, #0091D7); color: #fff; border-color: transparent; }
      .pend-pospuesto { opacity: .62; }
      .pend-pospuesto .pend-txt { text-decoration: none; }
      .pend-snz-tag { flex: none; font-size: 11px; background: #FEF3C7; color: #92400E;
        border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
      .pend-curso-tag { flex: none; font-size: 11px; background: #E6F4FC; color: #005781;
        border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
      .pend-pie { padding: 8px 14px; font-size: 12px; color: var(--fg-3, #6B819A);
        background: var(--surface-sunken, #F8FAFC); }
      .pend-vacio { padding: 16px 14px; font-size: 13px; color: var(--fg-3, #6B819A); text-align: center; }
      @media (prefers-reduced-motion: reduce) { .kpi__chev { transition: none; } }
    `;
    document.head.appendChild(st);
  }

  function _diasHtml(d) {
    const cls = d >= 30 ? ' bad' : d >= 10 ? ' warn' : '';
    return `<span class="pend-dias${cls}">${d} d</span>`;
  }

  function _filaHtml(id, sig, r) {
    const row = sig.row(r, _esc);
    const snz = sig.posponer && !r.pospuesto
      ? `<button type="button" class="pend-snz-btn" data-snz="${_esc(r.id)}" title="Sacarlo del ruido unos días, con motivo — también silencia el correo diario">posponer</button>`
      : '';
    // "En curso": el dueño del pendiente es el ROL — tomar avisa, no bloquea,
    // y cualquiera del rol puede soltar (si quien lo tomó no está, el
    // pendiente no se queda secuestrado).
    const cursoTag = r.en_curso
      ? `<span class="pend-curso-tag" title="Alguien del rol ya lo está trabajando — no bloquea: cualquiera puede actuar o soltarlo">en curso · ${_esc(r.curso_por)}${r.curso_dias ? ' · ' + r.curso_dias + 'd' : ''}</span>`
      : '';
    const cursoBtn = r.pospuesto ? '' : (r.en_curso
      ? `<button type="button" class="pend-snz-btn" data-soltar="${_esc(r.id)}" title="Liberarlo — por ejemplo, si quien lo tomó no está">soltar</button>`
      : (sig.curso ? `<button type="button" class="pend-snz-btn" data-tomar="${_esc(r.id)}" title="Avisar al resto del rol que lo estás trabajando">tomar</button>` : ''));
    const tag = r.pospuesto
      ? `<span class="pend-snz-tag" title="${_esc(r.snooze_motivo)}">pospuesto → ${_esc(r.snooze_hasta)}</span>
         <button type="button" class="pend-snz-btn" data-react="${_esc(r.id)}">reactivar</button>`
      : '';
    return `<div class="pend-fila${r.pospuesto ? ' pend-pospuesto' : ''}" data-row="${_esc(r.id)}" data-col="${_esc(r.col)}">
      <span class="pend-txt">${row.txt}</span>
      ${tag}${cursoTag}${_diasHtml(row.dias)}${cursoBtn}${snz}
      ${row.cta && !r.pospuesto ? `<a class="pend-cta" href="${row.cta.href}">${_esc(row.cta.label)}</a>` : ''}
    </div>`;
  }

  async function _renderPanel(panel, id, sig) {
    panel.innerHTML = `<div class="pend-vacio">Cargando…</div>`;
    let rows;
    try { rows = await sig.items(); }
    catch (e) {
      console.warn('[HomeSignals] filas de', id, 'no disponibles:', e?.code || e);
      panel.innerHTML = `<div class="pend-vacio">No se pudieron cargar las filas. <a href="${sig.href}">Abrir en su módulo</a></div>`;
      return;
    }
    const activas = rows.filter(r => !r.pospuesto);
    const pospuestas = rows.filter(r => r.pospuesto);
    const visibles = activas.slice(0, MAX_FILAS_PANEL);
    const resto = activas.length - visibles.length;

    panel.innerHTML = `
      <div class="pend-head">${_esc(sig.label)} <span class="pend-n">${activas.length}</span>
        <a href="${sig.href}">Abrir en su módulo →</a>
      </div>
      ${visibles.length
        ? visibles.map(r => _filaHtml(id, sig, r)).join('')
        : `<div class="pend-vacio">${_esc(sig.vacio || 'Nada pendiente.')}</div>`}
      ${pospuestas.length ? pospuestas.map(r => _filaHtml(id, sig, r)).join('') : ''}
      ${(resto > 0 || pospuestas.length)
        ? `<div class="pend-pie">${resto > 0 ? `…y ${resto} más — ábrelo en su módulo para verlo todo. ` : ''}${pospuestas.length ? `${pospuestas.length} pospuesto${pospuestas.length === 1 ? '' : 's'} (también fuera del correo diario).` : ''}</div>`
        : ''}`;

    // Posponer inline: un formulario a la vez, debajo de su fila.
    panel.querySelectorAll('[data-snz]').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelector('.pend-snz-form')?.remove();
        const fila = btn.closest('.pend-fila');
        const form = document.createElement('div');
        form.className = 'pend-snz-form';
        form.innerHTML = `
          <label style="font-size:12px;">días <input type="number" min="1" max="60" value="7"></label>
          <input type="text" placeholder="Motivo (obligatorio) — lo lee la siguiente persona" maxlength="140">
          <button type="button" class="ok">Posponer</button>
          <button type="button" class="no">Cancelar</button>`;
        fila.insertAdjacentElement('afterend', form);
        const [dias, motivo] = form.querySelectorAll('input');
        motivo.focus();
        form.querySelector('.no').onclick = () => form.remove();
        form.querySelector('.ok').onclick = async () => {
          const okBtn = form.querySelector('.ok');
          okBtn.disabled = true; okBtn.textContent = 'Guardando…';
          try {
            await SenalesService.posponerPendiente({
              col: fila.dataset.col, id: fila.dataset.row,
              dias: dias.value, motivo: motivo.value,
            });
            await _refrescarSenal(panel.closest('[data-pend-mount]'), id, sig);
            _renderPanel(panel, id, sig);
          } catch (e) {
            okBtn.disabled = false; okBtn.textContent = 'Posponer';
            motivo.placeholder = e?.message || 'No se pudo posponer';
            motivo.value = motivo.value || ''; motivo.focus();
          }
        };
      });
    });
    panel.querySelectorAll('[data-react]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const fila = btn.closest('.pend-fila');
          await SenalesService.reactivarPendiente({ col: fila.dataset.col, id: fila.dataset.row });
          await _refrescarSenal(panel.closest('[data-pend-mount]'), id, sig);
          _renderPanel(panel, id, sig);
        } catch (e) { btn.disabled = false; console.warn('[HomeSignals] reactivar:', e); }
      });
    });
    // Tomar / soltar no tocan el conteo (en curso sigue pendiente): solo
    // repintan el panel.
    const _accionCurso = (selector, fn) => {
      panel.querySelectorAll(selector).forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const fila = btn.closest('.pend-fila');
            await fn({ col: fila.dataset.col, id: fila.dataset.row });
            _renderPanel(panel, id, sig);
          } catch (e) { btn.disabled = false; console.warn('[HomeSignals] curso:', e); }
        });
      });
    };
    _accionCurso('[data-tomar]', (a) => SenalesService.tomarPendiente(a));
    _accionCurso('[data-soltar]', (a) => SenalesService.soltarPendiente(a));
  }

  // Tras posponer/reactivar el conteo del tile cambia: se recalcula esa señal
  // y se tira la caché de sesión para que la próxima visita no reviva el
  // número viejo.
  async function _refrescarSenal(mount, id, sig) {
    try {
      const n = await sig.count({});
      const val = mount?.querySelector(`[data-signal-val="${id}"]`);
      if (val) val.textContent = String(n);
    } catch (e) { /* el conteo viejo se queda; la caché igual se invalida */ }
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith(CACHE_PREFIX))
        .forEach(k => sessionStorage.removeItem(k));
    } catch (e) { /* sin storage */ }
  }

  function _wireExpansion(mount) {
    _injectStyles();
    mount.setAttribute('data-pend-mount', '1');
    // Re-render (p.ej. "Ver como" del admin): el innerHTML nuevo borró el
    // panel, así que el estado se resetea; el listener NO se duplica — dos
    // listeners harían que cada clic abriera y cerrara en el mismo acto.
    _panelAbierto = null;
    if (mount._pendWired) return;
    mount._pendWired = true;
    let panel = null;
    mount.addEventListener('click', (ev) => {
      const tile = ev.target.closest('[data-signal]');
      if (!tile || !mount.contains(tile)) return;
      const id = tile.dataset.signal;
      const sig = SIGNALS[id];
      if (!sig || typeof sig.items !== 'function') return;   // tile normal: navega
      ev.preventDefault();
      if (_panelAbierto === id) {                            // segundo clic: cierra
        panel?.remove(); panel = null; _panelAbierto = null;
        tile.setAttribute('aria-expanded', 'false');
        return;
      }
      mount.querySelectorAll('[data-signal][aria-expanded]')
        .forEach(t => t.setAttribute('aria-expanded', 'false'));
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'pend-panel';
        mount.appendChild(panel);
      }
      _panelAbierto = id;
      tile.setAttribute('aria-expanded', 'true');
      _renderPanel(panel, id, sig);
    });
  }

  /**
   * Renderiza la fila de señales en #mountId y dispara los conteos.
   * @param {Object} opts
   * @param {string} opts.rolEfectivo  rol tras "Ver como" (gating visual)
   * @param {string} opts.uid          uid REAL (las queries corren como el usuario real)
   * @param {string} [opts.mountId]    contenedor; default 'signalsRow'
   */
  async function render({ rolEfectivo, uid, mountId = 'signalsRow' }) {
    const mount = document.getElementById(mountId);
    if (!mount) return;

    const ids = (POR_ROL[rolEfectivo] || []).filter(id => {
      const sig = SIGNALS[id];
      if (!sig || !window.MODULOS) return false;
      // `modulo` puede ser string o lista (señales que migran de módulo, S15).
      const mods = Array.isArray(sig.modulo) ? sig.modulo : [sig.modulo];
      return mods.some(m => MODULOS.puedeVer(rolEfectivo, m));
    });

    // (El gate por aggregatesDisponibles() se quitó el 2026-08-24: era el
    // guard que escondió la fila COMPLETA desde el estreno — el SDK compat
    // nunca tuvo count() y nadie vio degradarse nada. Los conteos ahora
    // funcionan siempre, por agregado o por scan acotado.)
    if (!ids.length) {
      mount.style.display = 'none';
      return;
    }

    mount.innerHTML = `<div class="kpis">${ids.map(id => _tileHtml(id, SIGNALS[id])).join('')}</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    // La expansión se cablea ANTES de resolver los conteos: el camino de la
    // caché hace `return` temprano y sin esto las señales cacheadas no abrían.
    _wireExpansion(mount, ids);

    const setVal = (id, n) => {
      const tile = mount.querySelector(`[data-signal="${id}"]`);
      const val = mount.querySelector(`[data-signal-val="${id}"]`);
      if (!tile || !val) return;
      tile.classList.remove('is-loading');
      val.textContent = String(n);
    };
    const dropTile = (id) => {
      mount.querySelector(`[data-signal="${id}"]`)?.remove();
    };

    const cached = _readCache(uid, rolEfectivo);
    if (cached) {
      ids.forEach(id => {
        // number o string: el conteo por scan reporta "400+" cuando topa.
        if (typeof cached[id] === 'number' || typeof cached[id] === 'string') setVal(id, cached[id]);
        else dropTile(id);
      });
      _applyDeltas(mount, ids, cached, _rotateSnapshot(uid, rolEfectivo, cached));
      return;
    }

    const counts = {};
    await Promise.all(ids.map(async (id) => {
      try {
        counts[id] = await SIGNALS[id].count({ uid });
        setVal(id, counts[id]);
      } catch (err) {
        // permiso denegado / índice faltante → fuera la tarjeta, el home sigue.
        console.warn(`[HomeSignals] señal ${id} no disponible:`, err?.code || err);
        dropTile(id);
      }
    }));
    _writeCache(uid, rolEfectivo, counts);
    _applyDeltas(mount, ids, counts, _rotateSnapshot(uid, rolEfectivo, counts));
  }

  return { render, SIGNALS, POR_ROL };
})();
