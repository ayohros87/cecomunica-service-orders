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
      modulo: 'ordenes', icon: 'alert-circle', alert: true,
      label: 'Órdenes por asignar', sub: 'requieren asignar técnico',
      href: 'ordenes/index.html',
      count: () => SenalesService.countOrdenesPorEstado(EST.POR_ASIGNAR),
    },
    S2: {
      modulo: 'ordenes', icon: 'inbox',
      label: 'Recibidas en mostrador', sub: 'pendientes de procesar',
      href: 'ordenes/index.html',
      count: () => SenalesService.countOrdenesPorEstado(EST.MOSTRADOR),
    },
    S3: {
      modulo: 'ordenes', icon: 'hammer',
      label: 'En taller (asignadas)', sub: 'en manos de técnicos',
      href: 'ordenes/index.html',
      count: () => SenalesService.countOrdenesPorEstado(EST.ASIGNADO),
    },
    S4: {
      modulo: 'ordenes', icon: 'package-check',
      label: 'Completadas (en oficina)', sub: 'listas para entregar',
      href: 'ordenes/index.html',
      count: () => SenalesService.countOrdenesPorEstado(EST.COMPLETADO),
    },
    S5: {
      modulo: 'ordenes', icon: 'wrench',
      label: 'Mis órdenes asignadas', sub: 'en tu cola de trabajo',
      href: 'ordenes/index.html',
      count: (ctx) => SenalesService.countMisOrdenes(ctx.uid, EST.ASIGNADO),
    },
    S4P: {
      modulo: 'ordenes', icon: 'package-check',
      label: 'Mis completadas (en oficina)', sub: 'trabajadas por ti',
      href: 'ordenes/index.html',
      count: (ctx) => SenalesService.countMisOrdenes(ctx.uid, EST.COMPLETADO),
    },
    S6: {
      modulo: 'cotizaciones', icon: 'file-clock',
      label: 'Cotizaciones enviadas', sub: 'esperando respuesta del cliente',
      href: 'cotizaciones/index.html',
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
      href: 'contratos/index.html',
      count: () => SenalesService.countContratosPorEstado('aprobado'),
    },
    S9: {
      modulo: 'piezas', icon: 'puzzle',
      label: 'Piezas sin stock', sub: 'reponer inventario',
      href: 'inventario/piezas.html',
      count: () => SenalesService.countPiezasSinStock(),
    },
  };

  // Rol efectivo → señales (máx. 4). Cada señal pasa ADEMÁS por el gate de
  // módulo, así un error en esta lista nunca muestra datos de un módulo
  // que el rol no ve.
  const POR_ROL = {
    administrador:     ['S1', 'S3', 'S4', 'S6'],
    gerente:           ['S1', 'S3', 'S4', 'S6'],
    jefe_taller:       ['S1', 'S3', 'S4', 'S6'],
    recepcion:         ['S1', 'S2', 'S4', 'S8'],
    vendedor:          ['S7', 'S8', 'S1', 'S4'],
    tecnico:           ['S5', 'S4P'],
    tecnico_operativo: ['S5', 'S4P'],
    inventario:        ['S9'],
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

  function _tileHtml(id, sig) {
    return `
<a class="kpi${sig.alert ? ' kpi--alert' : ''} is-loading" href="${sig.href}" data-signal="${id}">
  <div class="kpi__label"><i data-lucide="${sig.icon}"></i> ${sig.label}</div>
  <div class="kpi__val num" data-signal-val="${id}">—</div>
  <div class="kpi__delta">${sig.sub}</div>
</a>`;
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
      return sig && window.MODULOS && MODULOS.puedeVer(rolEfectivo, sig.modulo);
    });

    if (!ids.length || !SenalesService.aggregatesDisponibles()) {
      mount.style.display = 'none';
      return;
    }

    mount.innerHTML = `<div class="kpis">${ids.map(id => _tileHtml(id, SIGNALS[id])).join('')}</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();

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
        if (typeof cached[id] === 'number') setVal(id, cached[id]);
        else dropTile(id);
      });
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
  }

  return { render, SIGNALS, POR_ROL };
})();
