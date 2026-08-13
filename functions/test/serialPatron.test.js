// Detector de seriales mal transcritos en una tanda de conteo
// (public/js/domain/serialPatron.js).
//
// Los casos son REALES, de las hojas que bodega mandó el 2026-08-12/13. Dos de
// ellos se atraparon a ojo y bodega confirmó que estaban mal; el tercero pasa
// limpio a propósito y documenta el límite de la heurística.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function cargarFrontend() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "js", "domain", "serialPatron.js"), "utf8");
  const sandbox = { window: {}, console, module: undefined };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "serialPatron.js" });
  return sandbox.window.SerialPatron;
}
const SP = cargarFrontend();

const sospechosos = (r) => r.revisados.filter((x) => x.sospechoso);

// Bases TM-7PLUS del 2026-08-12. El serial de la hoja era `O180828000175`;
// bodega confirmó que el real es `ZRK180828000175` — no era letra-O contra
// cero, faltaban tres caracteres al principio. Lo que lo delata es el largo.
test("marca el serial de otro largo (caso ZRK180828000175)", () => {
  const r = SP.revisar([
    "7TM27PA2460", "7TM27PA3013", "7TM27PA3033", "7TM27PA3041", "7TM27PA3101",
    "7TM27PA3103", "9TM17PA1165", "9TM17PA1205", "O180828000175",
  ]);
  const s = sospechosos(r);
  assert.equal(s.length, 1);
  assert.equal(s[0].serial, "O180828000175");
  assert.match(s[0].motivo, /13 caracteres/);
  assert.equal(s[0].sugerencia, null, "no debe inventar una corrección: el largo no cuadra");
});

// Radios PD786G-R del 2026-08-12: la hoja traía `16O13D0998` entre seriales
// `20229C00xx` / `20912A04xx`. Misma longitud, pero la O cae donde la serie
// lleva dígito — aquí sí hay una corrección concreta que proponer.
test("propone la corrección cuando una letra cae donde va un número (caso 16O13D0998)", () => {
  const r = SP.revisar([
    "20229C0013", "20229C0014", "20229C0015", "20229C0016", "20229C0017",
    "20912A0443", "20912A0444", "20912A0446", "16O13D0998",
  ]);
  const s = sospechosos(r);
  assert.equal(s.length, 1);
  assert.equal(s[0].serial, "16O13D0998");
  assert.equal(s[0].sugerencia, "16013D0998");
  assert.match(s[0].motivo, /16013D0998/);
});

// LÍMITE CONOCIDO. `B3710905` era en realidad `B7310905` (transposición de
// dígitos): un serial perfectamente válido de la misma serie. Ninguna
// heurística de forma puede verlo — lo destapa el cruce contra el pool
// (la ficha existía y estaba entregada) o bodega con el radio en la mano.
test("NO marca una transposición de dígitos: es forma válida (caso B3710905)", () => {
  const r = SP.revisar([
    "B6211094", "B6211167", "B6211136", "B6211169", "B6111177", "B3710905",
  ]);
  assert.equal(sospechosos(r).length, 0);
});

test("tanda limpia: nadie sospechoso", () => {
  const r = SP.revisar(["B6211094", "B6211167", "B6211136", "B6211169", "B6111177"]);
  assert.equal(sospechosos(r).length, 0);
  assert.equal(r.patron, "LDDDDDDD");
});

// Callarse es parte del contrato: sin forma dominante, marcar cualquier cosa
// sería ruido que entrena a bodega a ignorar el aviso.
test("se calla con tandas cortas", () => {
  const r = SP.revisar(["7TM27PA2460", "O180828000175"]);
  assert.equal(r.patron, null);
  assert.equal(sospechosos(r).length, 0);
});

test("se calla cuando no hay una forma dominante", () => {
  const r = SP.revisar(["AAA111", "BB22", "C3333333", "DDDD4444", "E5", "FFFFFF6"]);
  assert.equal(r.patron, null);
  assert.equal(sospechosos(r).length, 0);
});

// El caso mayoritario manda aunque los "raros" sean varios: 6 contra 2.
test("varios sospechosos a la vez", () => {
  const r = SP.revisar([
    "20229C0013", "20229C0014", "20229C0015", "20229C0016", "20229C0017", "20229C0018",
    "16O13D0998", "2O912A0443",
  ]);
  const s = sospechosos(r);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.sugerencia), ["16013D0998", "20912A0443"]);
});

test("describirPatron habla en cristiano", () => {
  assert.equal(SP.describirPatron("DDDDDLDDDD"), "5 números + 1 letra + 4 números");
  assert.equal(SP.describirPatron("LDDDDDDD"), "1 letra + 7 números");
  assert.equal(SP.describirPatron(null), "");
});
