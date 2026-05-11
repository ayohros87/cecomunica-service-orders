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
 *    - **EXTRACTED to ordenes.state.js**
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
 *    - APP, CONFIG, APP.utils → ordenes.state.js
 *    - Reduces this file from ~2600 to ~2400 lines
 * 
 * Dependencies: ordenes.state.js (APP, CONFIG), ordenesService.js, clientesService.js
 * ======================================== */

/* ========================================
   APP namespace, CONFIG, and utils are defined in ordenes.state.js
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
function mostrarFeedbackEquipo(equipoId, tipo = 'success') {
  const fila = document.querySelector(`tr[data-equipo-id="${equipoId}"]`);
  if (!fila) return;
  
  // Remover clase anterior si existe
  fila.classList.remove('feedback-success', 'feedback-update');
  
  // Forzar reflow para reiniciar animación
  void fila.offsetWidth;
  
  // Agregar nueva clase
  fila.classList.add(`feedback-${tipo}`);
  
  // Remover clase después de animación
  setTimeout(() => {
    fila.classList.remove(`feedback-${tipo}`);
  }, 1200);
}

// Exportar para uso global
window.mostrarFeedbackEquipo = mostrarFeedbackEquipo;

function formatFecha(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate();
    return d.toISOString().slice(0,10);
  } catch {
    return "—";
  }
}

function setFechaEntregaVisible(visible) {
  const body = document.body;
  if (!body) return;
  body.classList.toggle("hide-fecha-entrega", !visible);

  document.querySelectorAll(".toggle-fecha-entrega-btn").forEach(btn => {
    btn.textContent = visible ? "Ocultar fecha entrega" : "Mostrar fecha entrega";
  });
}

async function cargarClientes() {
  const clientesData = await ClientesService.loadClientes();
  clientesData.forEach((cliente, id) => {
    APP.state.clientesMap[id] = cliente.nombre;
  });
}

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

// BASE and modelosDisponibles are defined in ordenes.state.js

document.addEventListener("DOMContentLoaded", function () {
          function obtenerIconoLapiz(id, campo, valorActual) {
        return `
          <button class="lapiz" data-action="editar-campo-equipo" data-id="${id}" data-campo="${campo}" data-valor="${valorActual}">
            <svg xmlns="http://www.w3.org/2000/svg" class="lapiz-icon" viewBox="0 0 24 24" width="16" height="16">
              <path fill="#aaa" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
            </svg>
          </button>
        `;
      }
        
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

function aplicarRestriccionesPorRol(rol) {
  const normalizedRole = String(rol || "").trim().toLowerCase();
  const btnNuevaOrden = document.querySelector("button[data-action='go-nueva-orden']");
  const btnConfig = document.querySelector("button[data-action='go-config']");
  const btnProgreso = document.getElementById("btnProgresoTecnicos");
  const btnAdminEquiposCliente = document.getElementById("btnAdminEquiposCliente");
  const mobileBtnAdminEquiposCliente = document.getElementById("mobileBtnAdminEquiposCliente");

  // Ocultar botones según rol
  if ([ROLES.VENDEDOR, ROLES.VISTA].includes(normalizedRole)) {
    if (btnNuevaOrden) btnNuevaOrden.remove();
    if (btnConfig) btnConfig.remove();
  }

  if (normalizedRole !== ROLES.ADMIN && normalizedRole !== ROLES.RECEPCION) {
    document.querySelectorAll(".btn-agregar-equipo").forEach(b => b.style.display = "none");
  }

  // ✅ Mostrar "Progreso Técnicos" a todos los técnicos y administradores
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
}

// Export to window to prevent reference errors
window.aplicarRestriccionesPorRol = aplicarRestriccionesPorRol;

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
  if (!confirm(`¿Marcar la orden ${ordenId} como completada?`)) return;
  
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
  if (!confirm(`¿Entregar la orden ${ordenId} al cliente?`)) return;
  
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
  if (!confirm(`¿ELIMINAR la orden ${ordenId}? Esta acción no se puede deshacer.`)) return;
  
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
        { name: 'bateria', icon: '🔋' },
        { name: 'clip', icon: '📎' },
        { name: 'cargador', icon: '🔌' },
        { name: 'fuente', icon: '⚡' },
        { name: 'antena', icon: '📡' }
      ];

      // Leer estado de cada accesorio desde los iconos
      campos.forEach(campo => {
        const accesorioItem = Array.from(accesoriosWrapper.querySelectorAll('.accesorio-item'))
          .find(item => item.querySelector('.icono')?.textContent === campo.icon);

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

/* ========================================
   PART 2/3: Rendering & Data Loading
   ======================================== */

function renderizarOrdenYEquipos(ordenId, ordenData, equipos, contenedor) {
  // ✅ NORMALIZACIÓN ROBUSTA: Siempre asegurar que equipos sea un array
  const equiposNormalizados = Array.isArray(equipos) ? equipos : [];
  const sinEquipos = equiposNormalizados.length === 0;
  
  // Función para normalizar tipo de servicio
  function normalizarTipo(tipo) {
    return (tipo || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""); // Elimina diacríticos (tildes)
  }
  
  const filaOrden = document.createElement("tr");
  filaOrden.setAttribute("data-orden-id", ordenId);  // ✅ añadir
  const tieneNota = ordenData.nota_tecnica && ordenData.nota_tecnica.trim() !== "";
  const estiloNota = tieneNota ? 'background-color: #d4edda;' : '';
  const tooltipNota = tieneNota
    ? ordenData.nota_tecnica.slice(0, 80).replace(/"/g, "'")
    : 'Agregar nota técnica';
  const estado = (ordenData.estado_reparacion || "POR ASIGNAR").toUpperCase();
  const fotosTallerCount = Number(ordenData.fotos_taller_count || 0);
  const fotosBadge = fotosTallerCount > 0
    ? `<span class="fotos-taller-badge" title="Fotos de taller">📸 ${fotosTallerCount}</span>`
    : "";

  filaOrden.style.cursor = "pointer";
const trabajo = (ordenData.trabajo_estado)
  || (ordenData.cotizacion_emitida ? 'COMPLETADO' : 'SIN_INICIAR');

const dotClass =
  trabajo === 'COMPLETADO'   ? 'dot green'  :
  trabajo === 'EN_PROGRESO'  ? 'dot orange' :
                               'dot';

// ✅ Ícono de advertencia para órdenes sin equipos
const iconoAdvertencia = sinEquipos 
  ? '<span class="warn-icon" title="Orden sin equipos" style="color: #d97706; font-size: 16px; margin-left: 6px; font-weight: bold; cursor: help;">⚠️</span>' 
  : '';

// ✅ Ícono de contrato para PROGRAMACIÓN
let iconoContrato = '';
if (normalizarTipo(ordenData.tipo_de_servicio) === "PROGRAMACION") {
  if (ordenData.contrato) {
    if (ordenData.contrato.aplica === true) {
      const contratoNumero = ordenData.contrato.contrato_id || 'ID no disponible';
      iconoContrato = `<span title="Contrato: ${contratoNumero}" style="color: #059669; font-size: 14px; margin-left: 4px; cursor: help;">🔗</span>`;
    } else if (ordenData.contrato.aplica === false) {
      const motivoShort = ordenData.contrato.motivo_no_aplica || 'Sin motivo';
      iconoContrato = `<span title="No aplica contrato: ${motivoShort}" style="color: #dc2626; font-size: 14px; margin-left: 4px; cursor: help;">🚫</span>`;
    }
  } else {
    // Orden de PROGRAMACIÓN sin campo contrato (data vieja)
    iconoContrato = '<span title="PROGRAMACIÓN sin contrato registrado" style="color: #f59e0b; font-size: 14px; margin-left: 4px; cursor: help;">⚠️</span>';
  }
}

filaOrden.innerHTML = `
  <td>
    <span class="${dotClass}"></span>
    <span class="flecha">▶</span>
    ${ordenId}
    ${fotosBadge}
  </td>
  <td class="client-name-cell">
    <div class="cliente-cell">
      <span class="cliente-text">${nombreClienteDe(ordenData)}</span>
      <span class="cliente-icon">${iconoAdvertencia}${iconoContrato}</span>
    </div>
  </td>
  <td>${ordenData.tecnico_asignado || ""}</td>
  <td>${ordenData.tipo_de_servicio || ""}</td>
  <td><span class="estado-pill ${getEstadoClass(estado)}" title="${estado}">${estadoCompacto(estado)}</span></td>
  <td>${formatFecha(ordenData.fecha_creacion)}</td>
  <td class="col-fecha-entrega">${formatFecha(ordenData.fecha_entrega)}</td>
  <td class="acciones"><div class="acciones-wrap">${botonesFlujo(ordenId, estado, ordenData)}${botonesGestion(ordenId, estado, tooltipNota, estiloNota)}</div></td>
`;

  const filaDetalle = document.createElement("tr");
  filaDetalle.style.display = "none";
  filaDetalle.classList.add("filaDetalle");
  filaDetalle.setAttribute("data-orden-id", ordenId);
  filaDetalle.setAttribute("data-equipos-loaded", "false");
  
  // 🚀 LAZY RENDER: Solo placeholder inicial
  const estadoUpper = estado.toUpperCase();
  const ordenCerrada = estadoUpper.includes('ENTREGAD') || estadoUpper.includes('ENTREGADA');
  const ordenActiva = estadoUpper === 'POR ASIGNAR' || estadoUpper === 'ASIGNADO' || estadoUpper.includes('EN OFICINA');
  
  filaDetalle.innerHTML = `
    <td colspan="8" class="orden-expandida-wrapper">
      <div class="orden-expandida-card ${ordenCerrada ? 'orden-cerrada' : 'orden-activa'}">
        <!-- J) Header compacto con info de orden + acciones integradas -->
        <div class="orden-header-compacto">
          <!-- Columna izquierda: Orden + Cliente + Técnico + Progreso -->
          <div class="header-col-izq header-line" title="Cliente: ${nombreClienteDe(ordenData)} · Técnico: ${ordenData.tecnico_asignado || 'Sin asignar'}">
            <span class="orden-numero"><strong>Orden ${ordenId}</strong></span>
            <span class="separador">•</span>
            <span class="cliente-nombre">${nombreClienteDe(ordenData)}</span>
            <span class="separador">•</span>
            <!-- P) Indicador de progreso de intervenciones -->
            <div class="progreso-intervenciones-inline ${ordenCerrada ? 'contexto-historico' : 'contexto-activo'}" data-orden-id="${ordenId}">
              <span class="icon">🛠️</span>
              <span class="progreso-valor">0/${equiposNormalizados.length}</span>
            </div>
            <!-- U) Badge de contradicción si orden cerrada con intervenciones pendientes -->
            <span class="contradiccion-badge" data-orden-id="${ordenId}" style="display: none;"></span>
          </div>
          
          <!-- Columna derecha: Acciones de EQUIPOS -->
          <div class="header-col-der">
            <button class="btn-header-compact" data-action="agregar-equipo" data-stop-propagation="true" data-orden-id="${ordenId}" title="Agregar equipo">
              ➕
            </button>
            <div class="overflow-menu mini-menu">
              <button class="btn-header-compact" data-action="toggle-order-actions" data-stop-propagation="true" data-orden-id="${ordenId}" title="Más acciones">
                ⋯
              </button>
              <div class="overflow-menu-dropdown" id="order-actions-${ordenId}">
                <button class="overflow-menu-item" data-action="copiar-seriales" data-stop-propagation="true" data-orden-id="${ordenId}">📋 Copiar seriales</button>
                <button class="overflow-menu-item" data-action="activar-accesorios" data-stop-propagation="true" data-orden-id="${ordenId}">🧰 Accesorios en lote</button>
              </div>
            </div>
            <button id="btnGuardarAccesorios_${ordenId}" class="btn-header-compact primary" data-action="guardar-accesorios" data-stop-propagation="true" data-orden-id="${ordenId}" style="display:none;" title="Guardar accesorios">
              💾
            </button>
          </div>
        </div>
        
        <!-- Popover de leyenda de accesorios -->
        <div class="accesorios-popover" id="popoverAccesorios_${ordenId}" style="display: none;">
          <div class="popover-content">
            <div class="popover-header-leyenda">
              <div class="leyenda-titulo">📖 Leyenda de Accesorios</div>
              <button class="popover-close" data-action="close-popover" data-stop-propagation="true" data-orden-id="${ordenId}">×</button>
              <div class="leyenda-items-inline">
                <span class="leyenda-item"><span class="icono">🔋</span> Batería</span>
                <span class="leyenda-item"><span class="icono">📎</span> Clip</span>
                <span class="leyenda-item"><span class="icono">🔌</span> Cargador</span>
                <span class="leyenda-item"><span class="icono">⚡</span> Fuente</span>
                <span class="leyenda-item"><span class="icono">📡</span> Antena</span>
                <span class="separador-leyenda">|</span>
                <span class="estado-inline"><span class="indicador incluido"></span> Incluido</span>
                <span class="estado-inline"><span class="indicador no-incluido"></span> No incluido</span>
              </div>
            </div>
          </div>
        </div>

        
        <!-- Y) Resumen operativo para órdenes cerradas -->
        <div class="resumen-operativo" data-orden-id="${ordenId}" style="display: ${ordenCerrada ? 'block' : 'none'};">
          <div class="resumen-header">
            <span class="icon">📊</span>
            <strong>Resumen de Cierre</strong>
          </div>
          <div class="resumen-contenido">
            <div class="resumen-item">
              <span class="label">Total equipos:</span>
              <span class="valor resumen-equipos">0</span>
            </div>
            <div class="resumen-item">
              <span class="label">Intervenciones:</span>
              <span class="valor resumen-intervenciones">0/0</span>
            </div>
            <div class="resumen-item">
              <span class="label">Accesorios completos:</span>
              <span class="valor resumen-accesorios">0/0</span>
            </div>
          </div>
        </div>
        
        <!-- Contenedor de equipos -->
        <div class="equipos-container">
          <div style="padding: 20px; text-align: center; color: #666;">
            <div class="loader" style="margin: 0 auto;"></div>
            <p style="margin-top: 10px;">Cargando equipos...</p>
          </div>
        </div>
      </div>
    </td>
  `;

  filaOrden.addEventListener("click", (e) => {
    // ✅ Evitar abrir/cerrar equipos si el click vino desde elementos interactivos
    const clickedInteractive = e.target.closest('button') || 
                               e.target.closest('a') || 
                               e.target.closest('.overflow-menu');
    
    if (clickedInteractive) {
      // No hacer toggle, pero dejar que el evento siga burbujeando
      return;
    }

    filaOrden.classList.toggle("activo");
    const wasHidden = filaDetalle.style.display === "none";
    filaDetalle.style.display = wasHidden ? "table-row" : "none";
    
    // 🚀 Lazy load: solo generar tabla la primera vez que se expande
    if (wasHidden && filaDetalle.getAttribute("data-equipos-loaded") === "false") {
      renderEquiposTabla(ordenId, equiposNormalizados, filaDetalle);
    }
  });

  contenedor.appendChild(filaOrden);
  contenedor.appendChild(filaDetalle);
  
  // Add title only if text is truncated
  const clientText = filaOrden.querySelector('.cliente-text');
  if (clientText && clientText.scrollWidth > clientText.offsetWidth) {
    clientText.title = nombreClienteDe(ordenData);
  }

  // === Render móvil como card ===
  const cardsWrap = document.getElementById("ordersCards");
  if (cardsWrap) {
    const card = document.createElement("div");
    card.className = "card-contrato";
    card.setAttribute("data-orden-id", ordenId);
    
    // Get friendly estado display
    const estadoDisplay = (ordenData.estado_reparacion || "POR ASIGNAR").toUpperCase();
    const tecnicoDisplay = ordenData.tecnico_asignado || "Sin asignar";
    const tipoDisplay = ordenData.tipo_de_servicio || "—";
    const fotosBadgeMobile = fotosTallerCount > 0
      ? `<span class="fotos-taller-badge mobile" title="Fotos de taller">📸 ${fotosTallerCount}</span>`
      : "";

    card.innerHTML = `
      <div class="row">
        <div class="t1">Orden #${ordenId}</div>
        ${fotosBadgeMobile}
        <div class="t2">${nombreClienteDe(ordenData)}</div>
      </div>
      <div class="row" style="font-size: 13px; color: #6b7280; margin-bottom: 8px;">
        <span>${tipoDisplay}</span>
        <span style="font-weight: 600;">${tecnicoDisplay}</span>
      </div>
      <div class="row" style="margin-bottom: 12px;">
        <span class="estado" style="background: ${
          estadoDisplay === 'ENTREGADO AL CLIENTE' ? '#bbf7d0' :
          estadoDisplay === 'COMPLETADO (EN OFICINA)' ? '#bfdbfe' :
          estadoDisplay === 'ASIGNADO' ? '#fef3c7' :
          '#fecaca'
        }; font-size: 11px; padding: 6px 10px; border-radius: 16px; font-weight: 700;">${estadoCompacto(estadoDisplay)}</span>
      </div>
      <div class="row" style="font-size: 12px; color: #9ca3af; margin-bottom: 12px;">
        <span>📅 Creado: ${formatFecha(ordenData.fecha_creacion)}</span>
        <span class="fecha-entrega">📦 Entrega: ${formatFecha(ordenData.fecha_entrega)}</span>
      </div>
      <div class="acciones">
        <button class="btn secondary" data-action="abrir-equipos-mobile" data-stop-propagation="true" data-orden-id="${ordenId}">
          👁 Equipos
        </button>
        <button class="btn secondary" data-action="go-fotos-taller" data-stop-propagation="true" data-orden-id="${ordenId}">
          📸 Fotos
        </button>
        <button class="btn primary" data-action="editar-orden" data-orden-id="${ordenId}" style="flex: 2;">
          ✏️ Editar
        </button>
        ${botonesFlujo(ordenId, estado, ordenData)}
      </div>
    `;

    cardsWrap.appendChild(card);
  }
}

// 🚀 LAZY RENDER: Genera la tabla de equipos solo cuando se expande
function renderEquiposTabla(ordenId, equipos, filaDetalle) {
  const container = filaDetalle.querySelector('.equipos-container');
  if (!container) return;
  
  if (equipos.length === 0) {
    container.innerHTML = '<em style="color: #666; padding: 20px; display: block;">No hay equipos asociados</em>';
  } else {
    // P) Calcular progreso de intervenciones
    const equiposConIntervencion = equipos.filter(e => (e.trabajo_tecnico || "").trim()).length;
    const equiposNoDisponibles = equipos.filter(e => e.intervencion_no_disponible).length;
    const equiposFinalizados = equiposConIntervencion + equiposNoDisponibles;
    const progresoPercent = equipos.length ? Math.round((equiposFinalizados / equipos.length) * 100) : 0;
    
    // X) Calcular completitud de accesorios global
    const equiposAccesoriosCompletos = equipos.filter(e => {
      return e.bateria && e.clip && e.cargador && e.fuente && e.antena;
    }).length;
    
    // Obtener estado de la orden para contexto
    const ordenData = APP.state.orders.find(o => o.ordenId === ordenId);
    const estadoOrden = ordenData?.estado || '';
    const estadoUpper = estadoOrden.toUpperCase();
    const ordenCerrada = estadoUpper.includes('ENTREGAD') || estadoUpper.includes('ENTREGADA');
    
    // U) Detectar contradicción: orden cerrada con intervenciones pendientes
    const pendientesIntervencion = Math.max(0, equipos.length - equiposFinalizados);
    const hayContradiccion = ordenCerrada && pendientesIntervencion > 0;
    
    // Actualizar indicador de progreso (ahora en header inline)
    const progresoIndicador = document.querySelector(`.progreso-intervenciones-inline[data-orden-id="${ordenId}"]`);
    if (progresoIndicador) {
      const valorEl = progresoIndicador.querySelector('.progreso-valor');
      if (valorEl) valorEl.textContent = `Intervenidos ${equiposConIntervencion} / No disp ${equiposNoDisponibles}`;
      
      // Cambiar color según progreso
      progresoIndicador.classList.remove('completo', 'parcial', 'vacio');
      if (progresoPercent === 100) {
        progresoIndicador.classList.add('completo');
      } else if (progresoPercent > 0) {
        progresoIndicador.classList.add('parcial');
      } else {
        progresoIndicador.classList.add('vacio');
      }
    }
    
    // U) Mostrar badge de contradicción si aplica
    const contradiccionBadge = document.querySelector(`.contradiccion-badge[data-orden-id="${ordenId}"]`);
    if (contradiccionBadge) {
      if (hayContradiccion) {
        contradiccionBadge.style.display = 'inline-flex';
        contradiccionBadge.innerHTML = `
          <span class="badge-icon">⚠️</span>
          <span class="badge-text">Orden cerrada con ${pendientesIntervencion} intervención(es) pendiente(s)</span>
        `;
        contradiccionBadge.className = 'contradiccion-badge advertencia';
        contradiccionBadge.title = 'Esta orden fue entregada pero tiene equipos sin intervención registrada';
      } else {
        contradiccionBadge.style.display = 'none';
      }
    }
    
    // Y) Actualizar resumen operativo para órdenes cerradas
    const resumenOperativo = document.querySelector(`.resumen-operativo[data-orden-id="${ordenId}"]`);
    if (resumenOperativo && ordenCerrada) {
      resumenOperativo.querySelector('.resumen-equipos').textContent = equipos.length;
      resumenOperativo.querySelector('.resumen-intervenciones').textContent = `Intervenidos ${equiposConIntervencion} / No disp ${equiposNoDisponibles}`;
      resumenOperativo.querySelector('.resumen-accesorios').textContent = `${equiposAccesoriosCompletos}/${equipos.length}`;
      
      // Añadir clases de estado
      const itemIntervenciones = resumenOperativo.querySelector('.resumen-intervenciones').parentElement;
      const itemAccesorios = resumenOperativo.querySelector('.resumen-accesorios').parentElement;
      
      itemIntervenciones.classList.remove('completo', 'incompleto');
      itemAccesorios.classList.remove('completo', 'incompleto');
      
      if (equiposFinalizados === equipos.length) {
        itemIntervenciones.classList.add('completo');
      } else {
        itemIntervenciones.classList.add('incompleto');
      }
      
      if (equiposAccesoriosCompletos === equipos.length) {
        itemAccesorios.classList.add('completo');
      } else {
        itemAccesorios.classList.add('incompleto');
      }
    }
    
    container.innerHTML = `
      <table class="equipos-table">
        <colgroup>
          <col style="width: 8%;">
          <col style="width: 8%;">
          <col style="width: 26%;">
          <col style="width: 18%;">
          <col style="width: 32%;">
          <col style="width: 8%;">
        </colgroup>
        <thead>
          <tr>
            <th class="col-serie">Serie</th>
            <th class="col-modelo">Modelo</th>
            <th class="col-intervencion">Intervención</th>
            <th class="col-accesorios">Accesorios</th>
            <th class="col-observaciones">Observaciones</th>
            <th class="col-acciones">⋯</th>
          </tr>
        </thead>
        <tbody>
          ${equipos.map(e => {
            // R) Calcular completitud de accesorios
            const accesoriosPresentes = [e.bateria, e.clip, e.cargador, e.fuente, e.antena].filter(Boolean).length;
            const accesoriosTotal = 5;
            const accesoriosCompleto = accesoriosPresentes === accesoriosTotal;
            const noDisponible = !!e.intervencion_no_disponible;
            const motivoNoDisponible = (e.motivo_no_disponible || "").toString();
            const tieneIntervencion = !!(e.trabajo_tecnico || "").trim();
            
            return `
            <tr data-equipo-id="${ordenId}_${e.id}" class="equipo-row ${ordenCerrada ? 'contexto-historico' : 'contexto-activo'} ${noDisponible ? 'no-disponible' : ''}">
              <!-- K) Información primaria: Serie -->
              <td class="col-serie">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="numero_de_serie">
                  <span class="valor valor-primario">${e.numero_de_serie || "-"}</span>
                  ${obtenerIconoLapiz(`${ordenId}_${e.id}`, 'numero_de_serie', e.numero_de_serie || '')}
                </div>
              </td>
              
              <!-- K) Información primaria: Modelo -->
              <td class="col-modelo">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="modelo">
                  <span class="valor valor-primario">${e.modelo || "-"}</span>
                  ${obtenerIconoLapiz(`${ordenId}_${e.id}`, 'modelo', e.modelo || '')}
                </div>
              </td>
              
              <!-- V) Intervención con contexto adaptativo -->
              <td class="col-intervencion">
                <div class="intervencion-stack">
                  ${noDisponible
                    ? `<div class="intervencion-badge no-disponible" title="Equipo no disponible para intervención">
                         <button class="btn-intervencion" data-action="abrir-intervencion-desktop" data-stop-propagation="true" data-orden-id="${ordenId}" data-equipo-id="${e.id}">
                           <span class="icon">⛔</span>
                           <span class="label">No disponible</span>
                         </button>
                       </div>`
                    : (tieneIntervencion
                      ? `<div class="intervencion-badge activa" title="✓ Intervención registrada">
                          <div class="intervencion-content">
                            <button class="btn-intervencion" data-action="abrir-intervencion-desktop" data-stop-propagation="true" data-orden-id="${ordenId}" data-equipo-id="${e.id}">
                              <span class="icon">✅</span>
                              <span class="label">Registrada</span>
                            </button>
                            <span class="intervencion-text" title="${escapeHtml(e.trabajo_tecnico || '')}">${escapeHtml(e.trabajo_tecnico || '')}</span>
                          </div>
                         </div>`
                      : `<div class="intervencion-badge pendiente ${ordenCerrada ? 'historico' : 'activo'}" title="${ordenCerrada ? 'No se registró intervención (orden cerrada)' : 'Pendiente de intervención'}">
                           <button class="btn-intervencion" data-action="abrir-intervencion-desktop" data-stop-propagation="true" data-orden-id="${ordenId}" data-equipo-id="${e.id}">
                             <span class="icon">${ordenCerrada ? '📝' : '⏳'}</span>
                             <span class="label">${ordenCerrada ? 'No registrada' : 'Pendiente'}</span>
                           </button>
                         </div>`
                    )
                  }
                </div>
              </td>
              
              <!-- R+X) Accesorios con indicador de completitud mejorado -->
              <td class="col-accesorios">
                <div class="accesorios-wrapper ${accesoriosCompleto ? 'completo' : 'incompleto'}">
                  <div class="accesorios-group">
                    <span class="accesorio-item ${e.bateria ? 'activo' : 'inactivo'}" title="${e.bateria ? '✓ Batería incluida' : '✗ Batería NO incluida'}">
                      <span class="icono">🔋</span>
                    </span>
                    <span class="accesorio-item ${e.clip ? 'activo' : 'inactivo'}" title="${e.clip ? '✓ Clip incluido' : '✗ Clip NO incluido'}">
                      <span class="icono">📎</span>
                    </span>
                    <span class="accesorio-item ${e.cargador ? 'activo' : 'inactivo'}" title="${e.cargador ? '✓ Cargador incluido' : '✗ Cargador NO incluido'}">
                      <span class="icono">🔌</span>
                    </span>
                    <span class="accesorio-item ${e.fuente ? 'activo' : 'inactivo'}" title="${e.fuente ? '✓ Fuente incluida' : '✗ Fuente NO incluida'}">
                      <span class="icono">⚡</span>
                    </span>
                    <span class="accesorio-item ${e.antena ? 'activo' : 'inactivo'}" title="${e.antena ? '✓ Antena incluida' : '✗ Antena NO incluida'}">
                      <span class="icono">📡</span>
                    </span>
                  </div>
                  <span class="completitud-badge">${accesoriosPresentes}/${accesoriosTotal}</span>
                </div>
              </td>
              
              <!-- Observaciones -->
              <td class="col-observaciones">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="observaciones">
                  <span class="valor" title="${e.observaciones || ''}">${e.observaciones || "-"}</span>
                  ${obtenerIconoLapiz(`${ordenId}_${e.id}`, 'observaciones', e.observaciones || '')}
                </div>
              </td>
              
              <!-- M) Acciones destructivas con menor peso visual -->
              <td class="col-acciones">
                <button data-action="eliminar-equipo" data-id="${ordenId}_${e.id}" class="btn-eliminar-equipo" title="Eliminar equipo">
                  🗑️
                </button>
              </td>
            </tr>
          `}).join("")}
        </tbody>
      </table>
    `;
  }
  
  filaDetalle.setAttribute("data-equipos-loaded", "true");
}

// 🔄 Helper para refrescar solo los equipos de una orden expandida
// 🔄 Helper para refrescar solo los equipos de una orden expandida
function refrescarEquiposDeOrden(ordenId) {
  const ordenData = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!ordenData) return;
  
  const filaDetalle = document.querySelector(`tr.filaDetalle[data-orden-id="${ordenId}"]`);
  if (!filaDetalle || filaDetalle.getAttribute("data-equipos-loaded") === "false") return;
  
  // Si está expandida y ya cargada, re-renderizar solo la tabla de equipos
  const equipos = (ordenData.equipos || []).filter(e => !e.eliminado);
  renderEquiposTabla(ordenId, equipos, filaDetalle);
}

// Export to window for global access
window.refrescarEquiposDeOrden = refrescarEquiposDeOrden;

function botonesFlujo(ordenId, estado, ordenData) {
  const rol = APP.state.userRole || "";
  let html = "";
  const tipoServicio = (ordenData?.tipo_de_servicio || "").toUpperCase();

  if (rol === ROLES.ADMIN || rol === ROLES.RECEPCION) {
    if (estado === "POR ASIGNAR") {
      html += `<button class="btn" style="background:#3b82f6;color:white;font-weight:600;box-shadow:0 2px 8px rgba(59,130,246,0.3);" title="Asignar técnico" data-action="asignar-tecnico" data-stop-propagation="true" data-orden-id="${ordenId}"><span style="font-size: 16px;">🛠️</span> Asignar</button>`;
    } else if (estado === "ASIGNADO") {
      html += `<button class="btn" style="background:#10b981;color:white;font-weight:600;box-shadow:0 2px 8px rgba(16,185,129,0.3);" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><span style="font-size: 16px;">✅</span> Completar</button>`;
    } else if (estado === "COMPLETADO (EN OFICINA)" && !tipoServicio.includes("ENTRADA")) {
      html += `<button class="btn" style="background:#8b5cf6;color:white;font-weight:600;box-shadow:0 2px 8px rgba(139,92,246,0.3);" title="Entregar al cliente" data-action="entregar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><span style="font-size: 16px;">📲</span> Entregar</button>`;
    }
  }

  else if (rol === ROLES.TECNICO) {
    if (estado === "POR ASIGNAR") {
      html += `<button class="btn" style="background:#3b82f6;color:white;font-weight:600;box-shadow:0 2px 8px rgba(59,130,246,0.3);" title="Asignar técnico" data-action="asignar-tecnico" data-stop-propagation="true" data-orden-id="${ordenId}"><span style="font-size: 16px;">🛠️</span> Asignar</button>`;
    } else if (estado === "ASIGNADO") {
      html += `<button class="btn" style="background:#10b981;color:white;font-weight:600;box-shadow:0 2px 8px rgba(16,185,129,0.3);" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><span style="font-size: 16px;">✅</span> Completar</button>`;
    }
  }

  else if (rol === ROLES.TECNICO_OPERATIVO) {
    if (estado === "ASIGNADO") {
      html += `<button class="btn" style="background:#10b981;color:white;font-weight:600;box-shadow:0 2px 8px rgba(16,185,129,0.3);" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><span style="font-size: 16px;">✅</span> Completar</button>`;
    }
  }

  else if (rol === ROLES.VENDEDOR) {
    if (estado === "COMPLETADO (EN OFICINA)" && !tipoServicio.includes("ENTRADA")) {
      html += `<button class="btn" style="background:#8b5cf6;color:white;font-weight:600;box-shadow:0 2px 8px rgba(139,92,246,0.3);" title="Entregar al cliente" data-action="entregar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><span style="font-size: 16px;">📲</span> Entregar</button>`;
    }
  }

  return html || "<em>-</em>";
}


function botonesGestion(ordenId, estado, tooltipNota = "", estiloNota = "") {
  const rol = APP.state.userRole || "";
  const estadoUpper = (estado || "").toUpperCase();

  const o = APP.state.orders.find(x => x.ordenId === ordenId) || {};
  const trabajo = (o.trabajo_estado) || (o.cotizacion_emitida ? 'COMPLETADO' : 'SIN_INICIAR');
  const tieneNota = o.nota_tecnica && o.nota_tecnica.trim() !== "";

  // Build menu items array based on role
  let menuItems = [
    { icon: "📸", label: "Fotos de taller", action: "go-fotos-taller", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
  ];

  if (rol === ROLES.ADMIN || rol === ROLES.RECEPCION) {
    menuItems.push(
      { icon: "📜", label: "Generar nota entrega", action: "generar-nota-entrega", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: "📋", label: "Nota entrega con intervenciones", action: "generar-nota-entrega-intervenciones", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: "🖨️", label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: "🧰", label: trabajo === 'COMPLETADO' ? "✓ Trabajo completado" : trabajo === 'EN_PROGRESO' ? "Trabajo en progreso" : "Gestionar trabajo", action: "gestionar-trabajo", dataAttributes: `data-orden-id="${ordenId}"`, class: trabajo === 'COMPLETADO' ? 'highlighted' : '' },
      { icon: "🧠", label: tieneNota ? "✓ Ver notas técnicas" : "Agregar notas técnicas", action: "gestionar-notas", dataAttributes: `data-orden-id="${ordenId}"`, class: tieneNota ? 'highlighted' : '' },
      { divider: true },
      { icon: "✏️", label: "Editar orden", action: "editar-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: estadoUpper !== "POR ASIGNAR" ? "disabled" : "" },
      { icon: "🗑️", label: "Eliminar orden", action: "eliminar-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "danger" }
    );
  } else if (rol === ROLES.TECNICO || rol === ROLES.TECNICO_OPERATIVO) {
    menuItems.push(
      { icon: "🖨️", label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: "🧰", label: trabajo === 'COMPLETADO' ? "✓ Trabajo completado" : trabajo === 'EN_PROGRESO' ? "Trabajo en progreso" : "Gestionar trabajo", action: "gestionar-trabajo", dataAttributes: `data-orden-id="${ordenId}"`, class: trabajo === 'COMPLETADO' ? 'highlighted' : '' },
      { icon: "🧠", label: tieneNota ? "✓ Ver notas técnicas" : "Agregar notas técnicas", action: "gestionar-notas", dataAttributes: `data-orden-id="${ordenId}"`, class: tieneNota ? 'highlighted' : '' }
    );
  } else if (rol === ROLES.VISTA) {
    menuItems.push(
      { icon: "🖨️", label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
    );
  } else if (rol === ROLES.VENDEDOR) {
    menuItems.push(
      { icon: "📜", label: "Generar nota entrega", action: "generar-nota-entrega", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: "�", label: "Nota entrega con intervenciones", action: "generar-nota-entrega-intervenciones", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: "�🖨️", label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: "🧰", label: trabajo === 'COMPLETADO' ? "✓ Trabajo completado" : trabajo === 'EN_PROGRESO' ? "Trabajo en progreso" : "Gestionar trabajo", action: "gestionar-trabajo", dataAttributes: `data-orden-id="${ordenId}"`, class: trabajo === 'COMPLETADO' ? 'highlighted' : '' }
    );
  }

  if (menuItems.length === 0) return "<em>-</em>";

  // Build dropdown HTML
  const dropdownHtml = menuItems.map(item => {
    if (item.divider) {
      return '<div class="overflow-menu-divider"></div>';
    }
    const disabled = item.class.includes('disabled');
    const onclickAttr = disabled ? '' : `data-action="${item.action}" ${item.dataAttributes || ''}`;  
    return `<button class="overflow-menu-item ${item.class}" ${onclickAttr} ${disabled ? 'disabled' : ''} data-stop-propagation="true">
      <span>${item.icon}</span>
      <span>${item.label}</span>
    </button>`;
  }).join('');

  return `
    <div class="overflow-menu">
      <button class="overflow-menu-btn" data-action="toggle-overflow-menu" data-stop-propagation="true" data-orden-id="${ordenId}" title="Más acciones">
        ⋯
      </button>
      <div class="overflow-menu-dropdown" id="overflow-menu-${ordenId}">
        ${dropdownHtml}
      </div>
    </div>
  `;
}


window.renderizarOrdenYEquipos = renderizarOrdenYEquipos;
window.botonesFlujo = botonesFlujo;
window.botonesGestion = botonesGestion;


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


APP.state.orders = [];

window.cargarOrdenesYEquipos = async function (esCargaInicial = true) {
  const ordersTable = APP.utils.mustGetEl("ordersTable");
  if (esCargaInicial) {
    ordersTable.innerHTML = "";
    APP.state.orders = [];
    APP.state.lastVisible = null;
    APP.utils.mustGetEl("btnCargarMas").textContent = "⬇️ Cargar más órdenes (0)";
   APP.utils.mustGetEl("btnCargarMas").disabled = false;
    APP.utils.mustGetEl("btnCargarMas").style.display = "block";
  }

  try {
    const uid = firebase.auth().currentUser?.uid || null;
    const { orders, lastSnapshot } = await OrdenesService.loadOrders({
      lastSnapshot: esCargaInicial ? null : APP.state.lastVisible,
      userRole: APP.state.userRole,
      userId: uid,
      limit: 50
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

    document.getElementById("btnCargarMas").textContent = `⬇️ Cargar más órdenes (${totalVisible})`;

    ordenarOrdenes(filteredNuevas).forEach(o => {
      const equipos = (o.equipos || [])
        .filter(e => !e.eliminado)
        .sort((a, b) =>
          String(a.numero_de_serie || '').localeCompare(String(b.numero_de_serie || ''))
        );
      renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
      aplicarRestriccionesPorRol(APP.state.userRole);
    });


  } catch (error) {
    console.error("❌ Error al cargar órdenes:", error);
    ordersTable.innerHTML = "<tr><td colspan='9' style='color:red;'>Error al cargar datos</td></tr>";
  }
  const filters = getActiveFilters();
  actualizarResumen(hasActiveFilters(filters) ? applyActiveFiltersToOrders(APP.state.orders, filters) : APP.state.orders);
};


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


// Helper to normalize text (remove accents, lowercase, trim)
function normTxt(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

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
  const uid = APP.state.userId || firebase.auth().currentUser?.uid || null;
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
  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  if (!list || list.length === 0) {
    if (ordersTable) ordersTable.innerHTML = "<tr><td colspan='9'>No se encontraron coincidencias</td></tr>";
    actualizarResumen([]);
    return;
  }

  ordenarOrdenes(list).forEach(o => {
    const equipos = (o.equipos || [])
      .filter(e => !e.eliminado)
      .sort((a, b) => String(a.numero_de_serie || "").localeCompare(String(b.numero_de_serie || "")));
    renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
  });

  actualizarResumen(list);
  aplicarRestriccionesPorRol(APP.state.userRole);
}

function aplicarFiltrosCombinados() {
  const filters = getActiveFilters();
  const filtered = hasActiveFilters(filters)
    ? applyActiveFiltersToOrders(APP.state.orders, filters)
    : APP.state.orders;

  const btn = document.getElementById("btnCargarMas");
  if (btn) btn.textContent = `⬇️ Cargar más órdenes (${filtered.length})`;

  renderOrdersList(filtered);
}

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

  // 🔄 limpiar tabla y cards
  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  if (!filtroOrden && !filtroCliente && !filtroSerial && !filtroTipo) {
    // On empty search, reset to default view instead of alerting
    cargarOrdenesYEquipos(true);
    return;
  }

  let resultados = [];
  try {
    // Filtros avanzados usan lógica AND (quickSearch: false por defecto)
    resultados = await OrdenesService.searchOrders({
      filtroOrden,
      filtroCliente,
      filtroSerial,
      clientesMap: APP.state.clientesMap,
      quickSearch: false  // 🔥 Modo AND para filtros avanzados
    });

    const filters = getActiveFilters();
    resultados = hasActiveFilters(filters)
      ? applyActiveFiltersToOrders(resultados, filters)
      : resultados;

    if (resultados.length === 0) {
      ordersTable.innerHTML = "<tr><td colspan='9'>No se encontraron coincidencias</td></tr>";
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

  } catch (e) {
    console.error("❌ Error al filtrar:", e);
    ordersTable.innerHTML = "<tr><td colspan='9' style='color:red;'>Error al filtrar datos</td></tr>";
  }

  actualizarResumen(resultados);
  aplicarRestriccionesPorRol(APP.state.userRole);
};

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
    <button id="closeNotasModal" class="notas-close" type="button">✕</button>
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

window.filtrarRapido = async function() {
  const filtroRapido = document.getElementById("filtroRapido");
  if (!filtroRapido) return;
  
  const valor = normTxt(filtroRapido.value);
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");

  // Limpiar tabla y cards
  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  if (!valor) {
    // Si está vacío, recargar vista normal
    cargarOrdenesYEquipos(true);
    return;
  }

  let resultados = [];
  try {
    // Usar modo quickSearch con lógica OR
    resultados = await OrdenesService.searchOrders({
      filtroOrden: valor,
      filtroCliente: valor,
      filtroSerial: valor,
      clientesMap: APP.state.clientesMap,
      quickSearch: true  // 🔥 Activar modo OR
    });

    if (resultados.length === 0) {
      ordersTable.innerHTML = "<tr><td colspan='9'>No se encontraron coincidencias</td></tr>";
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

  } catch (e) {
    console.error("❌ Error al filtrar:", e);
    ordersTable.innerHTML = "<tr><td colspan='9' style='color:red;'>Error al filtrar datos</td></tr>";
  }

  actualizarResumen(resultados);
  aplicarRestriccionesPorRol(APP.state.userRole);
};

window.toggleFiltrosAvanzados = function() {
  const bloque = document.getElementById("filtrosAvanzados");
  const icono = document.getElementById("iconoAvanzados");
  
  if (!bloque || !icono) return;
  
  if (bloque.style.display === "none") {
    bloque.style.display = "block";
    icono.textContent = "▲";
  } else {
    bloque.style.display = "none";
    icono.textContent = "▼";
  }
};

window.limpiarFiltros = function () {
  // Limpiar búsqueda rápida
  const filtroRapido = document.getElementById("filtroRapido");
  if (filtroRapido) filtroRapido.value = "";
  
  // Limpiar campos individuales
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
  
  // Remover estado activo de badges
  document.querySelectorAll('.resumen .badge.active').forEach(b => b.classList.remove('active'));

  // 🔄 limpiar tabla y cards antes de recargar
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");
  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  // Volver a la vista inicial con paginación normal
  cargarOrdenesYEquipos(true);
};

// cargarOrdenesYEquipos(); // Ya se llama dentro de onAuthStateChanged

});

// estas funciones van fuera del DOMContentLoaded:
window.cambiarOrden = function () {
  APP.state.sortField = document.getElementById("APP.state.sortField").value;
  cargarOrdenesYEquipos();
};

window.cambiarDireccionOrden = function () {
  APP.state.sortAscending = !APP.state.sortAscending;
  cargarOrdenesYEquipos();
};
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

  const ok = window.confirm("¿Eliminar este equipo de la orden?");
  if (!ok) return;

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

function nombreClienteDe(orden) {
  const id = orden.cliente_id || orden.clienteId;
  return (id && APP.state.clientesMap[id]) || orden.cliente_nombre || orden.cliente || "—";
}

function getEstadoClass(estado) {
  const e = (estado || "").toUpperCase();
  if (e === "POR ASIGNAR") return "por-asignar";
  if (e === "ASIGNADO") return "asignado";
  if (e === "COMPLETADO (EN OFICINA)") return "completado";
  if (e === "ENTREGADO AL CLIENTE") return "entregado";
  return "por-asignar";
}

// Helper: Versión compacta de estados para píldoras
function estadoCompacto(estado) {
  const e = (estado || "").toUpperCase();
  if (e === "COMPLETADO (EN OFICINA)") return "COMPLETADO";
  if (e === "ENTREGADO AL CLIENTE") return "ENTREGADO";
  return e;
}

function actualizarResumen(lista) {
  const el = document.getElementById("resumenOrdenes");
  if (!el) return;
  const total = (lista || []).length;

  const porAsignar = (lista || []).filter(o =>
    (o.estado_reparacion || "POR ASIGNAR").toUpperCase() === "POR ASIGNAR").length;

  const asignado = (lista || []).filter(o =>
    (o.estado_reparacion || "").toUpperCase() === "ASIGNADO").length;

const completadoOficina = (lista || []).filter(o =>
  (o.estado_reparacion || "").toUpperCase() === "COMPLETADO (EN OFICINA)").length;

const entregadoCliente = (lista || []).filter(o =>
  (o.estado_reparacion || "").toUpperCase() === "ENTREGADO AL CLIENTE").length;
  
  // Verificar si hay un filtro activo
  const filtroEstadoSelect = document.getElementById("filtroEstado");
  const estadoActivo = filtroEstadoSelect ? filtroEstadoSelect.value : "";
  const estadoLabel = estadoActivo || "Todos";

  el.innerHTML = `
    <div class="overflow-menu resumen-menu-wrap">
      <button class="btn ghost resumen-btn" data-action="toggle-resumen-menu" data-stop-propagation="true" aria-haspopup="true" aria-expanded="false">
        Resumen: ${total} · ${estadoLabel}
      </button>
      <div class="overflow-menu-dropdown resumen-menu" id="resumen-menu">
        <div class="resumen-total" data-action="limpiar-filtros" title="Ver todas las órdenes">Total: ${total}</div>
        <div class="resumen-badges">
          <span class="badge asignar ${estadoActivo === 'POR ASIGNAR' ? 'active' : ''}" title="Click para filtrar: POR ASIGNAR" data-action="filtrar-badge" data-estado="POR ASIGNAR">${porAsignar}</span>
          <span class="badge asignado ${estadoActivo === 'ASIGNADO' ? 'active' : ''}" title="Click para filtrar: ASIGNADO" data-action="filtrar-badge" data-estado="ASIGNADO">${asignado}</span>
          <span class="badge completo ${estadoActivo === 'COMPLETADO (EN OFICINA)' ? 'active' : ''}" title="Click para filtrar: COMPLETADO (EN OFICINA)" data-action="filtrar-badge" data-estado="COMPLETADO (EN OFICINA)">${completadoOficina}</span>
          <span class="badge ${estadoActivo === 'ENTREGADO AL CLIENTE' ? 'active' : ''}" style="background:#bbf7d0;" title="Click para filtrar: ENTREGADO AL CLIENTE" data-action="filtrar-badge" data-estado="ENTREGADO AL CLIENTE">${entregadoCliente}</span>
        </div>
      </div>
    </div>
  `;

  // mirror to mobile header summary (compact text only)
  const mh = document.getElementById("mobileResumen");
  if (mh) {
    mh.textContent = `Total: ${total} · ${estadoLabel}`;
  }

}

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
        <div class="equipos-empty-icon">📦</div>
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
           <button class="btn ghost equipo-obs-more" data-action="ver-obs-completa" data-orden-id="${ordenId}" data-idx="${idx}">👁 Ver más</button>`
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
              <div class="equipo-card-serial">📦 ${escapeHtml(serial)}</div>
              <div class="equipo-card-model">Modelo: <span class="equipo-card-model-value">${escapeHtml(modelo)}</span></div>
            </div>
            ${noDisponible
              ? '<div class="equipo-status-badge equipo-status-badge--warn">⛔ No disponible</div>'
              : (e.trabajo_tecnico ? '<div class="equipo-status-badge equipo-status-badge--ok">✓ OK</div>' : '')
            }
          </div>
          ${obsHtml}
          
          <div class="equipo-card-actions">
            <button class="btn ${e.trabajo_tecnico ? 'ok' : 'secondary'} equipo-card-action"
              data-action="abrir-trabajo-equipo" data-orden-id="${ordenId}" data-idx="${idx}">
              ${e.trabajo_tecnico ? '✓ ' : ''}✍️ Intervención
            </button>

            <button class="btn ghost equipo-card-view"
              data-action="ver-trabajo-equipo" data-orden-id="${ordenId}" data-idx="${idx}" title="Ver comentario">
              👁
            </button>
          </div>

          ${trabajoDisplay}
        </div>
      `;
    }).join("");
  }

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
    `🛠️ Intervención Técnica · ${serial}`,
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
    btn.textContent = "⏳ Guardando...";

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
      btn.textContent = "💾 Guardar";
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
    btn.textContent = "💾 Guardar";
  } catch (e) {
    console.error("❌ Error guardando trabajo del equipo:", e);
    mostrarToast(`❌ Error al guardar: ${e?.message || e}`, "bad");
    btn.disabled = false;
    btn.textContent = "💾 Guardar";
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

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}


window.filtrarPorEstado = async function (estado) {
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");
  const btnCargarMas = document.getElementById("btnCargarMas");
  const loader = document.getElementById("loader");

  // 1) Limpiar otros filtros para que sea EXCLUSIVO
  document.getElementById("filtroOrden").value = "";
  document.getElementById("filtroCliente").value = "";
  document.getElementById("filtroSerial").value = "";

  // 2) Reset de tabla, cards y paginación
  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";
  APP.state.orders = [];
  APP.state.lastVisible = null;

  // 3) Si no hay estado seleccionado, volver a la carga normal
  if (!estado) {
    if (btnCargarMas) {
      btnCargarMas.textContent = "⬇️ Cargar más órdenes (0)";
      btnCargarMas.disabled = false;
      APP.utils.show(btnCargarMas);
    }
    cargarOrdenesYEquipos(true);
    return;
  }

  // Con filtro activo, ocultamos el "Cargar más" (consulta exclusiva)
  if (btnCargarMas) btnCargarMas.style.display = "none";

  let resultados = [];
  try {
    if (loader) loader.style.display = "block";

    resultados = await OrdenesService.filterByStatus(estado, 200);

    if (resultados.length === 0) {
      ordersTable.innerHTML = "<tr><td colspan='8'>No hay órdenes con ese estado</td></tr>";
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
    
    // Fallback if index is missing (failed-precondition)
    if (e?.code === "failed-precondition") {
      console.log("🔄 Index missing, using fallback JS filter");
      try {
        resultados = await OrdenesService.filterByStatus(estado, 200);
        
        if (resultados.length === 0) {
          ordersTable.innerHTML = "<tr><td colspan='8'>No hay órdenes con ese estado</td></tr>";
        } else {
          ordenarOrdenes(resultados).forEach(o => {
            const equipos = (o.equipos || [])
              .filter(e => !e.eliminado)
              .sort((a, b) => String(a.numero_de_serie || "").localeCompare(String(b.numero_de_serie || "")));
            renderizarOrdenYEquipos(o.ordenId, o, equipos, ordersTable);
          });
        }
        
        actualizarResumen(resultados);
        if (typeof aplicarRestriccionesPorRol === 'function') aplicarRestriccionesPorRol(APP.state.userRole);
        if (loader) APP.utils.hide(loader);
        return;
      } catch (fallbackErr) {
        console.error("❌ Fallback also failed:", fallbackErr);
      }
    }
    
    ordersTable.innerHTML = "<tr><td colspan='8' style='color:red;'>Error al filtrar por estado</td></tr>";
  } finally {
    if (loader) loader.style.display = "none";
  }

  actualizarResumen(resultados);
  if (typeof aplicarRestriccionesPorRol === 'function') aplicarRestriccionesPorRol(APP.state.userRole);
};

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
        <button class="text-modal-close" data-action="close-text-modal" aria-label="Cerrar">✕</button>
      </div>
      <div class="text-modal-body">
        <div class="text-modal-text" id="textModalBody"></div>
      </div>
      <div class="text-modal-footer">
        <button class="text-modal-btn secondary" data-action="copy-text-modal">📋 Copiar</button>
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