// La bandeja de órdenes no se le puede mover a la persona bajo los pies.
//
// Reporte de recepción (28-ago-2026, Brenda): "busqué la orden de DEVOLUCIÓN de
// PH Plaza del Este, la 2026082401. La búsqueda se realiza, pero luego vuelve a
// saltar al inicio, donde aparecen las órdenes creadas recientemente. Y al
// colocar el cursor sobre una orden, sin hacer clic, esa orden empieza a
// parpadear."
//
// Dos defectos con la misma raíz — el listener vivo de la primera página repinta
// con CADA escritura remota y nadie le había dicho que en pantalla no estaban
// las 40 recientes:
//   A — la búsqueda se pintaba a mano en el <tbody> y no dejaba rastro en el
//       estado. La búsqueda rápida ni siquiera cuenta como filtro activo, así
//       que el repintado siguiente volvía a las recientes; y "Cargar más"
//       seguía visible con la página corta de un resultado, el
//       IntersectionObserver lo veía y paginaba recientes debajo del hallazgo.
//   B — el repintado reconstruye el <tbody> aunque no haya cambiado nada de lo
//       que se ve. La fila bajo el cursor se destruye, pierde el :hover y el
//       navegador se lo devuelve al frame siguiente: late.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// ── DOM mínimo ────────────────────────────────────────────────────────────
// Solo lo que tocan getActiveFilters/renderOrdersList: campos con valor,
// contenedores que se vacían y un contador de filas pintadas. El contador es
// lo que mide el defecto B: cuántas veces se reconstruyó la lista.
function nuevoElemento(id) {
  const el = {
    id,
    value: "",
    checked: false,
    disabled: false,
    style: {},
    dataset: {},
    filas: [],                    // filas "pintadas" dentro del contenedor
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll(sel) {
      const s = String(sel);
      if (s.includes("activo")) return [];          // ninguna fila desplegada
      return s.includes("data-orden-id") ? el.filas : [];
    },
  };
  // Vaciar el contenedor por innerHTML tiene que borrar también las filas.
  let _html = "";
  Object.defineProperty(el, "innerHTML", {
    get: () => _html,
    set: (v) => { _html = v; if (v === "") el.filas = []; },
  });
  return el;
}

function cargarBandeja() {
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, nuevoElemento(id));
    return els.get(id);
  };

  const ctx = {
    console,
    JSON,
    Date,
    Set,
    Map,
    URLSearchParams,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  // El sandbox ES el window: en el navegador todo lo que cuelga de window es
  // global, y si aquí fueran dos objetos distintos `window.APP = …` no dejaría
  // un `APP` global y los módulos no se verían entre ellos.
  Object.assign(ctx, {
    addEventListener() {},
    matchMedia: () => ({ matches: false }),   // escritorio
    location: { hostname: "localhost", pathname: "/ordenes/", search: "", hash: "" },
    scrollY: 0,
    innerHeight: 800,
    scrollTo() {},
    history: { replaceState() {} },
  });
  ctx.window = ctx;
  ctx.document = {
    body: { classList: nuevoElemento("body").classList },
    documentElement: { scrollHeight: 2000 },
    getElementById: getEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => nuevoElemento("tmp"),
    addEventListener() {},
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "core", "roles.js"), ctx);
  vm.runInContext(leer("public", "js", "pages", "ordenes-state.js"), ctx);

  // Colaboradores del render, reemplazados por contadores.
  const pintados = { veces: 0, ultima: [] };
  ctx.renderizarOrdenYEquipos = (ordenId, orden, equipos, contenedor) => {
    if (contenedor) contenedor.filas.push({ ordenId });
  };
  ctx.renderOrdersListEspia = pintados;
  ctx.actualizarResumen = () => {};
  ctx.renderEmptyState = () => { pintados.vacio = true; };
  ctx.renderSkeletonRows = () => {};
  ctx.marcarClientesTruncados = () => {};

  vm.runInContext(leer("public", "js", "pages", "ordenes-filters.js"), ctx);

  // ordenarOrdenes vive en ordenes-data.js (que arrastra Firestore): se define
  // aquí con el mismo criterio por defecto, ordenId descendente.
  ctx.ordenarOrdenes = (data) => data.slice().sort((a, b) =>
    APP_sort(a, b, ctx.APP.state.sortField, ctx.APP.state.sortAscending));
  function APP_sort(a, b, campo, asc) {
    const va = String(a[campo] ?? ""), vb = String(b[campo] ?? "");
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  }

  // Espía de reconstrucciones: envuelve el render real contando llamadas que
  // SÍ tocaron el DOM (las que se saltan no vacían el contenedor).
  const tabla = getEl("ordersTable");
  const renderReal = ctx.renderOrdersList;
  ctx.renderOrdersList = (list) => {
    const antes = tabla.filas;
    renderReal(list);
    if (tabla.filas !== antes || tabla.filas.length !== antes.length) pintados.veces++;
    pintados.ultima = tabla.filas.map(f => f.ordenId);
  };
  // aplicarFiltrosCombinados capturó la referencia original en el momento de
  // definirse; se re-declara para que use el espía.
  const aplicarReal = ctx.aplicarFiltrosCombinados;
  ctx.aplicarFiltrosCombinados = aplicarReal;

  return { ctx, getEl, pintados, tabla, renderReal };
}

const ORDEN_VIEJA = {
  ordenId: "2026082401", cliente_nombre: "PH PLAZA DEL ESTE",
  tipo_de_servicio: "DEVOLUCIÓN", estado_reparacion: "POR ASIGNAR", equipos: [],
};
const RECIENTES = Array.from({ length: 40 }, (_, i) => ({
  ordenId: `20260828${String(i + 10).padStart(2, "0")}`,
  cliente_nombre: "OTRO CLIENTE", tipo_de_servicio: "PROGRAMACIÓN",
  estado_reparacion: "POR ASIGNAR", equipos: [],
}));

// ── A · la búsqueda sobrevive al listener vivo ────────────────────────────

test("A1 · un repintado del listener NO devuelve la bandeja a las recientes", () => {
  const { ctx, tabla } = cargarBandeja();
  // La búsqueda trajo una orden vieja y el merge la dejó junto a las 40 vivas.
  ctx.APP.state.orders = [ORDEN_VIEJA, ...RECIENTES];
  ctx.entrarModoServidor([ORDEN_VIEJA]);
  ctx.renderOrdersList([ORDEN_VIEJA]);
  assert.deepEqual(tabla.filas.map(f => f.ordenId), ["2026082401"]);

  // Llega una escritura remota cualquiera: el listener repinta.
  ctx.aplicarFiltrosCombinados();

  assert.deepEqual(tabla.filas.map(f => f.ordenId), ["2026082401"],
    "la búsqueda saltó de vuelta al inicio con las recientes");
});

test("A2 · sin búsqueda, el repintado sí muestra la lista viva completa", () => {
  const { ctx, tabla } = cargarBandeja();
  ctx.APP.state.orders = [...RECIENTES];
  ctx.aplicarFiltrosCombinados();
  assert.equal(tabla.filas.length, 40);
});

test("A3 · con la búsqueda en pantalla no se pagina: 'Cargar más' queda oculto", () => {
  const { ctx, getEl } = cargarBandeja();
  ctx.APP.state.orders = [ORDEN_VIEJA, ...RECIENTES];
  ctx.entrarModoServidor([ORDEN_VIEJA]);

  assert.equal(ctx.APP.state.busquedaServidor, true);
  assert.equal(getEl("btnCargarMas").style.display, "none",
    "el observer volvería a paginar recientes debajo del hallazgo");

  ctx.salirModoServidor();
  assert.equal(ctx.APP.state.busquedaServidor, false);
});

test("A4 · el guardia de la paginación está en el disparador, no solo en el CSS", () => {
  const src = leer("public", "js", "pages", "ordenes-index.js");
  const ini = src.indexOf("const triggerLoadMore");
  const fin = src.indexOf("btnCargarMas.addEventListener", ini);
  assert.ok(ini > 0 && fin > ini, "no se encontró triggerLoadMore");
  assert.match(src.slice(ini, fin), /APP\.state\.busquedaServidor\)\s*return/,
    "sin este candado, mostrar el botón por cualquier vía vuelve a paginar");
});

test("A5 · el listener vivo no re-muestra 'Cargar más' durante una búsqueda", () => {
  const src = leer("public", "js", "pages", "ordenes-data.js");
  const ini = src.indexOf("onUpdate:");
  const fin = src.indexOf("onError:", ini);
  const bloque = src.slice(ini, fin);
  const iBtn = bloque.indexOf('btnCargarMas.style.display = "block"');
  assert.ok(iBtn > 0, "no se encontró el punto donde se muestra el botón");
  assert.match(bloque.slice(0, iBtn), /!APP\.state\.busquedaServidor/,
    "el snapshot volvía a mostrar el botón y despertaba el auto-paginado");
});

// ── B · el repintado en balde ─────────────────────────────────────────────

test("B1 · una lista idéntica no reconstruye la tabla (el parpadeo al pasar el cursor)", () => {
  const { ctx, tabla } = cargarBandeja();
  ctx.APP.state.orders = [...RECIENTES];
  ctx.aplicarFiltrosCombinados();
  const filasPintadas = tabla.filas;
  assert.equal(filasPintadas.length, 40);

  // Ráfaga de escrituras remotas que no cambian nada de lo que se ve.
  ctx.aplicarFiltrosCombinados();
  ctx.aplicarFiltrosCombinados();
  ctx.aplicarFiltrosCombinados();

  assert.equal(tabla.filas, filasPintadas,
    "el <tbody> se reconstruyó sin necesidad: la fila bajo el cursor parpadea");
});

test("B2 · un cambio de verdad sí repinta", () => {
  const { ctx, tabla } = cargarBandeja();
  ctx.APP.state.orders = RECIENTES.map(o => ({ ...o }));
  ctx.aplicarFiltrosCombinados();
  const filasPintadas = tabla.filas;

  ctx.APP.state.orders[0].estado_reparacion = "ASIGNADO";
  ctx.aplicarFiltrosCombinados();

  assert.notEqual(tabla.filas, filasPintadas,
    "el cambio de estado se quedaría invisible hasta recargar");
});

test("B3 · con el esqueleto en pantalla nunca se salta el repintado", () => {
  const { ctx, tabla } = cargarBandeja();
  ctx.APP.state.orders = [...RECIENTES];
  ctx.aplicarFiltrosCombinados();
  assert.equal(tabla.filas.length, 40);

  // Alguien pisó el <tbody> por fuera (esqueleto de una búsqueda, estado
  // vacío, error). La firma sigue siendo la misma, pero no hay filas.
  tabla.innerHTML = "";
  ctx.aplicarFiltrosCombinados();

  assert.equal(tabla.filas.length, 40, "la bandeja se habría quedado en blanco");
});
