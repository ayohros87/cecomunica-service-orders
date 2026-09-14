// Almacén · Existencias lee el RESUMEN, no el pool entero (F2 de la auditoría
// de consumo 2026-09-10).
//
// La pantalla barría las ~7,600 fichas de `equipos_pool` en CADA apertura solo
// para pintar conteos por modelo y estado — el mayor consumidor del proyecto,
// ~70% del total. Ahora la tabla se arma con `agregados_pool` (un doc por
// modelo, ~111 lecturas) y las unidades de un modelo se traen SOLO al expandir
// su fila.
//
// El riesgo de este cambio no es que falle: es que pinte números distintos sin
// que nadie lo note. Por eso E2 compara contra la verdad derivada del pool.
//
//   E1 — cargar la pantalla NO toca `equipos_pool`.
//   E2 — los números pintados son los MISMOS que daría barrer el pool.
//   E3 — expandir trae solo las unidades de ese modelo, y una sola vez.
//   E4 — el grupo sin modelo (1,344 fichas reales con modelo_id null) se
//        consulta bien; si no, sus seriales serían inalcanzables.
//   E5 — una fila que solo existe por el conteo físico no dispara consulta.
//   E6 — sin resumen, la pantalla NO se queda muda: cae al pool y avisa.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (rel) => fs.readFileSync(path.join(RAIZ, "public", "js", rel), "utf8");

// El pool de mentira: dos modelos de catálogo y el grupo sin modelo.
const POOL = [
  { id: "A1", serial: "A1", modelo_id: "mPD606", modelo_label: "PD606", estado: "en_bodega", verificado: false },
  { id: "A2", serial: "A2", modelo_id: "mPD606", modelo_label: "PD606", estado: "en_bodega", verificado: true },
  { id: "A3", serial: "A3", modelo_id: "mPD606", modelo_label: "PD606", estado: "en_cliente", verificado: true },
  { id: "A4", serial: "A4", modelo_id: "mPD606", modelo_label: "PD606", estado: "devuelto_revision", verificado: true },
  { id: "B1", serial: "B1", modelo_id: "mNX420", modelo_label: "NX420", estado: "en_bodega", verificado: true },
  { id: "B2", serial: "B2", modelo_id: "mNX420", modelo_label: "NX420", estado: "en_taller", verificado: true },
  { id: "S1", serial: "S1", modelo_id: null, modelo_label: "", estado: "por_clasificar", verificado: false },
  { id: "S2", serial: "S2", modelo_id: null, modelo_label: "", estado: "por_clasificar", verificado: false },
];

const MODELOS = [
  { id: "mPD606", modelo: "PD606", marca: "HYTERA", activo: true },
  { id: "mNX420", modelo: "NX420", marca: "KENWOOD", activo: true },
  // Modelo con conteo físico pero sin NINGUNA unidad en el pool.
  { id: "mFANTASMA", modelo: "FANTASMA", marca: "ACME", activo: true },
];

const CONTEOS = [
  { id: "mPD606", cantidad: 2 },
  { id: "mNX420", cantidad: 1 },
  { id: "mFANTASMA", cantidad: 4 },
];

// Deriva el resumen igual que lo hace el trigger en el servidor.
function resumenDeVerdad(pool, modeloKey) {
  const m = new Map();
  for (const eq of pool) {
    const key = modeloKey(eq.modelo_id, eq.modelo_label);
    const g = m.get(key) || { key, modelo_id: eq.modelo_id || null, modelo_label: eq.modelo_label || "", est: {} };
    g.est[eq.estado] = (g.est[eq.estado] || 0) + 1;
    m.set(key, g);
  }
  return [...m.values()];
}

// Monta la página con firebase y DOM de mentira. Devuelve el módulo, el
// registro de consultas y los elementos del DOM para poder leer lo pintado.
function montar({ resumen = null, pool = POOL } = {}) {
  const consultas = [];
  const els = new Map();
  const nuevoEl = () => ({ innerHTML: "", textContent: "", style: {}, classList: { toggle() {}, add() {}, remove() {} } });
  const doc = {
    getElementById(id) { if (!els.has(id)) els.set(id, nuevoEl()); return els.get(id); },
  };

  function coleccion(nombre) {
    const filtros = [];
    const api = {
      where(campo, op, val) { filtros.push([campo, op, val]); return api; },
      limit() { return api; },
      doc(id) { return { get: async () => ({ exists: false, id, data: () => ({}) }) }; },
      async get() {
        consultas.push({ col: nombre, filtros: filtros.map(f => [...f]) });
        if (nombre === "agregados_pool") {
          const r = resumen === null ? resumenDeVerdad(pool, ctxObj.EquiposPoolService.modeloKey.bind(ctxObj.EquiposPoolService)) : resumen;
          return { docs: r.map(x => ({ id: x.key, data: () => ({ modelo_id: x.modelo_id, modelo_label: x.modelo_label, est: x.est }) })), size: r.length };
        }
        if (nombre === "equipos_pool") {
          const docs = pool.filter(p => filtros.every(([c, , v]) => (c === "modelo_id" ? (p.modelo_id || null) === (v || null) : p[c] === v)));
          return { docs: docs.map(p => ({ id: p.id, data: () => p })), size: docs.length };
        }
        return { docs: [], size: 0 };
      },
    };
    return api;
  }

  const ctxObj = {
    window: {}, document: doc, console: { warn() {}, error() {} },
    firebase: { firestore: () => ({ collection: coleccion }), auth: () => ({ currentUser: { uid: "u1" } }) },
    Toast: { _avisos: [], show(msg, tipo) { this._avisos.push({ msg, tipo }); } },
    ModelosService: { getModelos: async () => MODELOS },
    InventarioService: { getInventarioActual: async () => CONTEOS },
    setTimeout, Promise, Map, Set, Date, JSON, Math, Array, Object, Number, String, Boolean, RegExp, Error,
  };
  ctxObj.window.Toast = ctxObj.Toast;
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(leer("services/equiposPoolService.js"), ctx);
  ctxObj.EquiposPoolService = ctxObj.window.EquiposPoolService;
  vm.runInContext(leer("domain/stockAgg.js"), ctx);
  ctxObj.StockAgg = ctxObj.window.StockAgg;
  vm.runInContext(leer("pages/almacen-existencias.js"), ctx);
  return { P: ctxObj.window.AlmacenExistencias, consultas, els, ctxObj };
}

test("E1 · cargar la pantalla lee el resumen y NO el pool entero", async () => {
  const { P, consultas } = montar();
  await P.activar();
  const cols = consultas.map(c => c.col);
  assert.ok(cols.includes("agregados_pool"), "tiene que leer el resumen");
  assert.equal(cols.filter(c => c === "equipos_pool").length, 0,
    "abrir Existencias NO puede barrer el pool — es justo lo que se vino a quitar");
});

test("E2 · los números pintados son los mismos que daría barrer el pool", async () => {
  const { P, els } = montar();
  await P.activar();
  // La verdad, contada a mano sobre el pool de prueba.
  const bodega = POOL.filter(p => p.estado === "en_bodega").length;              // 3
  const cliente = POOL.filter(p => ["en_cliente", "asignado_contrato"].includes(p.estado)).length; // 1
  const taller = POOL.filter(p => p.estado === "en_taller").length;              // 1
  const cuarentena = POOL.filter(p => p.estado === "devuelto_revision").length;  // 1
  assert.equal(els.get("exKpiBodega").textContent, String(bodega));
  assert.equal(els.get("exKpiCliente").textContent, String(cliente));
  assert.equal(els.get("exKpiTaller").textContent, String(taller));
  assert.equal(els.get("exKpiCuarentena").textContent, String(cuarentena));
  // El join contra el conteo físico: PD606 tiene 2 en bodega y el conteo dice
  // 2 → sin diferencia; NX420 tiene 1 y el conteo 1 → sin diferencia;
  // FANTASMA no tiene unidades y el conteo dice 4 → diferencia. Una sola.
  assert.equal(els.get("exKpiDif").textContent, "1");
  const html = els.get("exTabla").innerHTML;
  assert.ok(html.includes("PD606") && html.includes("NX420"), "los modelos se pintan");
  assert.ok(html.includes("(sin modelo)"), "el grupo sin modelo sigue apareciendo");
});

test("E3 · expandir trae solo las unidades de ese modelo, y una sola vez", async () => {
  const { P, consultas, els } = montar();
  await P.activar();
  consultas.length = 0;

  await P.toggleFila("mPD606");
  await new Promise(r => setTimeout(r, 0));
  const alPool = consultas.filter(c => c.col === "equipos_pool");
  assert.equal(alPool.length, 1, "una consulta, no una por render");
  assert.deepEqual(alPool[0].filtros, [["modelo_id", "==", "mPD606"]],
    "tiene que pedir SOLO ese modelo");
  const html = els.get("exTabla").innerHTML;
  assert.ok(html.includes("A1") && html.includes("A4"), "salen los seriales del modelo abierto");
  assert.ok(!html.includes(">B1<"), "y NO los de otro modelo");

  // Reabrir no vuelve a leer: las unidades ya están en memoria.
  consultas.length = 0;
  await P.toggleFila("mPD606");            // cierra
  await P.toggleFila("mPD606");            // reabre
  await new Promise(r => setTimeout(r, 0));
  assert.equal(consultas.filter(c => c.col === "equipos_pool").length, 0,
    "reabrir la misma fila no puede costar otra consulta");
});

test("E4 · el grupo sin modelo se consulta con modelo_id null y trae sus fichas", async () => {
  const { P, consultas, els } = montar();
  await P.activar();
  consultas.length = 0;
  await P.toggleFila("sinmodelo");
  await new Promise(r => setTimeout(r, 0));
  const q = consultas.find(c => c.col === "equipos_pool");
  assert.ok(q, "el grupo sin modelo TIENE que poder cargar sus unidades");
  assert.deepEqual(q.filtros, [["modelo_id", "==", null]]);
  const html = els.get("exTabla").innerHTML;
  assert.ok(html.includes("S1") && html.includes("S2"), "sus seriales se pintan");
});

test("E5 · una fila que solo existe por el conteo físico no dispara consulta", async () => {
  const { P, consultas, els } = montar();
  await P.activar();
  consultas.length = 0;
  // FANTASMA no tiene grupo en el pool: su fila nace con docs = [] y no hay
  // nada que traer.
  await P.toggleFila("join_mFANTASMA");
  await new Promise(r => setTimeout(r, 0));
  assert.equal(consultas.filter(c => c.col === "equipos_pool").length, 0);
  assert.ok(els.get("exTabla").innerHTML.includes("Sin unidades en el pool"));
});

test("E6 · sin resumen la pantalla no se queda muda: cae al pool y avisa", async () => {
  const { P, consultas, els, ctxObj } = montar({ resumen: [] });
  await P.activar();
  assert.equal(consultas.filter(c => c.col === "equipos_pool").length, 1,
    "con el resumen vacío SÍ se lee el pool — la pantalla no puede quedarse en blanco");
  assert.ok(ctxObj.Toast._avisos.some(a => a.tipo === "warn"),
    "y tiene que avisar: volver a barrer el pool en silencio sería peor que el error");
  // Y aun así pinta bien: la red de seguridad no puede cambiar los números.
  assert.equal(els.get("exKpiBodega").textContent, "3");
});
