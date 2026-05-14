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

function mostrarToast(mensaje, tipo = 'ok') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${tipo}`;
  toast.textContent = mensaje;
  toast.classList.add('toast--show');
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('toast--hide');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

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

// ===== MODAL ASIGNAR TÉCNICO =====
// Uses static HTML modal (#modalAsignar) instead of dynamic creation
window.abrirModalAsignarTecnico = function(ordenId) {
  const modal = document.getElementById("modalAsignar");
  const select = document.getElementById("asignarTecnicoSelect");
  const btnConfirmar = modal.querySelector("button[data-action='confirmar-asignar-tecnico']");
  
  if (!modal || !select || !btnConfirmar) {
    console.error("Modal elements not found");
    return;
  }
  
  // Store ordenId in button dataset for later use
  btnConfirmar.dataset.ordenId = ordenId;
  
  // Clear and reload técnicos
  select.innerHTML = '<option value="">Seleccionar técnico...</option>';
  
  // Cargar técnicos usando service
  OrdenesService.loadTechnicians()
    .then(technicians => {
      technicians.forEach(tech => {
        const option = document.createElement("option");
        option.value = tech.uid;
        option.textContent = tech.nombre;
        select.appendChild(option);
      });
    })
    .catch(error => {
      console.error("Error cargando técnicos:", error);
      mostrarToast("❌ Error cargando técnicos", "error");
    });
  
  // Add backdrop click handler (close when clicking outside modal)
  modal.onclick = function(e) {
    if (e.target === modal) {
      cerrarModalAsignar();
    }
  };
  
  // Show modal
  APP.utils.show(modal);
};

window.cerrarModalAsignar = function() {
  const modal = document.getElementById("modalAsignar");
  if (modal) {
    APP.utils.hide(modal);
    // Clear select
    const select = document.getElementById("asignarTecnicoSelect");
    if (select) select.value = "";
  }
};

window.confirmarAsignarTecnico = async function(ordenId) {
  const select = document.getElementById("asignarTecnicoSelect");
  if (!select || !select.value) {
    mostrarToast("⚠️ Selecciona un técnico", "bad");
    return;
  }

  const tecnicoUid = select.value;
  const tecnicoNombre = select.options[select.selectedIndex].text;

  try {
    await OrdenesService.assignTechnician(ordenId, tecnicoUid, tecnicoNombre);
    
    mostrarToast("✅ Técnico asignado correctamente", "success");
    
    // Cerrar modal
    cerrarModalAsignar();
    
    // Recargar órdenes
    setTimeout(() => {
      APP.state.orders = [];
      APP.state.lastVisible = null;
      cargarOrdenesYEquipos(true);
    }, 1000);
  } catch (error) {
    console.error("Error asignando técnico:", error);
    mostrarToast("❌ Error al asignar técnico", "error");
  }
};

window.completarOrden = async function(ordenId) {
  if (!await Modal.confirm({ message: `¿Marcar la orden ${ordenId} como completada?` })) return;
  
  try {
    await OrdenesService.completeOrder(ordenId);
    
    mostrarToast("✅ Orden completada", "success");
    
    // Recargar órdenes
    setTimeout(() => {
      APP.state.orders = [];
      APP.state.lastVisible = null;
      cargarOrdenesYEquipos(true);
    }, 1000);
  } catch (error) {
    console.error("Error completando orden:", error);
    mostrarToast("❌ Error al completar orden", "error");
  }
};

window.entregarOrden = async function(ordenId) {
  if (!await Modal.confirm({ message: `¿Entregar la orden ${ordenId} al cliente?` })) return;
  
  try {
    await OrdenesService.deliverOrder(ordenId);
    
    mostrarToast("✅ Orden entregada al cliente", "success");
    
    // Recargar órdenes
    setTimeout(() => {
      APP.state.orders = [];
      APP.state.lastVisible = null;
      cargarOrdenesYEquipos(true);
    }, 1000);
  } catch (error) {
    console.error("Error entregando orden:", error);
    mostrarToast("❌ Error al entregar orden", "error");
  }
};

// ===== ELIMINAR ORDEN =====
window.eliminarOrden = async function(ordenId) {
  if (!await Modal.confirm({ message: `¿ELIMINAR la orden ${ordenId}? Esta acción no se puede deshacer.`, danger: true })) return;
  
  try {
    await OrdenesService.deleteOrder(ordenId);
    
    mostrarToast("✅ Orden eliminada", "success");
    
    // Recargar órdenes
    setTimeout(() => {
      APP.state.orders = [];
      APP.state.lastVisible = null;
      cargarOrdenesYEquipos(true);
    }, 1000);
  } catch (error) {
    console.error("Error eliminando orden:", error);
    mostrarToast("❌ Error al eliminar orden", "error");
  }
};

// ===== AGREGAR EQUIPO =====
window.agregarEquipo = function(ordenId) {
  window.location.href = `agregar-equipo.html?orden_id=${ordenId}`;
};

// ===== GUARDAR ACCESORIOS (LOTE) =====
window.guardarAccesoriosLote = async function(ordenId) {
  const filaDetalle = document.querySelector(`tr.filaDetalle[data-orden-id="${ordenId}"]`);
  if (!filaDetalle) {
    mostrarToast("⚠️ Abre la orden primero para guardar accesorios", "bad");
    return;
  }

  const updates = {};

  try {
    // Obtener todos los equipos de la orden desde el estado
    const ordenData = APP.state.orders.find(o => o.ordenId === ordenId);
    if (!ordenData || !ordenData.equipos) return;

    // Recorrer cada equipo y extraer el estado actual de sus iconos de accesorios
    ordenData.equipos.forEach(equipo => {
      const equipoId = equipo.id;

      // Buscar los iconos de accesorios para este equipo en la fila de equipos
      const filaEquipo = filaDetalle.querySelector(`tr[data-equipo-id="${ordenId}_${equipoId}"]`);
      if (!filaEquipo) return;

      const accesoriosWrapper = filaEquipo.querySelector('.accesorios-group');
      if (!accesoriosWrapper) return;

      const campos = [
        { name: 'bateria', icon: 'battery-full' },
        { name: 'clip',    icon: 'paperclip' },
        { name: 'cargador',icon: 'plug' },
        { name: 'fuente',  icon: 'zap' },
        { name: 'antena',  icon: 'radio-tower' }
      ];

      // Leer estado de cada accesorio desde los atributos data-campo
      campos.forEach(campo => {
        const accesorioItem = Array.from(accesoriosWrapper.querySelectorAll('.accesorio-item'))
          .find(item => item.dataset.campo === campo.name);

        if (accesorioItem) {
          const isActivo = accesorioItem.classList.contains('activo');
          const key = `${equipoId}.${campo.name}`;
          updates[key] = isActivo;
        }
      });
    });

    if (Object.keys(updates).length > 0) {
      await OrdenesService.batchUpdateAccessories(ordenId, updates);

      // Update local cache with fresh data from Firestore
      const ordenActualizada = await OrdenesService.getOrder(ordenId);
      if (ordenActualizada) {
        const cacheIndex = APP.state.orders.findIndex(o => o.ordenId === ordenId);
        if (cacheIndex !== -1) {
          APP.state.orders[cacheIndex] = ordenActualizada;
        }
      }

      mostrarToast("✅ Accesorios actualizados", "success");
    }

    // Remover modo edición
    delete filaDetalle.dataset.modoAccesorios;

    // Remover listeners y clases de edición
    const accesorioItems = filaDetalle.querySelectorAll('.accesorio-item.editable');
    accesorioItems.forEach(item => {
      item.classList.remove('editable');
      item.style.cursor = '';
      delete item.dataset.listenerAdded;
    });

    // Ocultar botón guardar
    const btnGuardar = document.getElementById(`btnGuardarAccesorios_${ordenId}`);
    if (btnGuardar) btnGuardar.style.display = "none";

    // Cerrar popover de leyenda
    const popover = document.getElementById(`popoverAccesorios_${ordenId}`);
    if (popover) popover.style.display = 'none';

    // Refrescar UI si hubo cambios
    if (Object.keys(updates).length > 0) {
      refrescarEquiposDeOrden(ordenId);
    }
  } catch (error) {
    console.error("Error guardando accesorios:", error);
    mostrarToast("❌ Error al guardar", "error");
  }
};


// END OF PART 1/3

// renderizarOrdenYEquipos, renderEquiposTabla, refrescarEquiposDeOrden, botonesFlujo, botonesGestion → pages/ordenes-render.js


// ordenarOrdenes, cargarOrdenesYEquipos → pages/ordenes-data.js


window.generarNotaEntrega = function(ordenId) {
  const orden = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!orden) {
    showAlertModal("Orden no encontrada", 'error');
    return;
  }

  const equipos = prepararEquiposParaNota(orden, false);

  const data = {
  numeroOrden: orden.ordenId || "",
  cliente: nombreClienteDe(orden),
  observaciones: orden.observaciones || "",
  equipos
};

  localStorage.setItem("notaEntregaData", JSON.stringify(data));
  window.open(BASE +"nota-entrega.html", "_blank");
}

window.generarNotaEntregaIntervenciones = function(ordenId) {
  const orden = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!orden) {
    showAlertModal("Orden no encontrada", 'error');
    return;
  }

  const equipos = prepararEquiposParaNota(orden, true);

  const data = {
    numeroOrden: orden.ordenId || "",
    cliente: nombreClienteDe(orden),
    observaciones: orden.observaciones || "",
    equipos
  };

  localStorage.setItem("notaEntregaData", JSON.stringify(data));
  window.open(BASE + "nota-entrega-intervenciones.html", "_blank");
}

function prepararEquiposParaNota(orden, incluirIntervencion = false) {
  const equipos = Array.isArray(orden?.equipos) ? orden.equipos : [];
  const unicos = [];
  const seen = new Set();

  equipos.forEach((e) => {
    if (!e || e.eliminado === true) return;

    const serial = String(e.numero_de_serie || "").trim();
    const modelo = String(e.modelo || "").trim();
    const nombre = String(e.nombre || "-").trim() || "-";
    const id = String(e.id || "").trim();

    // Prioriza id técnico; si no existe, usa serial+modelo como llave de deduplicación.
    const key = id ? `id:${id}` : `sm:${serial.toLowerCase()}|${modelo.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    const item = { serial, modelo, nombre };
    if (incluirIntervencion) {
      item.intervencion = String(e.trabajo_tecnico || "").trim();
    }
    unicos.push(item);
  });

  return unicos;
}


// getActiveFilters, hasActiveFilters, esOrdenMia, matchesAdvancedFilters, applyActiveFiltersToOrders, renderOrdersList, aplicarFiltrosCombinados, syncMobileAdvancedFiltersToDesktop, filtrarOrdenes → pages/ordenes-filters.js

window.gestionarNotasTecnicas = async function(ordenId) {
  const datos = await OrdenesService.getOrder(ordenId);
  if (!datos) {
    showAlertModal("Orden no encontrada", 'error');
    return;
  }

  const notaAnterior = datos.nota_tecnica || "";

  // 🎨 Crear modal moderno para notas técnicas
  const modal = document.createElement("div");
  modal.className = "notas-modal";

  const dialog = document.createElement("div");
  dialog.className = "notas-dialog";

  const header = document.createElement("div");
  header.className = "notas-header";
  header.innerHTML = `
    <div class="notas-title">
      <span class="notas-icon">🧠</span>
      <h3>Notas Técnicas - Orden ${ordenId}</h3>
    </div>
    <button id="closeNotasModal" class="notas-close" type="button"><i data-lucide="x"></i></button>
  `;

  const content = document.createElement("div");
  content.className = "notas-content";

  const label = document.createElement("label");
  label.className = "notas-label";
  label.textContent = "Escribe las notas técnicas de esta orden:";

  const textarea = document.createElement("textarea");
  textarea.id = "notasTecnicasTextarea";
  textarea.value = notaAnterior;
  textarea.placeholder = "Descripción detallada del trabajo realizado, piezas utilizadas, observaciones importantes...";
  textarea.className = "notas-textarea";

  const charCount = document.createElement("div");
  charCount.className = "notas-charcount";
  charCount.textContent = `${notaAnterior.length} caracteres`;

  textarea.oninput = () => {
    const len = textarea.value.length;
    charCount.textContent = `${len} caracteres`;
    if (len > 5000) {
      charCount.style.color = "#dc2626";
      charCount.textContent += " (máximo recomendado: 5000)";
    } else {
      charCount.style.color = "var(--muted)";
    }
  };

  const footer = document.createElement("div");
  footer.className = "notas-footer";

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "btn secondary";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.onclick = () => document.body.removeChild(modal);

  const btnGuardar = document.createElement("button");
  btnGuardar.className = "btn primary";
  btnGuardar.textContent = "Guardar nota";
  
  btnGuardar.onclick = async () => {
    const nuevaNota = textarea.value.trim();
    
    // Mostrar loading
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = `<span class="spinner"></span> Guardando...`;

    try {
      await OrdenesService.updateTechnicalNote(ordenId, nuevaNota);

      // ✅ Actualizar el botón directamente sin recargar
      const fila = [...document.querySelectorAll("tr")].find(f => f.innerText.includes(ordenId));
      if (fila) {
        const btns = fila.querySelectorAll("button");
        const botonNota = [...btns].find(b => b.textContent.includes("🧠"));
        if (botonNota) {
          if (nuevaNota) {
            botonNota.style.backgroundColor = "#d4edda";
            botonNota.style.borderColor = "#28a745";
            botonNota.title = nuevaNota.slice(0, 100).replace(/"/g, "'") + (nuevaNota.length > 100 ? "..." : "");
          } else {
            botonNota.style.backgroundColor = "";
            botonNota.style.borderColor = "";
            botonNota.title = "Agregar nota técnica";
          }
        }
      }

      document.body.removeChild(modal);
      mostrarToast("✅ Nota técnica guardada exitosamente", "success");
    } catch (error) {
      console.error("Error al guardar nota:", error);
      mostrarToast("❌ Error al guardar la nota técnica", "error");
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Guardar nota";
    }
  };

  // Cerrar con ESC
  const handleEscape = (e) => {
    if (e.key === "Escape" && document.body.contains(modal)) {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);

  // Cerrar al hacer clic fuera
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  dialog.onclick = (e) => e.stopPropagation();

  // Ensamblar modal
  content.appendChild(label);
  content.appendChild(textarea);
  content.appendChild(charCount);
  footer.appendChild(btnCancelar);
  footer.appendChild(btnGuardar);
  dialog.appendChild(header);
  dialog.appendChild(content);
  dialog.appendChild(footer);
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  // Configurar el botón de cerrar DESPUÉS de que el modal esté en el DOM
  document.getElementById("closeNotasModal").onclick = () => {
    document.body.removeChild(modal);
    document.removeEventListener("keydown", handleEscape);
  };

  // Auto-focus y seleccionar todo el texto
  setTimeout(() => {
    textarea.focus();
    textarea.select();
  }, 100);
};

// ===== NUEVAS FUNCIONES DE FILTRADO MEJORADO =====

// filtrarRapido, toggleFiltrosAvanzados, limpiarFiltros → pages/ordenes-filters.js

});

// cambiarOrden, cambiarDireccionOrden → pages/ordenes-filters.js
window.copiarSeriales = function (ordenId) {
  const filas = document.querySelectorAll(`.celda-editable[data-campo="numero_de_serie"][data-id^="${ordenId}_"] .valor`);
  const seriales = [...filas].map(f => f.textContent.trim()).filter(Boolean).join('\n');

  if (!seriales) {
    showAlertModal("No hay seriales para copiar", 'warning');
    return;
  }

  navigator.clipboard.writeText(seriales)
    .then(() => mostrarToast('✅ Seriales copiados al portapapeles', 'ok'))
    .catch(err => showAlertModal(`Error al copiar: ${err}`, 'error'));
};

function resolverEquipoDesdeCompuesto(compuestoId) {
  const orders = APP.state.orders || [];
  for (const orden of orders) {
    const equipos = Array.isArray(orden.equipos) ? orden.equipos : [];
    const equipo = equipos.find(eq => `${orden.ordenId}_${eq.id}` === compuestoId);
    if (equipo) {
      return { ordenId: orden.ordenId, equipoId: equipo.id, orden, equipo };
    }
  }
  return null;
}

window.editarCampoEquipo = async function(compuestoId, campo, valorActual = "") {
  const permitidos = new Set(["numero_de_serie", "modelo", "observaciones"]);
  if (!permitidos.has(campo)) {
    mostrarToast("⚠️ Campo no editable", "bad");
    return;
  }

  const target = resolverEquipoDesdeCompuesto(compuestoId);
  if (!target) {
    mostrarToast("❌ Equipo no encontrado", "bad");
    return;
  }

  const etiqueta = campo === "numero_de_serie"
    ? "Número de serie"
    : (campo === "modelo" ? "Modelo" : "Observaciones");

  const nuevoValor = window.prompt(`Editar ${etiqueta}:`, valorActual ?? "");
  if (nuevoValor === null) return;

  const valorLimpio = String(nuevoValor).trim();
  if (campo !== "observaciones" && !valorLimpio) {
    mostrarToast(`⚠️ ${etiqueta} no puede quedar vacío`, "bad");
    return;
  }

  try {
    await OrdenesService.updateEquipmentField(target.ordenId, target.equipoId, campo, valorLimpio);

    const cacheOrden = APP.state.orders.find(o => o.ordenId === target.ordenId);
    if (cacheOrden && Array.isArray(cacheOrden.equipos)) {
      const i = cacheOrden.equipos.findIndex(eq => eq.id === target.equipoId);
      if (i >= 0) cacheOrden.equipos[i][campo] = valorLimpio;
    }

    refrescarEquiposDeOrden(target.ordenId);
    mostrarToast("✅ Equipo actualizado", "ok");
  } catch (e) {
    console.error("❌ Error al editar campo del equipo:", e);
    mostrarToast(`❌ Error al actualizar: ${e?.message || e}`, "bad");
  }
};

window.eliminarEquipo = async function(e, compuestoId) {
  if (e) e.stopPropagation();

  const target = resolverEquipoDesdeCompuesto(compuestoId);
  if (!target) {
    mostrarToast("❌ Equipo no encontrado", "bad");
    return;
  }

  if (!await Modal.confirm({ message: '¿Eliminar este equipo de la orden?', danger: true })) return;

  try {
    await OrdenesService.deleteEquipment(target.ordenId, target.equipoId);

    const cacheOrden = APP.state.orders.find(o => o.ordenId === target.ordenId);
    if (cacheOrden && Array.isArray(cacheOrden.equipos)) {
      const i = cacheOrden.equipos.findIndex(eq => eq.id === target.equipoId);
      if (i >= 0) cacheOrden.equipos[i].eliminado = true;
    }

    refrescarEquiposDeOrden(target.ordenId);
    mostrarToast("✅ Equipo eliminado", "ok");
  } catch (err) {
    console.error("❌ Error al eliminar equipo:", err);
    showAlertModal("Error al eliminar equipo", "error");
  }
};

let equipoEditandoId = null;
let equipoEditandoOrdenId = null;

window.abrirEditorAccesorios = function(id, datosEquipo) {
  equipoEditandoId = id.split("_")[1];
  equipoEditandoOrdenId = id.split("_")[0];

  const form = document.getElementById("formAccesorios");
  ["bateria", "clip", "cargador", "fuente", "antena"].forEach(campo => {
    form.elements[campo].checked = !!datosEquipo[campo];
  });

  document.getElementById("modalAccesorios").style.display = "block";
};


window.activarModoAccesorios = function (ordenId) {
  const campos = ["bateria", "clip", "cargador", "fuente", "antena"];
  const filaDetalle = document.querySelector(`tr.filaDetalle[data-orden-id="${ordenId}"]`);
  
  if (!filaDetalle) {
    mostrarToast("⚠️ Abre la orden primero para editar accesorios", "bad");
    return;
  }
  
  // Marcar que estamos en modo edición
  filaDetalle.dataset.modoAccesorios = "true";
  
  // Hacer todos los accesorio-items clickeables
  const accesorioItems = filaDetalle.querySelectorAll('.accesorio-item');
  
  accesorioItems.forEach(item => {
    // Agregar clase de edición para estilos visuales
    item.classList.add('editable');
    
    // Si no tiene listener, agregarlo
    if (!item.dataset.listenerAdded) {
      item.dataset.listenerAdded = "true";
      item.style.cursor = "pointer";
      
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        // Toggle estado activo/inactivo
        if (this.classList.contains('activo')) {
          this.classList.remove('activo');
          this.classList.add('inactivo');
        } else {
          this.classList.remove('inactivo');
          this.classList.add('activo');
        }
      });
    }
  });
  
  // Mostrar botón guardar
  const btnGuardar = document.getElementById(`btnGuardarAccesorios_${ordenId}`);
  if (btnGuardar) btnGuardar.style.display = "inline-block";
  
  // Mostrar automáticamente la leyenda de accesorios
  const popover = document.getElementById(`popoverAccesorios_${ordenId}`);
  if (popover) {
    popover.style.display = 'block';
  }
};

// nombreClienteDe, getEstadoClass, tipoChip, estadoCompacto → pages/ordenes-state.js

// actualizarResumen → pages/ordenes-render.js

window.abrirEquiposMobile = function(ordenId) {
  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  if (!o) return;

  const equipos = (o.equipos || []).filter(e => !e.eliminado);

  const title = document.getElementById("equiposMobileTitle");
  const sub = document.getElementById("equiposMobileSub");
  const list = document.getElementById("equiposMobileList");
  const modal = document.getElementById("modalEquiposMobile");

  if (title) title.textContent = `Orden #${ordenId} · Equipos`;
  if (sub) sub.textContent = `${nombreClienteDe(o)} · ${equipos.length} equipo(s)`;

  if (!list) return;
  if (equipos.length === 0) {
    list.innerHTML = `
      <div class="equipos-empty">
        <div class="equipos-empty-icon"><i data-lucide="package"></i></div>
        <div class="equipos-empty-text">No hay equipos asociados</div>
      </div>
    `;
  } else {
    list.innerHTML = equipos.map((e, idx) => {
      const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
      const modelo = (e.modelo || e.MODEL || e.modelo_nombre || "-").toString();
      const obs = (e.observaciones || e.descripcion || e.nombre || "").toString();
      const noDisponible = !!e.intervencion_no_disponible;
      const motivoNoDisponible = (e.motivo_no_disponible || "").toString();
      const cardClass = `equipo-card ${noDisponible ? 'equipo-card--no-disponible' : (e.trabajo_tecnico ? 'equipo-card--ok' : '')}`;

      // 2-line clamp usando CSS inline simple
      const obsHtml = obs
        ? `<div class="equipo-obs clamp-2">${escapeHtml(obs)}</div>
           <button class="btn ghost equipo-obs-more" data-action="ver-obs-completa" data-orden-id="${ordenId}" data-idx="${idx}"><i data-lucide="eye"></i> Ver más</button>`
        : `<div class="equipo-obs equipo-obs--empty">Sin observaciones</div>`;
      
      // Trabajo tecnico display
      const trabajoDisplay = (e.trabajo_tecnico || "").trim()
        ? `<div class="trabajo-card trabajo-card--ok">
             <div class="trabajo-header">
               <span class="trabajo-icon">✓</span>
               <strong class="trabajo-title">Intervención Registrada</strong>
             </div>
             <div class="trabajo-text clamp-2">${escapeHtml(e.trabajo_tecnico)}</div>
           </div>`
        : (noDisponible
          ? `<div class="trabajo-card trabajo-card--warn">
               Equipo no disponible para intervención${motivoNoDisponible ? ` · ${escapeHtml(motivoNoDisponible)}` : ''}
             </div>`
          : `<div class="trabajo-card trabajo-card--empty">Sin intervención registrada</div>`
        );

      return `
        <div class="${cardClass}">
          <div class="equipo-card-header">
            <div class="equipo-card-info">
              <div class="equipo-card-serial"><i data-lucide="package"></i> ${escapeHtml(serial)}</div>
              <div class="equipo-card-model">Modelo: <span class="equipo-card-model-value">${escapeHtml(modelo)}</span></div>
            </div>
            ${noDisponible
              ? '<div class="equipo-status-badge equipo-status-badge--warn"><i data-lucide="ban"></i> No disponible</div>'
              : (e.trabajo_tecnico ? '<div class="equipo-status-badge equipo-status-badge--ok">✓ OK</div>' : '')
            }
          </div>
          ${obsHtml}
          
          <div class="equipo-card-actions">
            <button class="btn ${e.trabajo_tecnico ? 'ok' : 'secondary'} equipo-card-action"
              data-action="abrir-trabajo-equipo" data-orden-id="${ordenId}" data-idx="${idx}">
              <i data-lucide="${e.trabajo_tecnico ? 'check-circle' : 'pencil-line'}"></i> Intervención
            </button>

            <button class="btn ghost equipo-card-view"
              data-action="ver-trabajo-equipo" data-orden-id="${ordenId}" data-idx="${idx}" title="Ver comentario">
              <i data-lucide="eye"></i>
            </button>
          </div>

          ${trabajoDisplay}
        </div>
      `;
    }).join("");
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (modal) APP.utils.show(modal);
};

window.cerrarEquiposMobile = function() {
  const modal = document.getElementById("modalEquiposMobile");
  if (modal) APP.utils.hide(modal);
};

let _trabajoOrdenId = null;
let _trabajoEquipoIdx = null;

window.abrirTrabajoEquipoModal = function(ordenId, idx) {
  // Check permissions
  const rol = APP.state.userRole || "";
  if (![ROLES.TECNICO, ROLES.TECNICO_OPERATIVO, ROLES.ADMIN, ROLES.RECEPCION].includes(rol)) {
    mostrarToast("Sin permisos para editar", "bad");
    return;
  }

  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  if (!o) return;

  const equipos = (o.equipos || []).filter(e => !e.eliminado);
  const e = equipos[idx];
  if (!e) return;

  _trabajoOrdenId = ordenId;
  _trabajoEquipoIdx = idx;

  const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
  const modelo = (e.modelo || e.MODEL || e.modelo_nombre || "-").toString();

  document.getElementById("trabajoEquipoTitle").textContent = `✍️ Intervención técnica · ${serial}`;
  document.getElementById("trabajoEquipoSub").textContent = `Modelo: ${modelo}`;
  const txtEl = document.getElementById("trabajoEquipoText");
  if (txtEl) txtEl.value = (e.trabajo_tecnico || "").toString();

  const chkNoDisp = document.getElementById("trabajoNoDisponible");
  const motivoNoDisp = document.getElementById("trabajoMotivoNoDisponible");
  const isNoDisp = !!e.intervencion_no_disponible;
  if (chkNoDisp) chkNoDisp.checked = isNoDisp;
  if (motivoNoDisp) {
    motivoNoDisp.value = (e.motivo_no_disponible || "").toString();
    motivoNoDisp.disabled = !isNoDisp;
  }
  if (txtEl) txtEl.disabled = isNoDisp;

  if (chkNoDisp) {
    chkNoDisp.onchange = () => {
      const checked = chkNoDisp.checked;
      if (motivoNoDisp) {
        motivoNoDisp.disabled = !checked;
        if (!checked) motivoNoDisp.value = "";
        else setTimeout(() => motivoNoDisp.focus(), 0);
      }
      if (txtEl) {
        if (checked) txtEl.value = "";
        txtEl.disabled = checked;
      }
    };
  }

  const modal = document.getElementById("modalTrabajoEquipo");
  
  // Add backdrop click handler (close when clicking outside modal)
  modal.onclick = function(e) {
    if (e.target === modal) {
      cerrarTrabajoEquipoModal();
    }
  };
  
  APP.utils.show(modal);
  setTimeout(() => document.getElementById("trabajoEquipoText")?.focus(), 50);
};

window.cerrarTrabajoEquipoModal = function() {
  const modal = document.getElementById("modalTrabajoEquipo");
  if (modal) APP.utils.hide(modal);
  _trabajoOrdenId = null;
  _trabajoEquipoIdx = null;
};

window.abrirIntervencionEquipoDesktop = function(ordenId, equipoId) {
  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  if (!o) return;

  const equipos = (o.equipos || []).filter(e => !e.eliminado);
  const idx = equipos.findIndex(e => e.id === equipoId);
  if (idx === -1) return;

  // Reutilizamos el modal existente de mobile
  abrirTrabajoEquipoModal(ordenId, idx);
};

window.verTrabajoEquipo = function(ordenId, idx) {
  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  const equipos = (o?.equipos || []).filter(e => !e.eliminado);
  const e = equipos[idx];
  if (!e) return;

  const texto = (e.trabajo_tecnico || "").toString().trim();
  const noDisponible = !!e.intervencion_no_disponible;
  const motivo = (e.motivo_no_disponible || "").toString().trim();
  const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
  
  showTextModal(
    `Intervención Técnica · ${serial}`,
    texto || (noDisponible ? `Equipo no disponible para intervención${motivo ? ` · ${motivo}` : ""}` : "Sin intervención registrada"),
    !texto && !noDisponible
  );
};

window.guardarTrabajoEquipoModal = async function() {
  if (!_trabajoOrdenId && _trabajoOrdenId !== "") return;
  if (_trabajoEquipoIdx === null || _trabajoEquipoIdx === undefined) return;

  const btn = document.getElementById("btnGuardarTrabajoEquipo");
  const txt = (document.getElementById("trabajoEquipoText")?.value || "").trim();
  const chkNoDisp = document.getElementById("trabajoNoDisponible");
  const motivoNoDisp = (document.getElementById("trabajoMotivoNoDisponible")?.value || "").trim();
  const marcarNoDisp = !!chkNoDisp?.checked;

  try {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Guardando...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const user = firebase.auth().currentUser;
    const uid = user?.uid || "";
    const email = user?.email || "";

    const cacheOrden = APP.state.orders.find(x => x.ordenId === _trabajoOrdenId);
    const cacheEquipos = (cacheOrden?.equipos || []).filter(e => !e.eliminado);
    const cacheEquipo = cacheEquipos[_trabajoEquipoIdx];

    if (marcarNoDisp) {
      if (!cacheEquipo?.id) throw new Error("Equipo no encontrado");
      const equiposAll = await OrdenesService.updateEquipoNoDisponible({
        ordenId: _trabajoOrdenId,
        equipoId: cacheEquipo?.id,
        noDisponible: true,
        motivo: motivoNoDisp,
        uid,
        email
      });

      if (cacheOrden) cacheOrden.equipos = equiposAll;
      refrescarEquiposDeOrden(_trabajoOrdenId);
      cerrarTrabajoEquipoModal();
      mostrarToast("⚠️ Equipo marcado como no disponible", "ok");
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save"></i> Guardar';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    if (cacheEquipo?.intervencion_no_disponible) {
      if (!cacheEquipo?.id) throw new Error("Equipo no encontrado");
      await OrdenesService.updateEquipoNoDisponible({
        ordenId: _trabajoOrdenId,
        equipoId: cacheEquipo?.id,
        noDisponible: false,
        motivo: "",
        uid,
        email
      });
    }

    const equiposAll = await OrdenesService.updateTrabajoTecnico({
      ordenId: _trabajoOrdenId,
      equipoIdx: _trabajoEquipoIdx,
      texto: txt,
      uid,
      email
    });
    // Actualizar cache local
    const cache = APP.state.orders.find(x => x.ordenId === _trabajoOrdenId);
    if (cache) cache.equipos = equiposAll;

    // Refrescar UI - solo la tabla de equipos expandida si existe (desktop)
    refrescarEquiposDeOrden(_trabajoOrdenId);

    cerrarTrabajoEquipoModal();
    mostrarToast("✅ Intervención guardada", "ok");
    
    // Reset button state
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Guardar';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    console.error("❌ Error guardando trabajo del equipo:", e);
    mostrarToast(`❌ Error al guardar: ${e?.message || e}`, "bad");
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Guardar';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
};

async function setEquipoNoDisponible({ ordenId, equipoId, noDisponible, motivo }) {
  if (!ordenId || !equipoId) return;

  try {
    const user = firebase.auth().currentUser;
    const uid = user?.uid || "";
    const email = user?.email || "";

    const equiposAll = await OrdenesService.updateEquipoNoDisponible({
      ordenId,
      equipoId,
      noDisponible,
      motivo,
      uid,
      email
    });

    const cache = APP.state.orders.find(x => x.ordenId === ordenId);
    if (cache) cache.equipos = equiposAll;

    refrescarEquiposDeOrden(ordenId);

    const modal = document.getElementById("modalEquiposMobile");
    if (modal && !modal.classList.contains("hidden")) {
      abrirEquiposMobile(ordenId);
    }

    mostrarToast(noDisponible ? "⚠️ Equipo marcado como no disponible" : "✅ Equipo marcado como disponible", "ok");
  } catch (e) {
    console.error("❌ Error actualizando no disponible:", e);
    mostrarToast("❌ Error al actualizar estado", "bad");
  }
}

// Modal simple para obs completa
window.verObsCompleta = function(ordenId, idx) {
  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  const equipos = (o?.equipos || []).filter(e => !e.eliminado);
  const e = equipos[idx];
  if (!e) return;

  const obs = (e.observaciones || e.descripcion || e.nombre || "").toString();
  const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
  
  showTextModal(
    `📝 Observaciones · ${serial}`,
    obs || "Sin observaciones",
    !obs
  );
};

// escapeHtml → pages/ordenes-state.js

// filtrarPorEstado → pages/ordenes-filters.js

// 🔄 Forzar recarga de órdenes al regresar desde otra página (ej. firmar-entrega)
window.addEventListener("pageshow", (event) => {
  if (event.persisted || performance.getEntriesByType("navigation")[0].type === "back_forward") {
    console.log("♻️ Recargando órdenes tras regresar a la página...");
    cargarOrdenesYEquipos(true);
  }
});
function mostrarNotificacionProgreso(data) {
  const box = document.createElement("div");
  box.className = "notificacion-progreso";
  box.innerHTML = `
    <strong>🎯 ¡Orden completada!</strong><br>
    <small>Semana: ${data.semanal} · Mes: ${data.mensual} · Total: ${data.total}</small>
  `;
  document.body.appendChild(box);

  setTimeout(() => {
    box.classList.add("fade-out");
    setTimeout(() => box.remove(), 1000);
  }, 3000);
}

// ===== MOBILE UI HELPERS (NO LOGIC CHANGES) =====
function openMobileFilters() {
  const b = document.getElementById('mobileDrawerBackdrop');
  if (b) b.style.display = 'flex';

  // sync mobile sort select with existing select
  const real = document.getElementById('APP.state.sortField');
  const mob = document.getElementById('mobileSortField');
  if (real && mob) mob.value = real.value || 'ordenId';
}

function closeMobileFilters() {
  const b = document.getElementById('mobileDrawerBackdrop');
  if (b) b.style.display = 'none';
}

function mobileScrollTop() {
  closeMobileFilters();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mobileClearAll() {
  // reuse existing clear
  if (typeof limpiarFiltros === 'function') limpiarFiltros();

  // clear mobile quick search UI
  const q = document.getElementById('mobileQuickSearch');
  if (q) q.value = '';

  // clear chip active state
  document.querySelectorAll('#mobileEstadoChips .mchip').forEach(c => c.classList.remove('active'));

  closeMobileFilters();
}

function mobileApplyQuickSearch() {
  const qRaw = (document.getElementById('mobileQuickSearch')?.value || '').trim();
  const q = qRaw.toLowerCase();

  const inOrden = document.getElementById('filtroOrden');
  const inCliente = document.getElementById('filtroCliente');
  const inSerial = document.getElementById('filtroSerial');

  if (inOrden) inOrden.value = '';
  if (inCliente) inCliente.value = '';
  if (inSerial) inSerial.value = '';

  if (!q) {
    if (typeof filtrarOrdenes === 'function') filtrarOrdenes();
    closeMobileFilters();
    return;
  }

  const onlyDigits = /^\d+$/.test(q);
  const hasSpace = /\s/.test(q);
  const hasLetter = /[a-z]/i.test(q);
  const hasDigit = /\d/.test(q);

  if (onlyDigits) {
    // Pure numbers -> order
    if (inOrden) inOrden.value = qRaw;
  } else if (hasSpace || (hasLetter && !hasDigit)) {
    // Names / companies / phrases -> cliente
    if (inCliente) inCliente.value = qRaw;
  } else if (hasLetter && hasDigit && !hasSpace) {
    // Mixed serial-like token
    if (inSerial) inSerial.value = qRaw;
  } else {
    // Fallback
    if (inCliente) inCliente.value = qRaw;
  }

  if (typeof filtrarOrdenes === 'function') filtrarOrdenes();
  closeMobileFilters();
}

function mobileSyncSortField() {
  const mob = document.getElementById('mobileSortField');
  const real = document.getElementById('APP.state.sortField');
  if (mob && real) {
    real.value = mob.value;
    if (typeof cambiarOrden === 'function') cambiarOrden();
  }
}

function mobileToggleSortDir() {
  if (typeof cambiarDireccionOrden === 'function') cambiarDireccionOrden();
}

// Chip click wiring
document.addEventListener('click', (e) => {
  const chip = e.target.closest('#mobileEstadoChips .mchip');
  if (!chip) return;

  const estado = chip.getAttribute('data-estado') || '';
  const wasActive = chip.classList.contains('active');
  const chips = document.querySelectorAll('#mobileEstadoChips .mchip');

  chips.forEach(c => c.classList.remove('active'));

  let finalEstado = estado;
  if (wasActive) {
    // toggle off -> Todos
    finalEstado = '';
    // also highlight Todos chip
    const todos = document.querySelector('#mobileEstadoChips .mchip[data-estado=""]');
    if (todos) todos.classList.add('active');
  } else {
    chip.classList.add('active');
  }

  // Sync existing select and call existing handler
  const sel = document.getElementById('filtroEstado');
  if (sel) sel.value = finalEstado;

  if (typeof filtrarPorEstado === 'function') filtrarPorEstado(finalEstado);
  closeMobileFilters();
});

// Allow Enter key to search from mobile quick search
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement?.id === 'mobileQuickSearch') {
    e.preventDefault();
    mobileApplyQuickSearch();
  }
});

// Ensure callable from inline onclick
window.openMobileFilters = openMobileFilters;
window.closeMobileFilters = closeMobileFilters;
window.mobileScrollTop = mobileScrollTop;
window.mobileClearAll = mobileClearAll;
window.mobileApplyQuickSearch = mobileApplyQuickSearch;
window.mobileSyncSortField = mobileSyncSortField;
window.mobileToggleSortDir = mobileToggleSortDir;

// Overflow Menu Controls
window.toggleOverflowMenu = function(ordenId) {
  const menu = document.getElementById(`overflow-menu-${ordenId}`);
  if (!menu) return;
  const row = document.querySelector(`tr[data-orden-id="${ordenId}"]`);
  
  // Close all other menus first
  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== `overflow-menu-${ordenId}`) {
      m.classList.remove('show');
    }
  });
  document.querySelectorAll('tr.menu-open').forEach(r => r.classList.remove('menu-open'));
  
  // Toggle this menu
  menu.classList.toggle('show');
  if (menu.classList.contains('show') && row) {
    row.classList.add('menu-open');
  }
};

window.toggleOrderActionsMenu = function(ordenId) {
  const menu = document.getElementById(`order-actions-${ordenId}`);
  if (!menu) return;

  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== `order-actions-${ordenId}`) {
      m.classList.remove('show');
    }
  });

  menu.classList.toggle('show');
};


window.toggleTopbarMenu = function() {
  const menu = document.getElementById('topbar-menu');
  const btn = document.querySelector('[data-action="toggle-topbar-menu"]');
  if (!menu) return;

  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== 'topbar-menu') {
      m.classList.remove('show');
    }
  });

  menu.classList.toggle('show');
  if (btn) btn.setAttribute('aria-expanded', menu.classList.contains('show') ? 'true' : 'false');
};

window.toggleResumenMenu = function() {
  const menu = document.getElementById('resumen-menu');
  const btn = document.querySelector('[data-action="toggle-resumen-menu"]');
  if (!menu) return;

  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== 'resumen-menu') {
      m.classList.remove('show');
    }
  });

  menu.classList.toggle('show');
  if (btn) btn.setAttribute('aria-expanded', menu.classList.contains('show') ? 'true' : 'false');
};

window.closeAllMenus = function() {
  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    m.classList.remove('show');
  });
  const btn = document.querySelector('[data-action="toggle-topbar-menu"]');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  const resumenBtn = document.querySelector('[data-action="toggle-resumen-menu"]');
  if (resumenBtn) resumenBtn.setAttribute('aria-expanded', 'false');
  document.querySelectorAll('tr.menu-open').forEach(r => r.classList.remove('menu-open'));
};

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.overflow-menu')) {
    closeAllMenus();
  }
});

// Close menus on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllMenus();
  }
});

// Text Display Modal System
let textModalEl = null;

function createTextModal() {
  if (textModalEl) return textModalEl;
  
  const overlay = document.createElement('div');
  overlay.className = 'text-modal-overlay';
  overlay.id = 'textModalOverlay';
  
  overlay.innerHTML = `
    <div class="text-modal-content" data-stop-propagation="true">
      <div class="text-modal-header">
        <div class="text-modal-title" id="textModalTitle"></div>
        <button class="text-modal-close" data-action="close-text-modal" aria-label="Cerrar"><i data-lucide="x"></i></button>
      </div>
      <div class="text-modal-body">
        <div class="text-modal-text" id="textModalBody"></div>
      </div>
      <div class="text-modal-footer">
        <button class="text-modal-btn secondary" data-action="copy-text-modal"><i data-lucide="copy"></i> Copiar</button>
        <button class="text-modal-btn primary" data-action="close-text-modal">Cerrar</button>
      </div>
    </div>
  `;
  
  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTextModal();
  });
  
  // Close on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) {
      closeTextModal();
    }
  });
  
  document.body.appendChild(overlay);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  textModalEl = overlay;
  return overlay;
}

window.showTextModal = function(title, text, isEmpty = false) {
  const modal = createTextModal();
  const titleEl = document.getElementById('textModalTitle');
  const bodyEl = document.getElementById('textModalBody');
  
  titleEl.innerHTML = escapeHtml(title);
  
  if (isEmpty || !text || text.trim() === '') {
    bodyEl.innerHTML = '<div class="text-modal-empty">📭 Sin contenido para mostrar</div>';
    bodyEl.dataset.text = '';
  } else {
    bodyEl.textContent = text;
    bodyEl.dataset.text = text;
  }
  
  modal.classList.add('show');
  
  // Prevent body scroll when modal is open
  document.body.style.overflow = 'hidden';
};

window.closeTextModal = function() {
  if (textModalEl) {
    textModalEl.classList.remove('show');
    document.body.style.overflow = '';
  }
};

window.copyTextModalContent = function() {
  const bodyEl = document.getElementById('textModalBody');
  const text = bodyEl?.dataset?.text || bodyEl?.textContent || '';
  
  if (!text || text.trim() === '') {
    mostrarToast('⚠️ No hay contenido para copiar', 'bad');
    return;
  }
  
  navigator.clipboard.writeText(text)
    .then(() => {
      mostrarToast('✅ Copiado al portapapeles', 'ok');
    })
    .catch(err => {
      console.error('Error copying:', err);
      mostrarToast('❌ Error al copiar', 'bad');
    });
};

// Alert Modal System
let alertModalEl = null;
let alertModalTimer = null;

function createAlertModal() {
  if (alertModalEl) return alertModalEl;
  
  const overlay = document.createElement('div');
  overlay.className = 'alert-modal-overlay';
  overlay.id = 'alertModalOverlay';
  
  overlay.innerHTML = `
    <div class="alert-modal-content" data-stop-propagation="true">
      <div class="alert-modal-icon" id="alertModalIcon"></div>
      <div class="alert-modal-message" id="alertModalMessage"></div>
      <button class="alert-modal-button" data-action="close-alert-modal">Entendido</button>
    </div>
  `;
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAlertModal();
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) {
      closeAlertModal();
    }
  });
  
  document.body.appendChild(overlay);
  alertModalEl = overlay;
  return overlay;
}

window.showAlertModal = function(message, type = 'info', autoDismiss = false) {
  const modal = createAlertModal();
  const iconEl = document.getElementById('alertModalIcon');
  const messageEl = document.getElementById('alertModalMessage');
  
  // Set icon based on type
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  iconEl.textContent = icons[type] || icons.info;
  messageEl.textContent = message;
  
  // Remove previous type classes
  modal.classList.remove('success', 'error', 'warning', 'info');
  modal.classList.add(type);
  modal.classList.add('show');
  
  // Clear existing timer
  if (alertModalTimer) {
    clearTimeout(alertModalTimer);
    alertModalTimer = null;
  }
  
  // Auto-dismiss for success messages
  if (autoDismiss && type === 'success') {
    alertModalTimer = setTimeout(() => {
      closeAlertModal();
    }, 2000);
  }
  
  document.body.style.overflow = 'hidden';
};

window.closeAlertModal = function() {
  if (alertModalEl) {
    alertModalEl.classList.remove('show');
    document.body.style.overflow = '';
  }
  if (alertModalTimer) {
    clearTimeout(alertModalTimer);
    alertModalTimer = null;
  }
};


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
