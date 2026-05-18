// @ts-nocheck
/* ========================================
 * ORDENES FILTERS - Filter logic + UI bindings
 * All filter state lives in the DOM (filtro* inputs); these helpers
 * read it, normalize it (via normTxt from ordenes-state.js), match
 * orders, and re-render via ordenes-render.js.
 * ======================================== */

function setFechaEntregaVisible(visible) {
  const body = document.body;
  if (!body) return;
  body.classList.toggle("hide-fecha-entrega", !visible);

  document.querySelectorAll(".toggle-fecha-entrega-btn").forEach(btn => {
    btn.textContent = visible ? "Ocultar fecha entrega" : "Mostrar fecha entrega";
  });
}

function aplicarRestriccionesPorRol(rol) {
  const normalizedRole = String(rol || "").trim().toLowerCase();
  const btnNuevaOrden = document.querySelector("button[data-action='go-nueva-orden']");
  const btnConfig = document.querySelector("button[data-action='go-config']");
  const btnProgreso = document.getElementById("btnProgresoTecnicos");
  const btnAdminEquiposCliente = document.getElementById("btnAdminEquiposCliente");
  const mobileBtnAdminEquiposCliente = document.getElementById("mobileBtnAdminEquiposCliente");
  const topbarBtnAdminEquiposCliente = document.getElementById("topbarBtnAdminEquiposCliente");

  if ([ROLES.VENDEDOR, ROLES.VISTA].includes(normalizedRole)) {
    if (btnNuevaOrden) btnNuevaOrden.remove();
    if (btnConfig) btnConfig.remove();
  }

  if (normalizedRole !== ROLES.ADMIN && normalizedRole !== ROLES.RECEPCION) {
    document.querySelectorAll(".btn-agregar-equipo").forEach(b => b.style.display = "none");
  }

  if (btnProgreso) {
    if ([ROLES.ADMIN, ROLES.TECNICO, ROLES.TECNICO_OPERATIVO].includes(normalizedRole)) {
      btnProgreso.style.display = "inline-block";
    } else {
      btnProgreso.style.display = "none";
    }
  }

  const isAdmin = normalizedRole === ROLES.ADMIN;
  if (btnAdminEquiposCliente) {
    btnAdminEquiposCliente.style.display = isAdmin ? "inline-flex" : "none";
  }
  if (mobileBtnAdminEquiposCliente) {
    mobileBtnAdminEquiposCliente.style.display = isAdmin ? "inline-flex" : "none";
  }
  if (topbarBtnAdminEquiposCliente) {
    topbarBtnAdminEquiposCliente.style.display = isAdmin ? "flex" : "none";
  }
}
window.aplicarRestriccionesPorRol = aplicarRestriccionesPorRol;

function getActiveFilters() {
  const filtroOrden = normTxt(document.getElementById("filtroOrden")?.value || "");
  const filtroCliente = normTxt(document.getElementById("filtroCliente")?.value || "");
  const filtroSerial = normTxt(document.getElementById("filtroSerial")?.value || "");
  const filtroTipo = normTxt(document.getElementById("filtroTipo")?.value || "");
  const filtroEstado = (document.getElementById("filtroEstado")?.value || "").toString().trim().toUpperCase();
  const filtroTecnico = normTxt(document.getElementById("filtroTecnico")?.value || "");
  const soloMias = !!document.getElementById("toggleMisOrdenes")?.checked;

  return { filtroOrden, filtroCliente, filtroSerial, filtroTipo, filtroEstado, filtroTecnico, soloMias };
}

function hasActiveFilters(filters) {
  return !!(
    filters.filtroOrden ||
    filters.filtroCliente ||
    filters.filtroSerial ||
    filters.filtroTipo ||
    filters.filtroEstado ||
    filters.filtroTecnico ||
    filters.soloMias
  );
}

function esOrdenMia(order) {
  const uid = APP.state.userId;
  if (!uid) return false;
  return order?.tecnico_uid === uid || order?.vendedor_asignado === uid;
}

function matchesAdvancedFilters(order, filters) {
  const ordenId = normTxt(order.ordenId || "");
  const cliente = normTxt(nombreClienteDe(order));
  const tipo = normTxt(order.tipo_de_servicio || "");
  const tecnico = normTxt(order.tecnico_asignado || "");
  const estado = (order.estado_reparacion || "POR ASIGNAR").toString().trim().toUpperCase();

  if (filters.filtroOrden && !ordenId.includes(filters.filtroOrden)) return false;
  if (filters.filtroCliente && !cliente.includes(filters.filtroCliente)) return false;
  if (filters.filtroTipo && !tipo.includes(filters.filtroTipo)) return false;
  if (filters.filtroTecnico && !tecnico.includes(filters.filtroTecnico)) return false;

  if (filters.filtroSerial) {
    const serialMatch = (order.equipos || [])
      .filter(e => !e.eliminado)
      .some(e => normTxt(e.numero_de_serie || "").includes(filters.filtroSerial));
    if (!serialMatch) return false;
  }

  if (filters.filtroEstado && estado !== filters.filtroEstado) return false;
  if (filters.soloMias && !esOrdenMia(order)) return false;

  return true;
}

function applyActiveFiltersToOrders(list, filters) {
  return (list || []).filter(o => matchesAdvancedFilters(o, filters));
}

function renderOrdersList(list) {
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");

  // Preserve expanded-row state across re-renders. Without this, a
  // snapshot update on any order in the list would collapse every
  // currently-expanded row — annoying during active workflow when
  // staff have one open mid-task. ORDENES_INDEX_IMPROVEMENTS.md §3.1.
  const expandedIds = ordersTable
    ? new Set(
        Array.from(ordersTable.querySelectorAll('tr.activo[data-orden-id]'))
          .map(tr => tr.dataset.ordenId)
          .filter(Boolean)
      )
    : new Set();

  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  if (!list || list.length === 0) {
    renderEmptyState("No se encontraron coincidencias", {
      icon: 'search-x',
      sublabel: 'Probá ajustar los filtros o limpiar la búsqueda.'
    });
    actualizarResumen([]);
    return;
  }

  ordenarOrdenes(list).forEach(o => {
    const equipos = (o.equipos || [])
      .filter(e => !e.eliminado)
      .sort((a, b) => String(a.numero_de_serie || "").localeCompare(String(b.numero_de_serie || "")));
    renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
  });

  // Re-expand rows that were open before the re-render.
  if (expandedIds.size && ordersTable) {
    for (const ordenId of expandedIds) {
      const row = ordersTable.querySelector(`tr[data-orden-id="${ordenId}"]`);
      if (row && !row.classList.contains('activo') && typeof _toggleOrdenRow === 'function') {
        _toggleOrdenRow(row);
      }
    }
  }

  actualizarResumen(list);
  aplicarRestriccionesPorRol(APP.state.userRole);
  APP.utils.lucideRefresh([ordersTable, cardsWrap]);
}

function aplicarFiltrosCombinados() {
  const filters = getActiveFilters();
  const filtered = hasActiveFilters(filters)
    ? applyActiveFiltersToOrders(APP.state.orders, filters)
    : APP.state.orders;

  const btn = document.getElementById("btnCargarMas");
  if (btn) btn.innerHTML = `<i data-lucide="chevron-down"></i> Cargar más órdenes (${filtered.length})`;

  renderOrdersList(filtered);
  _syncFiltersToURL();
}

// ── URL filter state ──────────────────────────────────────────────
// Encodes the current filter + sort state into the page URL so:
//   - refresh preserves filters
//   - copy-paste-link to a colleague reproduces the same view
//   - back/forward navigates filter history
// ORDENES_INDEX_IMPROVEMENTS.md §5.4.
//
// Param keys are short to keep URLs scannable; mapping documented
// inline below.
const _URL_FILTER_KEYS = {
  // url-key  →  DOM element id (advanced/persistent filters only;
  // the quick-search input is ephemeral and intentionally not
  // serialized).
  orden:   'filtroOrden',
  cliente: 'filtroCliente',
  serial:  'filtroSerial',
  tipo:    'filtroTipo',
  estado:  'filtroEstado',
  tecnico: 'filtroTecnico',
  // booleans + sort live below
};

function _syncFiltersToURL() {
  if (typeof history?.replaceState !== 'function') return;
  const params = new URLSearchParams();
  for (const [key, id] of Object.entries(_URL_FILTER_KEYS)) {
    const el = document.getElementById(id);
    const val = (el?.value ?? '').toString().trim();
    if (val) params.set(key, val);
  }
  if (document.getElementById('toggleMisOrdenes')?.checked) params.set('mias', '1');
  const sortField = APP.state.sortField;
  if (sortField && sortField !== 'ordenId') params.set('sort', sortField);
  if (APP.state.sortAscending) params.set('asc', '1');

  const qs = params.toString();
  const newUrl = qs
    ? `${location.pathname}?${qs}${location.hash}`
    : `${location.pathname}${location.hash}`;
  // Skip if nothing changed — avoids cluttering history with no-ops.
  if (newUrl === location.pathname + location.search + location.hash) return;
  history.replaceState(null, '', newUrl);
}

function _applyURLToFilters() {
  if (typeof URLSearchParams !== 'function') return false;
  const params = new URLSearchParams(location.search);
  if (params.toString() === '') return false;

  let touched = false;
  for (const [key, id] of Object.entries(_URL_FILTER_KEYS)) {
    if (!params.has(key)) continue;
    const el = document.getElementById(id);
    if (el) { el.value = params.get(key); touched = true; }
  }
  if (params.get('mias') === '1') {
    const t = document.getElementById('toggleMisOrdenes');
    if (t) { t.checked = true; touched = true; }
    const m = document.getElementById('mobileSoloMias');
    if (m) m.checked = true;
  }
  if (params.has('sort')) {
    APP.state.sortField = params.get('sort');
    const sel = document.getElementById('campoOrdenamiento');
    if (sel) sel.value = APP.state.sortField;
    const mob = document.getElementById('mobileSortField');
    if (mob) mob.value = APP.state.sortField;
    touched = true;
  }
  APP.state.sortAscending = params.get('asc') === '1';

  // Mirror desktop search fields to the mobile filter drawer so both
  // stay in sync if the user opens it.
  const mirror = (srcId, dstId) => {
    const src = document.getElementById(srcId);
    const dst = document.getElementById(dstId);
    if (src && dst) dst.value = src.value;
  };
  mirror('filtroOrden',   'mobileFiltroOrden');
  mirror('filtroCliente', 'mobileFiltroCliente');
  mirror('filtroSerial',  'mobileFiltroSerial');
  mirror('filtroTipo',    'mobileFiltroTipo');
  mirror('filtroTecnico', 'mobileFiltroTecnico');

  return touched;
}

// Expose so ordenes-index.js can call before the initial data load.
// Function declarations at script top level alias `window._applyURLToFilters`
// to the same binding, so we must capture the original reference before
// re-assigning — otherwise the wrapper recurses into itself.
const _applyURLToFiltersInner = _applyURLToFilters;
window._applyURLToFilters = function () {
  const out = _applyURLToFiltersInner();
  if (typeof syncEstadoChipsFromSelect === 'function') syncEstadoChipsFromSelect();
  return out;
};

// Back/forward — re-apply URL state, then re-render.
window.addEventListener('popstate', () => {
  if (_applyURLToFilters()) {
    if (typeof aplicarFiltrosCombinados === 'function') aplicarFiltrosCombinados();
    if (typeof syncEstadoChipsFromSelect === 'function') syncEstadoChipsFromSelect();
  }
});

function syncMobileAdvancedFiltersToDesktop() {
  const orden = document.getElementById("mobileFiltroOrden")?.value || "";
  const cliente = document.getElementById("mobileFiltroCliente")?.value || "";
  const serial = document.getElementById("mobileFiltroSerial")?.value || "";
  const tipo = document.getElementById("mobileFiltroTipo")?.value || "";
  const tecnico = document.getElementById("mobileFiltroTecnico")?.value || "";
  const soloMias = !!document.getElementById("mobileSoloMias")?.checked;

  const dOrden = document.getElementById("filtroOrden");
  const dCliente = document.getElementById("filtroCliente");
  const dSerial = document.getElementById("filtroSerial");
  const dTipo = document.getElementById("filtroTipo");
  const dTecnico = document.getElementById("filtroTecnico");
  const dSoloMias = document.getElementById("toggleMisOrdenes");

  if (dOrden) dOrden.value = orden;
  if (dCliente) dCliente.value = cliente;
  if (dSerial) dSerial.value = serial;
  if (dTipo) dTipo.value = tipo;
  if (dTecnico) dTecnico.value = tecnico;
  if (dSoloMias) dSoloMias.checked = soloMias;
}

window.filtrarOrdenes = async function () {
  const filtroOrden = normTxt(document.getElementById("filtroOrden").value);
  const filtroCliente = normTxt(document.getElementById("filtroCliente").value);
  const filtroSerial = normTxt(document.getElementById("filtroSerial").value);
  const filtroTipo = normTxt(document.getElementById("filtroTipo").value);
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");

  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  _syncFiltersToURL();

  if (!filtroOrden && !filtroCliente && !filtroSerial && !filtroTipo) {
    cargarOrdenesYEquipos(true);
    return;
  }

  let resultados = [];
  try {
    resultados = await OrdenesService.searchOrders({
      filtroOrden,
      filtroCliente,
      filtroSerial,
      quickSearch: false
    });

    const filters = getActiveFilters();
    resultados = hasActiveFilters(filters)
      ? applyActiveFiltersToOrders(resultados, filters)
      : resultados;

    if (resultados.length === 0) {
      renderEmptyState("No se encontraron coincidencias", {
        icon: 'search-x',
        sublabel: 'Probá ajustar los filtros o limpiar la búsqueda.'
      });
      return;
    }

    ordenarOrdenes(resultados).forEach(o => {
      const equipos = (o.equipos || [])
        .filter(e => !e.eliminado)
        .sort((a, b) =>
          String(a.numero_de_serie || "").localeCompare(String(b.numero_de_serie || ""))
        );
      renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
    });
    APP.utils.lucideRefresh([ordersTable, document.getElementById("ordersCards")]);

  } catch (e) {
    console.error("❌ Error al filtrar:", e);
    renderEmptyState("Error al filtrar datos", { icon: 'alert-triangle', sublabel: 'Por favor, recarga la página.' });
  }

  actualizarResumen(resultados);
  aplicarRestriccionesPorRol(APP.state.userRole);
};

window.filtrarRapido = async function () {
  const filtroRapido = document.getElementById("filtroRapido");
  if (!filtroRapido) return;

  const valor = normTxt(filtroRapido.value);
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");

  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  if (!valor) {
    cargarOrdenesYEquipos(true);
    return;
  }

  let resultados = [];
  try {
    resultados = await OrdenesService.searchOrders({
      filtroOrden: valor,
      filtroCliente: valor,
      filtroSerial: valor,
      quickSearch: true
    });

    if (resultados.length === 0) {
      renderEmptyState("No se encontraron coincidencias", {
        icon: 'search-x',
        sublabel: 'Probá ajustar los filtros o limpiar la búsqueda.'
      });
      return;
    }

    ordenarOrdenes(resultados).forEach(o => {
      const equipos = (o.equipos || [])
        .filter(e => !e.eliminado)
        .sort((a, b) =>
          String(a.numero_de_serie || "").localeCompare(String(b.numero_de_serie || ""))
        );
      renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
    });
    APP.utils.lucideRefresh([ordersTable, document.getElementById("ordersCards")]);

  } catch (e) {
    console.error("❌ Error al filtrar:", e);
    renderEmptyState("Error al filtrar datos", { icon: 'alert-triangle', sublabel: 'Por favor, recarga la página.' });
  }

  actualizarResumen(resultados);
  aplicarRestriccionesPorRol(APP.state.userRole);
};

window.toggleFiltrosAvanzados = function () {
  const bloque = document.getElementById("filtrosAvanzados");
  const icono = document.getElementById("iconoAvanzados");

  if (!bloque || !icono) return;

  if (bloque.style.display === "none") {
    bloque.style.display = "block";
    icono.classList.add('open');
  } else {
    bloque.style.display = "none";
    icono.classList.remove('open');
  }
};

window.limpiarFiltros = function () {
  const filtroRapido = document.getElementById("filtroRapido");
  if (filtroRapido) filtroRapido.value = "";

  document.getElementById("filtroOrden").value = "";
  document.getElementById("filtroCliente").value = "";
  document.getElementById("filtroSerial").value = "";
  const filtroTipo = document.getElementById("filtroTipo");
  if (filtroTipo) filtroTipo.value = "";
  const filtroTecnico = document.getElementById("filtroTecnico");
  if (filtroTecnico) filtroTecnico.value = "";
  const sel = document.getElementById("filtroEstado");
  if (sel) sel.value = "";
  const toggleMisOrdenes = document.getElementById("toggleMisOrdenes");
  if (toggleMisOrdenes) toggleMisOrdenes.checked = false;

  const mOrden = document.getElementById("mobileFiltroOrden");
  const mCliente = document.getElementById("mobileFiltroCliente");
  const mSerial = document.getElementById("mobileFiltroSerial");
  const mTipo = document.getElementById("mobileFiltroTipo");
  const mTecnico = document.getElementById("mobileFiltroTecnico");
  const mSoloMias = document.getElementById("mobileSoloMias");
  if (mOrden) mOrden.value = "";
  if (mCliente) mCliente.value = "";
  if (mSerial) mSerial.value = "";
  if (mTipo) mTipo.value = "";
  if (mTecnico) mTecnico.value = "";
  if (mSoloMias) mSoloMias.checked = false;

  document.querySelectorAll('.resumen .badge.active').forEach(b => b.classList.remove('active'));
  // Reset estado chip bar to "Todas".
  document.querySelectorAll('#estadoChipsBar .estado-chip').forEach(chip => {
    const isAll = !chip.dataset.estado;
    chip.classList.toggle('active', isAll);
    chip.setAttribute('aria-selected', isAll ? 'true' : 'false');
  });

  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");
  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  _syncFiltersToURL();
  cargarOrdenesYEquipos(true);
};

window.cambiarOrden = function () {
  const sel = document.getElementById("campoOrdenamiento");
  if (!sel) return;
  APP.state.sortField = sel.value;
  _syncFiltersToURL();
  cargarOrdenesYEquipos();
};

window.cambiarDireccionOrden = function () {
  APP.state.sortAscending = !APP.state.sortAscending;
  _syncFiltersToURL();
  cargarOrdenesYEquipos();
};

/**
 * Chip-bar handler — ORDENES_INDEX_IMPROVEMENTS §4.3.
 *
 * The estado chips replace the dropdown as the primary filter scan.
 * Clicking a chip:
 *   1. Mirrors its value into the (hidden) #filtroEstado select so the
 *      rest of the filter pipeline (getActiveFilters, URL serializer,
 *      presets) keeps working unchanged.
 *   2. Updates `aria-selected` + `active` class on chips.
 *   3. Delegates to filtrarPorEstado for the actual data refresh.
 * Clicking the already-active chip clears the filter.
 *
 * @param {HTMLElement} el — the clicked chip button
 */
window.filtrarPorChipEstado = function (el) {
  const estado = el.dataset.estado || '';
  const wasActive = el.classList.contains('active');
  const next = wasActive ? '' : estado;

  // Mirror into the hidden select.
  const sel = document.getElementById('filtroEstado');
  if (sel) sel.value = next;

  // Update chip ARIA state.
  document.querySelectorAll('#estadoChipsBar .estado-chip').forEach(chip => {
    const isActive = chip.dataset.estado === next;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  filtrarPorEstado(next);
};

/**
 * Reflect the current estado filter into chip-bar active state.
 * Called after presets load / URL apply / popstate so the chips don't
 * drift from the (hidden) select they mirror.
 */
window.syncEstadoChipsFromSelect = function () {
  const sel = document.getElementById('filtroEstado');
  const current = (sel?.value || '').toString();
  document.querySelectorAll('#estadoChipsBar .estado-chip').forEach(chip => {
    const isActive = (chip.dataset.estado || '') === current;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
};

window.filtrarPorEstado = async function (estado) {
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");
  const btnCargarMas = document.getElementById("btnCargarMas");
  const loader = document.getElementById("loader");

  document.getElementById("filtroOrden").value = "";
  document.getElementById("filtroCliente").value = "";
  document.getElementById("filtroSerial").value = "";
  // Keep #filtroEstado in sync so the URL serializer sees the active estado.
  const filtroEstadoSel = document.getElementById("filtroEstado");
  if (filtroEstadoSel) filtroEstadoSel.value = estado || "";
  _syncFiltersToURL();

  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";
  APP.state.orders = [];
  APP.state.lastVisible = null;

  if (!estado) {
    if (btnCargarMas) {
      btnCargarMas.innerHTML = '<i data-lucide="chevron-down"></i> Cargar más órdenes (0)';
      btnCargarMas.disabled = false;
      APP.utils.show(btnCargarMas);
    }
    cargarOrdenesYEquipos(true);
    return;
  }

  if (btnCargarMas) btnCargarMas.style.display = "none";

  let resultados = [];
  try {
    if (loader) loader.style.display = "block";

    resultados = await OrdenesService.filterByStatus(estado, 200);

    if (resultados.length === 0) {
      renderEmptyState("No hay órdenes con ese estado", { icon: 'search-x' });
      return;
    }

    ordenarOrdenes(resultados).forEach(o => {
      const equipos = (o.equipos || [])
        .filter(e => !e.eliminado)
        .sort((a, b) => String(a.numero_de_serie || "").localeCompare(String(b.numero_de_serie || "")));
      renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
    });

  } catch (e) {
    console.error("❌ Error al filtrar por estado:", {
      code: e?.code,
      message: e?.message,
      name: e?.name,
      fullError: e
    });

    if (e?.code === "failed-precondition") {
      console.log("🔄 Index missing, using fallback JS filter");
      try {
        resultados = await OrdenesService.filterByStatus(estado, 200);

        if (resultados.length === 0) {
          renderEmptyState("No hay órdenes con ese estado", { icon: 'search-x' });
        } else {
          ordenarOrdenes(resultados).forEach(o => {
            const equipos = (o.equipos || [])
              .filter(e => !e.eliminado)
              .sort((a, b) => String(a.numero_de_serie || "").localeCompare(String(b.numero_de_serie || "")));
            renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
          });
          APP.utils.lucideRefresh([ordersTable, document.getElementById("ordersCards")]);
        }

        actualizarResumen(resultados);
        if (typeof aplicarRestriccionesPorRol === 'function') aplicarRestriccionesPorRol(APP.state.userRole);
        if (loader) APP.utils.hide(loader);
        return;
      } catch (fallbackErr) {
        console.error("❌ Fallback also failed:", fallbackErr);
      }
    }

    renderEmptyState("Error al filtrar por estado", { icon: 'alert-triangle', sublabel: 'Por favor, recarga la página.' });
  } finally {
    if (loader) loader.style.display = "none";
  }

  actualizarResumen(resultados);
  if (typeof aplicarRestriccionesPorRol === 'function') aplicarRestriccionesPorRol(APP.state.userRole);
};
