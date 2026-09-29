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
  const CACHE_PREFIX = 'ccHomeSignals:v3';

  // Estados canónicos de ordenes_de_servicio (ver APP.ESTADOS en
  // ordenes-state.js — no se carga en el home; literales a propósito).
  const EST = {
    POR_ASIGNAR: 'POR ASIGNAR',
    MOSTRADOR: 'RECIBIDO EN MOSTRADOR',
    ASIGNADO: 'ASIGNADO',
    COMPLETADO: 'COMPLETADO (EN OFICINA)',
  };

  // ¿La señal sigue en su ventana de "Nuevo"? Fecha local del navegador.
  function _esNueva(sig) {
    if (!sig.nuevo?.hasta) return false;
    const d = new Date();
    const hoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return hoy <= sig.nuevo.hasta;
  }

  // Fila de un contrato por firmar (FIR/FIRV): "tranca la entrega" cuando la
  // orden ya salió — es lo que recepción no puede entregar sin la firma.
  function _filaFirma(r, esc) {
    return {
      txt: `<b>${esc(r.cliente)}</b> <span class="bj-id">${esc(r.contrato)}</span> · ${esc(r.clase)}`
        + (r.vendedor ? ` · ${esc(r.vendedor)}` : '')
        + (r.con_orden ? ' · <b>tranca la entrega</b>' : ''),
      dias: r.dias,
      cta: r.cliente_id
        ? { label: 'Pedir firma', href: `clientes/centro.html?id=${encodeURIComponent(r.cliente_id)}&contrato=${encodeURIComponent(r.id)}` }
        : null,
    };
  }

  // Catálogo. `modulo` = gate de visibilidad; `count(ctx)` → Promise<number>.
  const SIGNALS = {
    OPC: {
      modulo: 'ordenes', icon: 'clipboard-plus', moreIsBad: true, fresh: true,
      label: 'Órdenes por crear', sub: 'contratos y ventas',
      href: 'ordenes/index.html',
      count: ctx => window.HomeFeedOrdenes.contar(ctx),
      panel: (mount, ctx, onCount) => window.HomeFeedOrdenes.renderPanel(mount, ctx, onCount),
    },
    S1: {
      modulo: 'ordenes', icon: 'alert-circle', alert: true, moreIsBad: true,
      label: 'Órdenes por asignar', sub: 'sin técnico',
      href: 'ordenes/index.html?estado=POR%20ASIGNAR',
      // soloTaller: la DEVOLUCION vive en "POR ASIGNAR" pero jamás se asigna
      // (2026-09-02) — sin esto la señal contaba trabajo que no existe.
      // Cuenta desde las filas (memo compartida con el panel): las de más de
      // orden_stale_max_dias van al grupo "por depurar" y no suman.
      count: () => SenalesService.countOrdenesPorAsignar(),
      items: () => SenalesService.listOrdenesPorAsignar(),
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> <span class="bj-id">${esc(r.id)}</span> · ${esc(r.tipo)}`,
        dias: r.dias,
        cta: { label: 'Abrir orden', href: `ordenes/editar-orden.html?id=${encodeURIComponent(r.id)}` },
      }),
      hrefLabel: 'Ver todas →',
      vacio: 'No hay órdenes pendientes de asignar.',
    },
    S2: {
      modulo: 'ordenes', icon: 'inbox',
      label: 'Recibidas en mostrador', sub: 'por procesar',
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
      label: 'Completadas (en oficina)', sub: 'terminadas',
      href: 'ordenes/index.html?estado=COMPLETADO%20(EN%20OFICINA)',
      count: () => SenalesService.countOrdenesPorEstado(EST.COMPLETADO),
    },
    // El subconjunto de S4 que NO puede entregarse: el candado de QC lo
    // impide hasta que el jefe de taller firme. S4 decía "listas para
    // entregar" y contaba también estas.
    S4Q: {
      modulo: 'ordenes', icon: 'clipboard-check',
      label: 'Esperando control de calidad', sub: 'aún no se entregan',
      href: 'ordenes/index.html?qc=1',
      count: () => SenalesService.countOrdenesQcPendiente(),
      items: () => SenalesService.listQcCola(),
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> <span class="bj-id">${esc(r.id)}</span> · ${esc(r.motivo)}`,
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
      label: 'Listas para entregar', sub: 'falta la entrega',
      href: 'ordenes/index.html?estado=COMPLETADO%20(EN%20OFICINA)',
      count: () => SenalesService.countListasParaEntregar(),
      items: () => SenalesService.listListasParaEntregar(),
      posponer: true, curso: true,
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> <span class="bj-id">${esc(r.id)}</span>`
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
      // "Abrir en su módulo" lleva las órdenes EXACTAS del panel (?ids=, el
      // mismo deep-link de los correos): son viejas y no salen en las 40
      // recientes de la lista (auditoría UX 2026-09-28, 4.1 #9).
      hrefDe: (rows) => rows.length
        ? `ordenes/index.html?ids=${rows.slice(0, 60).map(r => encodeURIComponent(r.id)).join(',')}`
        : 'ordenes/index.html',
      count: () => SenalesService.countEstancadas(),
      items: () => SenalesService.listEstancadas(),
      posponer: true, curso: true,
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> <span class="bj-id">${esc(r.id)}</span>`
          + ` · ${esc(r.estado.toLowerCase())}${r.tecnico ? ' · ' + esc(r.tecnico) : ''}`,
        dias: r.dias,
        cta: { label: 'Abrir orden', href: `ordenes/editar-orden.html?id=${encodeURIComponent(r.id)}` },
      }),
      vacio: 'Ninguna orden parada. Buen ritmo.',
    },
    S5: {
      modulo: 'ordenes', icon: 'wrench',
      label: 'Mis órdenes asignadas', sub: 'en tu cola',
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
      label: 'Cotizaciones enviadas', sub: 'esperan al cliente',
      href: 'cotizaciones/index.html?estado=enviada',
      count: () => SenalesService.countCotizacionesPorEstado('enviada'),
    },
    S7: {
      modulo: 'cotizaciones', icon: 'file-clock',
      label: 'Mis cotizaciones activas', sub: 'borradores y enviadas',
      // ?estado=activas: la lista aterriza con borrador+enviada+aprobada ya
      // filtradas y las trae TODAS, no solo las de la primera página
      // (auditoría UX 2026-09-28 §4.5 #12). Antes caía en "Todas".
      href: 'cotizaciones/index.html?estado=activas',
      count: (ctx) => SenalesService.countMisCotizacionesActivas(ctx.uid),
    },
    // "Contratos por firmar" (2026-09-29) reemplaza a S8 "Contratos por
    // activar": contaba todo contrato en 'aprobado' (203) —históricos legacy,
    // REEMP/DEMO que no llevan firma, borrados, ya entregados— y llevaba a la
    // lista de contratos, así que el número no pedía nada. Esta es la cola
    // que tranca entregas: seriales asignados, lleva firma y el cliente no ha
    // firmado. Cada fila abre el contrato en el Centro, donde sale el enlace
    // de firma. Pedir la firma es del VENDEDOR (FIRV, los suyos); gerencia ve
    // todos con el nombre del vendedor para supervisar. Recepción NO la ve
    // (2026-09-29): no le toca pedirla, y cuando la firma frena una entrega el
    // candado de ENTREGAR ya se lo dice con el enlace a la ficha.
    FIR: {
      modulo: 'centro', icon: 'pen-line', moreIsBad: true,
      // Marca temporal "Nuevo" (hasta el día indicado, inclusive): la señal
      // cambió de nombre y de número (203 → ~13) y sin aviso parecería un error.
      nuevo: { hasta: '2026-10-02', nota: 'Antes decía "Contratos por activar" y contaba más de 200 contratos viejos. Ahora solo cuenta los que de verdad esperan la firma del cliente.' },
      label: 'Contratos por firmar', sub: 'de todos los vendedores',
      href: 'clientes/centro.html',
      count: () => SenalesService.countContratosPorFirmar(),
      items: () => SenalesService.listContratosPorFirmar(),
      row: (r, esc) => _filaFirma(r, esc),
      hrefLabel: 'Abrir el Centro →',
      vacio: 'Ningún contrato esperando firma.',
    },
    FIRV: {
      modulo: 'centro', icon: 'pen-line', moreIsBad: true,
      // Marca temporal "Nuevo" (hasta el día indicado, inclusive): la señal
      // cambió de nombre y de número (203 → ~13) y sin aviso parecería un error.
      nuevo: { hasta: '2026-10-02', nota: 'Antes decía "Contratos por activar" y contaba más de 200 contratos viejos. Ahora solo cuenta los que de verdad esperan la firma del cliente.' },
      label: 'Mis contratos por firmar', sub: 'falta la firma',
      href: 'clientes/centro.html',
      count: (ctx) => SenalesService.countContratosPorFirmar({ uid: ctx.uid }),
      // items() se llama sin ctx: el elaborador sale del usuario autenticado.
      items: () => SenalesService.listContratosPorFirmar({ uid: firebase.auth().currentUser?.uid || null }),
      row: (r, esc) => _filaFirma(r, esc),
      hrefLabel: 'Abrir el Centro →',
      vacio: 'Ninguno de tus contratos espera firma.',
    },
    // UNA señal para todo lo que espera aprobación de administración/gerencia
    // (gestiones + contratos), igual que la bandeja del Centro. Antes eran dos
    // banners (S10 contratos, SAG gestiones) que a 0 se veían como dos cajas
    // vacías (Alberto, 2026-09-29).
    APR: {
      modulo: 'centro', icon: 'clipboard-check', moreIsBad: true, fresh: true,
      label: 'Pendientes por aprobar', sub: 'esperan tu revisión',
      href: 'clientes/centro.html',
      count: async () => {
        const [g, c] = await Promise.all(['gestiones', 'contratos'].map(t => window.AprobacionesService.contar(t)));
        return (Number(g) || 0) + (Number(c) || 0);
      },
      // Filas mezcladas, las que más días llevan esperando arriba (primera
      // página de cada cola; la bandeja del Centro trae el resto).
      items: async () => {
        const paginas = await Promise.all(['gestiones', 'contratos'].map(t =>
          window.AprobacionesService.listar(t).then(p => p.docs.map(r => ({ tipo: t, r }))).catch(() => [])));
        const ahora = Date.now();
        return paginas.flat().map(({ tipo, r }) => {
          const f = tipo === 'gestiones' ? (r.fecha_solicitud || r.created_at) : (r.fecha_creacion || r.created_at);
          const ms = f?.toDate ? f.toDate().getTime() : (f ? new Date(f).getTime() : null);
          return {
            id: r.id, col: tipo,
            cliente: r.cliente_nombre || 'Cliente sin nombre',
            referencia: tipo === 'gestiones' ? r.id : (r.contrato_id || r.id),
            clase: tipo === 'gestiones'
              ? (window.GestionesService?.tipoLabel ? GestionesService.tipoLabel(r.tipo) : (r.tipo || 'Gestión'))
              : (r.accion === 'Renovación' ? 'Renovación' : 'Contrato nuevo'),
            dias: ms ? Math.max(0, Math.floor((ahora - ms) / 86400000)) : 0,
            enlace: window.AprobacionesService.enlace(tipo, r),
          };
        }).sort((a, b) => b.dias - a.dias);
      },
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> <span class="bj-id">${esc(r.referencia)}</span> · ${esc(r.clase)}`,
        dias: r.dias,
        cta: r.enlace ? { label: 'Revisar', href: `clientes/centro.html${r.enlace}` } : null,
      }),
      hrefLabel: 'Abrir el Centro →',
      vacio: 'Nada pendiente por aprobar.',
    },
    // Pendiente del plan original ("no contable server-side"): contable desde
    // que la app estampa `requiere_aprobacion` al guardar (auditoría A10).
    SAP: {
      modulo: 'cotizaciones', icon: 'file-check', moreIsBad: true,
      label: 'Cotizaciones por aprobar', sub: 'fuera de política',
      href: 'cotizaciones/index.html?estado=borrador&aprobar=1', // solo requiere_aprobacion (auditoría UX 2026-09-28, P0 #20)
      count: () => SenalesService.countCotizacionesPorAprobar(),
    },
    // Nota: "cotizaciones fuera de umbral por aprobar" NO es contable
    // server-side hoy — requiereAprobacion se calcula al vuelo
    // (CotizacionTotales) y no se persiste en el doc. Si se quiere esa
    // señal, primero hay que estampar el flag al guardar (feature aparte).
    S9: {
      modulo: 'piezas', icon: 'puzzle',
      label: 'Piezas sin stock', sub: 'reponer inventario',
      href: 'inventario/piezas.html?filtro=sin_stock', // aterriza filtrada (auditoría UX 2026-09-28)
      count: () => SenalesService.countPiezasSinStock(),
    },
    // Lotes PoC preparados por ventas que recepción no ha cargado (el
    // traspaso ya viaja dentro del app; auditoría UX 2026-09-28 §4.7 #9).
    LPC: {
      modulo: 'poc', icon: 'inbox',
      label: 'Lotes PoC por cargar', sub: 'preparados por ventas',
      href: 'POC/nuevo-batch.html',
      count: () => SenalesService.countLotesPocPorCargar(),
    },
    // Pool de equipos serializados (PLAN_CICLO_VIDA_EQUIPOS.md, Fase A). Los
    // href aterrizan en la pestaña/filtro EXACTOS de la señal (deep-links).
    S11: {
      modulo: 'equipos', icon: 'warehouse',
      label: 'Equipos en bodega', sub: 'disponibles',
      href: 'almacen/index.html?tab=serial&estado=en_bodega',
      count: () => SenalesService.countEquiposPoolPorEstado('en_bodega'),
    },
    S12: {
      modulo: 'equipos', icon: 'search-check', moreIsBad: true,
      label: 'Equipos por verificar', sub: 'de la migración',
      href: 'almacen/index.html?tab=serial&estado=todos&verificar=1',
      count: () => SenalesService.countEquiposPoolSinVerificar(),
    },
    S13: {
      modulo: 'equipos', icon: 'package-search', moreIsBad: true,
      deuda: true,
      label: 'Devueltos por inspeccionar', sub: 'regresaron de cliente, esperan inspección',
      href: 'almacen/index.html?tab=serial&estado=devuelto_revision',
      count: () => SenalesService.countEquiposPoolPorEstado('devuelto_revision'),
      items: () => SenalesService.listCuarentena(),
      curso: true,
      row: (r, esc) => ({
        txt: `<span class="bj-id">${esc(r.serial)}</span> <b>${esc(r.modelo)}</b>`
          + (r.cliente && r.cliente !== '—' ? ` · venía de ${esc(r.cliente)}` : ''),
        dias: r.dias,
        cta: { label: 'Abrir en el pool', href: 'almacen/index.html?tab=serial&estado=devuelto_revision' },
      }),
      vacio: 'Cuarentena al día: todo lo devuelto ya pasó inspección.',
    },
    S14: {
      modulo: 'equipos', icon: 'map-pin-off', moreIsBad: true,
      deuda: true,
      label: 'Equipos por clasificar', sub: 'ubicación sin contrato ni orden que la respalde',
      href: 'almacen/index.html?tab=serial&estado=por_clasificar',
      count: () => SenalesService.countEquiposPoolPorEstado('por_clasificar'),
    },
    // Bandeja de bodega (Almacén · Hoy): el trabajo que nace en un contrato y
    // que hasta ahora solo llegaba por correo. El gate acepta el módulo nuevo
    // o el viejo para no perder la señal a mitad de la migración.
    S15: {
      modulo: ['almacen', 'pendientes'], icon: 'scan-barcode', alert: true, moreIsBad: true,
      label: 'Seriales por asignar', sub: 'esperan a bodega',
      href: 'almacen/index.html',
      count: () => SenalesService.countSerialesPorAsignar(),
    },
    // ── Regularización de cuentas (plan 2026-09-08) ──
    // La deuda D1–D7 la calcula el job en clientes.regularizacion; aquí solo
    // se lee. El vendedor ve SU cartera; gerencia/admin ven todas (REGG).
    REGV: {
      modulo: 'centro', icon: 'clipboard-list', alert: true, moreIsBad: true,
      deuda: true,
      label: 'Mis cuentas por regularizar', sub: 'operan, pero les faltan seriales o contratos',
      href: 'clientes/centro.html?filtro=regularizacion',
      count: (ctx) => SenalesService.countCuentasPorRegularizar({ uid: ctx.uid }),
      // items() se llama sin ctx: la cartera sale del usuario autenticado.
      items: () => SenalesService.listCuentasPorRegularizar({ uid: firebase.auth().currentUser?.uid || null }),
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> · ${esc(r.nivel_label)} · ${r.puntos} punto${r.puntos === 1 ? '' : 's'}${r.puntuales ? ` · ${r.puntuales} gestión${r.puntuales === 1 ? '' : 'es'} puntual${r.puntuales === 1 ? '' : 'es'}` : ''}`,
        dias: r.dias,
        cta: { label: 'Abrir ficha', href: `clientes/centro.html?id=${encodeURIComponent(r.id)}` },
      }),
      vacio: 'Tu cartera está al día: todas las cuentas tienen sus seriales y contratos.',
    },
    REGG: {
      modulo: 'centro', icon: 'clipboard-list', moreIsBad: true,
      deuda: true,
      label: 'Cuentas por regularizar', sub: 'todas las carteras — las sin vendedor primero',
      href: 'clientes/regularizacion.html',
      count: () => SenalesService.countCuentasPorRegularizar({}),
      items: () => SenalesService.listCuentasPorRegularizar({}),
      row: (r, esc) => ({
        txt: `<b>${esc(r.cliente)}</b> · ${esc(r.nivel_label)} · ${r.puntos} punto${r.puntos === 1 ? '' : 's'} · ${r.vendedor ? esc(r.vendedor) : '<span style="color:var(--cg-bad-deep,#991B1B);">sin vendedor</span>'}${r.excede ? ' · <b>excede el margen</b>' : ''}`,
        dias: r.dias,
        cta: { label: 'Abrir ficha', href: `clientes/centro.html?id=${encodeURIComponent(r.id)}` },
      }),
      vacio: 'Ninguna cuenta con deuda de regularización.',
    },
  };

  // Rol efectivo → señales (hasta 8; la rejilla se ajusta con data-n, ver
  // render). Cada señal pasa ADEMÁS por el gate de
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
    // REGV/REGG (cuentas por regularizar, plan 2026-09-08): el vendedor ve su
    // cartera; admin y gerencia ven todas, con las sin vendedor primero.
    administrador:     ['APR', 'OPC', 'S1', 'EST', 'S4Q', 'SAP', 'REGG', 'LPC'],
    // gerencia también aprueba gestiones (misma regla que el Centro): la señal
    // unificada le trae las dos colas, antes solo veía contratos.
    // S1 (por asignar) solo para quien PUEDE asignar técnico ('asignar-tecnico'
    // en core/roles.js: admin, jefe de taller, recepción). Gerencia y ventas lo
    // veían en rojo sin poder hacer nada con él (repaso del home 2026-09-29).
    gerente:           ['APR', 'SAP', 'FIR', 'REGG'],
    jefe_taller:       ['S1', 'EST', 'S4Q', 'SAP'],
    recepcion:         ['OPC', 'S1', 'S2', 'ENT', 'LPC'],
    vendedor:          ['S7', 'FIRV', 'REGV'],
    // S4P (mis completadas en oficina) salió el 2026-09-29: lo terminado ya
    // no es trabajo del técnico — espera a recepción — y el número solo crecía
    // (26-27 por técnico al medirlo). Sigue en la lista de órdenes (?mias=1).
    tecnico:           ['S5'],
    tecnico_operativo: ['S5'],
    // S14 (por clasificar) entra en lugar de S12 (por verificar): la ubicación
    // desconocida es un atraso accionable, mientras que "por verificar" es una
    // marca blanda — y su entrada bajó al marcar verificadas las ENTRADAs.
    // S12 sigue accesible desde Equipos por serial (filtro "sin verificar").
    // S15 (seriales por asignar) desplaza a S11 (equipos en bodega): S11 es un
    // dato de estado —ya está en los KPI de Inventario— y S15 es una cola con
    // gente esperando. (La fila ya no tiene tope fijo de 4: se ajusta a data-n.)
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
      return data.counts ? data : null;
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
    // Rótulo y (número + contexto) van cada uno en UNA línea que no envuelve
    // — lo que no cabe se recorta por CSS, así que el subtítulo completo va
    // en el title= de la tarjeta y no como tercera línea de texto.
    const abre = typeof sig.items === 'function' || typeof sig.panel === 'function';
    const nueva = _esNueva(sig);
    const titulo = `${sig.label} — ${sig.sub}${nueva ? ` · Nuevo: ${sig.nuevo.nota}` : ''}`;
    return `
<a class="kpi${sig.alert ? ' kpi--alert' : ''}${abre ? ' kpi--abre' : ''}${nueva ? ' kpi--nuevo' : ''} is-loading" href="${sig.href}" data-signal="${id}" title="${titulo.replace(/"/g, '&quot;')}"${abre ? ' aria-expanded="false" role="button"' : ''}>
  <div class="kpi__label"><i data-lucide="${sig.icon}"></i> <span class="kpi__t">${sig.label}</span>${nueva ? '<span class="kpi__nuevo">Nuevo</span>' : ''}${abre ? '<span class="kpi__chev" aria-hidden="true">▾</span>' : ''}</div>
  <div class="kpi__row">
    <div class="kpi__val num" data-signal-val="${id}">—</div>
    <div class="kpi__delta">${sig.sub}</div>
  </div>
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
     correo diario.

     La fila, el panel, la antigüedad y los botones de texto son del kit de
     bandeja (js/ui/bandeja.js + css/bandeja.css, 2026-09-08): antes este
     archivo inyectaba 50 líneas de CSS propio. Semáforo de SEÑAL: ámbar a
     10 días, rojo a 30. Lo específico del posponer (.pend-snz-form) vive
     en ceco-command.css. */

  const MAX_FILAS_PANEL = 40;
  let _panelAbierto = null;   // id de la señal abierta

  /* Pinta el conteo de una señal. `is-cero` apaga la tarjeta cuando no hay
     nada que hacer (número en gris, sin la barra roja de alerta): un cero
     en rojo era la cosa más ruidosa del home y significaba lo contrario.
     El conteo puede llegar como "50+" (scan topado), de ahí el === 0. */
  function _pintaVal(mount, id, n) {
    const tile = mount.querySelector(`[data-signal="${id}"]`);
    const val = mount.querySelector(`[data-signal-val="${id}"]`);
    if (!tile || !val) return;
    tile.classList.remove('is-loading');
    tile.classList.toggle('is-cero', n === 0 || n === '0');
    val.textContent = String(n);
    _sincronizarN(mount);
  }

  // Los ceros comparten una franja compacta. Mover el mismo enlace conserva
  // su panel, destino y eventos; el orden no depende de qué consulta terminó
  // primero. Un error o un conteo todavía cargando sigue en la fila principal.
  function _sincronizarN(mount) {
    const grid = mount.querySelector('.kpis');
    const cero = mount.querySelector('.kpis-zero');
    const items = mount.querySelector('.kpis-zero__items');
    const deuda = mount.querySelector('.kpis-deuda');
    const deudaItems = mount.querySelector('.kpis-deuda__items');
    if (!grid || !cero || !items) return;
    const orden = mount._signalOrder || [];
    for (const id of orden) {
      const tile = mount.querySelector(`[data-signal="${id}"]`);
      if (!tile) continue;
      const destino = tile.classList.contains('is-cero') ? items
        : (SIGNALS[id]?.deuda && deudaItems) ? deudaItems : grid;
      if (tile.parentElement === destino) continue;
      const foco = tile.contains(document.activeElement) ? document.activeElement : null;
      const siguiente = Array.from(destino.children).find(el => orden.indexOf(el.dataset.signal) > orden.indexOf(id));
      destino.insertBefore(tile, siguiente || null);
      if (foco) foco.focus({ preventScroll: true });
    }
    const n = grid.querySelectorAll('.kpi').length;
    grid.setAttribute('data-n', String(n));
    grid.hidden = n === 0;
    cero.hidden = items.children.length === 0;
    if (deuda) deuda.hidden = deudaItems.children.length === 0;
    mount.classList.toggle('signals-all-zero', n === 0 && items.children.length > 0 && !(deudaItems && deudaItems.children.length));
  }

  const _esc = (v) => Bandeja.esc(v);

  function _filaHtml(id, sig, r) {
    const row = sig.row(r, _esc);
    const snz = sig.posponer && !r.pospuesto
      ? Bandeja.btnTexto('posponer', { snz: r.id }, 'Sacarlo del ruido unos días, con motivo — también silencia el correo diario')
      : '';
    // "En curso": el dueño del pendiente es el ROL — tomar avisa, no bloquea,
    // y cualquiera del rol puede soltar (si quien lo tomó no está, el
    // pendiente no se queda secuestrado).
    const cursoTag = r.en_curso
      ? Bandeja.tag(`en curso · ${r.curso_por}${r.curso_dias ? ' · ' + r.curso_dias + 'd' : ''}`, 'info',
          'Alguien del rol ya lo está trabajando — no bloquea: cualquiera puede actuar o soltarlo')
      : '';
    const cursoBtn = r.pospuesto ? '' : (r.en_curso
      ? Bandeja.btnTexto('soltar', { soltar: r.id }, 'Liberarlo — por ejemplo, si quien lo tomó no está')
      : (sig.curso ? Bandeja.btnTexto('tomar', { tomar: r.id }, 'Avisar al resto del rol que lo estás trabajando') : ''));
    const tag = r.pospuesto
      ? Bandeja.tag(`pospuesto → ${r.snooze_hasta}`, 'aviso', r.snooze_motivo) + Bandeja.btnTexto('reactivar', { react: r.id })
      : '';
    return Bandeja.fila({
      txt: row.txt, dias: row.dias, clase: 'senal', off: !!r.pospuesto,
      data: { row: r.id, col: r.col },
      extraHtml: `${tag}${cursoTag}`,
      ctaHtml: `${cursoBtn}${snz}${row.cta && !r.pospuesto ? Bandeja.cta({ href: row.cta.href, label: row.cta.label, plano: true }) : ''}`,
    });
  }

  async function _renderPanel(panel, id, sig) {
    panel.dataset.signalPanel = id;
    if (typeof sig.panel === 'function') {
      const mount = panel.closest('[data-pend-mount]');
      const ctx = mount?._aprobacionesCtx;
      if (!ctx) return;
      await sig.panel(panel, ctx, n => {
        if (mount._aprobacionesCtx === ctx) _pintaVal(mount, id, n);
      });
      return;
    }
    panel.innerHTML = Bandeja.listaVacia('Cargando…');
    let rows;
    try { rows = await sig.items(); }
    catch (e) {
      console.warn('[HomeSignals] filas de', id, 'no disponibles:', e?.code || e);
      if (!panel.isConnected || panel.dataset.signalPanel !== id) return;
      panel.innerHTML = `<p class="bj-lista-vacia">No se pudieron cargar las filas. <a href="${sig.href}">Abrir en su módulo</a></p>`;
      return;
    }
    if (!panel.isConnected || panel.dataset.signalPanel !== id) return;
    // `viejo` (más de orden_stale_max_dias): casi seguro ya salió del taller.
    // Va en su propio grupo al final y no cuenta en la tarjeta.
    const activas = rows.filter(r => !r.pospuesto && !r.viejo);
    const viejas = rows.filter(r => !r.pospuesto && r.viejo);
    const pospuestas = rows.filter(r => r.pospuesto);
    const visibles = activas.slice(0, MAX_FILAS_PANEL);
    const resto = activas.length - visibles.length;

    const hrefPanel = typeof sig.hrefDe === 'function' ? sig.hrefDe(activas) : sig.href;
    panel.innerHTML = Bandeja.panelHead({ titulo: sig.label, n: activas.length, href: hrefPanel, hrefLabel: sig.hrefLabel })
      + (_esNueva(sig) ? `<p class="kpi-nuevo-nota"><b>Nuevo.</b> ${sig.nuevo.nota}</p>` : '')
      + (visibles.length
        ? visibles.map(r => _filaHtml(id, sig, r)).join('')
        : Bandeja.listaVacia(sig.vacio || 'Nada pendiente.'))
      + Bandeja.grupo({
        titulo: `Más de ${viejas[0]?.viejo || 30} días — por depurar`, n: viejas.length,
        filasHtml: viejas.slice(0, MAX_FILAS_PANEL).map(r => _filaHtml(id, sig, r)).join(''),
        notaHtml: viejas.length ? Bandeja.nota('Casi seguro ya no están en el taller: ciérralas o regístralas desde la orden. No suman en el número de la tarjeta.') : '',
      })
      + (pospuestas.length ? pospuestas.map(r => _filaHtml(id, sig, r)).join('') : '')
      + ((resto > 0 || pospuestas.length)
        ? Bandeja.pie(`${resto > 0 ? `…y ${resto} más — ábrelo en su módulo para verlo todo. ` : ''}${pospuestas.length ? `${pospuestas.length} pospuesto${pospuestas.length === 1 ? '' : 's'} (también fuera del correo diario).` : ''}`)
        : '');

    // Posponer inline: un formulario a la vez, debajo de su fila.
    panel.querySelectorAll('[data-snz]').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelector('.pend-snz-form')?.remove();
        const fila = btn.closest('.bj-row');
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
          const fila = btn.closest('.bj-row');
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
            const fila = btn.closest('.bj-row');
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
      if (mount) _pintaVal(mount, id, n);
    } catch (e) { /* el conteo viejo se queda; la caché igual se invalida */ }
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith(CACHE_PREFIX))
        .forEach(k => sessionStorage.removeItem(k));
    } catch (e) { /* sin storage */ }
  }

  function _wireExpansion(mount) {
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
      if (!sig || (typeof sig.items !== 'function' && typeof sig.panel !== 'function')) return; // tile normal: navega
      if (panel && !mount.contains(panel)) panel = null;
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
        panel.className = 'bj-panel';
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
  async function render({ rolEfectivo, uid, user = null, mountId = 'signalsRow' }) {
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

    // data-n = cuántas señales trae el rol: la rejilla se ajusta a ese número
    // en vez de asumir 4 fijas, que dejaba huérfana la quinta de admin y
    // gerencia en una segunda fila (ver .kpis en ceco-command.css).
    mount.style.display = '';
    mount._signalOrder = ids;
    mount.classList.remove('signals-all-zero');
    // Tres zonas (repaso del home 2026-09-29): la cola del día en tarjetas;
    // la DEUDA (`deuda: true` — atrasos de proyecto que no bajan en una
    // semana: regularización, por clasificar, por inspeccionar) en una franja
    // chica que no compite con ella; y lo que está en cero, en UNA línea de
    // texto junto a "Actualizado". Antes todo pesaba igual: 4 botones en 0 y
    // un 128 permanente al lado de "por asignar" enseñaban a no mirar la fila.
    const dia = ids.filter(id => !SIGNALS[id].deuda);
    const deuda = ids.filter(id => SIGNALS[id].deuda);
    mount.innerHTML = `<div class="kpis" data-n="${dia.length}">${dia.map(id => _tileHtml(id, SIGNALS[id])).join('')}</div>
      <div class="kpis-deuda"${deuda.length ? '' : ' hidden'}><span class="kpis-deuda__label">Seguimiento</span>
        <div class="kpis-deuda__items" role="group" aria-label="Atrasos en seguimiento">${deuda.map(id => _tileHtml(id, SIGNALS[id])).join('')}</div></div>
      <div class="kpis-foot">
        <div class="kpis-zero" hidden><span class="kpis-zero__label">Al día:</span>
          <div class="kpis-zero__items" role="group" aria-label="Sin pendientes"></div></div>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    // La expansión se cablea ANTES de resolver los conteos: el camino de la
    // caché hace `return` temprano y sin esto las señales cacheadas no abrían.
    _wireExpansion(mount, ids);
    _wireAprobaciones(mount, { rolEfectivo, uid, user });

    const setVal = (id, n) => _pintaVal(mount, id, n);
    const dropTile = (id) => {
      mount.querySelector(`[data-signal="${id}"]`)?.remove();
      _sincronizarN(mount);
    };

    // Opciones guardadas para recontar al volver (pageshow/visibilidad) o con
    // el botón "Actualizar" sin repintar la fila (auditoría UX 2026-09-28).
    mount._renderOpts = { rolEfectivo, uid, user };

    const cacheHit = _readCache(uid, rolEfectivo);
    const cached = cacheHit && cacheHit.counts;
    if (cached) {
      ids.forEach(id => {
        if (SIGNALS[id].fresh) return;
        // number o string: el conteo por scan reporta "400+" cuando topa.
        if (typeof cached[id] === 'number' || typeof cached[id] === 'string') setVal(id, cached[id]);
        else dropTile(id);
      });
      _applyDeltas(mount, ids, cached, _rotateSnapshot(uid, rolEfectivo, cached));
      _pintaActualizado(mount, cacheHit.t);
      await _refrescarAprobaciones(mount);
      return;
    }

    const counts = {};
    await Promise.all(ids.map(async (id) => {
      try {
        counts[id] = await SIGNALS[id].count({ rolEfectivo, uid, user });
        setVal(id, counts[id]);
      } catch (err) {
        // permiso denegado / índice faltante → fuera la tarjeta, el home sigue.
        console.warn(`[HomeSignals] señal ${id} no disponible:`, err?.code || err);
        // Una aprobación no debe desaparecer ni parecer cero si falta red.
        if (SIGNALS[id].fresh) setVal(id, '—');
        else dropTile(id);
      }
    }));
    _writeCache(uid, rolEfectivo, counts);
    _applyDeltas(mount, ids, counts, _rotateSnapshot(uid, rolEfectivo, counts));
    _pintaActualizado(mount, Date.now());
  }

  /* ── Frescura de los conteos (auditoría UX 2026-09-28, 4.1 #8) ──────────
     Los conteos salen de una caché de 5 min: asignabas una orden, volvías y
     "por asignar" seguía igual. Ahora (1) la fila dice de cuándo es el
     número, con un botón para actualizar, y (2) al volver a la pestaña o
     desde el bfcache se recuenta solo si el número tiene más de un minuto
     (cambiar de pestaña a cada rato no dispara consultas). */
  const RECUENTO_MIN_MS = 60 * 1000;

  function _haceTexto(t) {
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return 'Actualizado hace un momento';
    return `Actualizado hace ${min} min`;
  }

  function _pintaActualizado(mount, t) {
    mount._renderT = t;
    let meta = mount.querySelector('.kpis-meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'kpis-meta';
      meta.innerHTML = '<span class="kpis-meta__t"></span>'
        + '<button type="button" class="kpis-meta__btn" data-signals-refresh title="Volver a contar ahora">'
        + '<i data-lucide="refresh-cw"></i> Actualizar</button>';
      (mount.querySelector('.kpis-foot') || mount).appendChild(meta);
      meta.querySelector('[data-signals-refresh]').addEventListener('click', () => _recontar(mount, true));
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    meta.querySelector('.kpis-meta__t').textContent = _haceTexto(t);
    meta.title = new Date(t).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' });
  }

  // Recuenta las señales que siguen en pantalla SIN repintar la fila (un
  // panel abierto se queda abierto). Lo que falle conserva el número viejo.
  async function _recontar(mount, forzar = false) {
    const o = mount._renderOpts;
    if (!o || mount._recontando) return;
    if (!forzar && mount._renderT && Date.now() - mount._renderT < RECUENTO_MIN_MS) {
      _pintaActualizado(mount, mount._renderT);
      return;
    }
    mount._recontando = true;
    const btn = mount.querySelector('[data-signals-refresh]');
    if (btn) btn.disabled = true;
    try {
      if (window.SenalesService?.invalidarListas) SenalesService.invalidarListas();
      const previos = (_readCache(o.uid, o.rolEfectivo) || {}).counts || {};
      const counts = { ...previos };
      // Las `fresh` (aprobaciones, órdenes por crear) las recuenta
      // _refrescarAprobaciones: aquí solo con el botón, para no pagarlas dos veces.
      const ids = (mount._signalOrder || [])
        .filter(id => mount.querySelector(`[data-signal="${id}"]`) && !SIGNALS[id].fresh);
      if (forzar) _refrescarAprobaciones(mount);
      await Promise.all(ids.map(async (id) => {
        try {
          const n = await SIGNALS[id].count(o);
          if (mount._renderOpts !== o) return;
          counts[id] = n;
          _pintaVal(mount, id, n);
        } catch (e) { /* se queda el número anterior */ }
      }));
      if (mount._renderOpts !== o) return;
      _writeCache(o.uid, o.rolEfectivo, counts);
      _pintaActualizado(mount, Date.now());
    } finally {
      mount._recontando = false;
      if (btn) btn.disabled = false;
    }
  }

  // Aprobar en otra página/pestaña y volver (incluido bfcache) debe cambiar
  // el número, sin volver a ejecutar las consultas del resto del dashboard.
  async function _refrescarAprobaciones(mount) {
    const ctx = mount._aprobacionesCtx;
    if (!ctx) return;
    await Promise.all(Object.entries(SIGNALS).filter(([, sig]) => sig.fresh).map(async ([id, sig]) => {
      if (!mount.querySelector(`[data-signal="${id}"]`)) return;
      try {
        const n = await sig.count(ctx);
        if (mount._aprobacionesCtx === ctx) _pintaVal(mount, id, n);
      } catch (e) {
        if (mount._aprobacionesCtx !== ctx) return;
        const tile = mount.querySelector(`[data-signal="${id}"]`);
        if (tile) {
          _pintaVal(mount, id, '—');
          tile.title = 'No se pudo consultar. Abre el Centro de gestión para reintentar.';
        }
      }
    }));
  }

  function _wireAprobaciones(mount, ctx) {
    mount._aprobacionesCtx = ctx;
    if (mount._aprobacionesWired) return;
    mount._aprobacionesWired = true;
    // Además de las aprobaciones (siempre frescas), el resto se recuenta si
    // el número ya tiene más de un minuto (ver _recontar).
    window.addEventListener('pageshow', e => {
      if (e.persisted) { _refrescarAprobaciones(mount); _recontar(mount); }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { _refrescarAprobaciones(mount); _recontar(mount); }
    });
  }

  return { render, SIGNALS, POR_ROL };
})();
