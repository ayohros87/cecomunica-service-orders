// Plan de transición decidido en la venta (informe tracking 2026-08-12, P1/P5):
// el dominio front que arma, valida y resume el plan. La motivación medida:
// 0 linajes y 2 mapeos en toda la base porque la decisión se pedía a recepción
// semanas después — el plan la captura donde nace, con el vendedor.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");

function cargar() {
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "domain", "transicionPlan.js"), "utf8"), ctx);
  return ctx.window.TransicionPlan;
}

test("aplica — mismo corte que el origen obligatorio: Renovación y Reemplazo", () => {
  const P = cargar();
  assert.equal(P.aplica({ accion: "Renovación", codigo_tipo: "ALQ" }), true);
  assert.equal(P.aplica({ accion: "No Aplica", codigo_tipo: "REEMP" }), true);
  assert.equal(P.aplica({ accion: "Adición", codigo_tipo: "ALQ" }), false);
  assert.equal(P.aplica({ accion: "Nuevo", codigo_tipo: "ALQ" }), false);
});

test("el punto de partida es honesto por tipo: REEMP reemplaza, Renovación continúa", () => {
  const P = cargar();
  assert.equal(P.destinoDefault({ codigo_tipo: "REEMP" }), "reemplaza");
  assert.equal(P.destinoDefault({ accion: "Renovación", codigo_tipo: "ALQ" }), "continua");
});

test("construirSerial normaliza seriales y deriva las cantidades por modelo", () => {
  const P = cargar();
  const plan = P.construirSerial([
    { serial: "a-1", modelo: "P50", destino: "continua" },
    { serial: "A2", modelo: "P50", destino: "reemplaza" },
    { serial: "B1", modelo: "T338", destino: "devuelve" },
    { serial: "", modelo: "T338", destino: "devuelve" },       // sin serial: fuera
  ], ["orig1"]);
  assert.equal(plan.nivel, "serial");
  assert.equal(plan.unidades.length, 3);
  assert.equal(plan.unidades[0].serial_norm, "A1");
  const p50 = plan.por_modelo.find(f => f.modelo === "P50");
  assert.deepEqual({ c: p50.continuan, d: p50.devuelven, r: p50.reemplazan, t: p50.total },
    { c: 1, d: 0, r: 1, t: 2 });
});

test("un destino desconocido cae a 'devuelve' — la regla de fondo, nunca un estado inválido", () => {
  const P = cargar();
  const plan = P.construirSerial([{ serial: "X1", modelo: "P50", destino: "loQueSea" }], []);
  assert.equal(plan.unidades[0].destino, "devuelve");
});

test("validar nivel cantidad exige que las cantidades cuadren con el total", () => {
  const P = cargar();
  const mal = P.construirCantidad([{ modelo: "P50", total: 10, continuan: 6, devuelven: 3, reemplazan: 0 }], []);
  const v = P.validar(mal);
  assert.equal(v.ok, false);
  assert.match(v.mensaje, /suman 9 .* 10/);
  const bien = P.construirCantidad([{ modelo: "P50", total: 10, continuan: 6, devuelven: 4, reemplazan: 0 }], []);
  assert.equal(P.validar(bien).ok, true);
});

test("resumen — la frase que ven la vista previa, seriales y transición", () => {
  const P = cargar();
  const plan = P.construirCantidad([{ modelo: "P50", total: 10, continuan: 6, devuelven: 4, reemplazan: 0 }], []);
  assert.match(P.resumen(plan), /6 continúan · 4 se devuelven \(por cantidades/);
  const serial = P.construirSerial([{ serial: "A1", modelo: "P50", destino: "reemplaza" }], []);
  assert.equal(P.resumen(serial), "1 se reemplaza");
  assert.equal(P.resumen(null), "Sin unidades en el plan");
});
