// @ts-nocheck
/* ========================================
 * ORDENES INDEX - JavaScript
 * Extracted from inline <script> tag
 * ======================================== 
 * 
 * TECH DEBT REDUCTION - COMPLETED PHASES:
 * 
 * ✅ Phase 0: Safety Rails
 *    - Added APP namespace for organizing functionality
 *    - Created CONFIG object for constants
 *    - Added utility helpers (mustGetEl, qs, qsa, logError)
 *    - **EXTRACTED to pages/ordenes-state.js**
 * 
 * ✅ Phase 1: External CSS/JS
 *    - Moved inline <style> to ../css/ordenes-index.css (~1300 lines)
 *    - Moved inline <script> to ../js/ordenes-index.js (~2680 lines)
 *    - Fixed PowerShell extraction corruption
 * 
 * ✅ Phase 2: Service Layer
 *    - Created ordenesService.js (11 methods, 247 lines)
 *    - Created clientesService.js (6 methods, 120 lines)
 *    - Abstracted all Firestore operations
 *    - Replaced direct db calls with service methods
 * 
 * ✅ Phase 3: Event Delegation
 *    - Replaced all inline onclick handlers with data-action attributes
 *    - Created centralized event delegation system
 *    - 30+ action handlers in ACTION_HANDLERS map
 *    - Cleaner HTML, easier maintenance
 * 
 * ✅ Phase 4: Centralized State Management
 *    - Moved window.ordenesCargadas → APP.state.orders
 *    - Moved window.userRole → APP.state.userRole
 *    - Moved lastOrdenSnapshot → APP.state.lastVisible
 *    - Moved clientesMap → APP.state.clientesMap
 *    - Moved campoOrdenamiento → APP.state.sortField
 *    - Moved ordenAscendente → APP.state.sortAscending
 *    - All application state now centralized in APP.state
 * 
 * ✅ Phase 8: Service Layer Completion
 *    - All db.collection() calls replaced with OrdenesService methods
 *    - Added: searchOrders(), filterByStatus(), updateTrabajoTecnico(), getUserData(), getOrder()
 * 
 * ✅ Phase 9: Module Extraction
 *    - APP, CONFIG, APP.utils → pages/ordenes-state.js
 *    - Reduces this file from ~2600 to ~2400 lines
 * 
 * Dependencies: pages/ordenes-state.js (APP, CONFIG), ordenesService.js, clientesService.js
 * ======================================== */

/* ========================================
   APP namespace, CONFIG, and utils are defined in pages/ordenes-state.js
   This file extends APP with additional functionality
   ======================================== */

// Marca visualmente fila y card si ya hay trabajo guardado

// mostrarToast → pages/ordenes-ui.js

// Q) Feedback visual inmediato en fila de equipo
// mostrarFeedbackEquipo → pages/ordenes-render.js

// formatFecha → pages/ordenes-state.js

// setFechaEntregaVisible → pages/ordenes-filters.js

// cargarClientes, cargarTiposDeServicioFiltros, cargarTecnicosFiltros → pages/ordenes-data.js
// BASE and modelosDisponibles are defined in pages/ordenes-state.js

document.addEventListener("DOMContentLoaded", function () {
    // obtenerIconoLapiz → pages/ordenes-render.js

    setFechaEntregaVisible(false);

    const filtroEstadoEl = document.getElementById("filtroEstado");
    if (filtroEstadoEl) {
      filtroEstadoEl.addEventListener("change", () => aplicarFiltrosCombinados());
    }
    const filtroTipoEl = document.getElementById("filtroTipo");
    if (filtroTipoEl) {
      filtroTipoEl.addEventListener("change", () => aplicarFiltrosCombinados());
    }
    const filtroTecnicoEl = document.getElementById("filtroTecnico");
    if (filtroTecnicoEl) {
      filtroTecnicoEl.addEventListener("change", () => aplicarFiltrosCombinados());
    }
    const toggleMisOrdenes = document.getElementById("toggleMisOrdenes");
    if (toggleMisOrdenes) {
      toggleMisOrdenes.addEventListener("change", () => aplicarFiltrosCombinados());
    }

    firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "../login.html";
  } else {
    try {
      const userData = await OrdenesService.getUserData(user.uid);
      const rol = userData?.rol || null;
      APP.state.user = userData || null;
      APP.state.userId = user.uid || null;
      APP.state.userRole = rol; // se usa globalmente
      const shouldDefaultMine = [ROLES.TECNICO, ROLES.TECNICO_OPERATIVO].includes(rol);
      const toggleMisOrdenes = document.getElementById("toggleMisOrdenes");
      const mobileSoloMias = document.getElementById("mobileSoloMias");
      if (shouldDefaultMine) {
        if (toggleMisOrdenes) toggleMisOrdenes.checked = true;
        if (mobileSoloMias) mobileSoloMias.checked = true;
      }
      APP.utils.show("loader");
      await cargarClientes();
      await cargarTiposDeServicioFiltros();
      await cargarTecnicosFiltros();
      await cargarOrdenesYEquipos();
      APP.utils.hide("loader");
      aplicarRestriccionesPorRol(rol);
      if (shouldDefaultMine) aplicarFiltrosCombinados();

    } catch (e) {
      console.error("Error obteniendo rol del usuario:", e);
      showAlertModal("Error al verificar permisos. Por favor, recarga la página.", 'error');
      firebase.auth().signOut();
    }
  }
});

APP.utils.mustGetEl("btnCargarMas").addEventListener("click", () => {
  cargarOrdenesYEquipos(false); // no es carga inicial
});

// Listener para Enter en búsqueda rápida
const filtroRapido = document.getElementById('filtroRapido');
if (filtroRapido) {
  filtroRapido.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      filtrarRapido();
    }
  });
}

      function cerrarSesion() {
        firebase.auth().signOut().then(() => {
          window.location.href = "../login.html"; // ✅ correcto si estás dentro de /ordenes/
        });
      }

      window.cerrarSesion = cerrarSesion;

// Keyboard shortcuts for quick actions
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + K for search focus
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
  
  // ESC to close modals
  if (e.key === 'Escape') {
    const modal = document.querySelector('.overlay[style*="display: flex"]');
    if (modal) {
      modal.style.display = 'none';
    }
  }
});

// aplicarRestriccionesPorRol → pages/ordenes-filters.js

// abrirModalAsignarTecnico, cerrarModalAsignar, confirmarAsignarTecnico, completarOrden, entregarOrden → pages/ordenes-flujo.js

// eliminarOrden, agregarEquipo → pages/ordenes-flujo.js

// ===== GUARDAR ACCESORIOS (LOTE) =====
// guardarAccesoriosLote → pages/ordenes-equipos.js


// END OF PART 1/3

// renderizarOrdenYEquipos, renderEquiposTabla, refrescarEquiposDeOrden, botonesFlujo, botonesGestion → pages/ordenes-render.js


// ordenarOrdenes, cargarOrdenesYEquipos → pages/ordenes-data.js


// generarNotaEntrega, generarNotaEntregaIntervenciones, prepararEquiposParaNota → pages/ordenes-flujo.js


// getActiveFilters, hasActiveFilters, esOrdenMia, matchesAdvancedFilters, applyActiveFiltersToOrders, renderOrdersList, aplicarFiltrosCombinados, syncMobileAdvancedFiltersToDesktop, filtrarOrdenes → pages/ordenes-filters.js

// gestionarNotasTecnicas → pages/ordenes-notas.js

// ===== NUEVAS FUNCIONES DE FILTRADO MEJORADO =====

// filtrarRapido, toggleFiltrosAvanzados, limpiarFiltros → pages/ordenes-filters.js

});

// copiarSeriales → pages/ordenes-flujo.js

// resolverEquipoDesdeCompuesto, editarCampoEquipo, eliminarEquipo, abrirEditorAccesorios, activarModoAccesorios, abrirEquiposMobile, cerrarEquiposMobile, abrirTrabajoEquipoModal, cerrarTrabajoEquipoModal, abrirIntervencionEquipoDesktop, verTrabajoEquipo, guardarTrabajoEquipoModal, setEquipoNoDisponible, verObsCompleta → pages/ordenes-equipos.js

// escapeHtml → pages/ordenes-state.js

// filtrarPorEstado → pages/ordenes-filters.js

// 🔄 Forzar recarga de órdenes al regresar desde otra página (ej. firmar-entrega)
window.addEventListener("pageshow", (event) => {
  if (event.persisted || performance.getEntriesByType("navigation")[0].type === "back_forward") {
    console.log("♻️ Recargando órdenes tras regresar a la página...");
    cargarOrdenesYEquipos(true);
  }
});
// mostrarNotificacionProgreso, mobile UI helpers, menu togglers, showTextModal, showAlertModal, etc. → pages/ordenes-ui.js


/* ========================================
   PHASE 3: Event Delegation System
   ======================================== */

/**
 * Centralized event delegation for all button clicks
 * Replaces inline onclick handlers for cleaner HTML and better maintainability
 */
(function initEventDelegation() {
  
  // Action handlers map
  const ACTION_HANDLERS = {
    // Navigation actions
    'go-nueva-orden': () => window.location.href = BASE + 'nueva-orden.html',
    'go-config': () => window.location.href = BASE + 'config.html',
    'go-admin-equipos-cliente': () => {
      const currentRole = String(APP.state?.userRole || "").trim().toLowerCase();
      if (currentRole !== ROLES.ADMIN) {
        mostrarToast('Solo administradores pueden acceder', 'bad');
        return;
      }
      window.location.href = BASE + 'admin-equipos-cliente.html';
    },
    'go-reporte-pendientes': () => window.open(BASE + 'reporte-pendientes.html', '_blank'),
    'go-progreso-tecnicos': () => window.location.href = 'progreso-tecnicos.html',
    'go-menu-principal': () => window.location.href = '../index.html',
    'logout': () => cerrarSesion(),
    'toggle-topbar-menu': () => toggleTopbarMenu(),
    'toggle-resumen-menu': () => toggleResumenMenu(),
    
    // Filter actions
    'filtrar': () => filtrarOrdenes(),
    'filtrar-rapido': () => filtrarRapido(),
    'limpiar-filtros': () => limpiarFiltros(),
    'toggle-filtros-avanzados': () => toggleFiltrosAvanzados(),
    'cambiar-orden': () => cambiarOrden(),
    'cambiar-direccion': () => cambiarDireccionOrden(),
    'filtrar-estado': () => aplicarFiltrosCombinados(),
    'filtrar-tipo': () => aplicarFiltrosCombinados(),
    'filtrar-tecnico': () => aplicarFiltrosCombinados(),
    'filtrar-mias': () => aplicarFiltrosCombinados(),
    'toggle-fecha-entrega': () => {
      const visible = document.body?.classList.contains('hide-fecha-entrega');
      setFechaEntregaVisible(visible);
    },
    
    // Modal actions
    'cerrar-modal-asignar': () => cerrarModalAsignar(),
    'confirmar-asignar-tecnico': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) confirmarAsignarTecnico(ordenId);
    },
    
    // Order actions
    'asignar-tecnico': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) abrirModalAsignarTecnico(ordenId);
    },
    'completar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) completarOrden(ordenId);
    },
    'entregar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) entregarOrden(ordenId);
    },
    'eliminar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) eliminarOrden(ordenId);
    },
    'editar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) window.location.href = `editar-orden.html?id=${ordenId}`;
    },
    'go-fotos-taller': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        window.location.href = BASE + `fotos-taller.html?ordenId=${encodeURIComponent(ordenId)}`;
      }
    },
    
    // Equipment actions
    'agregar-equipo': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) agregarEquipo(ordenId);
    },
    'copiar-seriales': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) copiarSeriales(ordenId);
    },
    'activar-accesorios': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) activarModoAccesorios(ordenId);
    },
    'guardar-accesorios': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) guardarAccesoriosLote(ordenId);
    },
    'toggle-order-actions': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) toggleOrderActionsMenu(ordenId);
    },
    'toggle-leyenda-accesorios': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        const popover = document.getElementById(`popoverAccesorios_${ordenId}`);
        if (popover) {
          popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
        }
      }
    },
    'close-popover': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        const popover = document.getElementById(`popoverAccesorios_${ordenId}`);
        if (popover) popover.style.display = 'none';
      }
    },
    'editar-campo-equipo': (el) => {
      const { id, campo, valor } = el.dataset;
      if (id && campo !== undefined) editarCampoEquipo(id, campo, valor || '');
    },
    'eliminar-equipo': (el, e) => {
      const id = el.dataset.id;
      if (id) eliminarEquipo(e, id);
    },
    'abrir-intervencion-desktop': (el) => {
      const { ordenId, equipoId } = el.dataset;
      if (ordenId && equipoId) abrirIntervencionEquipoDesktop(ordenId, equipoId);
    },
    'toggle-no-disponible': async (el) => {
      const { ordenId, equipoId } = el.dataset;
      const checked = !!el.checked;
      const panel = el.closest('.intervencion-hover-ctrl, .no-disponible-panel');
      const motivoInput = panel?.querySelector('.motivo-no-disponible');

      if (motivoInput) {
        motivoInput.disabled = !checked;
        if (!checked) {
          motivoInput.value = "";
        } else {
          setTimeout(() => motivoInput.focus(), 0);
        }
      }

      const motivo = checked ? (motivoInput?.value || "").trim() : "";
      if (ordenId && equipoId) await setEquipoNoDisponible({ ordenId, equipoId, noDisponible: checked, motivo });
    },
    'motivo-no-disponible': async (el) => {
      if (el.disabled) return;
      const { ordenId, equipoId } = el.dataset;
      const motivo = (el.value || "").trim();
      if (ordenId && equipoId) await setEquipoNoDisponible({ ordenId, equipoId, noDisponible: true, motivo });
    },
    
    // Mobile actions
    'mobile-scroll-top': () => mobileScrollTop(),
    'mobile-open-filters': () => openMobileFilters(),
    'mobile-close-filters': () => closeMobileFilters(),
    'mobile-clear-all': () => mobileClearAll(),
    'mobile-apply-search': () => mobileApplyQuickSearch(),
    'mobile-sync-sort': () => mobileSyncSortField(),
    'mobile-toggle-sort': () => mobileToggleSortDir(),
    'mobile-apply-advanced': () => {
      syncMobileAdvancedFiltersToDesktop();
      filtrarOrdenes();
      closeMobileFilters();
    },
    'abrir-equipos-mobile': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) abrirEquiposMobile(ordenId);
    },
    'cerrar-equipos-mobile': () => cerrarEquiposMobile(),
    'cerrar-trabajo-equipo': () => cerrarTrabajoEquipoModal(),
    'guardar-trabajo-equipo': () => guardarTrabajoEquipoModal(),
    'ver-obs-completa': (el) => {
      const ordenId = el.dataset.ordenId;
      const idx = parseInt(el.dataset.idx, 10);
      if (ordenId && !isNaN(idx)) verObsCompleta(ordenId, idx);
    },
    'abrir-trabajo-equipo': (el) => {
      const ordenId = el.dataset.ordenId;
      const idx = parseInt(el.dataset.idx, 10);
      if (ordenId && !isNaN(idx)) abrirTrabajoEquipoModal(ordenId, idx);
    },
    'ver-trabajo-equipo': (el) => {
      const ordenId = el.dataset.ordenId;
      const idx = parseInt(el.dataset.idx, 10);
      if (ordenId && !isNaN(idx)) verTrabajoEquipo(ordenId, idx);
    },
    'close-text-modal': () => closeTextModal(),
    'copy-text-modal': () => copyTextModalContent(),
    'close-alert-modal': () => closeAlertModal(),
    
    // Overflow menu
    'toggle-overflow-menu': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) toggleOverflowMenu(ordenId);
    },
    
    // Overflow menu actions
    'generar-nota-entrega': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        generarNotaEntrega(ordenId);
        closeAllMenus();
      }
    },
    'generar-nota-entrega-intervenciones': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        generarNotaEntregaIntervenciones(ordenId);
        closeAllMenus();
      }
    },
    'imprimir-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      const orden = APP.state.orders.find(o => o.ordenId === ordenId);
      if (orden) {
        localStorage.setItem('imprimirOrdenData', JSON.stringify({
          ordenId: orden.ordenId,
          tipo_de_servicio: orden.tipo_de_servicio || '',
          tecnico_asignado: orden.tecnico_asignado || '',
          estado_reparacion: orden.estado_reparacion || '',
          observaciones: orden.observaciones || '',
          cliente: nombreClienteDe(orden),
          fecha_creacion: orden.fecha_creacion?.toDate?.()?.toISOString?.() ?? null,
          fecha_entrega: orden.fecha_entrega?.toDate?.()?.toISOString?.() ?? null,
          equipos: (orden.equipos || []).filter(e => !e.eliminado).map(e => ({
            numero_de_serie: e.numero_de_serie || '',
            modelo: e.modelo || '',
            bateria: !!e.bateria,
            clip: !!e.clip,
            cargador: !!e.cargador,
            fuente: !!e.fuente,
            antena: !!e.antena,
            observaciones: e.observaciones || ''
          }))
        }));
      }
      window.open(BASE + `imprimir-orden.html?id=${ordenId}`, '_blank');
      closeAllMenus();
    },
    'gestionar-trabajo': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        window.location.href = BASE + `trabajar-orden.html?id=${ordenId}`;
      }
    },
    'gestionar-notas': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        gestionarNotasTecnicas(ordenId);
        closeAllMenus();
      }
    },
    
    // Badge filter actions
    'filtrar-badge': (el) => {
      const estado = el.dataset.estado;
      const resumenEl = el.closest('.resumen, #mobileResumen');
      
      // Toggle active state
      const wasActive = el.classList.contains('active');
      if (resumenEl) {
        resumenEl.querySelectorAll('.badge').forEach(b => b.classList.remove('active'));
      }
      
      if (!wasActive) {
        el.classList.add('active');
        // Sync dropdown
        const sel = document.getElementById('filtroEstado');
        if (sel) sel.value = estado;
        filtrarPorEstado(estado);
      } else {
        // Toggle off - show all
        const sel = document.getElementById('filtroEstado');
        if (sel) sel.value = '';
        limpiarFiltros();
      }
    }
  };
  
  /**
   * Handle click events with action delegation
   * @param {Event} e - Click event
   */
  function handleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    // Handle backdrop clicks (only if clicking exactly on the backdrop, not children)
    if (target.dataset.backdrop === 'true' && e.target !== target) {
      return;
    }

    if (target.tagName === 'SELECT' && (target.dataset.action === 'filtrar-estado' || target.dataset.action === 'filtrar-tipo')) {
      return;
    }
    
    const action = target.dataset.action;
    const handler = ACTION_HANDLERS[action];
    
    if (handler) {
      // Stop propagation if requested
      if (target.dataset.stopPropagation === 'true') {
        e.stopPropagation();
      }
      
      // Prevent default if requested
      if (target.dataset.preventDefault === 'true') {
        e.preventDefault();
      }
      
      // Execute handler
      handler(target, e);
    } else {
      console.warn(`[Event Delegation] No handler found for action: ${action}`);
    }
  }
  
  /**
   * Handle change events with action delegation
   * @param {Event} e - Change event
   */
  function handleChange(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    const action = target.dataset.action;
    const handler = ACTION_HANDLERS[action];
    
    if (handler) {
      handler(target, e);
    }
  }
  
  // Attach event listeners to document
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  
  console.log('✅ Event delegation system initialized');
})();
