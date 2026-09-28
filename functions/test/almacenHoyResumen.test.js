// Almacén · Hoy y el asistente de conteo cuentan desde el resumen
// (auditoría de consumo 2026-09-25).
//
// Cada apertura de Almacén · Hoy leía ~4,200 fichas del pool para pintar dos
// cosas que no muestran ninguna ficha:
//   · la nota de "por clasificar" — solo dos números (cuántas y cuántas sin
//     modelo) sobre ~1,240 fichas que la bandeja NO pinta, a propósito;
//   · la sección de diferencias — la bodega contada por modelo, ~2,870 fichas.
// Los dos conteos ya están hechos en `agregados_pool`.
//
// La regla que manda: el resumen sirve para PINTAR, nunca para decidir una
// mutación (puede ir segundos atrasado). Estos dos usos son de pintar — el
// asistente de conteo guarda solo lo que el usuario teclea.
//
//   H1 — contarBodegaPorModelo lee el resumen, no el pool, y da el MISMO Map
//        que contar las fichas.
//   H2 — sin resumen, cuenta sobre el pool (y da lo mismo).
//   H3 — contarPorClasificar da el mismo {n, sinModelo} que contar las fichas.
//   H4 — sin resumen, cuenta sobre el pool.
//   H5 — "sin modelo" no cuenta una ficha con modelo_id de catálogo aunque le
//        falte la etiqueta: esa SÍ tiene modelo.
//   H6 — abrir Almacén · Hoy no lee fichas de "por clasificar" ni de bodega,
//        y la nota dice los números correctos.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (rel) => fs.readFileSync(path.join(RAIZ, "public", "js", rel), "utf8");

const POOL = [
  { id: "B1", modelo_id: "m1", modelo_label: "PD606", estado: "en_bodega" },
  { id: "B2", modelo_id: "m1", modelo_label: "PD606", estado: "en_bodega" },
  { id: "B3", modelo_id: "m2", modelo_label: "NX420", estado: "en_bodega" },
  // Grupo por etiqueta (sin id de catálogo): también cuenta como modelo.
  { id: "B4", modelo_id: null, modelo_label: "TK 3000", estado: "en_bodega" },
  { id: "C1", modelo_id: "m1", modelo_label: "PD606", estado: "en_cliente" },
  { id: "P1", modelo_id: "m1", modelo_label: "PD606", estado: "por_clasificar" },
  { id: "P2", modelo_id: null, modelo_label: "", estado: "por_clasificar" },
  { id: "P3", modelo_id: null, modelo_label: "", estado: "por_clasificar" },
  { id: "P4", modelo_id: null, modelo_label: "", estado: "por_clasificar" },
  { id: "D1", modelo_id: "m2", modelo_label: "NX420", estado: "devuelto_revision" },
];

function montarServicio({ pool = POOL, resumen = undefined } = {}) {
  const consultas = [];
  const ctxObj = {
    window: {}, console: { warn() {}, error() {}, log() {} },
    setTimeout, Promise, Map, Set, Date, JSON, Math, Array, Object, Number, String, Boolean, RegExp, Error,
  };
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(leer("services/equiposPoolService.js"), ctx);
  const S = ctxObj.window.EquiposPoolService;
  const mk = S.modeloKey.bind(S);
  const resumenReal = () => {
    const m = new Map();
    for (const eq of pool) {
      const key = mk(eq.modelo_id, eq.modelo_label);
      const g = m.get(key) || { key, modelo_id: eq.modelo_id || null, modelo_label: eq.modelo_label || "", est: {} };
      g.est[eq.estado] = (g.est[eq.estado] || 0) + 1;
      m.set(key, g);
    }
    return [...m.values()];
  };
  function coleccion(nombre) {
    const filtros = [];
    const api = {
      where(c, op, v) { filtros.push([c, op, v]); return api; },
      limit() { return api; },
      async get() {
        consultas.push({ col: nombre, filtros: filtros.map(f => [...f]) });
        if (nombre === "agregados_pool") {
          const r = resumen === undefined ? resumenReal() : resumen;
          return { docs: r.map(x => ({ id: x.key, data: () => ({ modelo_id: x.modelo_id, modelo_label: x.modelo_label, est: x.est }) })), size: r.length };
        }
        const docs = pool.filter(p => filtros.every(([c, , v]) => p[c] === v));
        return { docs: docs.map(p => ({ id: p.id, data: () => ({ ...p }) })), size: docs.length, empty: !docs.length };
      },
    };
    return api;
  }
  ctxObj.firebase = { firestore: () => ({ collection: coleccion }) };
  return { S, consultas, mk };
}

// La verdad, contada como lo hacía el código viejo sobre las fichas.
const bodegaContada = (pool, mk) => {
  const m = new Map();
  for (const d of pool.filter(p => p.estado === "en_bodega")) {
    const k = mk(d.modelo_id, d.modelo_label);
    const cur = m.get(k) || { modelo_id: d.modelo_id, modelo_label: d.modelo_label, n: 0 };
    cur.n++; m.set(k, cur);
  }
  return m;
};
const leyoFichas = (consultas, estado) =>
  consultas.some(c => c.col === "equipos_pool" && c.filtros.some(([f, , v]) => f === "estado" && v === estado));

test("H1 · contarBodegaPorModelo lee el resumen y da el mismo Map que contar las fichas", async () => {
  const { S, consultas, mk } = montarServicio();
  const m = await S.contarBodegaPorModelo();
  assert.equal(leyoFichas(consultas, "en_bodega"), false, "no puede leer las fichas de bodega");
  const esperado = bodegaContada(POOL, mk);
  assert.deepEqual([...m.keys()].sort(), [...esperado.keys()].sort(), "las mismas claves, incluido el grupo por etiqueta");
  for (const [k, v] of esperado) assert.equal(m.get(k).n, v.n, `bodega de ${k}`);
});

test("H2 · sin resumen, contarBodegaPorModelo cuenta sobre el pool y da lo mismo", async () => {
  const { S, consultas, mk } = montarServicio({ resumen: [] });
  const m = await S.contarBodegaPorModelo();
  assert.equal(leyoFichas(consultas, "en_bodega"), true, "sin resumen tiene que contar las fichas");
  const esperado = bodegaContada(POOL, mk);
  for (const [k, v] of esperado) assert.equal(m.get(k).n, v.n);
});

test("H3 · contarPorClasificar da el mismo {n, sinModelo} que contar las fichas", async () => {
  const { S, consultas } = montarServicio();
  const r = await S.contarPorClasificar();
  assert.equal(leyoFichas(consultas, "por_clasificar"), false, "no puede leer las fichas de por clasificar");
  const pc = POOL.filter(p => p.estado === "por_clasificar");
  assert.equal(r.n, pc.length);
  assert.equal(r.sinModelo, pc.filter(p => !p.modelo_id && !p.modelo_label).length);
});

test("H4 · sin resumen, contarPorClasificar cuenta sobre el pool", async () => {
  const { S, consultas } = montarServicio({ resumen: [] });
  const r = await S.contarPorClasificar();
  assert.equal(leyoFichas(consultas, "por_clasificar"), true);
  assert.deepEqual({ n: r.n, sinModelo: r.sinModelo }, { n: 4, sinModelo: 3 });
});

test("H5 · 'sin modelo' no cuenta una ficha con modelo_id aunque le falte la etiqueta", async () => {
  // Una ficha con id de catálogo y sin etiqueta TIENE modelo: el id lo resuelve.
  // El código viejo contaba `!modelo_label` y la habría metido en "sin modelo".
  //
  // Dos casos, porque se comportan distinto en el resumen:
  //   P5 — m1 sin etiqueta, pero m1 tiene OTRAS fichas con etiqueta: el grupo
  //        m1 del resumen hereda "PD606", y ahí `!r.modelo_label` no se nota.
  //   P6 — m9, cuyas fichas NO tienen etiqueta ninguna: el grupo m9 queda con
  //        etiqueta vacía. Ese es el que delata contar por etiqueta en vez de
  //        por la clave `sinmodelo`. (Una primera versión de esta prueba solo
  //        tenía P5 y seguía verde con la cuenta equivocada.)
  const pool = [...POOL,
    { id: "P5", modelo_id: "m1", modelo_label: "", estado: "por_clasificar" },
    { id: "P6", modelo_id: "m9", modelo_label: "", estado: "por_clasificar" },
  ];
  for (const resumen of [undefined, []]) {           // con resumen y sin él: igual
    const { S } = montarServicio({ pool, resumen });
    const r = await S.contarPorClasificar();
    assert.equal(r.n, 6);
    assert.equal(r.sinModelo, 3, "P5 y P6 tienen modelo_id: ninguna es 'sin modelo'");
  }
});

// ── La pantalla ──────────────────────────────────────────────────────────
function montarHoy({ sinMetodoNuevo = false } = {}) {
  const consultas = [];
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { id, innerHTML: "", textContent: "", style: {}, hidden: false,
      classList: { toggle() {}, add() {}, remove() {} }, querySelector() { return null; },
      querySelectorAll() { return []; }, addEventListener() {} });
    return els.get(id);
  };
  const doc = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const resumenReal = (mk) => {
    const m = new Map();
    for (const eq of POOL) {
      const key = mk(eq.modelo_id, eq.modelo_label);
      const g = m.get(key) || { key, modelo_id: eq.modelo_id || null, modelo_label: eq.modelo_label || "", est: {} };
      g.est[eq.estado] = (g.est[eq.estado] || 0) + 1;
      m.set(key, g);
    }
    return [...m.values()];
  };
  let mk = null;
  function coleccion(nombre) {
    const filtros = [];
    const api = {
      where(c, op, v) { filtros.push([c, op, v]); return api; },
      limit() { return api; }, orderBy() { return api; },
      count() { return { get: async () => { consultas.push({ col: nombre, filtros: filtros.map(f => [...f]), count: true }); return { data: () => ({ count: 0 }) }; } }; },
      async get() {
        consultas.push({ col: nombre, filtros: filtros.map(f => [...f]) });
        if (nombre === "agregados_pool") {
          const r = resumenReal(mk);
          return { docs: r.map(x => ({ id: x.key, data: () => ({ modelo_id: x.modelo_id, modelo_label: x.modelo_label, est: x.est }) })), size: r.length };
        }
        if (nombre === "equipos_pool") {
          const docs = POOL.filter(p => filtros.every(([c, , v]) => p[c] === v));
          return { docs: docs.map(p => ({ id: p.id, data: () => ({ ...p }) })), size: docs.length, empty: !docs.length };
        }
        return { docs: [], size: 0, empty: true };
      },
    };
    return api;
  }
  const ctxObj = {
    window: { userRole: "inventario" }, document: doc,
    location: { search: "", pathname: "/almacen/index.html" },
    console: { warn() {}, error() {}, log() {} },
    firebase: { firestore: () => ({ collection: coleccion }), auth: () => ({ currentUser: { uid: "u1" } }) },
    Toast: { show() {} }, Modal: { open() {}, close() {}, confirm: async () => true },
    lucide: { createIcons() {} }, ROLES: { ADMIN: "administrador", INVENTARIO: "inventario" },
    ModelosService: { getModelos: async () => [] },
    InventarioService: { getInventarioActual: async () => [] },
    // La forma real de todo(): render() hace [...colas.seriales], así que un {}
    // vacío revienta dentro del try/catch de cargar() y la pantalla no pinta.
    ColaInventarioService: {
      todo: async () => ({ seriales: [], cambios: [], transiciones: [], fallidas: [] }),
      refrescarBadge() {}, COLA_TRANSICIONES_ACTIVA: false,
    },
    setTimeout, Promise, Map, Set, Date, JSON, Math, Array, Object, Number, String, Boolean, RegExp, Error,
  };
  ctxObj.window.Toast = ctxObj.Toast;
  const ctx = vm.createContext(ctxObj);
  for (const f of ["services/equiposPoolService.js", "domain/stockAgg.js", "services/conflictosPoolService.js", "ui/bandeja.js"]) {
    vm.runInContext(leer(f), ctx);
  }
  ctxObj.EquiposPoolService = ctxObj.window.EquiposPoolService;
  ctxObj.StockAgg = ctxObj.window.StockAgg;
  ctxObj.ConflictosPoolService = ctxObj.window.ConflictosPoolService;
  ctxObj.Bandeja = ctxObj.window.Bandeja;
  mk = ctxObj.EquiposPoolService.modeloKey.bind(ctxObj.EquiposPoolService);
  // Simula el equiposPoolService.js VIEJO que un navegador tiene en caché.
  if (sinMetodoNuevo) delete ctxObj.EquiposPoolService.contarPorClasificar;
  vm.runInContext(leer("pages/almacen-hoy.js"), ctx);
  return { H: ctxObj.window.AlmacenHoy, consultas, els };
}

test("H7 · con un servicio viejo en caché, la bandeja se pinta igual y solo cae la nota", async () => {
  // contarPorClasificar es nuevo. Un navegador con equiposPoolService.js viejo
  // en caché no lo tiene, y llamar a una función inexistente lanza EN EL ACTO,
  // antes de que .catch se enganche: sin protección, reventaba el Promise.all
  // de cargar() y se caía la bandeja entera. La regla del archivo es la
  // contraria — "cada carga cae por su lado" — y esta prueba la sostiene.
  const { H, els } = montarHoy({ sinMetodoNuevo: true });
  await H.recargar();
  const aviso = (els.get("avisoFallidas") || {}).innerHTML || "";
  assert.match(aviso, /No se pudo leer: <b>[^<]*por clasificar/, "tiene que avisar qué faltó");
  const grupos = (els.get("hoyGrupos") || {}).innerHTML || "";
  // "Del pool" pasó a "Del inventario de equipos" (auditoría UX 2026-09-28, T2).
  assert.ok(/De contratos|Del inventario de equipos/.test(grupos), "el resto de la bandeja SÍ se pinta");
});

test("H6 · abrir Almacén · Hoy no lee fichas de por clasificar ni de bodega, y la nota cuadra", async () => {
  const { H, consultas, els } = montarHoy();
  await H.recargar();
  assert.equal(leyoFichas(consultas, "por_clasificar"), false, "la nota son dos números: no se leen ~1,240 fichas");
  assert.equal(leyoFichas(consultas, "en_bodega"), false, "las diferencias salen del resumen: no se leen ~2,870 fichas");
  // Lo que SÍ se pinta como lista sigue viniendo de las fichas: los devueltos.
  assert.equal(leyoFichas(consultas, "devuelto_revision"), true, "los devueltos se pintan uno por uno: esos sí se leen");
  const html = [...els.values()].map(e => e.innerHTML).join("\n");
  assert.match(html, /4 unidades en\s+"por clasificar"/, "la nota dice cuántas hay");
  assert.match(html, /3 sin modelo/, "y cuántas sin modelo");
});
