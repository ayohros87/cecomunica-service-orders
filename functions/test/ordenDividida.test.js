// Órdenes divididas: el contrato y la gestión se dan por entregados con la
// ÚLTIMA hermana (Brenda, 2026-10-13 — dividir PROGRAMACIONES por modelo).
//
// Lo que estas pruebas protegen: que la primera mitad entregada NO dispare
// "contrato entregado" a facturación ni la devolución de los salientes de un
// reemplazo mientras la otra mitad sigue en el taller; y que una hermana
// anulada o cerrada sin retirar no deje a la familia esperando para siempre.
//
// También cubre el reparto por modelo del front (ordenes-dividir.js), cargado
// en un vm sin navegador.
//
// Corre con `npm test` (node --test). No necesita red ni Firestore.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const D = require("../src/domain/ordenDividida");

const o = (estado, extra = {}) => ({ estado_reparacion: estado, ...extra });

test("D1 · una orden sin dividir no tiene familia (cero lecturas)", () => {
  assert.equal(D.estaDividida({ tipo_de_servicio: "PROGRAMACIÓN" }), false);
  assert.equal(D.estaDividida(null), false);
  assert.equal(D.estaDividida({ dividida_de: "2026101201" }), true);
  assert.equal(D.estaDividida({ dividida_en: ["2026101302"] }), true);
  assert.equal(D.estaDividida({ dividida_en: [] }), false);
});

test("D2 · la primera hermana entregada espera a las que siguen vivas", () => {
  const familia = [
    { id: "M", data: o("ENTREGADO AL CLIENTE", { dividida_en: ["H1", "H2"] }) },
    { id: "H1", data: o("ASIGNADO", { dividida_de: "M" }) },
    { id: "H2", data: o("POR ASIGNAR", { dividida_de: "M" }) },
  ];
  assert.deepEqual(D.hermanasPendientes(familia, "M"), ["H1", "H2"]);
});

test("D3 · la última hermana entregada no tiene pendientes", () => {
  const familia = [
    { id: "M", data: o("ENTREGADO AL CLIENTE", { dividida_en: ["H1"] }) },
    { id: "H1", data: o("ENTREGADO AL CLIENTE", { dividida_de: "M" }) },
  ];
  assert.deepEqual(D.hermanasPendientes(familia, "H1"), []);
  assert.deepEqual(D.hermanasPendientes(familia, "M"), []);
});

test("D4 · una hermana anulada, cerrada sin retirar o eliminada no detiene a las demás", () => {
  const familia = [
    { id: "M", data: o("COMPLETADO (EN OFICINA)", { dividida_en: ["H1", "H2", "H3", "H4"] }) },
    { id: "H1", data: o("ANULADA") },
    { id: "H2", data: o("CERRADA (SIN RETIRAR)") },
    { id: "H3", data: o("ASIGNADO", { eliminado: true }) },
    { id: "H4", data: null },   // doc borrado
  ];
  assert.deepEqual(D.hermanasPendientes(familia, "M"), []);
});

test("D5 · COMPLETADO sin entregar sigue siendo pendiente", () => {
  const familia = [
    { id: "M", data: o("ENTREGADO AL CLIENTE") },
    { id: "H1", data: o("COMPLETADO (EN OFICINA)") },
  ];
  assert.deepEqual(D.hermanasPendientes(familia, "M"), ["H1"]);
});

// ── Front: reparto por modelo ─────────────────────────────────────────────
function cargarDividir() {
  const ctx = { window: {}, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "pages", "ordenes-dividir.js"), "utf8");
  vm.runInContext(src, ctx);
  return ctx.OrdenesDividir;
}

test("F1 · repartirPorModelo: una orden por modelo, la madre conserva el primero", () => {
  const { repartirPorModelo } = cargarDividir();
  const equipos = [
    { id: "a", modelo: "PNC360S-R" }, { id: "b", modelo: "NX-420-R" },
    { id: "c", modelo: "PNC360S-R" }, { id: "d", modelo: "" },
    { id: "e", modelo: "NX-420-R" }, { id: "f", modelo: " PNC360S-R " },
  ];
  // Round-trip por JSON: los objetos nacen en el realm del vm y deepEqual los
  // rechaza por prototipo aunque sean iguales.
  const r = JSON.parse(JSON.stringify(repartirPorModelo(equipos)));
  assert.deepEqual(r, [
    { modelo: "PNC360S-R", ids: ["a", "c", "f"] },
    { modelo: "NX-420-R", ids: ["b", "e"] },
    { modelo: "sin modelo", ids: ["d"] },
  ]);
});

test("F2 · puedeDividir: PROGRAMACIÓN en POR ASIGNAR sin técnico y con 2+ equipos; REPARACIÓN no", () => {
  const { puedeDividir } = cargarDividir();
  const base = { estado_reparacion: "POR ASIGNAR", equipos: [{ id: "a" }, { id: "b" }] };
  assert.equal(puedeDividir({ ...base, tipo_de_servicio: "PROGRAMACIÓN" }), true);
  assert.equal(puedeDividir({ ...base, tipo_de_servicio: "Programacion" }), true);
  assert.equal(puedeDividir({ ...base, tipo_de_servicio: "ENTRADA" }), true);
  assert.equal(puedeDividir({ ...base, tipo_de_servicio: "REPARACIÓN" }), false);
  assert.equal(puedeDividir({ ...base, tipo_de_servicio: "PROGRAMACIÓN", tecnico_uid: "t1" }), false);
  assert.equal(puedeDividir({ ...base, tipo_de_servicio: "PROGRAMACIÓN", estado_reparacion: "ASIGNADO" }), false);
  assert.equal(puedeDividir({ ...base, tipo_de_servicio: "PROGRAMACIÓN", equipos: [{ id: "a" }, { id: "b", eliminado: true }] }), false);
});
