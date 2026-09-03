// La bandeja no puede repetir una orden.
//
// Reporte (28-ago-2026): "cuando coloco para ver las órdenes por tipo
// DEVOLUCIÓN me aparecen órdenes repetidas en el listado".
//
// El filtro por tipo es un filtro de CLIENTE: no consulta al servidor, tamiza
// lo que ya está cargado. Como las DEVOLUCIÓN casi nunca caen en las 40 vivas,
// la lista queda corta, el botón "Cargar más" se ve, el IntersectionObserver
// lo dispara y la bandeja pagina una y otra vez. Ahí se juntan dos descuidos:
//
//   1 — el listener vivo de la primera página reescribía APP.state.lastVisible
//       en CADA snapshot. Cualquier escritura remota (una Cloud Function
//       estampando, un colega guardando) rebobinaba el cursor al final de la
//       página 1, aunque ya se hubiera paginado hasta la 5.
//   2 — la paginación hacía `APP.state.orders.push(...)` sin deduplicar. Con
//       el cursor rebobinado, la página 2 volvía a entrar entera: cada orden
//       suya quedaba DOS veces en el estado y DOS veces en la tabla.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function nuevoElemento(id) {
  const el = {
    id,
    value: "",
    checked: false,
    disabled: false,
    style: {},
    dataset: {},
    filas: [],
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
      if (s.includes("activo")) return [];
      return s.includes("data-orden-id") ? el.filas : [];
    },
  };
  let _html = "";
  Object.defineProperty(el, "innerHTML", {
    get: () => _html,
    set: (v) => { _html = v; if (v === "") el.filas = []; },
  });
  return el;
}

// ── Firestore de mentira ──────────────────────────────────────────────────
// 120 órdenes ordenadas por fecha desc. Los "snapshots" son índices: el cursor
// de paginación es el índice del último doc entregado.
const TOTAL = 120;
const COLECCION = Array.from({ length: TOTAL }, (_, i) => ({
  ordenId: `2026${String(1000 + i)}`,
  cliente_nombre: i % 7 === 0 ? "PH PLAZA DEL ESTE" : "OTRO CLIENTE",
  tipo_de_servicio: i % 7 === 0 ? "DEVOLUCIÓN" : "PROGRAMACIÓN",
  estado_reparacion: "POR ASIGNAR",
  equipos: [],
}));
const PAGINA = 40;

function cargarBandeja() {
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, nuevoElemento(id));
    return els.get(id);
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Set, Map, URLSearchParams, Promise, Array, Number, String, Boolean, isNaN,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  Object.assign(ctx, {
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
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

  const tabla = getEl("ordersTable");
  ctx.renderizarOrdenYEquipos = (ordenId, orden, equipos, contenedor) => {
    if (contenedor) contenedor.filas.push({ ordenId });
  };
  ctx.actualizarResumen = () => {};
  ctx.renderEmptyState = () => { tabla.innerHTML = ""; };
  ctx.renderSkeletonRows = () => {};
  ctx.marcarClientesTruncados = () => {};
  ctx.aplicarRestriccionesPorRol = () => {};

  vm.runInContext(leer("public", "js", "pages", "ordenes-filters.js"), ctx);

  // El listener vivo y la paginación, contra la colección de mentira.
  let emitirSnapshot = null;
  ctx.firebase = { auth: () => ({ currentUser: { uid: "u1" } }) };
  ctx.EmpresaService = { getDoc: async () => null };
  ctx.OrdenesService = {
    subscribeFirstPage({ onUpdate }) {
      emitirSnapshot = () => onUpdate({
        orders: COLECCION.slice(0, PAGINA).map(o => ({ ...o })),
        lastSnapshot: PAGINA - 1,
        fromCache: false,
      });
      return () => {};
    },
    async loadOrders({ lastSnapshot }) {
      const desde = lastSnapshot === null || lastSnapshot === undefined ? 0 : lastSnapshot + 1;
      const trozo = COLECCION.slice(desde, desde + PAGINA);
      if (trozo.length === 0) return { orders: [], lastSnapshot: null };
      return {
        orders: trozo.map(o => ({ ...o })),
        lastSnapshot: desde + trozo.length - 1,
      };
    },
  };

  vm.runInContext(leer("public", "js", "pages", "ordenes-data.js"), ctx);

  return { ctx, getEl, tabla, snapshot: () => emitirSnapshot() };
}

const repetidos = (ids) => {
  const vistos = new Set(), dobles = new Set();
  for (const id of ids) (vistos.has(id) ? dobles : vistos).add(id);
  return [...dobles];
};

test("D1 · una escritura remota no rebobina el cursor de la paginación", async () => {
  const { ctx, snapshot } = cargarBandeja();
  ctx.cargarOrdenesYEquipos(true);
  snapshot();                                   // primera página viva (0-39)
  const cursorPagina1 = ctx.APP.state.lastVisible;

  await ctx.cargarOrdenesYEquipos(false);       // página 2 (40-79)
  assert.equal(ctx.APP.state.orders.length, 80);

  snapshot();                                   // una Cloud Function estampa algo

  assert.notEqual(ctx.APP.state.lastVisible, cursorPagina1,
    "el cursor volvió al final de la página 1: el siguiente 'Cargar más' repite la página 2");
});

test("D2 · paginar tras una escritura remota no duplica órdenes", async () => {
  const { ctx, tabla, snapshot } = cargarBandeja();
  ctx.cargarOrdenesYEquipos(true);
  snapshot();
  await ctx.cargarOrdenesYEquipos(false);       // página 2

  snapshot();                                   // escritura remota
  await ctx.cargarOrdenesYEquipos(false);       // página 3 — antes repetía la 2

  const dobles = repetidos(ctx.APP.state.orders.map(o => o.ordenId));
  assert.deepEqual(dobles, [], `órdenes repetidas en el estado: ${dobles.join(", ")}`);

  const doblesEnPantalla = repetidos(tabla.filas.map(f => f.ordenId));
  assert.deepEqual(doblesEnPantalla, [],
    `filas repetidas en la tabla: ${doblesEnPantalla.join(", ")}`);
});

test("D3 · el filtro por tipo DEVOLUCIÓN no lista dos veces la misma orden", async () => {
  const { ctx, getEl, tabla, snapshot } = cargarBandeja();
  ctx.cargarOrdenesYEquipos(true);
  snapshot();

  getEl("filtroTipo").value = "DEVOLUCIÓN";
  ctx.aplicarFiltrosCombinados();

  // La lista queda corta → el observer pagina; entre página y página entran
  // escrituras remotas (las DEVOLUCIÓN las crean triggers).
  for (let i = 0; i < 3; i++) {
    await ctx.cargarOrdenesYEquipos(false);
    snapshot();
  }
  ctx.aplicarFiltrosCombinados();

  const ids = tabla.filas.map(f => f.ordenId);
  assert.deepEqual(repetidos(ids), [],
    `la bandeja muestra la misma DEVOLUCIÓN más de una vez: ${repetidos(ids).join(", ")}`);
  assert.ok(ids.length > 0, "el filtro no mostró ninguna DEVOLUCIÓN");
});

test("D4 · seguir paginando sí trae órdenes nuevas (el cursor no se congela)", async () => {
  const { ctx, snapshot } = cargarBandeja();
  ctx.cargarOrdenesYEquipos(true);
  snapshot();
  await ctx.cargarOrdenesYEquipos(false);   // 40-79
  await ctx.cargarOrdenesYEquipos(false);   // 80-119
  assert.equal(ctx.APP.state.orders.length, TOTAL,
    "la paginación dejó de avanzar: faltan órdenes viejas");
});
