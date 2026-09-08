// Regularización de cuentas — el módulo compartido debe ser byte a byte igual
// en front y back, y la regla D1–D7 + nivel + escalera debe dar lo que dice
// docs/plans/PLAN_REGULARIZACION_CUENTAS.md §3 y §6.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const R = require("../src/domain/regularizacion");

test("regularizacion.js es idéntico en functions/src/domain y public/js/domain", () => {
  const back = fs.readFileSync(path.join(__dirname, "..", "src", "domain", "regularizacion.js"), "utf8");
  const front = fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "domain", "regularizacion.js"), "utf8");
  assert.equal(front, back, "public/js/domain/regularizacion.js difiere de functions/src/domain/regularizacion.js — copia una sobre la otra");
});

const en = (u, extra = {}) => ({ id: u, serial: u, estado: "en_cliente", asignacion: { cliente_id: "c1" }, ...extra });
const con = (id, extra = {}) => ({ id, contrato_id: id, estado: "activo", codigo_tipo: "SERV", equipos: [{ cantidad: 2 }], seriales_estado: "asignados", ...extra });

test("cuenta al día: sin unidades sueltas ni contratos legacy", () => {
  const r = R.calcular({ contratos: [con("SERV20260101-01")], unidades: [en("A1", { asignacion: { cliente_id: "c1", contrato_doc_id: "x" } })] });
  assert.equal(r.nivel, "al_dia");
  assert.equal(r.puntos, 0);
  assert.equal(r.etiqueta, null);
  assert.equal(R.chip(r), null);
  assert.equal(R.estampa(r), null);
});

test("D1: radios en campo sin contrato; pendiente_devolucion no cuenta", () => {
  const r = R.calcular({
    contratos: [con("SERV20260101-01")],
    unidades: [en("A1"), en("A2"), en("A3", { pendiente_devolucion: true })],
  });
  assert.equal(r.d1, 2);
  assert.deepEqual(r.d1_ids, ["A1", "A2"]);
  assert.equal(r.nivel, "leve");             // D1 ≤ 2 y D2 = 0
  assert.equal(r.etiqueta, "operativa");
});

test("D2: contrato vigente con seriales legacy sube a por_regularizar; 'pendiente' no es deuda", () => {
  const r = R.calcular({ contratos: [con("ALQ20240101-01", { seriales_estado: "legacy" }), con("SERV20260101-02", { seriales_estado: "pendiente" })] });
  assert.equal(r.d2, 1);
  assert.deepEqual(r.d2_ids, ["ALQ20240101-01"]);
  assert.equal(r.nivel, "por_regularizar");
  assert.equal(r.etiqueta, "migracion");     // solo deuda del cutover
});

test("D2 no cuenta contratos sin líneas ni DEMO/TEMP ni vencidos/anulados", () => {
  const r = R.calcular({ contratos: [
    con("ALQ20240101-01", { seriales_estado: "legacy", equipos: [] }),
    con("TEMP20260901-01", { codigo_tipo: "TEMP", seriales_estado: "legacy" }),
    con("ALQ20230101-01", { seriales_estado: "legacy", estado: "anulado" }),
  ] });
  assert.equal(r.d2, 0);
  assert.equal(r.nivel, "al_dia");
});

test("Arraiján: tres contratos legacy sin seriales = 3 puntos, por_regularizar, migración", () => {
  const r = R.calcular({ contratos: [
    con("PROP20260306-01", { codigo_tipo: "PROP", seriales_estado: "legacy", estado: "aprobado" }),
    con("PROP20251212-01", { codigo_tipo: "PROP", seriales_estado: "legacy", estado: "aprobado" }),
    con("ALQ20250908-05", { codigo_tipo: "ALQ", seriales_estado: "legacy", estado: "aprobado" }),
  ] });
  assert.equal(r.puntos, 3);
  assert.equal(r.nivel, "por_regularizar");
  assert.equal(r.etiqueta, "migracion");
  assert.equal(R.resumen(r), "Por regularizar (3): 3 contrato(s) sin seriales declarados");
});

test("crítica: 20 radios sin contrato, o radios en campo sin ningún contrato vigente", () => {
  const veinte = Array.from({ length: 20 }, (_, i) => en(`R${i}`));
  assert.equal(R.calcular({ contratos: [con("SERV20260101-01")], unidades: veinte }).nivel, "critica");
  const r = R.calcular({ contratos: [], unidades: [en("A1")] });
  assert.equal(r.nivel, "critica");
  assert.equal(r.sin_contrato_vigente, true);
  assert.equal(R.chip(r).tono, "bad");
});

test("D3–D7 suman y se describen", () => {
  const r = R.calcular({
    contratos: [
      con("SERV20260101-01", { origen_tipo: "legacy" }),
      con("REEMP20260201-01", { codigo_tipo: "REEMP", reemplaza_seriales: [], regularizacion: { sobrantes: 2 } }),
    ],
    unidades: [{ id: "Z9", serial: "Z9", estado: "por_clasificar", ultima_asignacion: { cliente_id: "c1" } }],
    gestiones: [{ id: "GA20260907-01", tipo: "aumento", estado: "pendiente_firma", aumento: { contrato_papel: true } }],
  });
  assert.deepEqual([r.d3, r.d4, r.d5, r.d6, r.d7], [1, 1, 1, 2, 1]);
  assert.equal(r.puntos, 6);
  assert.equal(r.etiqueta, "operativa");
  const d = R.desglose(r);
  assert.equal(d[0].codigo, "d6");
  assert.equal(d.length, 5);
});

test("estampa y escalera: DEMO/TEMP se estampan pero no cuentan; excede por cantidad o por días", () => {
  const base = R.calcular({ contratos: [con("SERV20260101-01")], unidades: [en("A1"), en("A2"), en("A3")] });
  const st = R.estampa(base, { ahora: new Date("2026-06-01") });
  assert.equal(st.puntual_n, 1);
  assert.equal(st.nivel, "por_regularizar");

  const marca = (d) => ({ nivel: "por_regularizar", puntos: 3, at: new Date(d) });
  const gestiones = [
    { id: "g1", tipo: "reemplazo", estado: "pendiente_bodega", cuenta_regularizacion: marca("2026-06-01") },
    { id: "g2", tipo: "aumento", estado: "pendiente_firma", cuenta_regularizacion: marca("2026-06-10") },
    { id: "g3", tipo: "demo", estado: "pendiente_bodega", cuenta_regularizacion: marca("2026-06-11") },   // no cuenta
    { id: "g4", tipo: "baja", estado: "anulada", cuenta_regularizacion: marca("2026-06-12") },            // no cuenta
  ];
  const contratos = [con("SERV20260101-01"), con("TEMP20260615-01", { codigo_tipo: "TEMP", cuenta_regularizacion: marca("2026-06-15") })];
  const r = R.calcular({ contratos, unidades: [en("A1"), en("A2"), en("A3")], gestiones, opts: { ahora: new Date("2026-07-01") } });
  assert.equal(r.gestiones_puntuales, 2);
  assert.equal(r.excede_margen, false);
  // Tercera puntual + una más → excede por cantidad.
  const mas = gestiones.concat([{ id: "g5", tipo: "reemplazo", estado: "pendiente_bodega", cuenta_regularizacion: marca("2026-06-20") },
    { id: "g6", tipo: "reemplazo", estado: "pendiente_bodega", cuenta_regularizacion: marca("2026-06-21") }]);
  assert.equal(R.calcular({ contratos, unidades: [en("A1"), en("A2"), en("A3")], gestiones: mas, opts: { ahora: new Date("2026-07-01") } }).excede_margen, true);
  // Pocas, pero la primera marca tiene más de 90 días → excede por días.
  assert.equal(R.calcular({ contratos, unidades: [en("A1"), en("A2"), en("A3")], gestiones, opts: { ahora: new Date("2026-09-15") } }).excede_margen, true);
  // Deuda de migración pura nunca excede.
  const mig = R.calcular({ contratos: [con("ALQ20240101-01", { seriales_estado: "legacy" })], gestiones: mas, opts: { ahora: new Date("2027-01-01") } });
  assert.equal(mig.etiqueta, "migracion");
  assert.equal(mig.excede_margen, false);
});

test("igual(): solo compara lo que importa para no reescribir el doc del cliente", () => {
  const a = R.calcular({ unidades: [en("A1")] });
  const b = R.calcular({ unidades: [en("A1")] });
  assert.equal(R.igual(a, b), true);
  assert.equal(R.igual(a, R.calcular({ unidades: [en("A1"), en("A2")] })), false);
  assert.equal(R.igual(a, { ...a, calculado_at: new Date(), vendedor_uid: "x" }), true);
});
