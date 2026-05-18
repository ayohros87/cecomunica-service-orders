// @ts-nocheck
/* ========================================
 * ORDENES INDEX - Page coordinator
 * Thin bootstrap: wires DOM listeners, drives the initial auth +
 * data load, handles back-button reloads, and registers the
 * Ctrl/Cmd+K / Escape keyboard shortcuts.
 *
 * All other behavior is in pages/ordenes-state.js, ordenes-data.js,
 * ordenes-render.js, ordenes-filters.js, ordenes-flujo.js,
 * ordenes-equipos.js, ordenes-notas.js, ordenes-ui.js, and
 * ordenes-events.js (loaded in that order from ordenes/index.html).
 * ======================================== */

// Measures .filters-card-sticky height and exposes it as
// --filter-card-h so the orders-table thead can stick directly below
// the filter card instead of using a hardcoded 128 px estimate.
// Re-measured automatically when the card resizes (advanced filters
// toggle, viewport change, content reflow).
function syncFilterCardHeight() {
  const card = document.querySelector('.filters-card-sticky');
  if (!card) return;
  const h = Math.ceil(card.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--filter-card-h', h + 'px');
}

document.addEventListener("DOMContentLoaded", function () {
  setFechaEntregaVisible(false);

  // Initial measurement + observe future resizes.
  syncFilterCardHeight();
  const filterCard = document.querySelector('.filters-card-sticky');
  if (filterCard && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncFilterCardHeight).observe(filterCard);
  }

  // Filter inputs re-apply combined filters on change
  const filtroEstadoEl = document.getElementById("filtroEstado");
  if (filtroEstadoEl) filtroEstadoEl.addEventListener("change", () => aplicarFiltrosCombinados());
  const filtroTipoEl = document.getElementById("filtroTipo");
  if (filtroTipoEl) filtroTipoEl.addEventListener("change", () => aplicarFiltrosCombinados());
  const filtroTecnicoEl = document.getElementById("filtroTecnico");
  if (filtroTecnicoEl) filtroTecnicoEl.addEventListener("change", () => aplicarFiltrosCombinados());
  const toggleMisOrdenes = document.getElementById("toggleMisOrdenes");
  if (toggleMisOrdenes) toggleMisOrdenes.addEventListener("change", () => aplicarFiltrosCombinados());

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    try {
      const userData = await OrdenesService.getUserData(user.uid);
      const rol = userData?.rol || null;
      APP.state.user = userData || null;
      APP.state.userId = user.uid || null;
      APP.state.userRole = rol;

      const shouldDefaultMine = [ROLES.TECNICO, ROLES.TECNICO_OPERATIVO].includes(rol);
      if (shouldDefaultMine) {
        const toggleMis = document.getElementById("toggleMisOrdenes");
        const mobileSoloMias = document.getElementById("mobileSoloMias");
        if (toggleMis) toggleMis.checked = true;
        if (mobileSoloMias) mobileSoloMias.checked = true;
      }

      // Skeleton placeholders for perceived perf — replaced once
      // cargarOrdenesYEquipos clears ordersTable + ordersCards.
      // ORDENES_INDEX_IMPROVEMENTS.md QW11.
      renderSkeletonRows(8);
      await cargarTiposDeServicioFiltros();
      await cargarTecnicosFiltros();
      // Apply URL filter state AFTER the dropdowns have their options
      // populated (so `<select>` values resolve correctly) but BEFORE
      // the initial data load (so sort + soloMias take effect on the
      // first render). ORDENES_INDEX_IMPROVEMENTS.md §5.4.
      const hadUrlFilters = typeof _applyURLToFilters === 'function' && _applyURLToFilters();
      await cargarOrdenesYEquipos();
      aplicarRestriccionesPorRol(rol);
      if (shouldDefaultMine || hadUrlFilters) aplicarFiltrosCombinados();
    } catch (e) {
      console.error("Error obteniendo rol del usuario:", e);
      Toast.show("Error al verificar permisos. Por favor, recarga la página.", 'bad');
      firebase.auth().signOut();
    }
  });

  // ── "Cargar más" auto-load via IntersectionObserver ──────────────
  // The button stays as a manual fallback (e.g. when IO is unavailable
  // or when the user explicitly clicks it). The observer fires before
  // the user actually scrolls to the button so loading is invisible
  // in normal use. ORDENES_INDEX_IMPROVEMENTS.md QW14.
  const btnCargarMas = APP.utils.mustGetEl("btnCargarMas");
  let _autoLoadInFlight = false;

  const triggerLoadMore = () => {
    if (_autoLoadInFlight) return;
    if (btnCargarMas.disabled) return;
    if (btnCargarMas.style.display === "none") return;
    _autoLoadInFlight = true;
    Promise.resolve(cargarOrdenesYEquipos(false))
      .finally(() => { _autoLoadInFlight = false; });
  };

  btnCargarMas.addEventListener("click", triggerLoadMore);

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) triggerLoadMore();
      }
    }, {
      // Pre-fetch slightly before the button is visible — feels more
      // continuous to the user than waiting for true intersection.
      rootMargin: "200px 0px 200px 0px",
      threshold: 0,
    });
    io.observe(btnCargarMas);
  }

  const filtroRapido = document.getElementById('filtroRapido');
  if (filtroRapido) {
    filtroRapido.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        filtrarRapido();
      }
    });
  }
});

function cerrarSesion() {
  firebase.auth().signOut().then(() => {
    window.location.href = "../login.html";
  });
}
window.cerrarSesion = cerrarSesion;

// Ctrl/Cmd+K focuses the quick search; ESC closes any open .overlay modal.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const filtroRapido = document.getElementById('filtroRapido');
    if (filtroRapido) {
      filtroRapido.focus();
    } else {
      const filtroOrden = document.getElementById('filtroOrden');
      if (filtroOrden) filtroOrden.focus();
    }
  }

  if (e.key === 'Escape') {
    const modal = document.querySelector('.overlay[style*="display: flex"]');
    if (modal) modal.style.display = 'none';
  }
});

// Force reload on back-button navigation so freshly signed contracts/orders show up.
window.addEventListener("pageshow", (event) => {
  if (event.persisted || performance.getEntriesByType("navigation")[0].type === "back_forward") {
    console.log("♻️ Recargando órdenes tras regresar a la página...");
    cargarOrdenesYEquipos(true);
  }
});
