// requiereReaprobacion (js/domain/contratoTarifario.js): una edición de un
// contrato APROBADO que cambia lo económico o el plazo lo devuelve a pendiente
// de aprobación (2026-09-04, Alberto: "sin reaprobación nadie se entera").
// Corre con `npm test` (node --test), sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");

function cargar() {
  const ctx = { console, window: {}, FMT: { ITBMS_RATE: 0.07, round2: (n) => Math.round(n * 100) / 100 }, OrigenContrato: { tipoDe: () => "" } };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "domain", "contratoTarifario.js"), "utf8"), ctx);
  return ctx.window.ContratoTarifario;
}
const J = (x) => JSON.parse(JSON.stringify(x));

const base = {
  equipos: [{ modelo_id: "x7", modelo: "HYTERA PNC360S-R", cantidad: 24, precio: 12, modalidad: "alquiler" }],
  cargos: [{ cargo_id: "gps", concepto: "GPS", cantidad: 1, monto: 5, recurrente: true }],
  duracion: "18 meses", duracion_meses: 18, itbms_aplica: true, observaciones: "a",
};

test("misma economía y plazo → no requiere (observaciones y orden de líneas no cuentan)", () => {
  const T = cargar();
  const otro = { ...base, observaciones: "b", equipos: [...base.equipos].reverse() };
  assert.deepEqual(J(T.requiereReaprobacion(base, otro)), { requiere: false, cambios: [] });
});

test("cambia la cantidad de una línea → requiere por 'equipos'", () => {
  const T = cargar();
  const otro = { ...base, equipos: [{ ...base.equipos[0], cantidad: 22 }] };
  assert.deepEqual(J(T.requiereReaprobacion(base, otro)), { requiere: true, cambios: ["equipos"] });
});

test("cambia precio, cargo, duración o ITBMS → cada uno se reporta", () => {
  const T = cargar();
  assert.deepEqual(J(T.requiereReaprobacion(base, { ...base, equipos: [{ ...base.equipos[0], precio: 13 }] }).cambios), ["equipos"]);
  assert.deepEqual(J(T.requiereReaprobacion(base, { ...base, cargos: [] }).cambios), ["cargos"]);
  assert.deepEqual(J(T.requiereReaprobacion(base, { ...base, duracion: "24 meses", duracion_meses: 24 }).cambios), ["duracion"]);
  assert.deepEqual(J(T.requiereReaprobacion(base, { ...base, itbms_aplica: false }).cambios), ["itbms"]);
});

test("líneas sin modelo_id se comparan por texto de modelo; modalidad ausente = alquiler", () => {
  const T = cargar();
  const a = { equipos: [{ modelo: "PNC360S-R", cantidad: 2, precio: 10 }], cargos: [], duracion: "18 meses" };
  const b = { equipos: [{ modelo: "pnc360s-r ", cantidad: 2, precio: 10, modalidad: "alquiler" }], cargos: [], duracion: "18 meses" };
  assert.equal(T.requiereReaprobacion(a, b).requiere, false);
  const c = { ...b, equipos: [{ ...b.equipos[0], modalidad: "propio" }] };
  assert.equal(T.requiereReaprobacion(a, c).requiere, true);
});
