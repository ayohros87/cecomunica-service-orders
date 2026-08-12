// Invariante de custodia (informe tracking 2026-08-12, P3.2): una unidad
// en_cliente sin cliente en la asignación queda MARCADA (custodia_faltante),
// nunca bloqueada — y la marca se borra sola en cuanto aparece la custodia o
// el estado deja de ser en_cliente. La brecha que motiva esto: 1,918 unidades
// en_cliente sin contrato y 16 sin asignación de ningún tipo.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-custodia" });
const pool = require("../src/domain/equiposPool");

const { custodiaPatch, ESTADOS } = pool;
const conCliente = { cliente_id: "abc", cliente_nombre: "ACME" };
const soloNombre = { cliente_id: "", cliente_nombre: "ACME (papel)" };
const vacia = { cliente_id: "", cliente_nombre: "" };

test("en_cliente sin asignación → marca", () => {
  assert.deepEqual(custodiaPatch(ESTADOS.EN_CLIENTE, null), { custodia_faltante: true });
  assert.deepEqual(custodiaPatch(ESTADOS.EN_CLIENTE, undefined), { custodia_faltante: true });
  assert.deepEqual(custodiaPatch(ESTADOS.EN_CLIENTE, vacia), { custodia_faltante: true });
});

test("en_cliente con cliente → no marca", () => {
  assert.deepEqual(custodiaPatch(ESTADOS.EN_CLIENTE, conCliente), {});
  // La custodia de papel (solo nombre, sin id) también cuenta: hay un humano
  // identificable detrás.
  assert.deepEqual(custodiaPatch(ESTADOS.EN_CLIENTE, soloNombre), {});
});

test("otros estados sin asignación → no marca (bodega no tiene dueño)", () => {
  assert.deepEqual(custodiaPatch(ESTADOS.EN_BODEGA, null), {});
  assert.deepEqual(custodiaPatch(ESTADOS.EN_TALLER, null), {});
  assert.deepEqual(custodiaPatch(ESTADOS.DEVUELTO, null), {});
});

test("la marca se borra al ganar custodia o salir de en_cliente", () => {
  const marcada = { custodia_faltante: true };
  // Gana cliente estando en_cliente → borra.
  const p1 = custodiaPatch(ESTADOS.EN_CLIENTE, conCliente, marcada);
  assert.ok(p1.custodia_faltante, "debe traer el delete()");
  assert.notEqual(p1.custodia_faltante, true);
  // Vuelve a bodega → borra aunque siga sin asignación.
  const p2 = custodiaPatch(ESTADOS.EN_BODEGA, null, marcada);
  assert.ok(p2.custodia_faltante);
  assert.notEqual(p2.custodia_faltante, true);
});

test("sin marca previa y fuera de en_cliente → parche vacío (no ensucia el doc)", () => {
  assert.deepEqual(custodiaPatch(ESTADOS.EN_BODEGA, conCliente, {}), {});
  assert.deepEqual(custodiaPatch(ESTADOS.ASIGNADO, null, {}), {});
});

test("en creación (actual={}) nunca devuelve delete() — un create no lo admite", () => {
  assert.deepEqual(custodiaPatch(ESTADOS.EN_CLIENTE, conCliente, {}), {});
  assert.deepEqual(custodiaPatch(ESTADOS.EN_CLIENTE, null, {}), { custodia_faltante: true });
});
