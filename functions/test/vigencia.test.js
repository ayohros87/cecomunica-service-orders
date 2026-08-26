// Aritmética de vigencias (lib/vigencia.js) — funciones puras, sin red.
// Corre con `npm test` (node --test).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/lib/vigencia");

test("parseDuracionMeses: formatos del selector y del histórico", () => {
  assert.equal(V.parseDuracionMeses("12 meses"), 12);
  assert.equal(V.parseDuracionMeses("18 meses"), 18);
  assert.equal(V.parseDuracionMeses("1 MES"), 1);
  assert.equal(V.parseDuracionMeses("2 años"), 24);
  assert.equal(V.parseDuracionMeses("2 anos"), 24);
  assert.equal(V.parseDuracionMeses("24"), 24);
  assert.equal(V.parseDuracionMeses(36), 36);
  assert.equal(V.parseDuracionMeses(""), null);
  assert.equal(V.parseDuracionMeses(null), null);
  assert.equal(V.parseDuracionMeses("indefinido"), null);
  assert.equal(V.parseDuracionMeses("0 meses"), null);
});

test("mejorFechaInicio: prioridad facturación → entrega → aprobación → creación", () => {
  const d = (s) => new Date(s);
  assert.equal(V.mejorFechaInicio({
    facturacion_fecha_inicio: d("2026-01-01"),
    fecha_aprobacion: d("2025-12-01"),
  }).fuente, "facturacion_fecha_inicio");
  assert.equal(V.mejorFechaInicio({
    fecha_entrega_ultima: d("2026-01-05"),
    fecha_creacion: d("2025-12-01"),
  }).fuente, "fecha_entrega_ultima");
  assert.equal(V.mejorFechaInicio({ fecha_creacion: "2026-02-10" }).fuente, "fecha_creacion");
  assert.equal(V.mejorFechaInicio({}).fecha, null);
  // Timestamp-like (toDate) también resuelve.
  const ts = { toDate: () => d("2026-03-01") };
  const r = V.mejorFechaInicio({ fecha_aprobacion: ts });
  assert.equal(r.fuente, "fecha_aprobacion");
  assert.equal(r.fecha.getTime(), d("2026-03-01").getTime());
});

test("calcularVencimiento: suma de meses", () => {
  const v = V.calcularVencimiento(new Date("2026-03-12"), 12);
  assert.equal(v.toISOString().slice(0, 10), "2027-03-12");
  assert.equal(V.calcularVencimiento(null, 12), null);
  assert.equal(V.calcularVencimiento(new Date("2026-03-12"), 0), null);
});

test("estadoVencimiento: vigente / por_vencer (60d) / vencido", () => {
  const now = new Date("2026-08-26");
  assert.equal(V.estadoVencimiento(new Date("2027-08-26"), now), "vigente");
  assert.equal(V.estadoVencimiento(new Date("2026-10-01"), now), "por_vencer");
  assert.equal(V.estadoVencimiento(new Date("2026-08-01"), now), "vencido");
  assert.equal(V.estadoVencimiento(null, now), null);
});

test("renovacionDisponible: 60 días siempre; anticipada 3 meses solo 18+", () => {
  const now = new Date("2026-08-26");
  const en45d = new Date("2026-10-10");
  const en80d = new Date("2026-11-14");
  assert.equal(V.renovacionDisponible(en45d, 12, now), true);   // dentro de 60d
  assert.equal(V.renovacionDisponible(en80d, 12, now), false);  // 12m: sin anticipada
  assert.equal(V.renovacionDisponible(en80d, 18, now), true);   // 18m: anticipada 3m
  const en5m = new Date("2027-01-26");
  assert.equal(V.renovacionDisponible(en5m, 24, now), false);   // fuera hasta de la anticipada
});
