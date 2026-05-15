// @ts-nocheck
/* ========================================
 * ORDENES DATA - Firestore reads
 * Loads clientes, tipos de servicio, técnicos, and the paginated
 * orders list. Mutates APP.state.* only — no DOM rendering here
 * (rendering lives in ordenes-render.js, filter UI in ordenes-filters.js).
 * ======================================== */

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

window.cargarOrdenesYEquipos = async function (esCargaInicial = true) {
  const ordersTable = APP.utils.mustGetEl("ordersTable");
  if (esCargaInicial) {
    ordersTable.innerHTML = "";
    APP.state.orders = [];
    APP.state.lastVisible = null;
    APP.utils.mustGetEl("btnCargarMas").innerHTML = '<i data-lucide="chevron-down"></i> Cargar más órdenes (0)';
    APP.utils.mustGetEl("btnCargarMas").disabled = false;
    APP.utils.mustGetEl("btnCargarMas").style.display = "block";
  }

  try {
    const uid = APP.state.userId || firebase.auth().currentUser?.uid || null;
    const { orders, lastSnapshot } = await OrdenesService.loadOrders({
      lastSnapshot: esCargaInicial ? null : APP.state.lastVisible,
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
    APP.utils.lucideRefresh([ordersTable, document.getElementById("btnCargarMas")]);

  } catch (error) {
    console.error("❌ Error al cargar órdenes:", error);
    ordersTable.innerHTML = "<tr><td colspan='9' style='color:red;'>Error al cargar datos</td></tr>";
  }
  const filters = getActiveFilters();
  actualizarResumen(hasActiveFilters(filters) ? applyActiveFiltersToOrders(APP.state.orders, filters) : APP.state.orders);
};
