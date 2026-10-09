// Aviso de la anulación de una gestión (2026-10-09, caso FORTALEZA).
//
// FORTALEZA anuló el aumento GA20260925-01 y los 5 PNC360S-R siguieron
// vendidos y en el POC: habían salido por VENTA DIRECTA (factura 10848, OS
// 2026092801 sin contrato), no por la gestión. El correo de la anulación los
// señala; estos guardias fijan cuáles cuentan.
const test = require("node:test");
const assert = require("node:assert/strict");
const AV = require("../src/domain/anulacionGestionAviso");

const CLI = "Qd7OK7YlgMFvuWaPBuSe";
const vendido = (id, orden, extra = {}) => ({
  id, estado: "vendido", modelo_label: "HYTERA PNC360S-R", orden_actual_id: orden,
  venta: { cliente_id: CLI, factura: "FACTURA 10848" }, ...extra,
});

test("V1 — el caso FORTALEZA: vendidos colgando de una programación viva se señalan", () => {
  const r = AV.ventasSinEntregar(
    [vendido("24708A1183", "2026092801"), vendido("24708A1167", "2026092801")],
    { "2026092801": { estado_reparacion: "ASIGNADO" } }, CLI);
  assert.deepEqual(r.map(v => v.serial), ["24708A1183", "24708A1167"]);
  assert.equal(r[0].factura, "FACTURA 10848");
  assert.equal(r[0].orden, "2026092801");
});

test("V2 — lo ya entregado es del cliente: no se señala", () => {
  const r = AV.ventasSinEntregar(
    [vendido("A", "o1"), vendido("B", "o2"), vendido("C", "o3"), vendido("D", null)],
    {
      o1: { estado_reparacion: "ENTREGADO AL CLIENTE" },
      o2: { estado_reparacion: "ANULADA" },
      o3: { estado_reparacion: "ASIGNADO", eliminado: true },
    }, CLI);
  assert.deepEqual(r, []);
});

test("V3 — solo vendidos de ESTE cliente", () => {
  const ordenes = { o1: { estado_reparacion: "POR ASIGNAR" } };
  const r = AV.ventasSinEntregar([
    vendido("A", "o1", { venta: { cliente_id: "otro" } }),
    vendido("B", "o1", { estado: "en_bodega" }),
    vendido("C", "o1"),
  ], ordenes, CLI);
  assert.deepEqual(r.map(v => v.serial), ["C"]);
  assert.deepEqual(AV.ventasSinEntregar([vendido("C", "o1")], ordenes, null), []);
});

test("V4 — la propuesta del taller rechazada ya tiene su correo: no se duplica", () => {
  assert.equal(AV.debeAvisar({ estado: "anulada", tipo: "aumento" }), true);
  assert.equal(AV.debeAvisar({ estado: "anulada", tipo: "reemplazo", origen: { tipo: "taller" } }), false);
  assert.equal(AV.debeAvisar({ estado: "cerrada" }), false);
});
