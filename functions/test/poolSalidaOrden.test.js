// Salida del taller SIN entrega — regresión de PROP20260731-01/-02 (2026-08-05).
//
// Un equipo que se quita de una orden viva (o cuya orden se elimina) NUNCA se
// entregó al cliente, pero el trigger lo mandaba a `en_cliente` de todas
// formas. Combinado con que onSerialWrite no podía liberar una unidad en_taller
// al corregir los seriales del contrato, 12 radios que nunca salieron de bodega
// quedaron registrados como colocados en el cliente (24 fichas para un contrato
// de 12). Este test fija la decisión de destino.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-salida-orden" });
const pool = require("../src/domain/equiposPool");

const { destinoAlSalirDeOrden, ESTADOS } = pool;
const conContrato = { asignacion: { contrato_doc_id: "abc123" }, propiedad: "cecomunica" };
const sinContrato = { asignacion: null, propiedad: "cecomunica" };
const delCliente  = { asignacion: null, propiedad: "cliente" };

test("respeta el estado del que salió (kardex)", () => {
  assert.equal(destinoAlSalirDeOrden(sinContrato, ESTADOS.EN_BODEGA), ESTADOS.EN_BODEGA);
  assert.equal(destinoAlSalirDeOrden(delCliente, ESTADOS.EN_CLIENTE), ESTADOS.EN_CLIENTE);
  assert.equal(destinoAlSalirDeOrden(conContrato, ESTADOS.ASIGNADO), ESTADOS.ASIGNADO);
  assert.equal(destinoAlSalirDeOrden(conContrato, ESTADOS.VENDIDO), ESTADOS.VENDIDO);
});

test("el caso del incidente: entró desde asignado y ya no tiene contrato → bodega", () => {
  // onSerialWrite soltó la asignación mientras la unidad estaba en el taller.
  // "asignado_contrato sin contrato" no existe: la unidad vuelve al estante.
  assert.equal(destinoAlSalirDeOrden(sinContrato, ESTADOS.ASIGNADO), ESTADOS.EN_BODEGA);
});

test("sin rastro en el kardex se infiere de la ficha", () => {
  assert.equal(destinoAlSalirDeOrden(conContrato, null), ESTADOS.ASIGNADO);
  assert.equal(destinoAlSalirDeOrden(delCliente, null), ESTADOS.EN_CLIENTE);
  assert.equal(destinoAlSalirDeOrden(sinContrato, null), ESTADOS.EN_BODEGA);
});

test("nunca devuelve en_taller (saldría de la orden para quedarse en ella)", () => {
  assert.notEqual(destinoAlSalirDeOrden(sinContrato, ESTADOS.EN_TALLER), ESTADOS.EN_TALLER);
  assert.equal(destinoAlSalirDeOrden(sinContrato, ESTADOS.EN_TALLER), ESTADOS.EN_BODEGA);
});

test("flota nuestra sin contrato nunca cae en en_cliente por defecto", () => {
  // La regresión original: cualquier equipo removido terminaba 'en_cliente' y
  // desaparecía del inventario disponible sin que nadie lo notara.
  for (const previo of [null, undefined, ESTADOS.EN_BODEGA, ESTADOS.ASIGNADO]) {
    assert.notEqual(destinoAlSalirDeOrden(sinContrato, previo), ESTADOS.EN_CLIENTE);
  }
});

test("tolera fichas vacías sin reventar", () => {
  assert.equal(destinoAlSalirDeOrden(null, null), ESTADOS.EN_BODEGA);
  assert.equal(destinoAlSalirDeOrden({}, null), ESTADOS.EN_BODEGA);
  assert.equal(destinoAlSalirDeOrden({ asignacion: {} }, null), ESTADOS.EN_BODEGA);
});
