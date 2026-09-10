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

// ── La duración se compara NORMALIZADA (2026-09-10) ────────────────────────
// 184 de los 220 contratos aprobados en producción no traen `duracion_meses`
// (es un derivado que los contratos viejos no tienen). Comparando el triple
// crudo, uno de esos SIEMPRE salía "cambió la duración" al guardarlo desde el
// editor —que sí escribe el derivado—, así que corregir una observación lo
// devolvía a pendiente de aprobación y le mandaba correo a ventas.
test("un contrato viejo sin duracion_meses no 'cambia de duración' al guardarlo", () => {
  const T = cargar();
  const viejo = { ...base, duracion: "18 meses", duracion_meses: undefined, duracion_dias: undefined };
  const guardado = { ...base, duracion: "18 meses", duracion_meses: 18 };
  assert.equal(T.requiereReaprobacion(viejo, guardado).requiere, false);
});

test("días y meses no se confunden entre sí", () => {
  const T = cargar();
  // Sin `duracion_meses` heredado de `base`: un TEMP por días no lo trae.
  const sinDeriv = { equipos: base.equipos, cargos: base.cargos, itbms_aplica: true };
  const enDias = { ...sinDeriv, duracion: "7 días", duracion_dias: 7 };
  const enMeses = { ...sinDeriv, duracion: "7 meses", duracion_meses: 7 };
  assert.deepEqual(J(T.requiereReaprobacion(enDias, enMeses).cambios), ["duracion"]);
  // El mismo plazo escrito de dos formas (con y sin tilde, con y sin derivado)
  // sigue siendo el mismo plazo.
  assert.equal(T.requiereReaprobacion(enDias, { ...sinDeriv, duracion: "7 dias" }).requiere, false);
});

test("un plazo realmente distinto sigue pidiendo aprobación", () => {
  const T = cargar();
  const a = { ...base, duracion: "18 meses" };
  const b = { ...base, duracion: "24 meses", duracion_meses: 24 };
  assert.deepEqual(J(T.requiereReaprobacion(a, b).cambios), ["duracion"]);
});

test("una duración sin número ('Otro') se compara como texto, no se inventa", () => {
  const T = cargar();
  const sinDeriv = { equipos: base.equipos, cargos: base.cargos, itbms_aplica: true };
  const a = { ...sinDeriv, duracion: "Otro" };
  assert.equal(T.requiereReaprobacion(a, { ...sinDeriv, duracion: "Otro" }).requiere, false);
  assert.deepEqual(J(T.requiereReaprobacion(a, { ...sinDeriv, duracion: "12 meses", duracion_meses: 12 }).cambios), ["duracion"]);
});

// ── La modalidad ausente se deriva del TIPO del contrato ───────────────────
// El editor rellena la modalidad por línea al abrir un contrato viejo (que no
// la trae). Con el default fijo en 'alquiler', rellenar un PROP con lo que el
// propio contrato ya decía salía como "cambiaron los equipos".
test("rellenar la modalidad de un PROP con lo que ya decía no es un cambio", () => {
  const T = cargar();
  const linea = { modelo_id: "x7", modelo: "PD606-R", cantidad: 4, precio: 20 };
  const antes = { codigo_tipo: "PROP", duracion: "12 meses", itbms_aplica: true, cargos: [], equipos: [linea] };
  const despues = { ...antes, equipos: [{ ...linea, modalidad: "propio" }] };
  assert.equal(T.requiereReaprobacion(antes, despues).requiere, false);
});

test("lo mismo para un ALQ, con su propia derivación", () => {
  const T = cargar();
  const linea = { modelo_id: "x7", modelo: "PD606-R", cantidad: 4, precio: 20 };
  const antes = { codigo_tipo: "ALQ", duracion: "12 meses", itbms_aplica: true, cargos: [], equipos: [linea] };
  const despues = { ...antes, equipos: [{ ...linea, modalidad: "alquiler" }] };
  assert.equal(T.requiereReaprobacion(antes, despues).requiere, false);
});

test("cambiar de verdad la modalidad de una línea SÍ pide aprobación", () => {
  const T = cargar();
  const linea = { modelo_id: "x7", modelo: "PD606-R", cantidad: 4, precio: 20 };
  const antes = { codigo_tipo: "ALQ", duracion: "12 meses", itbms_aplica: true, cargos: [], equipos: [linea] };
  const despues = { ...antes, equipos: [{ ...linea, modalidad: "propio" }] };
  assert.deepEqual(J(T.requiereReaprobacion(antes, despues).cambios), ["equipos"]);
});
