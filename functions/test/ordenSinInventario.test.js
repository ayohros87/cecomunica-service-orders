// Visita técnica e inspección: cuándo se va al pool (tripwire 2026-11-24).
const test = require("node:test");
const assert = require("node:assert/strict");
const { filasARevisar } = require("../src/domain/ordenSinInventario");

const clave = (s) => String(s || "").trim().toUpperCase();
const f = (...seriales) => seriales.map((serial) => ({ serial }));
const seriales = (filas) => filas.map((e) => e.serial);

test("guardar el trabajo de un radio (mismos seriales, mismo estado) no revisa nada", () => {
  const r = filasARevisar({ antes: f("A", "B", "C"), despues: f("A", "B", "C"), mismoMomento: true, cerrada: false, clave });
  assert.deepEqual(r, []);
});

test("un serial nuevo o corregido se revisa solo él", () => {
  const r = filasARevisar({ antes: f("A", "B"), despues: f("A", "b ", "C"), mismoMomento: true, cerrada: false, clave });
  assert.deepEqual(seriales(r), ["C"]);
});

test("al nacer, cambiar de estado, cerrarse o reabrirse se revisan todas", () => {
  for (const cerrada of [false, true]) {
    const r = filasARevisar({ antes: f("A", "B"), despues: f("A", "B"), mismoMomento: false, cerrada, clave });
    assert.deepEqual(seriales(r), ["A", "B"]);
  }
  assert.deepEqual(seriales(filasARevisar({ antes: [], despues: f("A"), mismoMomento: false, cerrada: false, clave })), ["A"]);
});

test("orden eliminada o sin filas vivas: se sueltan las que tenía", () => {
  const r = filasARevisar({ antes: f("A", "B"), despues: [], mismoMomento: false, cerrada: true, clave });
  assert.deepEqual(seriales(r), ["A", "B"]);
});

test("ya cerrada: una edición sin serial nuevo no revisa nada; con serial nuevo, todas", () => {
  assert.deepEqual(filasARevisar({ antes: f("A", "B"), despues: f("A", "B"), mismoMomento: true, cerrada: true, clave }), []);
  const r = filasARevisar({ antes: f("A", "B"), despues: f("A", "X"), mismoMomento: true, cerrada: true, clave });
  assert.deepEqual(seriales(r), ["A", "X"]);
});

test("quitar un radio de una visita abierta no revisa nada (igual que antes)", () => {
  assert.deepEqual(filasARevisar({ antes: f("A", "B"), despues: f("A"), mismoMomento: true, cerrada: false, clave }), []);
});
