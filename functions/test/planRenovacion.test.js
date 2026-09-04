// decidirAplicacion (lib/planRenovacion.js) — la decisión PURA de qué filas
// de seriales crear/quitar y qué fichas soltar al aplicar el plan por serial
// de una renovación (2026-09-04, caso Chino Panameño). Sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-plan-renovacion" });
const { decidirAplicacion, hashPlan, serialesExcluidosPorPlan, SOURCE } = require("../src/lib/planRenovacion");

const U = (serial, destino, extra = {}) => ({ serial, serial_norm: serial, modelo: "PNC360S", destino, ...extra });
const plan = (unidades) => ({ nivel: "serial", unidades });

test("sin plan por serial no hay nada que aplicar", () => {
  assert.deepEqual(decidirAplicacion(null, []), { crear: [], quitar: [], soltar: [] });
  assert.deepEqual(decidirAplicacion({ nivel: "cantidad", por_modelo: [] }, []), { crear: [], quitar: [], soltar: [] });
});

test("'continua' crea la fila; 'no_tiene' suelta; 'devuelve' no hace nada aquí", () => {
  const r = decidirAplicacion(plan([U("A1", "continua"), U("A2", "no_tiene"), U("A3", "devuelve")]), []);
  assert.deepEqual(r.crear.map((u) => u.serial), ["A1"]);
  assert.deepEqual(r.soltar.map((u) => u.serial), ["A2"]);
  assert.equal(r.quitar.length, 0);
});

test("una fila que ya existe (de cualquier fuente) no se duplica", () => {
  const r = decidirAplicacion(plan([U("A1", "continua"), U("b-2", "continua")]),
    [{ id: "f1", serial: "A1", source: "bodega" }, { id: "f2", serial: "B2", source: SOURCE }]);
  assert.equal(r.crear.length, 0);
});

test("corrección del plan: la fila propia de una unidad que dejó de continuar se quita; las ajenas no", () => {
  const filas = [
    { id: "f1", serial: "A1", source: SOURCE },
    { id: "f2", serial: "A2", source: SOURCE },
    { id: "f3", serial: "A3", source: "regularizacion_aprobacion" },
  ];
  const r = decidirAplicacion(plan([U("A1", "continua"), U("A2", "no_tiene")]), filas);
  assert.deepEqual(r.quitar.map((q) => q.serial), ["A2", "A3"].filter((s) => s === "A2"));
  assert.deepEqual(r.soltar.map((u) => u.serial), ["A2"]);
  assert.equal(r.crear.length, 0);
});

test("seriales repetidos en el plan cuentan una sola vez", () => {
  const r = decidirAplicacion(plan([U("A1", "continua"), U("a1", "continua")]), []);
  assert.equal(r.crear.length, 1);
});

test("el hash cambia con el destino y no con el orden", () => {
  const h1 = hashPlan(plan([U("A1", "continua"), U("A2", "no_tiene")]));
  const h2 = hashPlan(plan([U("A2", "no_tiene"), U("A1", "continua")]));
  const h3 = hashPlan(plan([U("A1", "continua"), U("A2", "continua")]));
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(hashPlan(null), hashPlan(undefined));
});

test("serialesExcluidosPorPlan: todo lo que no continúa queda fuera del amarre automático", () => {
  const s = serialesExcluidosPorPlan(plan([U("A1", "continua"), U("A2", "no_tiene"), U("A3", "devuelve"), U("A4", "reemplaza")]));
  assert.deepEqual([...s].sort(), ["A2", "A3", "A4"]);
  assert.equal(serialesExcluidosPorPlan(null).size, 0);
});
