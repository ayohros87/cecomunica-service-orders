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
  return data.sort((a, b) => {
    let valorA = APP.state.sortField === "ordenId" ? a.ordenId : a[APP.state.sortField] || '';
    let valorB = APP.state.sortField === "ordenId" ? b.ordenId : b[APP.state.sortField] || '';

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

function _detenerSnapshotInicial() {
  if (typeof _firstPageUnsubscribe === 'function') {
    try { _firstPageUnsubscribe(); } catch (e) { console.warn("unsubscribe failed", e); }
  }
  _firstPageUnsubscribe = null;
}

function _iniciarSnapshotInicial() {
  _detenerSnapshotInicial();

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

  _firstPageUnsubscribe = OrdenesService.subscribeFirstPage({
    userRole: APP.state.userRole,
    userId: uid,
    limit: CONFIG.pageLimit(APP.state.userRole),
    onUpdate: ({ orders, lastSnapshot, fromCache }) => {
      // Merge: live orders replace anything with the same ordenId in
      // the cached state; paginated entries past the live cursor are
      // preserved (they're a snapshot from a previous "Cargar más").
      const liveIds = new Set(orders.map(o => o.ordenId));
      const paginatedKept = (APP.state.orders || []).filter(o => !liveIds.has(o.ordenId));
      APP.state.orders = [...orders, ...paginatedKept];
      APP.state.lastVisible = lastSnapshot;

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

      if (orders.length === 0 && paginatedKept.length === 0) {
        btnCargarMas.style.display = "none";
      } else {
        btnCargarMas.style.display = "block";
      }

      if (typeof aplicarFiltrosCombinados === 'function') {
        aplicarFiltrosCombinados();
      }
    },
    onError: (err) => {
      console.error("❌ Snapshot error:", err);
      renderEmptyState("Error al cargar datos", {
        icon: 'alert-triangle',
        sublabel: 'Por favor, recarga la página.'
      });
    }
  });

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
      limit: CONFIG.pageLimit(APP.state.userRole)
    });

    if (orders.length === 0) {
      document.getElementById("btnCargarMas").style.display = "none";
      return;
    }

    APP.state.lastVisible = lastSnapshot;
    const nuevasOrdenes = orders;
    APP.state.orders.push(...nuevasOrdenes);

    const filters = getActiveFilters();
    const filteredNuevas = hasActiveFilters(filters)
      ? applyActiveFiltersToOrders(nuevasOrdenes, filters)
      : nuevasOrdenes;

    const totalVisible = hasActiveFilters(filters)
      ? applyActiveFiltersToOrders(APP.state.orders, filters).length
      : APP.state.orders.length;

    document.getElementById("btnCargarMas").innerHTML = `<i data-lucide="chevron-down"></i> Cargar más órdenes (${totalVisible})`;

    ordenarOrdenes(filteredNuevas).forEach(o => {
      const equipos = (o.equipos || [])
        .filter(e => !e.eliminado)
        .sort((a, b) =>
          String(a.numero_de_serie || '').localeCompare(String(b.numero_de_serie || ''))
        );
      renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
      aplicarRestriccionesPorRol(APP.state.userRole);
    });
    APP.utils.lucideRefresh([
      ordersTable,
      document.getElementById("ordersCards"),
      document.getElementById("btnCargarMas")
    ]);

  } catch (error) {
    console.error("❌ Error al cargar órdenes:", error);
    renderEmptyState("Error al cargar datos", { icon: 'alert-triangle', sublabel: 'Por favor, recarga la página.' });
  }
  const filters = getActiveFilters();
  actualizarResumen(hasActiveFilters(filters) ? applyActiveFiltersToOrders(APP.state.orders, filters) : APP.state.orders);
};
