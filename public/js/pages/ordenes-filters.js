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
  APP.state.busquedaServidor = false;
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

  // El reporte de pendientes vuelca toda la operación (clientes + vendedores):
  // a vendedor ni se le ofrece — y la página además valida el rol al cargar
  // (auditoría órdenes P2).
  if (normalizedRole === ROLES.VENDEDOR) {
    document.querySelectorAll("[data-action='go-reporte-pendientes']").forEach(b => b.remove());
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

  return { filtroOrden, filtroCliente, filtroSerial, filtroTipo, filtroEstado, filtroTecnico, soloMias, soloQcPendiente,
           idsCorreo: _idsCorreo };
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

  if (filters.filtroEstado && estado !== filters.filtroEstado) return false;
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
  box.innerHTML = `<span><b>Estás viendo las ${n} orden(es) del correo.</b>
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

  const btn = document.getElementById("btnCargarMas");
  if (btn && !APP.state.busquedaServidor) {
    btn.innerHTML = `<i data-lucide="chevron-down"></i> Cargar más órdenes (${filtered.length})`;
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
  if (document.getElementById('filtroQcPendiente')?.checked) params.set('qc', '1');
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
  // ?ids=a,b,c — las órdenes concretas que enumeraba un correo. Las trae
  // asegurarOrdenesDeCorreo() del servidor, porque son viejas y no caben en la
  // primera página. Tope de cordura: el correo manda como mucho 30.
  const idsRaw = params.get('ids');
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
}

window.filtrarOrdenes = async function () {
  const filtroOrden = normTxt(document.getElementById("filtroOrden").value);
  const filtroCliente = normTxt(document.getElementById("filtroCliente").value);
  const filtroSerial = normTxt(document.getElementById("filtroSerial").value);
  const filtroTipo = normTxt(document.getElementById("filtroTipo").value);
  const ordersTable = document.getElementById("ordersTable");
  const cardsWrap = document.getElementById("ordersCards");

  // Skeleton durante el roundtrip (auditoría órdenes P0): antes la tabla
  // quedaba EN BLANCO sin ninguna señal mientras respondía el servidor —
  // la sensación de "lenta" más frecuente de la bandeja.
  invalidarFirmaLista();
  if (typeof renderSkeletonRows === 'function') renderSkeletonRows(6);
  else { if (ordersTable) ordersTable.innerHTML = ""; if (cardsWrap) cardsWrap.innerHTML = ""; }

  _syncFiltersToURL();

  if (!filtroOrden && !filtroCliente && !filtroSerial && !filtroTipo) {
    salirModoServidor();
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

    // Search results may include orders outside the live-listener slice
    // (older orders matched by client / serial). Merge into APP.state.orders
    // so the delegated row-expand handler can resolve them — otherwise the
    // expand spinner hangs silently. See ordenes-render.js:_toggleOrdenRow.
    _mergeIntoOrdersCache(resultados);

    if (resultados.length === 0) {
      salirModoServidor();
      renderEmptyState("No se encontraron coincidencias", {
        icon: 'search-x',
        sublabel: 'Prueba ajustar los filtros o limpiar la búsqueda.'
      });
      actualizarResumen(resultados);
      return;
    }

    // El resultado queda ANOTADO antes de pintarlo: de ahí en adelante el
    // listener vivo repinta esto y no la bandeja completa, y la paginación
    // automática queda apagada hasta que se limpie la búsqueda.
    entrarModoServidor(resultados);
    renderOrdersList(resultados);
    return;

  } catch (e) {
    console.error("❌ Error al filtrar:", e);
    salirModoServidor();
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

  // Skeleton durante el roundtrip — ver nota en filtrarOrdenes.
  invalidarFirmaLista();
  if (typeof renderSkeletonRows === 'function') renderSkeletonRows(6);
  else { if (ordersTable) ordersTable.innerHTML = ""; if (cardsWrap) cardsWrap.innerHTML = ""; }

  if (!valor) {
    salirModoServidor();
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

    _mergeIntoOrdersCache(resultados);

    if (resultados.length === 0) {
      salirModoServidor();
      renderEmptyState("No se encontraron coincidencias", {
        icon: 'search-x',
        sublabel: 'Prueba ajustar los filtros o limpiar la búsqueda.'
      });
      actualizarResumen(resultados);
      return;
    }

    // Ver la nota de filtrarOrdenes: el resultado se anota antes de pintarlo.
    entrarModoServidor(resultados);
    renderOrdersList(resultados);
    return;

  } catch (e) {
    console.error("❌ Error al filtrar:", e);
    salirModoServidor();
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

window.cambiarOrden = function () {
  const sel = document.getElementById("campoOrdenamiento");
  if (!sel) return;
  APP.state.sortField = sel.value;
  _syncFiltersToURL();
  syncSortHeaders();
  cargarOrdenesYEquipos();
};

window.cambiarDireccionOrden = function () {
  APP.state.sortAscending = !APP.state.sortAscending;
  _syncFiltersToURL();
  syncSortHeaders();
  cargarOrdenesYEquipos();
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
  cargarOrdenesYEquipos();
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
window.filtrarPorChipEstado = function (el) {
  const estado = el.dataset.estado || '';
  const wasActive = el.classList.contains('active');
  const next = wasActive ? '' : estado;

  // Mirror into the hidden select.
  const sel = document.getElementById('filtroEstado');
  if (sel) sel.value = next;

  // Update chip ARIA state.
  document.querySelectorAll('.estado-chips-bar .estado-chip').forEach(chip => {
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
  document.querySelectorAll('.estado-chips-bar .estado-chip').forEach(chip => {
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
  invalidarFirmaLista();
  APP.state.orders = [];
  APP.state.lastVisible = null;

  if (!estado) {
    salirModoServidor();
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
    renderOrdersList(resultados);
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
        resultados = await OrdenesService.filterByStatus(estado, 200);

        if (resultados.length === 0) {
          salirModoServidor();
          renderEmptyState("No hay órdenes con ese estado", { icon: 'search-x' });
          actualizarResumen(resultados);
        } else {
          APP.state.orders = resultados;
          entrarModoServidor(resultados);
          renderOrdersList(resultados);   // ya hace resumen, roles, iconos y truncado
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
