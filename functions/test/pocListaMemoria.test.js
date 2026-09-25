// Lista de POC: ordenar no tira la memoria de la búsqueda (2026-09-25).
//
// La búsqueda de POC trae las ~4,600 fichas vivas con PocService.getAll() y
// las guarda en memoria (_allDocs) para que las teclas siguientes filtren sin
// volver a Firestore. Medido 2026-09-22→25: es el mayor consumidor que queda,
// ~36,000 lecturas/día, casi todo de recepción.
//
// ordenarPor() pasaba por refresh(), que es la ruta de las MUTACIONES y por
// eso tira la memoria. Pero filtrar() ordena EN MEMORIA (_ordenarDocs): el
// orden no cambia qué fichas hay. Cada clic en una columna estando buscando
// volvía a bajar las ~4,600 fichas.
//
//   M1 — ordenar mientras buscas NO vuelve a bajar las fichas, y el orden sí
//        cambia (se aplica en memoria).
//   M2 — refresh() —datos que cambiaron— SÍ las vuelve a bajar: una ficha
//        reabierta o cerrada tiene que verse.
//   M3 — ordenar SIN buscar pide la página ordenada al servidor, como siempre:
//        esa sí depende del orden.
//   M4 — marcar una casilla mientras buscas no vuelve a bajar las fichas.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (rel) => fs.readFileSync(path.join(RAIZ, "public", "js", rel), "utf8");

const FICHAS = [
  { id: "f1", serial: "AB-300", unit_id_num: 300, cliente: "C", activo: true },
  { id: "f2", serial: "AB-100", unit_id_num: 100, cliente: "A", activo: true },
  { id: "f3", serial: "AB-200", unit_id_num: 200, cliente: "B", activo: true },
  { id: "f4", serial: "ZZ-999", unit_id_num: 999, cliente: "D", activo: true },   // no casa con "ab"
];

function montar() {
  const llamadas = { getAll: 0, getCerradas: 0, listPage: [] };
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, {
        id, value: "", checked: false, style: {}, innerHTML: "", children: [],
        get firstChild() { return this.children[0] || null; },
        removeChild(c) { this.children.splice(this.children.indexOf(c), 1); },
        appendChild(c) { this.children.push(c); return c; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      });
    }
    return els.get(id);
  };
  const ctxObj = {
    window: {},
    document: {
      getElementById: el, createElement: () => ({ appendChild() {}, style: {}, dataset: {}, addEventListener() {} }),
      querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    },
    console: { warn() {}, error() {}, log() {} },
    Toast: { show() {} }, Modal: { confirm: async () => true }, lucide: { createIcons() {} },
    FMT: { esc: (v) => String(v ?? "") },
    PocState: { nombreClienteDe: (d) => d.cliente || "", actualizarResumen() {}, esLectura: () => false },
    PocService: {
      getAll: async () => { llamadas.getAll++; return FICHAS.map(f => ({ ...f })); },
      getCerradas: async () => { llamadas.getCerradas++; return []; },
      listPage: async (o) => { llamadas.listPage.push({ sortField: o.sortField, sortAsc: o.sortAsc }); return { docs: [], lastDoc: null }; },
    },
    setTimeout, clearTimeout, Promise, Map, Set, Date, JSON, Math, Array, Object, Number, String, Boolean, RegExp, Error,
  };
  // En el navegador window ES el global: poc-list.js define window.PocList y
  // luego lo usa como `PocList` a secas. Aquí igual.
  ctxObj.window = ctxObj;
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(leer("pages/poc-list.js"), ctx);
  const P = ctxObj.PocList;
  // Lo que se prueba es QUÉ se carga y en QUÉ orden, no el HTML de cada fila.
  P._buildRow = (docId) => ({ docId });
  P._ofrecerCerradas = () => {};
  P.actualizarFlechitas = () => {};
  el("filtroCampo").value = "serial";
  return { P, llamadas, el };
}
const esperar = () => new Promise(r => setTimeout(r, 0));
const pintado = (el) => el("devicesTable").children.map(c => c.docId);

test("M1 · ordenar mientras buscas no vuelve a bajar las fichas, y el orden cambia", async () => {
  const { P, llamadas, el } = montar();
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  assert.equal(llamadas.getAll, 1, "la primera búsqueda baja las fichas una vez");

  P.ordenarPor("unit_id"); await esperar();          // unit_id ascendente
  assert.equal(llamadas.getAll, 1, "ordenar NO puede volver a bajar las ~4,600 fichas");
  assert.deepEqual(pintado(el), ["f2", "f3", "f1"], "100, 200, 300: el orden se aplicó en memoria");

  P.ordenarPor("unit_id"); await esperar();          // mismo campo → descendente
  assert.equal(llamadas.getAll, 1);
  assert.deepEqual(pintado(el), ["f1", "f3", "f2"], "300, 200, 100");
});

test("M2 · refresh() —los datos cambiaron— sí vuelve a bajar las fichas", async () => {
  const { P, llamadas, el } = montar();
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  P.refresh(); await esperar();
  assert.equal(llamadas.getAll, 2, "una ficha reabierta o cerrada tiene que verse: la memoria se tira");
});

test("M3 · ordenar sin buscar pide la página ordenada al servidor, como siempre", async () => {
  const { P, llamadas, el } = montar();
  el("filtroValor").value = "";
  P.ordenarPor("unit_id"); await esperar();
  assert.equal(llamadas.getAll, 0, "sin búsqueda no hay barrido completo");
  const ultima = llamadas.listPage[llamadas.listPage.length - 1];
  assert.ok(ultima, "sin buscar, ordenar pide la página al servidor");
  assert.equal(ultima.sortField, "unit_id");
  assert.equal(ultima.sortAsc, true);
});

test("M4 · marcar una casilla mientras buscas no vuelve a bajar las fichas", async () => {
  const { P, llamadas, el } = montar();
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  el("soloActivos").checked = true;
  P.manejarCambioActivos(); await esperar();
  el("soloIncompletos").checked = true;
  P.manejarCambioIncompletos(); await esperar();
  assert.equal(llamadas.getAll, 1, "las casillas filtran en memoria");
});
