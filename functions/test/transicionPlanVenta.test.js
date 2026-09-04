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

// ── 2026-09-04: destino 'no_tiene', fuente por unidad y conciliación con las líneas ──
test("'no_tiene' es un destino válido, se cuenta aparte y conserva la fuente y la modalidad", () => {
  const P = cargar();
  const plan = P.construirSerial([
    { serial: "A1", modelo: "PNC360S", destino: "continua", fuente: "origen", modalidad: "alquiler" },
    { serial: "A2", modelo: "PNC360S", destino: "no_tiene", fuente: "migracion" },
    { serial: "A3", modelo: "PNC360S", destino: "continua", fuente: "agregado", modalidad: "propio" },
    { serial: "A4", modelo: "PNC360S", destino: "continua", fuente: "loQueSea" },
  ], ["o1"]);
  assert.equal(P.validar(plan).ok, true);
  const f = plan.por_modelo[0];
  assert.deepEqual({ c: f.continuan, n: f.no_tienen, t: f.total }, { c: 3, n: 1, t: 4 });
  assert.equal(plan.unidades[1].fuente, "migracion");
  assert.equal(plan.unidades[2].modalidad, "propio");
  assert.equal("fuente" in plan.unidades[3], false);
  assert.match(P.resumen(plan), /3 continúan \(1 agregado por el vendedor\)/);
  assert.match(P.resumen(plan), /1 no lo tiene el cliente/);
});

test("conciliarLineas cuenta los 'continúa' por línea (modelo + modalidad) y reporta los sin línea", () => {
  const P = cargar();
  const plan = P.construirSerial([
    { serial: "A1", modelo: "HYTERA PNC360S-R", destino: "continua" },
    { serial: "A2", modelo: "HYTERA PNC360S", destino: "continua" },
    { serial: "A3", modelo: "HYTERA PNC360S", destino: "no_tiene" },
    { serial: "P1", modelo: "HYTERA PNC360S", destino: "continua", modalidad: "propio" },
    { serial: "X1", modelo: "TK-3000", destino: "continua" },
  ], []);
  const lineas = [
    { modelo_id: "m1", modelo: "HYTERA PNC360S-R", cantidad: 24, modalidad: "alquiler" },
    { modelo_id: "m1", modelo: "HYTERA PNC360S-R", cantidad: 1, modalidad: "propio" },
  ];
  const r = P.conciliarLineas(plan, lineas);
  assert.deepEqual(JSON.parse(JSON.stringify(r.porLinea)), [{ idx: 0, continuan: 2, reemplazan: 0 }, { idx: 1, continuan: 1, reemplazan: 0 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(r.sinLinea.map(u => u.serial))), ["X1"]);
});

// ── 2026-09-04 (2): reemplazo por OTRO modelo, refurbished por serial, modalidad derivada ──
test("reemplaza por otro modelo y refurbished por serial viajan en la unidad; la conciliación cuenta el reemplazo en la línea del modelo ENTRANTE", () => {
  const P = cargar();
  const plan = P.construirSerial([
    { serial: "A1", modelo: "HYTERA PNC360S", destino: "continua", refurbished: true },
    { serial: "A2", modelo: "HYTERA PNC360S", destino: "reemplaza" },
    { serial: "A3", modelo: "HYTERA PNC360S", destino: "reemplaza", reemplazo_modelo_id: "m3", reemplazo_modelo: "KENWOOD TK-3000" },
    { serial: "A4", modelo: "HYTERA PNC360S", destino: "devuelve", refurbished: true },  // refurbished solo aplica a continúa
  ], []);
  assert.equal(plan.unidades[0].refurbished, true);
  assert.equal("refurbished" in plan.unidades[3], false);
  assert.equal(plan.unidades[2].reemplazo_modelo_id, "m3");
  assert.equal("reemplazo_modelo_id" in plan.unidades[1], false);
  assert.match(P.resumen(plan), /2 se reemplazan \(1 por otro modelo\)/);
  const lineas = [
    { modelo_id: "x7", modelo: "HYTERA PNC360S-R", cantidad: 2 },
    { modelo_id: "m3", modelo: "KENWOOD TK-3000", cantidad: 1 },
  ];
  const r = JSON.parse(JSON.stringify(P.conciliarLineas(plan, lineas)));
  assert.deepEqual(r.porLinea, [{ idx: 0, continuan: 1, reemplazan: 1 }, { idx: 1, continuan: 0, reemplazan: 1 }]);
  assert.equal(r.sinLinea.length, 0);
  assert.equal(P.tieneReemplazos(plan), true);
});

test("derivarModalidad: sin equipo solo cuando no hay reemplazos ni unidades de más; refurbished si algún continúa lo marca", () => {
  const P = cargar();
  const soloContinuan = P.construirSerial([
    { serial: "A1", modelo: "P", destino: "continua", refurbished: true },
    { serial: "A2", modelo: "P", destino: "no_tiene" },
  ], []);
  let m = P.derivarModalidad(soloContinuan, [{ modelo: "P", cantidad: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), { sin_equipo: true, refurbished: true, refurbished_n: 1, reemplazos: 0, continuan: 1, nuevos: 0 });
  m = P.derivarModalidad(soloContinuan, [{ modelo: "P", cantidad: 3 }]);
  assert.equal(m.sin_equipo, false); assert.equal(m.nuevos, 2);
  const conReemplazo = P.construirSerial([{ serial: "A1", modelo: "P", destino: "reemplaza" }], []);
  m = P.derivarModalidad(conReemplazo, [{ modelo: "P", cantidad: 1 }]);
  assert.equal(m.sin_equipo, false); assert.equal(m.reemplazos, 1); assert.equal(m.refurbished, false);
  assert.equal(P.derivarModalidad(null, []).sin_equipo, true);
});
