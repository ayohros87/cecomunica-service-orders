// Sello sync_at de poc_devices: el trigger tiene que reconocer SU propia
// escritura (si no, se sella en bucle) y sellar todo lo demás — incluida una
// copia de datos viejos que trae un sync_at antiguo.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");
const { esSelloPropio } = require("../src/domain/pocSello");

const ahora = Date.parse("2026-10-21T18:00:00Z");
const ts = (msAtras) => Timestamp.fromMillis(ahora - msAtras);

test("el eco del propio sello no se vuelve a sellar", () => {
  assert.equal(esSelloPropio({ sync_at: ts(3600e3) }, { sync_at: ts(1000) }, ahora), true);
  assert.equal(esSelloPropio({}, { sync_at: ts(1000) }, ahora), true);        // primer sello
});

test("una edición normal (sync_at sin tocar) se sella", () => {
  const s = ts(3600e3);
  assert.equal(esSelloPropio({ sync_at: s, sim: "1" }, { sync_at: s, sim: "2" }, ahora), false);
  assert.equal(esSelloPropio({ sim: "1" }, { sim: "2" }, ahora), false);       // ficha nunca sellada
  assert.equal(esSelloPropio(null, { serial: "X" }, ahora), false);            // alta
});

test("una copia que trae un sync_at VIEJO se sella igual", () => {
  assert.equal(esSelloPropio({ sync_at: ts(60e3) }, { sync_at: ts(86400e3) }, ahora), false);
  assert.equal(esSelloPropio(null, { sync_at: ts(86400e3) }, ahora), false);
});
