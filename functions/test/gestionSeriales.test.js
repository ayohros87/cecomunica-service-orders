// serialesDe (domain/gestionSeriales.js): los seriales que toca una gestión,
// aplanados para que el archivo los pueda buscar con array-contains.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serialesDe, mismoConjunto } = require("../src/domain/gestionSeriales");

test("reemplazo: el que sale Y el que entra, los dos son buscables", () => {
  const g = { tipo: "reemplazo", items: [{ serial_saliente: "8J4K02245", serial_nuevo: "8J4K02299" }] };
  assert.deepEqual(serialesDe(g).sort(), ["8J4K02245", "8J4K02299"]);
});

test("demo y aumento traen los seriales de seriales_asignados", () => {
  assert.deepEqual(serialesDe({ tipo: "demo", demo: { seriales_asignados: [{ serial: "B1300455" }] } }), ["B1300455"]);
  assert.deepEqual(serialesDe({ tipo: "aumento", aumento: { seriales_asignados: [{ serial_norm: "B1300461" }] } }), ["B1300461"]);
});

test("normaliza igual que el pool (mayúsculas, sin guiones ni espacios)", () => {
  assert.deepEqual(serialesDe({ items: [{ serial: " 8j4k-022 45 " }] }), ["8J4K02245"]);
});

test("deduplica: el mismo serial en dos campos cuenta una vez", () => {
  const g = { items: [{ serial: "B1300455", serial_norm: "B1300455" }, { serial_saliente: "b1300455" }] };
  assert.deepEqual(serialesDe(g), ["B1300455"]);
});

test("descarta el cajón de sastre sin dígitos (CONSOLA, GPS, DEMO)", () => {
  const g = { items: [{ serial: "CONSOLA" }, { serial: "GPS" }, { serial: "DEMO" }, { serial: "B1300455" }] };
  assert.deepEqual(serialesDe(g), ["B1300455"]);
});

test("una gestión sin seriales da lista vacía, no null", () => {
  assert.deepEqual(serialesDe({ tipo: "baja", items: [] }), []);
  assert.deepEqual(serialesDe(null), []);
});

test("mismoConjunto ignora el orden — reordenar ítems no dispara escritura", () => {
  assert.equal(mismoConjunto(["A1", "B2"], ["B2", "A1"]), true);
  assert.equal(mismoConjunto(["A1"], ["A1", "B2"]), false);
  assert.equal(mismoConjunto(undefined, []), true);
});
