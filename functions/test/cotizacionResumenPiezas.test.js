// Resumen de piezas de la cotización (pedido de Solangel, 2026-10-07): la
// misma pieza sumada a través de los equipos, para que quien factura no tenga
// que contarla renglón por renglón.
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/domain/cotizacionesTotales");

const eq = (id, serial) => ({ id, serial, modelo: "NX-1300", marca: "Kenwood", intervencion: "" });
const it = (equipo, modelo, nombre, cant, precio, extra = {}) =>
  ({ equipo, modelo, nombre, cant, precio, desc: 0, ...extra });

test("suma la misma pieza a través de varios equipos", () => {
  const a = eq("e1", "S1"), b = eq("e2", "S2"), c = eq("e3", "S3");
  const r = T.resumenPiezas([
    it(a, "KNB-45L", "Batería", 1, 40),
    it(a, "MO", "Mano de obra", 1, 25),
    it(b, "knb-45l ", "Batería", 1, 40),
    it(c, "KNB-45L", "Batería", 2, 40),
  ]);
  assert.equal(r.length, 2);
  assert.deepEqual(
    { parte: r[0].parte, cant: r[0].cant, total: r[0].total, equipos: r[0].equipos },
    { parte: "KNB-45L", cant: 4, total: 160, equipos: 3 });
  assert.equal(r[1].nombre, "Mano de obra");
  assert.equal(r[1].cant, 1);
});

test("la misma pieza a dos precios sale en dos filas", () => {
  const r = T.resumenPiezas([
    it(eq("e1", "S1"), "KNB-45L", "Batería", 1, 40),
    it(eq("e2", "S2"), "KNB-45L", "Batería", 1, 35),
  ]);
  assert.equal(r.length, 2);
});

test("sin número de pieza agrupa por nombre; el total respeta el descuento por renglón", () => {
  const r = T.resumenPiezas([
    it(eq("e1", "S1"), "", "Antena", 1, 10, { desc: 10 }),
    it(eq("e2", "S2"), "", "antena", 1, 10),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].cant, 2);
  assert.equal(r[0].total, 19);
});

test("con un solo equipo (o cotización comercial) no hay resumen", () => {
  const a = eq("e1", "S1");
  assert.deepEqual(T.resumenPiezas([it(a, "X", "X", 1, 1), it(a, "X", "X", 1, 1)]), []);
  assert.deepEqual(T.resumenPiezas([{ nombre: "Radio", cant: 3, precio: 100 }]), []);
  assert.equal(T.resumenPiezasHtml([it(a, "X", "X", 1, 1)]), "");
});

test("cotizaciones viejas sin `equipo`: cuenta los equipos por `spec`", () => {
  const r = T.resumenPiezas([
    { spec: "Equipo: Serie S1 · Modelo NX", modelo: "P1", nombre: "Perilla", cant: 1, precio: 5 },
    { spec: "Equipo: Serie S2 · Modelo NX", modelo: "P1", nombre: "Perilla", cant: 1, precio: 5 },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].cant, 2);
  assert.equal(r[0].equipos, 2);
});

test("el HTML escapa y pinta el bloque", () => {
  const html = T.resumenPiezasHtml([
    it(eq("e1", "S1"), "<P1>", "Perilla", 1, 5),
    it(eq("e2", "S2"), "<P1>", "Perilla", 1, 5),
  ]);
  assert.match(html, /Resumen de piezas/);
  assert.match(html, /&lt;P1&gt;/);
  assert.match(html, /en 2 equipos/);
});
