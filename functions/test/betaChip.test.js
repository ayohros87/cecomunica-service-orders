// Chip "Beta" con vencimiento (js/ui/beta.js, 2026-10-21): se ve hasta el
// último día anunciado (hora de Panamá) y después desaparece solo, sin deploy.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "ui", "beta.js"), "utf8");
function cargar() { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(SRC, ctx); return ctx.window.Beta; }

test("la programación en renovaciones es beta hasta el 20 de noviembre inclusive", () => {
  const B = cargar();
  assert.equal(B.activa("programacion_renovacion", new Date("2026-10-21T12:00:00-05:00")), true);
  assert.equal(B.activa("programacion_renovacion", new Date("2026-11-20T23:00:00-05:00")), true, "el 20 todavía se ve");
  assert.equal(B.activa("programacion_renovacion", new Date("2026-11-21T00:01:00-05:00")), false, "el 21 ya no");
});

test("el chip dice Beta y explica a quién avisar; una clave desconocida no pinta nada", () => {
  const B = cargar();
  B.FUNCIONES.programacion_renovacion.hasta = "2999-12-31";
  assert.match(B.chip("programacion_renovacion"), />Beta</);
  assert.match(B.chip("programacion_renovacion"), /avísale a Alberto/);
  assert.equal(B.chip("no_existe"), "");
});
