// Factura de venta con contrato ("Propio") — caso Zuleika 2026-09-03: cuando
// el contrato nace primero y bodega asigna los seriales, la factura QBO que
// Recepción emite después no tenía dónde asociarse (el asistente de venta solo
// acepta unidades en_bodega). Ahora la factura vive en contratos.factura_venta
// y cada unidad del pool la hereda vía facturaVentaPatch — SIN tocar el estado
// (el ciclo del contrato manda) y sin colarse en el feed "Órdenes por crear".
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-factura-venta" });
const pool = require("../src/domain/equiposPool");

const { facturaVentaPatch } = pool;

const OPTS = {
  factura: "001-0000010274",
  cliente_id: "cli1",
  cliente_nombre: "ACME",
  contrato_doc_id: "abc123",
  contrato_id: "PROP20260901-01",
};

test("unidad asignada sin venta → estampa venta.* y propiedad cliente", () => {
  const patch = facturaVentaPatch({ estado: "asignado_contrato" }, OPTS);
  assert.deepEqual(patch, {
    "venta.factura":         "001-0000010274",
    "venta.cliente_id":      "cli1",
    "venta.cliente_nombre":  "ACME",
    "venta.contrato_doc_id": "abc123",
    "venta.contrato_id":     "PROP20260901-01",
    "venta.origen":          "contrato",
    propiedad: "cliente",
  });
});

test("NUNCA toca el estado ni estampa orden_programacion_id", () => {
  // El feed "Órdenes por crear" consulta venta.orden_programacion_id == null
  // sobre estado 'vendido': estas ventas ni cumplen el estado ni llevan el
  // campo — el campo ausente no matchea la query de Firestore.
  const patch = facturaVentaPatch({ estado: "en_cliente" }, OPTS);
  assert.ok(!("estado" in patch));
  assert.ok(!("venta.orden_programacion_id" in patch));
  assert.ok(!("venta" in patch)); // dot-paths, no un mapa que pise el existente
});

test("idempotente: la misma factura ya puesta → null (onSerialWrite re-corre)", () => {
  const actual = { estado: "asignado_contrato", venta: { factura: "001-0000010274" } };
  assert.equal(facturaVentaPatch(actual, OPTS), null);
});

test("corrección: otra factura ya puesta → se sobreescribe", () => {
  const actual = { estado: "en_cliente", venta: { factura: "001-0000009999", orden_programacion_id: "OS-1" } };
  const patch = facturaVentaPatch(actual, OPTS);
  assert.equal(patch["venta.factura"], "001-0000010274");
  // dot-paths: orden_programacion_id del doc sobrevive porque no se lista.
  assert.ok(!("venta.orden_programacion_id" in patch));
});

test("factura vacía o solo espacios → null (nada que estampar)", () => {
  assert.equal(facturaVentaPatch({}, { ...OPTS, factura: "" }), null);
  assert.equal(facturaVentaPatch({}, { ...OPTS, factura: "   " }), null);
  assert.equal(facturaVentaPatch({}, {}), null);
});

test("doc sin venta previa y opts mínimos → campos vacíos seguros", () => {
  const patch = facturaVentaPatch(null, { factura: " F-1 " });
  assert.equal(patch["venta.factura"], "F-1"); // trim
  assert.equal(patch["venta.cliente_id"], "");
  assert.equal(patch["venta.contrato_doc_id"], null);
});
