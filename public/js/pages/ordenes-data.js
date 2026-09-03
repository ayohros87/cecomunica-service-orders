// @ts-nocheck
/* ========================================
 * ORDENES DATA - Firestore reads
 * Loads clientes, tipos de servicio, técnicos, and the paginated
 * orders list. Mutates APP.state.* only — no DOM rendering here
 * (rendering lives in ordenes-render.js, filter UI in ordenes-filters.js).
 * ======================================== */

async function cargarTiposDeServicioFiltros() {
  const desktopSel = document.getElementById("filtroTipo");
  const mobileSel = document.getElementById("mobileFiltroTipo");
  if (!desktopSel && !mobileSel) return;

  const applyOptions = (opts = []) => {
    // DEVOLUCIÓN es un tipo auto-creado (renovación/anulación/baja) y por eso
    // no vive en el config tipo_de_servicio (no debe ofrecerse al crear una
    // orden); en el filtro sí hace falta para poder buscar esos tiquetes.
    if (!opts.some(n => normTxt(n) === "devolucion")) {
      opts = [...opts, "DEVOLUCIÓN"];
    }
    const fill = (sel) => {
      if (!sel) return;
      sel.innerHTML = '<option value="">Tipo (todos)</option>';
      opts.forEach(nombre => {
        const option = document.createElement("option");
        option.value = nombre;
        option.textContent = nombre;
        sel.appendChild(option);
      });
    };
    fill(desktopSel);
    fill(mobileSel);
  };

  try {
    const doc = await EmpresaService.getDoc("tipo_de_servicio");
    if (doc) {
      applyOptions(doc.list || []);
      return;
    }
  } catch (e) {
    console.warn("No se pudieron cargar tipos de servicio:", e);
  }

  applyOptions(["PROGRAMACIÓN", "VISITA TÉCNICA", "ENTRADA", "OTRO"]);
}

async function cargarTecnicosFiltros() {
  const desktopSel = document.getElementById("filtroTecnico");
  const mobileSel = document.getElementById("mobileFiltroTecnico");
  if (!desktopSel && !mobileSel) return;

  const applyOptions = (opts = []) => {
    const fill = (sel) => {
      if (!sel) return;
      sel.innerHTML = '<option value="">Técnico (todos)</option>';
      opts.forEach(nombre => {
        const option = document.createElement("option");
        option.value = nombre;
        option.textContent = nombre;
        sel.appendChild(option);
      });
    };
    fill(desktopSel);
    fill(mobileSel);
  };

  try {
    const tecnicos = await OrdenesService.loadTechnicians();
    const nombres = tecnicos
      .map(t => (t.nombre || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    applyOptions(nombres);
    return;
  } catch (e) {
    console.warn("No se pudieron cargar técnicos:", e);
  }

  const fromOrders = Array.from(
    new Set((APP.state.orders || []).map(o => (o.tecnico_asignado || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  applyOptions(fromOrders);
}

window.ordenarOrdenes = function (data) {
  // Timestamps de Firestore → ISO string: comparan bien entre sí y con las
  // fechas guardadas como texto ("YYYY-MM-DD"), cosa que el objeto Timestamp
  // no hace. Necesario para ordenar por fecha desde las cabeceras (P2).
  const valorDe = (o, field) => {
    if (field === "ordenId") return o.ordenId;
    const v = o[field];
    if (v && typeof v.toDate === "function") return v.toDate().toISOString();
    return v || '';
  };
  return data.sort((a, b) => {
    let valorA = valorDe(a, APP.state.sortField);
    let valorB = valorDe(b, APP.state.sortField);

    const esNumero = !isNaN(valorA) && !isNaN(valorB);
    if (esNumero) {
      valorA = Number(valorA);
      valorB = Number(valorB);
    } else {
      valorA = valorA.toString().toLowerCase();
      valorB = valorB.toString().toLowerCase();
    }

    if (valorA < valorB) return APP.state.sortAscending ? -1 : 1;
    if (valorA > valorB) return APP.state.sortAscending ? 1 : -1;
    return 0;
  });
};

// ── Snapshot subscription for the first page ────────────────────────
// Live updates replace the previous one-shot read + setTimeout(1000)
// reload pattern that waited on CF triggers to settle.
// ORDENES_INDEX_IMPROVEMENTS.md §3.1.
//
// Older orders (past the first page, loaded via "Cargar más") are not
// live — they're a static snapshot at the time of pagination. Active
// workflow happens on recent orders which live in the first page.
let _firstPageUnsubscribe = null;

// Watchdog for the "página pensando" report (F1). Firestore connectivity
// intermittency can leave the first snapshot pending forever: neither
// onUpdate nor onError fires, so the skeleton spins indefinitely. If no
// real data lands within this window we swap the skeleton for a friendly
// error + "Reintentar". The listener stays attached, so if data arrives
// late it self-heals by painting over the error.
let _firstPageWatchdog = null;
const FIRST_PAGE_TIMEOUT_MS = 15000;

function _limpiarWatchdogInicial() {
  if (_firstPageWatchdog) { clearTimeout(_firstPageWatchdog); _firstPageWatchdog = null; }
}

function _reintentarCargaInicial() {
  if (typeof renderSkeletonRows === 'function') renderSkeletonRows(8);
  _iniciarSnapshotInicial();
}

function _detenerSnapshotInicial() {
  if (typeof _firstPageUnsubscribe === 'function') {
    try { _firstPageUnsubscribe(); } catch (e) { console.warn("unsubscribe failed", e); }
  }
  _firstPageUnsubscribe = null;
  _limpiarWatchdogInicial();
}

// ── El cursor de paginación no se rebobina ────────────────────────────────
// Reporte (2026-08-28): "al ver las órdenes por tipo DEVOLUCIÓN me aparecen
// órdenes repetidas". El filtro por tipo tamiza en el navegador lo ya cargado,
// así que la lista queda corta, el botón "Cargar más" se ve y el
// IntersectionObserver pagina sin parar. Mientras tanto el listener vivo
// reescribía APP.state.lastVisible con CADA snapshot — cualquier escritura
// remota devolvía el cursor al final de la PRIMERA página aunque ya se hubiera
// paginado hasta la quinta, y el siguiente "Cargar más" volvía a traer una
// página ya cargada. Desde el primer "Cargar más", el cursor es de la
// paginación y el snapshot vivo ya no lo toca.
let _yaSePagino = false;

function _iniciarSnapshotInicial() {
  _detenerSnapshotInicial();
  _yaSePagino = false;

  const btnCargarMas = APP.utils.mustGetEl("btnCargarMas");

  // Reset paginated state — the live listener owns the first page now.
  // NOTE: we intentionally do NOT clear #ordersTable here. The skeleton
  // rows (or previously-rendered rows) stay on screen until the first
  // snapshot replaces them in a single synchronous render, so there's no
  // blank flash between "skeleton gone" and "data in". The flicker fix —
  // the listener's onUpdate is what owns the swap.
  APP.state.orders = [];
  APP.state.lastVisible = null;
  // Gate pagination until the live first page renders — see triggerLoadMore
  // in ordenes-index.js. Without this, auto-load appends page 1 below the
  // skeleton before the snapshot lands.
  APP.state.firstPageReady = false;
  btnCargarMas.innerHTML = '<i data-lucide="chevron-down"></i> Cargar más órdenes (0)';
  btnCargarMas.disabled = false;
  btnCargarMas.style.display = "block";

  const uid = APP.state.userId || firebase.auth().currentUser?.uid || null;

  // Tracks whether we've painted real data yet, so the very first empty
  // cache snapshot doesn't flash an empty state before the server replies.
  let _liveRendered = false;
  // Coalescer de renders (auditoría órdenes P0): tras el primer pintado,
  // cada escritura remota en la primera página (un colega guardando, una
  // Cloud Function estampando) disparaba un re-render COMPLETO (~10k
  // nodos). Los updates subsecuentes se agrupan en 150 ms: una ráfaga de
  // triggers = un solo repintado.
  let _primerPintado = false;
  let _coalesceTimer = null;

  _firstPageUnsubscribe = OrdenesService.subscribeFirstPage({
    userRole: APP.state.userRole,
    userId: uid,
    // El técnico con "Mis órdenes" activo consulta SUS órdenes al servidor
    // (P1.10); el toggle re-suscribe (ver ordenes-index).
    soloMias: !!document.getElementById('toggleMisOrdenes')?.checked,
    limit: CONFIG.pageLimit(APP.state.userRole),
    onUpdate: ({ orders, lastSnapshot, fromCache }) => {
      // Merge: live orders replace anything with the same ordenId in
      // the cached state; paginated entries past the live cursor are
      // preserved (they're a snapshot from a previous "Cargar más").
      const liveIds = new Set(orders.map(o => o.ordenId));
      const paginatedKept = (APP.state.orders || []).filter(o => !liveIds.has(o.ordenId));
      APP.state.orders = [...orders, ...paginatedKept];
      // Base de los conteos de chips/KPIs: SIEMPRE el dataset sin filtrar.
      // filtrarPorEstado reemplaza APP.state.orders con el subset de un solo
      // estado; sin esta base congelada, los demás chips caían a 0 tras
      // filtrar ("Por asignar: 0" siendo falso).
      APP.state.chipBase = APP.state.orders;
      // El cursor solo lo mueve el snapshot mientras la bandeja siga siendo la
      // primera página. Tras el primer "Cargar más" mandan las páginas
      // paginadas: rebobinar aquí traía dos veces la misma página (ver la nota
      // de _yaSePagino).
      if (!_yaSePagino) APP.state.lastVisible = lastSnapshot;

      // Hold the skeleton on the first snapshot if it's an empty result
      // served from the local cache — the server response lands a moment
      // later with the real data (or a genuine empty state). Without this
      // the list would flash empty and then immediately repopulate.
      if (!_liveRendered && fromCache && orders.length === 0 && paginatedKept.length === 0) {
        return;
      }
      _liveRendered = true;
      // First real page is in — pagination/auto-load may run from here.
      APP.state.firstPageReady = true;

      // Con un resultado de servidor en pantalla (búsqueda o chip de estado)
      // el botón se queda escondido: volver a mostrarlo despertaba el
      // IntersectionObserver y la bandeja paginaba órdenes recientes debajo
      // del hallazgo. Ver el "modo servidor" en ordenes-filters.js.
      if (!APP.state.busquedaServidor) {
        if (orders.length === 0 && paginatedKept.length === 0) {
          btnCargarMas.style.display = "none";
        } else {
          btnCargarMas.style.display = "block";
        }
      }

      // El watchdog se desarma DESPUÉS de pintar, no al llegar los datos
      // (reporte jefa de taller 2026-08-19: "Ver órdenes" se quedaba cargando
      // para siempre). Antes se limpiaba arriba y el pintado ocurría después,
      // sin try/catch, dentro del callback de onSnapshot: cualquier excepción
      // en el render se perdía dentro del SDK, onError no se disparaba, el
      // watchdog ya no existía y el esqueleto se quedaba en pantalla eterno.
      // Ahora la red de seguridad sigue armada hasta que hay filas de verdad.
      try {
        if (typeof aplicarFiltrosCombinados !== 'function') {
          // Falla RUIDOSA a propósito: si ordenes-filters.js no cargó (404,
          // caché parcial, error previo) antes no pasaba nada de nada — ni
          // render ni error. Un esqueleto para siempre, sin rastro en consola.
          throw new Error('aplicarFiltrosCombinados no está definida (¿ordenes-filters.js no cargó?)');
        }
        if (!_primerPintado) {
          _primerPintado = true;      // el primer pintado sale INMEDIATO
          aplicarFiltrosCombinados();
        } else {
          clearTimeout(_coalesceTimer);
          _coalesceTimer = setTimeout(() => {
            try { aplicarFiltrosCombinados(); }
            catch (e) { console.error('❌ Error repintando órdenes:', e); }
          }, 150);
        }
        // Pintado OK: recién ahora se puede bajar la guardia.
        _limpiarWatchdogInicial();
      } catch (e) {
        console.error('❌ Error pintando las órdenes:', e);
        _limpiarWatchdogInicial();
        _primerPintado = false;   // permite reintentar el primer pintado
        if (typeof renderEmptyState === 'function') {
          renderEmptyState('No se pudieron mostrar las órdenes', {
            icon: 'alert-triangle',
            sublabel: 'Los datos llegaron pero falló el dibujado de la lista. Vuelve a intentar; si sigue igual, recarga la página.',
            retryLabel: 'Reintentar',
            onRetry: _reintentarCargaInicial
          });
        }
      }
    },
    onError: (err) => {
      console.error("❌ Snapshot error:", err);
      _limpiarWatchdogInicial();
      // Mensajes por causa: "revisa tu conexión" mandaba a la persona a mirar
      // el wifi cuando el problema era un índice compuesto sin desplegar o un
      // permiso. Reintentar no arregla ninguno de esos dos.
      const code = String(err?.code || '');
      let titulo = 'Error al cargar datos';
      let sub = 'Revisa tu conexión e intenta de nuevo.';
      if (code.includes('failed-precondition')) {
        titulo = 'Falta un índice de la base de datos';
        sub = 'La consulta de órdenes necesita un índice que no está desplegado. Avisa a soporte — reintentar no lo resuelve.';
      } else if (code.includes('permission-denied')) {
        titulo = 'Sin permiso para ver las órdenes';
        sub = 'Tu usuario no tiene acceso a esta lista. Avisa a soporte para revisar tu rol.';
      }
      renderEmptyState(titulo, {
        icon: 'alert-triangle',
        sublabel: sub,
        retryLabel: 'Reintentar',
        onRetry: _reintentarCargaInicial
      });
    }
  });

  // Arm the watchdog now that the listener is attached. Cleared on the first
  // real render (onUpdate) or on error; if it fires first, it means the
  // snapshot is stuck — show the retry state instead of an endless skeleton.
  _limpiarWatchdogInicial();
  _firstPageWatchdog = setTimeout(() => {
    _firstPageWatchdog = null;
    if (typeof renderEmptyState === 'function') {
      renderEmptyState("La carga está tardando más de lo normal", {
        icon: 'wifi-off',
        sublabel: 'Puede ser una intermitencia de conexión. Vuelve a intentar.',
        retryLabel: 'Reintentar',
        onRetry: _reintentarCargaInicial
      });
    }
  }, FIRST_PAGE_TIMEOUT_MS);

  // Stop the listener when the tab is hidden permanently (closed/refresh).
  // BFCache restore on Safari/Firefox keeps the listener alive; pageshow
  // handler in ordenes-index.js handles re-establishing if needed.
  window.addEventListener('pagehide', _detenerSnapshotInicial, { once: true });
}

window._iniciarSnapshotInicial = _iniciarSnapshotInicial;
window._detenerSnapshotInicial = _detenerSnapshotInicial;

window.cargarOrdenesYEquipos = async function (esCargaInicial = true) {
  // Initial load: hand off to the live subscription. Subsequent calls
  // (esCargaInicial=false) are pagination — one-shot reads past the
  // cursor.
  if (esCargaInicial) {
    _iniciarSnapshotInicial();
    return;
  }

  const ordersTable = APP.utils.mustGetEl("ordersTable");

  try {
    const uid = APP.state.userId || firebase.auth().currentUser?.uid || null;
    const { orders, lastSnapshot } = await OrdenesService.loadOrders({
      lastSnapshot: APP.state.lastVisible,
      userRole: APP.state.userRole,
      userId: uid,
      soloMias: !!document.getElementById('toggleMisOrdenes')?.checked,
      limit: CONFIG.pageLimit(APP.state.userRole)
    });

    // A partir de aquí el cursor es de la paginación: ni un snapshot vivo lo
    // rebobina (ver _yaSePagino). Se marca aunque la página venga vacía —
    // significa que ya no hay nada más viejo que traer.
    _yaSePagino = true;

    if (orders.length === 0) {
      document.getElementById("btnCargarMas").style.display = "none";
      return;
    }

    APP.state.lastVisible = lastSnapshot;
    // Segundo candado contra las órdenes repetidas: la página se descarta
    // contra lo que YA está cargado. Aunque una consulta vuelva a traer algo
    // conocido (un cursor rebobinado, una orden que se movió entre páginas al
    // crearse otra encima), no se pinta dos veces.
    const yaCargadas = new Set((APP.state.orders || []).map(o => o.ordenId));
    const nuevasOrdenes = orders.filter(o => !yaCargadas.has(o.ordenId));
    APP.state.orders.push(...nuevasOrdenes);
    APP.state.chipBase = APP.state.orders;
    // Si la página entera ya estaba en pantalla, `nuevasOrdenes` queda vacía:
    // no se añade ninguna fila, pero el cursor ya avanzó y el siguiente
    // "Cargar más" mira más atrás.

    const filters = getActiveFilters();
    const filteredNuevas = hasActiveFilters(filters)
      ? applyActiveFiltersToOrders(nuevasOrdenes, filters)
      : nuevasOrdenes;

    const totalVisible = hasActiveFilters(filters)
      ? applyActiveFiltersToOrders(APP.state.orders, filters).length
      : APP.state.orders.length;

    document.getElementById("btnCargarMas").innerHTML = `<i data-lucide="chevron-down"></i> Cargar más órdenes (${totalVisible})`;

    // Estas filas se AÑADEN a mano, fuera de renderOrdersList: su firma de
    // pintado queda obsoleta y el próximo repintado debe ejecutarse de verdad.
    if (typeof invalidarFirmaLista === 'function') invalidarFirmaLista();

    ordenarOrdenes(filteredNuevas).forEach(o => {
      const equipos = (o.equipos || [])
        .filter(e => !e.eliminado)
        .sort((a, b) =>
          String(a.numero_de_serie || '').localeCompare(String(b.numero_de_serie || ''))
        );
      renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
    });
    // Una sola pasada de restricciones por página (antes corría DENTRO del
    // forEach: 50 barridos de DOM por cada "Cargar más").
    aplicarRestriccionesPorRol(APP.state.userRole);
    APP.utils.lucideRefresh([
      ordersTable,
      document.getElementById("ordersCards"),
      document.getElementById("btnCargarMas")
    ]);
    if (typeof marcarClientesTruncados === 'function') {
      marcarClientesTruncados([ordersTable, document.getElementById("ordersCards")]);
    }

  } catch (error) {
    console.error("❌ Error al cargar órdenes:", error);
    renderEmptyState("Error al cargar datos", { icon: 'alert-triangle', sublabel: 'Por favor, recarga la página.' });
  }
  const filters = getActiveFilters();
  actualizarResumen(hasActiveFilters(filters) ? applyActiveFiltersToOrders(APP.state.orders, filters) : APP.state.orders);
};
