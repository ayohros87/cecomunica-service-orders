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
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function aplicarFiltrosCombinados() {
  const filters = getActiveFilters();
  const filtered = hasActiveFilters(filters)
    ? applyActiveFiltersToOrders(APP.state.orders, filters)
    : APP.state.orders;

  const btn = document.getElementById("btnCargarMas");
  if (btn) btn.innerHTML = `<i data-lucide="chevron-down"></i> Cargar más órdenes (${filtered.length})`;

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

  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

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
      clientesMap: APP.state.clientesMap,
      quickSearch: false
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
    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (e) {
    console.error("❌ Error al filtrar:", e);
    ordersTable.innerHTML = "<tr><td colspan='9' style='color:red;'>Error al filtrar datos</td></tr>";
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
      clientesMap: APP.state.clientesMap,
      quickSearch: true
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
    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (e) {
    console.error("❌ Error al filtrar:", e);
    ordersTable.innerHTML = "<tr><td colspan='9' style='color:red;'>Error al filtrar datos</td></tr>";
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

  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");
  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  cargarOrdenesYEquipos(true);
};

window.cambiarOrden = function () {
  APP.state.sortField = document.getElementById("APP.state.sortField").value;
  cargarOrdenesYEquipos();
};

window.cambiarDireccionOrden = function () {
  APP.state.sortAscending = !APP.state.sortAscending;
  cargarOrdenesYEquipos();
};

window.filtrarPorEstado = async function (estado) {
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");
  const btnCargarMas = document.getElementById("btnCargarMas");
  const loader = document.getElementById("loader");

  document.getElementById("filtroOrden").value = "";
  document.getElementById("filtroCliente").value = "";
  document.getElementById("filtroSerial").value = "";

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
          if (typeof lucide !== 'undefined') lucide.createIcons();
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

console.log('[ordenes-filters.js] Filter helpers ready');
