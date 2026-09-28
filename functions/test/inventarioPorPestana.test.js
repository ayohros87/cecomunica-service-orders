// Inventario · Equipos carga por pestaña (auditoría de consumo 2026-09-24).
//
// La página barría el pool ENTERO (~7,650 fichas) en cada carga fría: el 38%
// de las lecturas de un día normal. Ahora, si lo que se mira es UNA ubicación
// sin búsqueda ni filtros, carga solo esa ubicación y los conteos globales
// salen del resumen. Todo lo que necesita el pool entero lo sigue teniendo.
//
// El riesgo de este cambio NO es que reviente: es que responda mal en
// silencio. La auditoría 2026-08-04 (N1) ya encontró esta página diciendo "sin
// resultados" para un serial que estaba en OTRA pestaña — "la pregunta más
// frecuente de la página fallaba en silencio". Estos guardias impiden volver:
//
//   P1 — abrir en una ubicación sin filtros lee SOLO esa ubicación.
//   P2 — las tarjetas de Pendientes dicen el total GLOBAL, no el de lo cargado.
//   P3 — los contadores de pestaña dicen el total global.
//   P4 — buscar estando en una pestaña carga el pool entero ANTES de responder,
//        y nunca pinta "ningún equipo coincide" con media lista en memoria.
//   P5 — la búsqueda encuentra una ficha que está en OTRA ubicación (N1).
//   P6 — Todos y Otros cargan el pool entero.
//   P7 — cualquier filtro secundario carga el pool entero.
//   P8 — mover una ficha fuera de la pestaña la saca de la lista y corrige los
//        conteos con el delta.
//   P9 — la conciliación no vive aquí: es la columna Dif. de Existencias,
//        que sale del resumen (nunca de lo cargado en una pestaña).
//   P10 — una ubicación vacía no dice "no hay equipos en el pool".
//   P11 — sin resumen cae al pool entero y avisa.
//   P12 — una carga que falla se muestra y NO se reintenta en bucle.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (rel) => fs.readFileSync(path.join(RAIZ, "public", "js", rel), "utf8");

// Un pool chico pero con TODAS las ubicaciones que importan: la prueba de que
// una búsqueda cruza pestañas necesita fichas en varias.
const POOL = [
  { id: "B1", serial: "B1", serial_norm: "B1", modelo_id: "m1", modelo_label: "PD606", estado: "en_bodega", verificado: true },
  { id: "B2", serial: "B2", serial_norm: "B2", modelo_id: "m1", modelo_label: "PD606", estado: "en_bodega", verificado: false },
  { id: "B3", serial: "B3", serial_norm: "B3", modelo_id: "m2", modelo_label: "NX420", estado: "en_bodega", verificado: true },
  { id: "C1", serial: "C1", serial_norm: "C1", modelo_id: "m1", modelo_label: "PD606", estado: "en_cliente", verificado: true },
  { id: "C2", serial: "SERIALLEJOS", serial_norm: "SERIALLEJOS", modelo_id: "m2", modelo_label: "NX420", estado: "en_cliente", verificado: false },
  { id: "T1", serial: "T1", serial_norm: "T1", modelo_id: "m2", modelo_label: "NX420", estado: "en_taller", verificado: true },
  { id: "P1", serial: "P1", serial_norm: "P1", modelo_id: "m1", modelo_label: "PD606", estado: "por_clasificar", verificado: false },
  { id: "P2", serial: "P2", serial_norm: "P2", modelo_id: "m1", modelo_label: "PD606", estado: "por_clasificar", verificado: false },
  { id: "D1", serial: "D1", serial_norm: "D1", modelo_id: "m2", modelo_label: "NX420", estado: "devuelto_revision", verificado: true },
  { id: "V1", serial: "V1", serial_norm: "V1", modelo_id: "m1", modelo_label: "PD606", estado: "vendido", verificado: true },
  // Un conflicto: el mismo serial en dos fichas (failsafe Kenwood).
  { id: "K1", serial: "K1", serial_norm: "K1", modelo_id: "m1", modelo_label: "PD606", estado: "en_bodega", verificado: true, serial_compartido: true },
  { id: "K1__m2", serial: "K1", serial_norm: "K1", modelo_id: "m2", modelo_label: "NX420", estado: "en_cliente", verificado: true, serial_compartido: true },
];

// La verdad, contada sobre el pool entero — contra esto se comparan los modos.
const verdad = (pool) => {
  const por = {};
  pool.forEach(p => { por[p.estado] = (por[p.estado] || 0) + 1; });
  return { por, total: pool.length, sinVerificar: pool.filter(p => p.verificado === false).length };
};

function resumenDe(pool) {
  const m = new Map();
  for (const eq of pool) {
    const key = eq.modelo_id || "sinmodelo";
    const g = m.get(key) || { key, modelo_id: eq.modelo_id, modelo_label: eq.modelo_label, est: {} };
    g.est[eq.estado] = (g.est[eq.estado] || 0) + 1;
    m.set(key, g);
  }
  return [...m.values()];
}

// Monta la página con un Firestore falso que REGISTRA cada consulta: así se
// prueba no solo qué pinta, sino qué lee.
// Freno contra bucles: si la página entra en un ciclo render → carga → render,
// sin freno CUELGA la suite en vez de fallarla (una promesa que nunca resuelve
// no retiene el proceso; una cadena de reintentos sí). Pasado el tope el
// Firestore falso deja de contestar: el bucle se detiene y la aserción falla.
const TOPE_CONSULTAS = 400;
const congelado = () => new Promise(() => {});

function montar({ tab = "en_bodega", pool = POOL.map(p => ({ ...p })), resumen = undefined, fallarPool = false, conteosFisicos = [], modelos = [] } = {}) {
  const consultas = [];
  const els = new Map();
  const nuevoEl = (id) => ({
    id, innerHTML: "", textContent: "", value: "", checked: false, style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, options: [],
  });
  const doc = {
    getElementById(id) { if (!els.has(id)) els.set(id, nuevoEl(id)); return els.get(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  const estado = { pool, resumen };
  function coleccion(nombre) {
    const filtros = [];
    let limite = null;
    const api = {
      where(c, op, v) { filtros.push([c, op, v]); return api; },
      limit(n) { limite = n; return api; },
      select() { return api; },
      doc(id) {
        return {
          get: async () => {
            if (consultas.length > TOPE_CONSULTAS) return congelado();
            consultas.push({ col: nombre, doc: id });
            const p = estado.pool.find(x => x.id === id);
            return { exists: !!p, id, data: () => (p ? { ...p } : undefined) };
          },
        };
      },
      count() {
        return {
          get: async () => {
            if (consultas.length > TOPE_CONSULTAS) return congelado();
            consultas.push({ col: nombre, filtros: filtros.map(f => [...f]), count: true });
            const n = estado.pool.filter(p => filtros.every(([c, , v]) => p[c] === v)).length;
            return { data: () => ({ count: n }) };
          },
        };
      },
      async get() {
        if (consultas.length > TOPE_CONSULTAS) return congelado();
        consultas.push({ col: nombre, filtros: filtros.map(f => [...f]) });
        if (nombre === "agregados_pool") {
          const r = estado.resumen === undefined ? resumenDe(estado.pool) : estado.resumen;
          return { docs: r.map(x => ({ id: x.key, data: () => ({ modelo_id: x.modelo_id, modelo_label: x.modelo_label, est: x.est }) })), size: r.length };
        }
        if (nombre === "equipos_pool") {
          if (fallarPool) throw new Error("red caída");
          let docs = estado.pool.filter(p => filtros.every(([c, , v]) => p[c] === v));
          if (limite) docs = docs.slice(0, limite);
          return { docs: docs.map(p => ({ id: p.id, data: () => ({ ...p }) })), size: docs.length, empty: !docs.length };
        }
        return { docs: [], size: 0, empty: true };
      },
    };
    return api;
  }

  const avisos = [];
  const ctxObj = {
    window: {}, document: doc, localStorage: { getItem: () => null, setItem() {} },
    location: { search: "" },
    console: { warn() {}, error() {}, log() {} },
    firebase: {
      firestore: Object.assign(() => ({ collection: coleccion }), { FieldPath: { documentId: () => "__name__" } }),
      auth: () => ({ currentUser: { uid: "u1" } }),
      functions: () => ({ httpsCallable: () => async () => ({ data: {} }) }),
    },
    Toast: { show(msg, tipo) { avisos.push({ msg, tipo }); } },
    FMT: { esc: (v) => String(v == null ? "" : v) },
    ROLES: { ADMIN: "administrador", INVENTARIO: "inventario" },
    Modal: { open() {}, close() {}, confirm: async () => true },
    lucide: { createIcons() {} },
    ModelosService: { getModelos: async () => [] },
    InventarioService: { getInventarioActual: async () => conteosFisicos },
    setTimeout, Promise, Map, Set, Date, JSON, Math, Array, Object, Number, String, Boolean, RegExp, Error,
  };
  ctxObj.window.Toast = ctxObj.Toast;
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(leer("services/equiposPoolService.js"), ctx);
  ctxObj.EquiposPoolService = ctxObj.window.EquiposPoolService;
  vm.runInContext(leer("domain/stockAgg.js"), ctx);
  ctxObj.StockAgg = ctxObj.window.StockAgg;
  vm.runInContext(leer("services/conflictosPoolService.js"), ctx);
  ctxObj.ConflictosPoolService = ctxObj.window.ConflictosPoolService;
  vm.runInContext(leer("pages/inventario-equipos.js"), ctx);
  const P = ctxObj.window.EquiposPool;
  P._tab = tab;
  P._rol = "administrador";
  // La página arma estos al arrancar; el test no pasa por el bootstrap.
  P._familias = new Map();
  P._modelos = modelos;
  P._sel = P._sel || new Set();
  return { P, consultas, els, avisos, estado, ctxObj };
}

// Espera a que se asienten las cargas que render() dispara por su cuenta.
const asentar = async (P) => {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 0));
    if (!P._pidiendo) { await new Promise(r => setTimeout(r, 0)); if (!P._pidiendo) return; }
  }
};
const barridosCompletos = (consultas) =>
  consultas.filter(c => c.col === "equipos_pool" && !c.doc && !c.count && c.filtros.length === 0).length;
const txt = (els, id) => (els.get(id) || {}).textContent;

test("P1 · abrir en una ubicación sin filtros lee SOLO esa ubicación", async () => {
  const { P, consultas } = montar({ tab: "en_bodega" });
  await P.cargar();
  await asentar(P);
  assert.equal(barridosCompletos(consultas), 0, "no puede barrer el pool entero — es justo lo que se vino a quitar");
  const q = consultas.find(c => c.col === "equipos_pool" && c.filtros.length === 1);
  assert.deepEqual(q.filtros, [["estado", "==", "en_bodega"]]);
  assert.equal(P._completo, false);
  assert.ok(P._equipos.every(e => e.estado === "en_bodega"), "en memoria solo hay bodega");
});

test("P2 · las tarjetas de Pendientes dicen el total GLOBAL, no el de lo cargado", async () => {
  const { P, els } = montar({ tab: "en_bodega" });
  await P.cargar();
  await asentar(P);
  const V = verdad(POOL);
  // En memoria solo hay bodega (0 por clasificar); la tarjeta tiene que decir 2.
  assert.equal(txt(els, "colaPorClasificar"), String(V.por.por_clasificar));
  assert.equal(txt(els, "colaPorInspeccionar"), String(V.por.devuelto_revision));
  assert.equal(txt(els, "colaSinVerificar"), String(V.sinVerificar), "sin verificar es del pool ENTERO");
  // Conflictos ya no es tarjeta de esta lista: la cola vive en Almacén · Hoy
  // (auditoría UX 2026-09-28, P2 #14) y esta pantalla no la recuenta.
  assert.equal(els.get("colaConflictos"), undefined);
});

test("P3 · los contadores de pestaña dicen el total global", async () => {
  const { P, els } = montar({ tab: "en_bodega" });
  await P.cargar();
  await asentar(P);
  const V = verdad(POOL);
  assert.equal(txt(els, "countBodega"), `(${V.por.en_bodega})`);
  assert.equal(txt(els, "countCliente"), `(${V.por.en_cliente})`, "cliente no está cargado y aun así se cuenta");
  assert.equal(txt(els, "countTaller"), `(${V.por.en_taller})`);
  assert.equal(txt(els, "countOtros"), `(${V.por.vendido})`);
  assert.equal(txt(els, "countTodos"), `(${V.total})`);
});

test("P4 · buscar en una pestaña carga el pool entero ANTES de responder", async () => {
  const { P, consultas, els } = montar({ tab: "en_bodega" });
  await P.cargar();
  await asentar(P);
  consultas.length = 0;
  els.get("eqBusqueda").value = "SERIALLEJOS";
  P.render();
  // Lo pintado MIENTRAS carga no puede ser una respuesta: tiene que decir que busca.
  const mientras = els.get("eqTabla").innerHTML;
  assert.ok(!/Ningún equipo/.test(mientras), "no puede decir 'ningún equipo coincide' con media lista");
  // Sin la palabra "pool" en pantalla (auditoría UX 2026-09-28, T2).
  assert.match(mientras, /Buscando "SERIALLEJOS" en todo el inventario/);
  await asentar(P);
  assert.equal(barridosCompletos(consultas), 1, "buscar tiene que traer el pool entero, una vez");
  assert.equal(P._completo, true);
});

test("P5 · la búsqueda encuentra una ficha que está en OTRA ubicación (N1)", async () => {
  const { P, els } = montar({ tab: "en_bodega" });
  await P.cargar();
  await asentar(P);
  els.get("eqBusqueda").value = "SERIALLEJOS";   // está en en_cliente, no en bodega
  P.render();
  await asentar(P);
  const html = els.get("eqTabla").innerHTML;
  assert.ok(html.includes("SERIALLEJOS"), "el serial de otra ubicación TIENE que aparecer");
  assert.ok(!/Ningún equipo/.test(html));
});

test("P6 · Todos y Otros cargan el pool entero", async () => {
  for (const tab of ["todos", "otros"]) {
    const { P, consultas } = montar({ tab });
    await P.cargar();
    await asentar(P);
    assert.equal(barridosCompletos(consultas), 1, `la pestaña ${tab} necesita el pool entero`);
    assert.equal(P._completo, true, tab);
  }
});

test("P7 · cualquier filtro secundario carga el pool entero", async () => {
  for (const [id, prop] of [["chkSinCliente", "checked"], ["chkCompartidos", "checked"], ["eqFiltroPropiedad", "value"]]) {
    const { P, consultas, els } = montar({ tab: "en_bodega" });
    await P.cargar();
    await asentar(P);
    consultas.length = 0;
    els.get(id)[prop] = prop === "checked" ? true : "cliente";
    P.render();
    await asentar(P);
    assert.equal(barridosCompletos(consultas), 1, `el filtro ${id} cruza ubicaciones en los contadores`);
  }
});

test("P8 · mover una ficha fuera de la pestaña la saca y corrige los conteos", async () => {
  const { P, els, estado } = montar({ tab: "por_clasificar" });
  await P.cargar();
  await asentar(P);
  assert.equal(P._equipos.length, 2);
  // "Corregir a bodega" de P1: pasa de por_clasificar a en_bodega y se verifica.
  const p1 = estado.pool.find(p => p.id === "P1");
  p1.estado = "en_bodega"; p1.verificado = true;
  await P.refrescar("P1");
  assert.equal(P._equipos.length, 1, "P1 ya no es de esta pestaña");
  assert.ok(!P._equipos.some(e => e.id === "P1"));
  assert.equal(txt(els, "colaPorClasificar"), "1", "la tarjeta baja por el delta, sin releer el resumen");
  assert.equal(txt(els, "countBodega"), `(${verdad(POOL).por.en_bodega + 1})`, "bodega sube uno");
  assert.equal(txt(els, "colaSinVerificar"), String(verdad(POOL).sinVerificar - 1), "y ya no cuenta como sin verificar");
});

test("P9 · la conciliación vive UNA vez: la columna Dif. de Existencias, desde el resumen", () => {
  // Antes esta pantalla tenía su propio modal de conciliación y, en modo por
  // pestaña, una versión agrupaba lo cargado (la pestaña en_cliente, sin una
  // sola ficha de bodega) y reportaba −3 y −1: diferencias falsas con cara de
  // reporte correcto. La absorción en Almacén (auditoría UX 2026-09-28, P2
  // #14) la retiró: el único join conteo↔bodega es el de Existencias, y su
  // bodega por modelo sale del resumen (`agregados_pool`), nunca de docs.
  const pagina = leer("pages/inventario-equipos.js");
  assert.doesNotMatch(pagina, /abrirConciliacion|_bodegaDesdeResumen|concilTabla/,
    "la lista por serial no debe volver a tener conciliación propia");
  const ex = leer("pages/almacen-existencias.js");
  assert.match(ex, /StockAgg\.build\(\{ modelos, conteos, poolMap: bodegaMap \}\)/,
    "Existencias concilia con StockAgg");
  const armado = ex.slice(ex.indexOf("const bodegaMap = new Map()"), ex.indexOf("StockAgg.build("));
  assert.match(armado, /g\.est\['en_bodega'\]/, "la bodega por modelo sale del resumen (est.en_bodega), no de docs");
  assert.doesNotMatch(armado, /\.docs/, "no se agrupa lo cargado");
});

test("P10 · una ubicación vacía no dice 'no hay equipos en el pool'", async () => {
  const { P, els } = montar({ tab: "no_retirado" });   // ninguna ficha ahí
  await P.cargar();
  await asentar(P);
  const html = els.get("eqTabla").innerHTML;
  assert.ok(!/No hay equipos en el pool/.test(html), "hay 12 fichas en el pool: solo esta pestaña está vacía");
  assert.match(html, /No hay radios sin retirar/);
});

test("P11 · sin resumen cae al pool entero y avisa", async () => {
  const { P, consultas, avisos } = montar({ tab: "en_bodega", resumen: [] });
  await P.cargar();
  await asentar(P);
  assert.equal(P._completo, true, "sin resumen no hay de dónde sacar los conteos globales");
  assert.equal(barridosCompletos(consultas), 1);
  assert.ok(avisos.some(a => a.tipo === "warn"), "tiene que avisar — volver a barrer en silencio sería el error");
});

// Sin la guardia de error, render → carga → falla → render… es un bucle
// asíncrono sin fin. TOPE_CONSULTAS lo frena para que la prueba FALLE (el
// número de consultas se dispara) en vez de colgar la suite entera.
test("P12 · una carga que falla se muestra y NO se reintenta en bucle", async () => {
  const { P, consultas, els } = montar({ tab: "en_bodega", fallarPool: true });
  await P.cargar();
  await asentar(P);
  const antes = consultas.length;
  P.render(); P.render(); P.render();
  await asentar(P);
  assert.equal(consultas.length, antes, "renderizar tras un error no puede volver a pedir datos solo");
  assert.match(els.get("eqTabla").innerHTML, /No se pudo cargar el pool/);
  assert.match(els.get("eqTabla").innerHTML, /Reintentar/);
});
