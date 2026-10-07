const test = require("node:test");
const assert = require("node:assert");
const { requiereFacturaVenta, CORTE } = require("../src/domain/facturaVentaRequerida");

const despues = new Date(CORTE.getTime() + 3600e3);
const antes = new Date(CORTE.getTime() - 3600e3);
const serv = (f = despues) => ({ tipo_contrato: "Servicio", codigo_tipo: "SERV", fecha_creacion: f });
const deBodega = { estado: "en_bodega", propiedad: "cecomunica" };

test("SERV nuevo: radio de bodega a línea propio exige factura", () => {
  assert.strictEqual(requiereFacturaVenta({ contrato: serv(), propiedadLinea: "cliente", unidad: deBodega }), true);
});

test("contrato creado antes del corte no se bloquea", () => {
  assert.strictEqual(requiereFacturaVenta({ contrato: serv(antes), propiedadLinea: "cliente", unidad: deBodega }), false);
});

test("línea de alquiler no es venta", () => {
  assert.strictEqual(requiereFacturaVenta({ contrato: serv(), propiedadLinea: "cecomunica", unidad: deBodega }), false);
});

test("radio que el cliente ya tenía (custodia, comprado antes o traído) no es venta", () => {
  assert.strictEqual(requiereFacturaVenta({ contrato: serv(), propiedadLinea: "cliente", unidad: { estado: "en_cliente", propiedad: "cliente" } }), false);
  assert.strictEqual(requiereFacturaVenta({ contrato: serv(), propiedadLinea: "cliente", unidad: { estado: "en_bodega", propietario: { cliente_id: "c1" } } }), false);
  assert.strictEqual(requiereFacturaVenta({ contrato: serv(), propiedadLinea: "cliente", unidad: { estado: "en_bodega", propiedad: "cliente" } }), false);
});

test("serial sin ficha en el pool no se presume venta", () => {
  assert.strictEqual(requiereFacturaVenta({ contrato: serv(), propiedadLinea: "cliente", unidad: null }), false);
});

test("PROP sigue con su candado por tipo, no por esta marca", () => {
  assert.strictEqual(requiereFacturaVenta({ contrato: { tipo_contrato: "Propio", fecha_creacion: despues }, propiedadLinea: "cliente", unidad: deBodega }), false);
});

test("acepta Timestamp de Firestore", () => {
  const ts = { toDate: () => despues };
  assert.strictEqual(requiereFacturaVenta({ contrato: { ...serv(), fecha_creacion: ts }, propiedadLinea: "cliente", unidad: deBodega }), true);
});
