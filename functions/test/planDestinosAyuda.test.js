// "Se reemplaza" vs "Se devuelve" en el plan de la renovación (Alberto,
// 2026-10-21): los vendedores los usaban como sinónimos. El paso de seriales
// explica cada destino arriba de la tabla y avisa cuando hay "se devuelve" y
// a la vez entran radios nuevos (ASESORÍA: 21 devueltos y 21 nuevos).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const R = path.join(__dirname, "..", "..", "public", "js");

function montar() {
  const box = { innerHTML: "" }, mod = { innerHTML: "", textContent: "" };
  const ctx = {
    window: { Centro: { esc: (s) => String(s ?? "") } }, console,
    document: { getElementById: (i) => (i === "wcPlanConc" ? box : i === "wcModalidad" ? mod : null), querySelectorAll: () => [] },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(R, "domain", "transicionPlan.js"), "utf8"), ctx);
  ctx.TransicionPlan = ctx.window.TransicionPlan;
  vm.runInContext(fs.readFileSync(path.join(R, "pages", "centro-plan-seriales-renovacion.js"), "utf8"), ctx);
  const C = ctx.window.Centro;
  const conciliar = (destino, n, cantidad) => {
    C._wcOrigenIds = () => []; C._wcSinDestino = 0;
    C._wcLeerPlan = () => ctx.TransicionPlan.construirSerial(Array.from({ length: n }, (_, i) =>
      ({ serial: "S" + i, modelo_id: "m", modelo: "PNC360S-R", destino, fuente: "origen" })), []);
    C._lineasModelo = () => [{ modelo_id: "m", modelo: "PNC360S-R", cantidad, modalidad: "alquiler" }];
    C._wcConciliar();
    return box.innerHTML;
  };
  return { C, conciliar };
}

test("la leyenda explica la diferencia: reemplaza recibe OTRO, devuelve NO", () => {
  const html = montar().C._wcLeyendaDestinos();
  assert.match(html, /Se reemplaza<\/b>: el cliente entrega este radio y recibe OTRO/);
  assert.match(html, /Se devuelve<\/b>: el cliente entrega este radio y NO recibe otro/);
  assert.match(html, /Continúa/);
});

test("'se devuelve' con radios nuevos en la línea → se pregunta si era un reemplazo", () => {
  assert.match(montar().conciliar("devuelve", 21, 21), /Marcaste 21 “Se devuelve” y entran 21 radio\(s\) nuevo\(s\)/);
});

test("sin radios nuevos, o con reemplazos bien marcados, no hay aviso", () => {
  const h = montar();
  assert.doesNotMatch(h.conciliar("devuelve", 2, 0), /Se devuelve” y entran/);
  assert.doesNotMatch(h.conciliar("reemplaza", 21, 21), /Se devuelve” y entran/);
});
