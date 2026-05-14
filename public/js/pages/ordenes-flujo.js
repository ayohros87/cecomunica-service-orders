// @ts-nocheck
/* ========================================
 * ORDENES FLUJO - Lifecycle transitions
 * Asignar / Completar / Entregar / Eliminar / Agregar-equipo flows,
 * plus nota-entrega generators and serial copy. All actions delegate
 * to OrdenesService for Firestore writes and trigger a reload via
 * cargarOrdenesYEquipos.
 * ======================================== */

// ===== MODAL ASIGNAR TÉCNICO =====
window.abrirModalAsignarTecnico = function (ordenId) {
  const modal = document.getElementById("modalAsignar");
  const select = document.getElementById("asignarTecnicoSelect");
  const btnConfirmar = modal.querySelector("button[data-action='confirmar-asignar-tecnico']");

  if (!modal || !select || !btnConfirmar) {
    console.error("Modal elements not found");
    return;
  }

  btnConfirmar.dataset.ordenId = ordenId;

  select.innerHTML = '<option value="">Seleccionar técnico...</option>';

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

  modal.onclick = function (e) {
    if (e.target === modal) {
      cerrarModalAsignar();
    }
  };

  APP.utils.show(modal);
};

window.cerrarModalAsignar = function () {
  const modal = document.getElementById("modalAsignar");
  if (modal) {
    APP.utils.hide(modal);
    const select = document.getElementById("asignarTecnicoSelect");
    if (select) select.value = "";
  }
};

window.confirmarAsignarTecnico = async function (ordenId) {
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

    cerrarModalAsignar();

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

window.completarOrden = async function (ordenId) {
  if (!await Modal.confirm({ message: `¿Marcar la orden ${ordenId} como completada?` })) return;

  try {
    await OrdenesService.completeOrder(ordenId);

    mostrarToast("✅ Orden completada", "success");

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

window.entregarOrden = async function (ordenId) {
  if (!await Modal.confirm({ message: `¿Entregar la orden ${ordenId} al cliente?` })) return;

  try {
    await OrdenesService.deliverOrder(ordenId);

    mostrarToast("✅ Orden entregada al cliente", "success");

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

window.eliminarOrden = async function (ordenId) {
  if (!await Modal.confirm({ message: `¿ELIMINAR la orden ${ordenId}? Esta acción no se puede deshacer.`, danger: true })) return;

  try {
    await OrdenesService.deleteOrder(ordenId);

    mostrarToast("✅ Orden eliminada", "success");

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

window.agregarEquipo = function (ordenId) {
  window.location.href = `agregar-equipo.html?orden_id=${ordenId}`;
};

window.generarNotaEntrega = function (ordenId) {
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
  window.open(BASE + "nota-entrega.html", "_blank");
};

window.generarNotaEntregaIntervenciones = function (ordenId) {
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
};

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

console.log('[ordenes-flujo.js] Lifecycle handlers ready');
