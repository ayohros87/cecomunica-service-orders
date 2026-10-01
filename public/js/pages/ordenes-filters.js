// @ts-nocheck
/* ========================================
 * ORDENES FILTERS - Filter logic + UI bindings
 * All filter state lives in the DOM (filtro* inputs); these helpers
 * read it, normalize it (via normTxt from ordenes-state.js), match
 * orders, and re-render via ordenes-render.js.
 * ======================================== */

// Merge fresh orders into APP.state.orders by ordenId — fresh entries
// (e.g. from searchOrders) overwrite stale cache, untouched entries are
// preserved. Mirrors the merge pattern in ordenes-data.js for the live
// listener. Required so the delegated expand handler in ordenes-render.js
// can resolve orders that were surfaced by search but lived outside the
// initial page slice.
function _mergeIntoOrdersCache(fresh) {
  if (!Array.isArray(fresh) || fresh.length === 0) return;
  const freshIds = new Set(fresh.map(o => o.ordenId));
  const kept = (APP.state.orders || []).filter(o => !freshIds.has(o.ordenId));
  APP.state.orders = [...fresh, ...kept];
}

// ── Modo "resultado de servidor" ───────────────────────────────────────────
// Reporte de recepción (2026-08-28): "busco la orden 2026082401, la encuentra,
// y al rato la pantalla salta sola de vuelta a las órdenes recientes".
//
// Una búsqueda (rápida o avanzada) y el chip de estado NO son un filtro sobre
// las 40 órdenes vivas: son una CONSULTA PROPIA al servidor que trae órdenes
// de cualquier antigüedad. Antes ese resultado se pintaba a mano en el <tbody>
// y nadie más se enteraba, así que:
//   · el listener vivo repintaba la bandeja completa encima del hallazgo —
//     con la búsqueda rápida ni siquiera hay input entre los filtros activos,
//     de modo que aplicarFiltrosCombinados volvía a las recientes; y
//   · "Cargar más" seguía visible con la página corta de un solo resultado, el
//     IntersectionObserver lo veía y paginaba órdenes recientes debajo.
// Recordar el resultado arregla las dos cosas: la base del repintado pasa a
// ser ESE conjunto y la paginación queda apagada mientras dure.
let _resultadoServidor = null;   // Set<string> de ordenId | null

function entrarModoServidor(resultados) {
  _resultadoServidor = new Set((resultados || []).map(o => o.ordenId));
  APP.state.busquedaServidor = true;
  const btn = document.getElementById("btnCargarMas");
  if (btn) btn.style.display = "none";
}

function salirModoServidor() {
  _resultadoServidor = null;
  _busq = null;
  APP.state.busquedaServidor = false;
  APP.state.origenServidor = null;
  _ocultarAvisoChip();
}

// ── Búsqueda en servidor: texto + estado + fechas + Cargar más ─────────────
// Auditoría UX 2026-09-28 (T6, 4.2 #16): la búsqueda cortaba en 100 sin avisar,
// no combinaba con el chip ni con fechas y no encontraba palabras a medias.
// Ahora una sola función arma la consulta (OrdenesService.buscarOrdenes) con
// todo lo que haya en pantalla y recuerda el cursor para "Cargar más".
const BUSQ_PAGINA = 100;
let _busq = null;   // { modo, cursor, acumulado, hayMas, filtradoEnCliente }

// Un <input type="date"> da "AAAA-MM-DD" sin zona: se lee como día de Panamá
// (UTC-5 fijo, sin horario de verano) para que "hasta hoy" incluya la tarde.
function _fechaDeInput(id, finDelDia) {
  const v = (document.getElementById(id)?.value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T${finDelDia ? "23:59:59.999" : "00:00:00.000"}-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function _rangoFechas() {
  let desde = _fechaDeInput("filtroDesde", false);
  let hasta = _fechaDeInput("filtroHasta", true);
  // Rango al revés = la persona invirtió los campos; se corrige, no se castiga.
  if (desde && hasta && desde > hasta) {
    desde = _fechaDeInput("filtroHasta", false);
    hasta = _fechaDeInput("filtroDesde", true);
  }
  return { desde, hasta };
}
function _hayFechas() {
  const { desde, hasta } = _rangoFechas();
  return !!(desde || hasta);
}
function _msFecha(v) {
  if (!v) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}
function _modoInferido() {
  return (document.getElementById("filtroRapido")?.value || "").trim() ? "rapido" : "avanzado";
}
function _hayTextoAvanzado() {
  return ["filtroOrden", "filtroCliente", "filtroSerial"]
    .some(id => (document.getElementById(id)?.value || "").trim());
}

function _mostrarAvisoBusqueda() {
  const box = document.getElementById("chipMasBox");
  if (!box || !_busq) return;
  if (!_busq.hayMas) { box.style.display = "none"; return; }
  const fmt = (n) => Number(n).toLocaleString("es-PA");
  const n = _busq.acumulado.length;
  const nota = _busq.filtradoEnCliente
    ? ' <span title="El índice de estado/fecha aún se está construyendo">(estado y fecha filtrados en esta página)</span>'
    : "";
  box.innerHTML = `<span>${n ? `Mostrando <b>${fmt(n)}</b> resultados` : "Ninguna coincidencia en lo revisado"}; hay más órdenes por revisar.${nota}</span>
    <button type="button" class="btn btn-secondary btn-sm" id="btnBusqMas"><i data-lucide="chevron-down"></i> Cargar más</button>`;
  box.style.display = "flex";
  const b = box.querySelector("#btnBusqMas");
  if (b) b.onclick = () => {
    b.disabled = true;
    b.textContent = "Cargando…";
    _buscarEnServidor(_busq?.modo || _modoInferido(), { anexar: true });
  };
  if (window.lucide?.createIcons) { try { lucide.createIcons({ nodes: [box] }); } catch (_) {} }
}

/**
 * Corre la búsqueda en el servidor con TODO lo que hay en pantalla: texto
 * (rápido o avanzado), chip de estado y rango de fechas.
 * @param {"rapido"|"avanzado"} modo
 * @param {{anexar?: boolean}} [opts] - anexar=true: siguiente página (Cargar más)
 */
async function _buscarEnServidor(modo, { anexar = false } = {}) {
  const valorRapido = (document.getElementById("filtroRapido")?.value || "").trim();
  const texto = modo === "rapido"
    ? { filtroOrden: valorRapido, filtroCliente: valorRapido, filtroSerial: valorRapido, quickSearch: true }
    : {
        filtroOrden: (document.getElementById("filtroOrden")?.value || "").trim(),
        filtroCliente: (document.getElementById("filtroCliente")?.value || "").trim(),
        filtroSerial: (document.getElementById("filtroSerial")?.value || "").trim(),
        quickSearch: false,
      };
  const hayTexto = !!(texto.filtroOrden || texto.filtroCliente || texto.filtroSerial);
  // Sin toUpperCase: las claves de chip por_recibir/por_asignar son valores
  // del select y vuelven a él (filtrarPorEstado); buscarOrdenes normaliza.
  const estado = (document.getElementById("filtroEstado")?.value || "").trim();
  const { desde, hasta } = _rangoFechas();
  _syncFiltersToURL();

  // Sin texto ni fechas no hay nada que buscar: el chip o la bandeja viva.
  if (!hayTexto && !desde && !hasta) {
    salirModoServidor();
    if (estado) { filtrarPorEstado(estado); return; }
    cargarOrdenesYEquipos(true);
    return;
  }

  if (!anexar) {
    invalidarFirmaLista();
    if (typeof renderSkeletonRows === "function") renderSkeletonRows(6);
  }

  let r;
  try {
    r = await OrdenesService.buscarOrdenes({
      ...texto, estado, desde, hasta,
      limit: BUSQ_PAGINA,
      cursor: anexar ? _busq?.cursor : null,
    });
  } catch (e) {
    console.error("❌ Error al buscar:", e);
    salirModoServidor();
    renderEmptyState("Error al buscar", { icon: "alert-triangle", sublabel: "Por favor, recarga la página." });
    return;
  }

  let nuevos = r.orders;
  // El avanzado respeta tipo/técnico/mis órdenes desde el primer pintado (el
  // rápido nunca los aplicó: busca en toda la colección).
  if (modo === "avanzado") {
    const filters = getActiveFilters();
    if (hasActiveFilters(filters)) nuevos = applyActiveFiltersToOrders(nuevos, filters);
  }
  const previos = anexar && _busq ? _busq.acumulado : [];
  const vistos = new Set(previos.map(o => o.ordenId));
  const acumulado = [...previos, ...nuevos.filter(o => !vistos.has(o.ordenId))];

  _mergeIntoOrdersCache(acumulado);
  entrarModoServidor(acumulado);
  APP.state.origenServidor = "busqueda";
  _busq = { modo, cursor: r.cursor, acumulado, hayMas: r.hayMas, filtradoEnCliente: r.filtradoEnCliente };

  if (!acumulado.length) {
    renderEmptyState("No se encontraron coincidencias", {
      icon: "search-x",
      sublabel: r.hayMas ? "Aún hay órdenes por revisar: usa «Cargar más»." : "Prueba ajustar los filtros, las fechas o limpiar la búsqueda.",
    });
    actualizarResumen(acumulado);
  } else {
    renderOrdersList(acumulado);
  }
  _mostrarAvisoBusqueda();
  aplicarRestriccionesPorRol(APP.state.userRole);
}
window.buscarEnServidor = _buscarEnServidor;

// Cambio en Desde/Hasta: re-consulta con el texto y el chip actuales.
window.filtrarPorFechas = function () {
  _buscarEnServidor(_busq?.modo || _modoInferido());
};

// ?desde=/?hasta= en la URL (un enlace copiado): la bandeja viva no sabe de
// fechas, así que se consulta al servidor al cargar.
window.asegurarBusquedaDeURL = function () {
  if (_hayFechas()) {
    const bloque = document.getElementById("filtrosAvanzados");
    if (bloque) bloque.style.display = "block";
    _buscarEnServidor(_modoInferido());
  }
};

// ── "Mostrando N de M" del chip de estado (auditoría UX 2026-09-28, 4.2 #6)
// El chip trae las 200 más recientes de ese estado y "Cargar más" se ocultaba
// sin aviso: "Entregado" parecía tener 200 órdenes cuando eran 3,400.
const CHIP_PAGINA = 200;
function _ocultarAvisoChip() {
  const box = document.getElementById("chipMasBox");
  if (box) box.style.display = "none";
}
async function _mostrarAvisoChip(estado, mostradas, limite) {
  const box = document.getElementById("chipMasBox");
  if (!box) return;
  let total = null;
  try {
    if (window.SenalesService) total = await SenalesService.countChipBandeja(estado);
  } catch (e) { total = null; }
  // El usuario pudo cambiar de chip mientras llegaba el conteo.
  if ((document.getElementById("filtroEstado")?.value || "") !== estado) return;
  // "N+" (conteo con tope) es un piso: basta para saber si hay más.
  const totalN = total == null ? null : parseInt(total, 10);
  const hayMas = Number.isFinite(totalN) ? totalN > mostradas : mostradas >= limite;
  if (!hayMas) { box.style.display = "none"; return; }
  const fmt = (n) => Number(n).toLocaleString("es-PA");
  box.innerHTML = `<span>Mostrando las <b>${fmt(mostradas)}</b> más recientes${total != null ? ` de <b>${fmt(total)}</b>` : ""}.</span>
    <button type="button" class="btn btn-secondary btn-sm" id="btnChipMas"><i data-lucide="chevron-down"></i> Cargar más</button>`;
  box.style.display = "flex";
  const b = box.querySelector("#btnChipMas");
  if (b) b.onclick = () => {
    b.disabled = true;
    filtrarPorEstado(estado, { limite: limite + CHIP_PAGINA });
  };
  if (window.lucide?.createIcons) { try { lucide.createIcons({ nodes: [box] }); } catch (_) {} }
}
window.entrarModoServidor = entrarModoServidor;
window.salirModoServidor = salirModoServidor;

// Base del repintado: con un resultado de servidor en pantalla son exactamente
// las órdenes que trajo la consulta (releídas de APP.state.orders, así el
// listener vivo sí refresca lo que cambie en ellas); si no, la lista viva.
function baseDeRenderizado() {
  if (!_resultadoServidor) return APP.state.orders;
  return (APP.state.orders || []).filter(o => _resultadoServidor.has(o.ordenId));
}

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
  // Permisos alineados con roles.js (auditoría UX 2026-09-28, T4): antes se
  // ocultaba con querySelector (solo el PRIMER botón: el cajón móvil seguía
  // mostrando "Nueva" y "Config") y con listas de roles propias.
  const puede = (accion) => typeof canRole === "function" ? canRole(normalizedRole, accion) : false;
  const btnAdminEquiposCliente = document.getElementById("btnAdminEquiposCliente");
  const mobileBtnAdminEquiposCliente = document.getElementById("mobileBtnAdminEquiposCliente");
  const topbarBtnAdminEquiposCliente = document.getElementById("topbarBtnAdminEquiposCliente");

  if (!puede("crear-orden")) {
    document.querySelectorAll("[data-action='go-nueva-orden']").forEach(b => b.remove());
  }
  // Config (listas, importar/exportar) es de administrador: sus páginas ya
  // rebotan a cualquier otro rol.
  if (!puede("admin-equipos")) {
    document.querySelectorAll("[data-action='go-config']").forEach(b => b.remove());
  }

  // El reporte de pendientes vuelca toda la operación (clientes + vendedores):
  // a vendedor ni se le ofrece — y la página además valida el rol al cargar
  // (auditoría órdenes P2).
  if (normalizedRole === ROLES.VENDEDOR) {
    document.querySelectorAll("[data-action='go-reporte-pendientes']").forEach(b => b.remove());
  }

  if (normalizedRole !== ROLES.ADMIN && normalizedRole !== ROLES.RECEPCION) {
    document.querySelectorAll(".btn-agregar-equipo").forEach(b => b.style.display = "none");
  }

  // "Progreso" = permiso 'ver-progreso' de roles.js (admin, vendedor, jefe de
  // taller, gerente; antes lo veían técnicos y NO jefe ni gerente). Los
  // técnicos lo conservan: progreso-tecnicos.html les abre su propia fila en
  // modo lectura.
  const verProgreso = puede("ver-progreso")
    || [ROLES.TECNICO, ROLES.TECNICO_OPERATIVO].includes(normalizedRole);
  document.querySelectorAll("[data-action='go-progreso-tecnicos']").forEach(b => {
    b.style.display = verProgreso ? "" : "none";
  });

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

// Órdenes que un correo señaló por su ID (deep-link `?ids=`). Es un filtro
// EXACTO y sin caja de texto: no lo pone la persona, lo pone el enlace. Se
// guarda aquí y no en un input porque no hay control de UI que lo represente.
let _idsCorreo = null;   // Set<string> | null

function getActiveFilters() {
  const filtroOrden = normTxt(document.getElementById("filtroOrden")?.value || "");
  const filtroCliente = normTxt(document.getElementById("filtroCliente")?.value || "");
  const filtroSerial = normTxt(document.getElementById("filtroSerial")?.value || "");
  const filtroTipo = normTxt(document.getElementById("filtroTipo")?.value || "");
  const filtroEstado = (document.getElementById("filtroEstado")?.value || "").toString().trim().toUpperCase();
  const filtroTecnico = normTxt(document.getElementById("filtroTecnico")?.value || "");
  const soloMias = !!document.getElementById("toggleMisOrdenes")?.checked;
  const soloQcPendiente = !!document.getElementById("filtroQcPendiente")?.checked;

  const { desde, hasta } = _rangoFechas();

  return { filtroOrden, filtroCliente, filtroSerial, filtroTipo, filtroEstado, filtroTecnico, soloMias, soloQcPendiente,
           idsCorreo: _idsCorreo, desdeMs: desde ? desde.getTime() : null, hastaMs: hasta ? hasta.getTime() : null };
}

function hasActiveFilters(filters) {
  return !!(
    filters.filtroOrden ||
    filters.filtroCliente ||
    filters.filtroSerial ||
    filters.filtroTipo ||
    filters.filtroEstado ||
    filters.filtroTecnico ||
    filters.soloMias ||
    filters.soloQcPendiente ||
    filters.desdeMs != null || filters.hastaMs != null ||
    (filters.idsCorreo && filters.idsCorreo.size)
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

  // El deep-link del correo manda sobre todo lo demás: la persona hizo clic en
  // "Ver órdenes" para ver ESAS, no para explorar la bandeja.
  if (filters.idsCorreo && filters.idsCorreo.size && !filters.idsCorreo.has(order.ordenId)) return false;

  // Chip de estado: misma regla que la consulta (domain/estadosBandeja.js) —
  // por_recibir / por_asignar son vistas; POR ASIGNAR crudo ya excluye las
  // DEVOLUCIÓN ahí.
  if (filters.filtroEstado) {
    const ok = typeof EstadosBandeja !== "undefined"
      ? EstadosBandeja.coincide(order, filters.filtroEstado)
      : estado === filters.filtroEstado;
    if (!ok) return false;
  }
  // Rango de fechas (auditoría UX 2026-09-28, T6): el mismo criterio que el
  // servidor, para que el repintado vivo no muestre lo que la consulta excluyó.
  if (filters.desdeMs != null || filters.hastaMs != null) {
    const f = _msFecha(order.fecha_creacion);
    if (f == null) return false;
    if (filters.desdeMs != null && f < filters.desdeMs) return false;
    if (filters.hastaMs != null && f > filters.hastaMs) return false;
  }
  if (filters.soloMias && !esOrdenMia(order)) return false;
  // Cola de control de calidad: completadas que no pueden entregarse hasta
  // que el QC quede aprobado. Las ENTRADA cierran sin QC, así que no son cola.
  if (filters.soloQcPendiente) {
    const esEntrada = typeof esOrdenEntrada === 'function' && esOrdenEntrada(order);
    const pendiente = typeof OrdenesQC !== 'undefined' && OrdenesQC.qcPendiente(order);
    if (esEntrada || !pendiente || estado !== "COMPLETADO (EN OFICINA)") return false;
  }

  return true;
}

function applyActiveFiltersToOrders(list, filters) {
  return (list || []).filter(o => matchesAdvancedFilters(o, filters));
}

// ── El repintado NO reconstruye la tabla bajo un menú ⋯ abierto ────────────
// Reporte de recepción (2026-08-28): "creé cuatro órdenes y solo pude imprimir
// una". "Imprimir orden" y "Nota de entrega" viven SOLO en el menú ⋯ de la
// fila, y ese menú es un nodo DENTRO del <tbody>: cuando el listener vivo
// repintaba (cualquier escritura remota en las 40 más recientes lo dispara),
// el <tbody> se vaciaba y el menú abierto desaparecía a media maniobra. Peor
// aún, si el nodo se reemplaza entre el mousedown y el mouseup el navegador NO
// emite el click: el botón de imprimir se pulsaba y no pasaba nada.
//
// Con un menú abierto la persona está a mitad de una acción, así que el
// repintado espera. Se vigila con un intervalo corto (solo mientras hay algo
// pendiente) para cubrir TODAS las formas de cerrarlo: clic fuera, ESC, elegir
// una opción o volver a pulsar el ⋯.
let _repintadoPendiente = false;
let _repintadoEsperaDesde = 0;
let _repintadoVigia = null;
const REPINTADO_ESPERA_MAX_MS = 15000;

function _hayMenuAbiertoEnLista() {
  return !!document.querySelector(
    '#ordersTable .overflow-menu-dropdown.show, #ordersCards .overflow-menu-dropdown.show'
  );
}

function _vigilarCierreDeMenu() {
  if (_repintadoVigia) return;
  _repintadoVigia = setInterval(() => {
    if (_hayMenuAbiertoEnLista()) return;
    clearInterval(_repintadoVigia);
    _repintadoVigia = null;
    if (!_repintadoPendiente) return;
    _repintadoPendiente = false;
    // Se repinta con el estado FRESCO, no con la lista que quedó congelada.
    if (typeof aplicarFiltrosCombinados === 'function') aplicarFiltrosCombinados();
  }, 250);
}

// ── Repintado en balde ────────────────────────────────────────────────────
// Reporte de recepción (2026-08-28): "paso el cursor por encima de una orden,
// sin hacer clic, y esa orden empieza a parpadear".
//
// El listener vivo dispara con CADA escritura remota sobre las 40 recientes,
// incluidas las que no cambian NADA de lo que se ve (una Cloud Function
// estampando un campo interno, un colega guardando otra orden). Cada una
// vaciaba y reconstruía el <tbody>: la fila bajo el cursor se destruye, pierde
// el :hover —fondo y botones de acción— y el navegador se lo devuelve en el
// frame siguiente. Con varias escrituras seguidas, la fila late.
//
// Si la lista a pintar es idéntica a la que ya está en pantalla, no se toca el
// DOM. La firma incluye el orden y el layout porque ambos cambian el dibujo.
let _firmaListaPintada = '';

function _firmaDeLista(list) {
  try {
    return `${APP.state.sortField}|${APP.state.sortAscending}|${APP.utils.isMobileLayout()}|${JSON.stringify(list)}`;
  } catch (e) {
    return '';   // algo no serializable → nunca se salta el repintado
  }
}

// Cualquier pintado ajeno a renderOrdersList (esqueleto, estado vacío, páginas
// de "Cargar más" añadidas a mano) invalida la firma. Además del contador de
// filas de abajo, que ya cubre esqueleto y vacío por sí solo.
function invalidarFirmaLista() { _firmaListaPintada = ''; }
window.invalidarFirmaLista = invalidarFirmaLista;

function renderOrdersList(list) {
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");

  const firma = _firmaDeLista(list);
  if (firma && firma === _firmaListaPintada && (list?.length || 0) > 0) {
    // Cinturón: la firma sola no basta si el <tbody> lo pisó otro (esqueleto,
    // estado vacío). Cada orden aporta su fila + su fila de detalle, así que
    // con la lista pintada de verdad el contador nunca baja de list.length.
    const pintadas = (ordersTable?.querySelectorAll('tr[data-orden-id]').length || 0)
      + (cardsWrap?.querySelectorAll('.card-contrato[data-orden-id]').length || 0);
    if (pintadas >= list.length) {
      actualizarResumen(list);
      return;
    }
  }

  if (_hayMenuAbiertoEnLista()) {
    if (!_repintadoPendiente) {
      _repintadoPendiente = true;
      _repintadoEsperaDesde = Date.now();
    }
    // Tope de cortesía: un menú abierto y olvidado no congela la bandeja.
    if (Date.now() - _repintadoEsperaDesde < REPINTADO_ESPERA_MAX_MS) {
      _vigilarCierreDeMenu();
      return;
    }
  }
  _repintadoPendiente = false;

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

  // Red de seguridad del scroll (2026-08-28): este render vacía el <tbody> y
  // lo reconstruye. Si algo fuerza un layout con la tabla a medio llenar, el
  // navegador recorta window.scrollY al máximo de ese momento y la persona
  // acaba en el tope de la página — y como el listener vivo repinta con CADA
  // escritura remota, pasaba sin tocar nada. La causa concreta (medir el
  // nombre del cliente fila por fila) ya se corrigió en ordenes-render.js;
  // esto cubre cualquier otra lectura de layout que se cuele en el futuro.
  const scrollPrevio = window.scrollY;

  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";

  if (!list || list.length === 0) {
    _firmaListaPintada = '';
    renderEmptyState("No se encontraron coincidencias", {
      icon: 'search-x',
      sublabel: 'Prueba ajustar los filtros o limpiar la búsqueda.'
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

  _firmaListaPintada = firma;

  actualizarResumen(list);
  aplicarRestriccionesPorRol(APP.state.userRole);
  APP.utils.lucideRefresh([ordersTable, cardsWrap]);
  if (typeof marcarClientesTruncados === 'function') marcarClientesTruncados([ordersTable, cardsWrap]);

  // Solo se devuelve la posición si SIGUE existiendo con la lista nueva. Al
  // filtrar, la lista se acorta de verdad y el tope es el destino correcto;
  // al repintar el mismo conjunto por un snapshot, la posición se conserva.
  if (scrollPrevio > 0 && window.scrollY !== scrollPrevio) {
    const alcanzable = document.documentElement.scrollHeight - window.innerHeight;
    if (alcanzable >= scrollPrevio) window.scrollTo(0, scrollPrevio);
  }
}

// La cola de QC NO cabe en la primera página. La lista viva son las 40 órdenes
// más recientes por fecha_creacion, pero una orden entra en cola de QC al
// completarse: las que enumera el correo diario son precisamente las viejas, y
// el filtro de cliente sobre esas 40 devolvía "No se encontraron coincidencias"
// mientras el correo decía que había cinco esperando.
//
// Solución: al encender el filtro (chip o deep-link ?qc=1) se consulta la cola
// al servidor y se fusiona en APP.state.orders. Sobrevive a los snapshots
// siguientes porque onUpdate conserva lo que no viene en la página viva
// (paginatedKept), igual que las páginas de "Cargar más".
let _colaQcCargada = false;

async function asegurarColaQc() {
  if (!document.getElementById('filtroQcPendiente')?.checked) return;
  if (_colaQcCargada) return;
  if (typeof OrdenesService?.listQcPendientes !== 'function') return;

  const loader = document.getElementById('loader');
  if (loader) loader.style.display = '';
  try {
    const cola = await OrdenesService.listQcPendientes(200);
    const yaHay = new Set((APP.state.orders || []).map(o => o.ordenId));
    const nuevas = cola.filter(o => !yaHay.has(o.ordenId));
    if (nuevas.length) {
      APP.state.orders = [...(APP.state.orders || []), ...nuevas];
      APP.state.chipBase = APP.state.orders;
    }
    _colaQcCargada = true;
    aplicarFiltrosCombinados();
  } catch (e) {
    console.error('[QC] no se pudo traer la cola de control de calidad:', e);
    Toast.show('No se pudo cargar la cola de QC completa; se muestra solo lo que ya estaba cargado.', 'bad');
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

// Al apagar el filtro se olvida la marca para que volver a encenderlo
// re-consulte (una orden pudo firmarse mientras tanto).
function olvidarColaQc() { _colaQcCargada = false; }

// ── Deep-link `?ids=` de los correos ──────────────────────────────────────
// Mismo problema que la cola de QC, y por la misma razón: las órdenes que un
// correo enumera son viejas (estancadas 10+ días, listas para entregar hace
// días) y no caben en la primera página, que son las 40 más recientes. Antes
// el CTA "Ver órdenes" llevaba a la lista pelada y la persona veía su bandeja
// normal, sin rastro de lo que el correo anunciaba.
//
// El correo ya calculó QUÉ órdenes son, así que las manda por ID en la URL en
// vez de que el cliente vuelva a deducir el criterio (edad, SLA, estado) —
// duplicar esa lógica aquí la dejaría desincronizada del cron a la primera.
let _idsCargados = false;

async function asegurarOrdenesDeCorreo() {
  if (!_idsCorreo || !_idsCorreo.size || _idsCargados) return;
  if (typeof OrdenesService?.listByIds !== 'function') return;

  const loader = document.getElementById('loader');
  if (loader) loader.style.display = '';
  try {
    const faltantes = [...(_idsCorreo)]
      .filter(id => !(APP.state.orders || []).some(o => o.ordenId === id));
    if (faltantes.length) {
      const traidas = await OrdenesService.listByIds(faltantes);
      if (traidas.length) {
        APP.state.orders = [...(APP.state.orders || []), ...traidas];
        APP.state.chipBase = APP.state.orders;
      }
    }
    _idsCargados = true;
    aplicarFiltrosCombinados();
    _avisoCorreoHtml();
  } catch (e) {
    console.error('[ids] no se pudieron traer las órdenes del correo:', e);
    Toast.show('No se pudieron cargar todas las órdenes del correo.', 'bad');
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

// Aviso de que la vista está recortada por el enlace del correo, con salida.
// Sin esto la persona ve 6 órdenes y cree que su bandeja se vació.
function _avisoCorreoHtml() {
  if (!_idsCorreo || !_idsCorreo.size) return;
  let box = document.getElementById('avisoDeepLinkCorreo');
  const cont = document.getElementById('ordersTable')?.closest('.app-table-wrap')?.parentElement
            || document.querySelector('.app-wrap');
  if (!box && cont) {
    box = document.createElement('div');
    box.id = 'avisoDeepLinkCorreo';
    box.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;'
      + 'margin:0 0 12px;padding:9px 12px;border-radius:8px;font-size:13px;'
      + 'background:#EFF6FF;color:#1E3A8A;border:1px solid #BFDBFE;';
    cont.insertBefore(box, cont.firstChild);
  }
  if (!box) return;
  const n = _idsCorreo.size;
  box.innerHTML = `<span><b>Estás viendo ${n === 1 ? 'solo la orden del enlace' : `las ${n} órdenes del enlace`}.</b>
      El resto de la bandeja está oculto.</span>
    <button type="button" class="btn btn-secondary btn-sm" id="btnVerTodasCorreo"
            style="margin-left:auto;">Ver todas las órdenes</button>`;
  box.querySelector('#btnVerTodasCorreo').onclick = () => {
    _idsCorreo = null;
    box.remove();
    aplicarFiltrosCombinados();
  };
}

function aplicarFiltrosCombinados() {
  const filters = getActiveFilters();
  // Con una búsqueda en pantalla la base es el resultado del servidor, no las
  // 40 vivas: sin esto, cada escritura remota devolvía la bandeja al inicio.
  const base = baseDeRenderizado();
  const filtered = hasActiveFilters(filters)
    ? applyActiveFiltersToOrders(base, filters)
    : base;

  // Sin contador: "(40)" eran las YA cargadas, no las que faltan (auditoría
  // UX 2026-09-28, 4.2 #6).
  const btn = document.getElementById("btnCargarMas");
  if (btn && !APP.state.busquedaServidor) {
    btn.innerHTML = `<i data-lucide="chevron-down"></i> Cargar más órdenes`;
  }

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
  // `num` es el campo "Orden" del avanzado (prefijo tecleado). La clave `orden`
  // quedó reservada para el deep-link por ID exacto (alias de `ids`, abajo).
  num:     'filtroOrden',
  cliente: 'filtroCliente',
  serial:  'filtroSerial',
  tipo:    'filtroTipo',
  estado:  'filtroEstado',
  tecnico: 'filtroTecnico',
  desde:   'filtroDesde',
  hasta:   'filtroHasta',
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
  if (document.getElementById('filtroQcPendiente')?.checked) params.set('qc', '1');
  // El deep-link por ID sobrevive al refresco y se puede copiar.
  if (_idsCorreo && _idsCorreo.size) params.set('ids', [..._idsCorreo].join(','));
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
  // ?qc=1 — cola de control de calidad. Es el destino del CTA del correo
  // diario (recordatorioOperativo, sección D) y de la señal del home.
  if (params.get('qc') === '1') {
    const q = document.getElementById('filtroQcPendiente');
    if (q) { q.checked = true; touched = true; }
  }
  // ?ids=a,b,c — las órdenes concretas que enumeraba un correo, una señal del
  // home o el resultado de Ctrl+K. Las trae asegurarOrdenesDeCorreo() del
  // servidor, porque pueden ser viejas y no caber en la primera página. Tope
  // de cordura: el correo manda como mucho 30. `?orden=<id>` es alias (los
  // enlaces viejos de correos, nuevo-batch y editar-orden): antes solo
  // filtraba por texto las 40 recientes y una orden vieja "no existía"
  // (auditoría de módulos 2026-09-30, 01 R2).
  const idsRaw = params.get('ids') || params.get('orden');
  if (idsRaw) {
    const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
    if (ids.length) { _idsCorreo = new Set(ids); touched = true; }
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
  // Refleja el sort restaurado en las cabeceras (se llama después de la
  // pintada inicial de syncSortHeaders, que corre con los defaults).
  if (typeof syncSortHeaders === 'function') syncSortHeaders();

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
  mirror('filtroDesde',   'mobileFiltroDesde');
  mirror('filtroHasta',   'mobileFiltroHasta');

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
    // La navegación reescribe los filtros: el resultado de servidor que había
    // en pantalla ya no representa lo que pide la URL.
    salirModoServidor();
    const btnCargarMas = document.getElementById("btnCargarMas");
    if (btnCargarMas) btnCargarMas.style.display = "block";
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
  const dDesde = document.getElementById("filtroDesde");
  const dHasta = document.getElementById("filtroHasta");
  if (dDesde) dDesde.value = document.getElementById("mobileFiltroDesde")?.value || "";
  if (dHasta) dHasta.value = document.getElementById("mobileFiltroHasta")?.value || "";
}

// Buscar (avanzado) y Buscar (rápido) comparten _buscarEnServidor: la misma
// consulta con el chip de estado y las fechas que haya en pantalla.
window.filtrarOrdenes = async function () {
  await _buscarEnServidor("avanzado");
};

window.filtrarRapido = async function () {
  if (!document.getElementById("filtroRapido")) return;
  await _buscarEnServidor("rapido");
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
  ["filtroDesde", "filtroHasta", "mobileFiltroDesde", "mobileFiltroHasta"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

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
  document.querySelectorAll('.estado-chips-bar .estado-chip').forEach(chip => {
    const isAll = !chip.dataset.estado;
    chip.classList.toggle('active', isAll);
    chip.setAttribute('aria-selected', isAll ? 'true' : 'false');
  });

  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");
  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";
  invalidarFirmaLista();
  salirModoServidor();
  const btnCargarMas = document.getElementById("btnCargarMas");
  if (btnCargarMas) btnCargarMas.style.display = "block";

  _syncFiltersToURL();
  cargarOrdenesYEquipos(true);
};

// Cambiar el orden NO toca Firestore (2026-09-02, factura de agosto): el sort
// lo aplica ordenarOrdenes() en memoria dentro de renderOrdersList, así que
// basta re-renderizar. Antes se llamaba cargarOrdenesYEquipos(), que destruye
// y recrea el onSnapshot — y un listener nuevo re-descarga su primera página
// completa (~50 docs de 8KB) para producir la misma pantalla.
window.cambiarOrden = function () {
  const sel = document.getElementById("campoOrdenamiento");
  if (!sel) return;
  APP.state.sortField = sel.value;
  _syncFiltersToURL();
  syncSortHeaders();
  aplicarFiltrosCombinados();
};

window.cambiarDireccionOrden = function () {
  APP.state.sortAscending = !APP.state.sortAscending;
  _syncFiltersToURL();
  syncSortHeaders();
  aplicarFiltrosCombinados();
};

// ── Cabeceras ordenables (auditoría órdenes P2) ─────────────────────
// Click en un <th class="th-sort"> ordena por esa columna; segundo click
// invierte la dirección. Reemplazan al select "Ordenar" + botón de dirección
// de la toolbar (el select sigue oculto como espejo para el drawer móvil).
window.sortColumna = function (el) {
  const key = el?.dataset?.sortKey;
  if (!key) return;
  if (APP.state.sortField === key) {
    APP.state.sortAscending = !APP.state.sortAscending;
  } else {
    APP.state.sortField = key;
    // Número y fechas arrancan "lo más reciente primero"; texto, A→Z.
    APP.state.sortAscending = !["ordenId", "fecha_creacion", "fecha_entrega"].includes(key);
  }
  // Espejos de estado (solo si la opción existe en cada select).
  [document.getElementById("campoOrdenamiento"), document.getElementById("mobileSortField")]
    .forEach(sel => {
      if (sel && Array.from(sel.options).some(o => o.value === key)) sel.value = key;
    });
  _syncFiltersToURL();
  syncSortHeaders();
  aplicarFiltrosCombinados();
};

// Pinta ↑/↓ y aria-sort en la cabecera activa (y limpia las demás).
window.syncSortHeaders = function () {
  document.querySelectorAll("th.th-sort[data-sort-key]").forEach(th => {
    const active = th.dataset.sortKey === APP.state.sortField;
    const dir = th.querySelector(".th-sort__dir");
    if (dir) dir.textContent = active ? (APP.state.sortAscending ? " ↑" : " ↓") : "";
    th.classList.toggle("th-sort--active", active);
    if (active) th.setAttribute("aria-sort", APP.state.sortAscending ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  });
};
// Estado inicial (o restaurado de URL): el script va defer, el <thead> ya existe.
syncSortHeaders();

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
// Chip "Cerradas" (auditoría UX 2026-09-28, seguimiento): los 6 estados
// terminales viven en UN chip con menú; sueltos eran 12 chips en la barra.
const CHIP_CERRADAS = {
  'ENTREGADO AL CLIENTE':  'Entregado',
  'CERRADA (VISITA)':      'Visita cerrada',
  'CERRADA (DEVOLUCION)':  'Devolución cerrada',
  'CERRADA (ENTRADA)':     'Entrada cerrada',
  'CERRADA (SIN RETIRAR)': 'Sin retirar',
  'ANULADA':               'Anulada',
};
window.CHIP_CERRADAS = CHIP_CERRADAS;

// Pinta el chip de grupo y sus ítems según el estado activo: si es uno de los
// cerrados, el chip queda activo y su etiqueta dice cuál ("Cerradas · Anulada").
function _pintarChipCerradas(current) {
  const esCerrado = Object.prototype.hasOwnProperty.call(CHIP_CERRADAS, current);
  document.querySelectorAll('.estado-chip--cerradas').forEach(chip => {
    chip.classList.toggle('active', esCerrado);
    chip.setAttribute('aria-selected', esCerrado ? 'true' : 'false');
    chip.dataset.estado = esCerrado ? current : '';
    const lbl = chip.querySelector('.estado-chip__label');
    if (lbl) lbl.textContent = esCerrado ? `Cerradas · ${CHIP_CERRADAS[current]}` : 'Cerradas';
  });
  document.querySelectorAll('.estado-chip-menu__item').forEach(it => {
    it.classList.toggle('active', (it.dataset.estado || '') === current);
  });
}

function _cerrarMenusCerradas() {
  document.querySelectorAll('.estado-chip-menu').forEach(m => { m.hidden = true; });
  document.querySelectorAll('.estado-chip--cerradas').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// Abre el menú del chip "Cerradas" pegado al chip, en posición fija para que
// la barra móvil (overflow-x) no lo recorte. Se cierra al elegir, al tocar
// fuera o con Escape.
window.abrirChipCerradas = function (btn) {
  const menu = btn.parentElement?.querySelector('.estado-chip-menu');
  if (!menu) return;
  const abrir = menu.hidden;
  _cerrarMenusCerradas();
  if (!abrir) return;
  const r = btn.getBoundingClientRect();
  menu.hidden = false;
  const ancho = menu.offsetWidth || 220;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${r.bottom + 6}px`;
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('.estado-chip-menu__item.active, .estado-chip-menu__item')?.focus();
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.estado-chip-grupo')) _cerrarMenusCerradas();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _cerrarMenusCerradas(); });
window.addEventListener('resize', _cerrarMenusCerradas);

window.filtrarPorChipEstado = function (el) {
  const estado = el.dataset.estado || '';
  // Tocar el chip activo RE-CONSULTA, no lo apaga: quien lo toca para
  // "refrescar" perdía el filtro y caía en "Todas" (auditoría de módulos
  // 2026-09-30, 01 R7). Para volver a Todas está el chip "Todas".
  const next = estado;
  _cerrarMenusCerradas();
  // El chip es una intención nueva: el recorte del deep-link `?ids=` se suelta.
  if (_idsCorreo) {
    _idsCorreo = null;
    document.getElementById('avisoDeepLinkCorreo')?.remove();
  }

  // Mirror into the hidden select.
  const sel = document.getElementById('filtroEstado');
  if (sel) sel.value = next;

  // Update chip ARIA state.
  document.querySelectorAll('.estado-chips-bar .estado-chip:not(.estado-chip--cerradas)').forEach(chip => {
    const isActive = chip.dataset.estado === next;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  _pintarChipCerradas(next);

  // Con una BÚSQUEDA en pantalla el chip no la tira (auditoría UX 2026-09-28,
  // 4.2 #6) y ahora re-consulta EN EL SERVIDOR con el estado (4.2 #16): antes
  // filtraba solo la página traída y "cliente X, entregadas" se quedaba corto.
  if (APP.state.busquedaServidor && APP.state.origenServidor === 'busqueda') {
    _buscarEnServidor(_busq?.modo || _modoInferido());
    return;
  }

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
  document.querySelectorAll('.estado-chips-bar .estado-chip:not(.estado-chip--cerradas)').forEach(chip => {
    const isActive = (chip.dataset.estado || '') === current;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  _pintarChipCerradas(current);
};

// Lo que trae el chip del servidor pasa por los filtros que siguen vivos en
// pantalla (mis órdenes, tipo, técnico): el técnico con "Ver solo mis órdenes"
// veía las 18 ASIGNADO de todos hasta el siguiente repintado del listener.
function _visiblesDeChip(resultados) {
  const filters = getActiveFilters();
  return hasActiveFilters(filters) ? applyActiveFiltersToOrders(resultados, filters) : resultados;
}

// ?estado= en la URL (señales del home, chip copiado): la misma consulta que
// tocar el chip. Antes solo se copiaba al select y se filtraban EN EL
// NAVEGADOR las 40 recientes: "En taller 19" abría con 6 filas (auditoría de
// módulos 2026-09-30, 01 R2). Se llama tras cargarOrdenesYEquipos, como
// asegurarColaQc; no se espera.
window.asegurarEstadoDeURL = function () {
  const estado = (document.getElementById('filtroEstado')?.value || '').trim();
  if (!estado) return;
  if (_hayFechas()) return;                     // asegurarBusquedaDeURL ya consulta con el estado
  if (_idsCorreo && _idsCorreo.size) return;    // ?ids= manda: son órdenes concretas
  filtrarPorEstado(estado);
};

window.filtrarPorEstado = async function (estado, { limite = CHIP_PAGINA } = {}) {
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");
  const btnCargarMas = document.getElementById("btnCargarMas");
  const loader = document.getElementById("loader");

  // Una clave de vista llega a veces en mayúsculas (URL, búsqueda): se lleva a
  // la forma del <option> o el select la descarta y el chip queda en "Todas".
  const vista = window.EstadosBandeja ? EstadosBandeja.vistaDe(estado) : null;
  if (vista) estado = vista;

  // Keep #filtroEstado in sync so the URL serializer sees the active estado.
  const filtroEstadoSel = document.getElementById("filtroEstado");
  if (filtroEstadoSel) filtroEstadoSel.value = estado || "";

  // Con texto avanzado o fechas, el chip se cruza EN EL SERVIDOR (auditoría UX
  // 2026-09-28, 4.2 #16): antes era un cruce sobre las 200 del estado con un
  // aviso. _buscarEnServidor vuelve aquí solo si no hay texto ni fechas.
  if (_hayTextoAvanzado() || _hayFechas()) {
    _buscarEnServidor("avanzado");
    return;
  }
  _syncFiltersToURL();

  if (ordersTable) ordersTable.innerHTML = "";
  if (cardsWrap) cardsWrap.innerHTML = "";
  invalidarFirmaLista();
  APP.state.orders = [];
  APP.state.lastVisible = null;

  if (!estado) {
    salirModoServidor();
    if (btnCargarMas) {
      btnCargarMas.innerHTML = '<i data-lucide="chevron-down"></i> Cargar más órdenes';
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

    resultados = await OrdenesService.filterByStatus(estado, limite);

    if (resultados.length === 0) {
      salirModoServidor();
      renderEmptyState("No hay órdenes con ese estado", { icon: 'search-x' });
      return;
    }

    // _toggleOrdenRow resolves orders from APP.state.orders by ordenId;
    // without this the expand spinner hangs silently after a chip filter.
    APP.state.orders = resultados;

    // Mismo trato que la búsqueda: el conjunto del servidor manda sobre el
    // repintado del listener vivo mientras el chip siga encendido.
    entrarModoServidor(resultados);
    APP.state.origenServidor = "estado";
    renderOrdersList(_visiblesDeChip(resultados));
    _mostrarAvisoChip(estado, resultados.length, limite);
    return;   // el `finally` de abajo apaga el loader

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
        resultados = await OrdenesService.filterByStatus(estado, limite);

        if (resultados.length === 0) {
          salirModoServidor();
          renderEmptyState("No hay órdenes con ese estado", { icon: 'search-x' });
          actualizarResumen(resultados);
        } else {
          APP.state.orders = resultados;
          entrarModoServidor(resultados);
          APP.state.origenServidor = "estado";
          renderOrdersList(_visiblesDeChip(resultados));   // ya hace resumen, roles, iconos y truncado
          _mostrarAvisoChip(estado, resultados.length, limite);
        }

        if (loader) APP.utils.hide(loader);
        return;
      } catch (fallbackErr) {
        console.error("❌ Fallback also failed:", fallbackErr);
      }
    }

    salirModoServidor();
    renderEmptyState("Error al filtrar por estado", { icon: 'alert-triangle', sublabel: 'Por favor, recarga la página.' });
  } finally {
    if (loader) loader.style.display = "none";
  }

  actualizarResumen(resultados);
  if (typeof aplicarRestriccionesPorRol === 'function') aplicarRestriccionesPorRol(APP.state.userRole);
};

// --- Puente window (F1, docs/plans/PLAN_MIGRACION_MODULAR.md) ---
// Estos nombres los usan otros archivos o el HTML (onclick / inline). Hoy son
// globales porque el archivo es un <script> clásico; al empaquetarse como
// módulo ES dejarían de serlo. El puente los publica de forma explícita.
Object.assign(window, {
  aplicarFiltrosCombinados, applyActiveFiltersToOrders, asegurarColaQc,
  asegurarOrdenesDeCorreo, getActiveFilters, hasActiveFilters, olvidarColaQc,
  setFechaEntregaVisible, syncMobileAdvancedFiltersToDesktop
});
