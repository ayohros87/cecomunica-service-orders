// Accesorios sin serial (catálogo `sin_serial`) fuera del pool — CEMENTO BAYANO,
// ENTRADA 2026100103: "FUENTE DE NIPPON" se reportó como "no existe en
// inventario" porque la fila de la fuente se trataba como un radio.
const test = require("node:test");
const assert = require("node:assert");
const { esSinSerial, separarSinSerial } = require("../src/domain/accesorioSinSerial");

const porId = new Map([
  ["fuente", { id: "fuente", modelo: "FUENTE", sin_serial: true }],
  ["radio",  { id: "radio",  modelo: "PNC460-R" }],
  ["raro",   { id: "raro",   modelo: "X", sin_serial: "si" }],
]);

test("solo sin_serial === true aparta la fila", () => {
  assert.strictEqual(esSinSerial("fuente", porId), true);
  assert.strictEqual(esSinSerial("radio", porId), false);
  assert.strictEqual(esSinSerial("raro", porId), false);
});

test("sin modelo_id, modelo desconocido o sin catálogo: sigue siendo unidad del pool", () => {
  assert.strictEqual(esSinSerial(null, porId), false);
  assert.strictEqual(esSinSerial("borrado", porId), false);
  assert.strictEqual(esSinSerial("fuente", null), false);
});

test("separa la fuente y deja los radios de la misma orden", () => {
  const filas = [
    { serial: "FUENTE DE NIPPON", modelo_id: "fuente" },
    { serial: "25725A0556", modelo_id: "radio" },
    { serial: "B8C10697", modelo_id: null },
  ];
  const { conSerial, sinSerial } = separarSinSerial(filas, porId);
  assert.deepStrictEqual(sinSerial.map((e) => e.serial), ["FUENTE DE NIPPON"]);
  assert.deepStrictEqual(conSerial.map((e) => e.serial), ["25725A0556", "B8C10697"]);
});
