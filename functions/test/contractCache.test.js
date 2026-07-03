// Tests de la lógica PURA del contador de contratos (sin Firestore).
// Corre con `node --test` (built-in, sin dependencias).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { contarDesdeCache } = require("../src/domain/contadorContrato");

test("sin órdenes → contador en cero", () => {
  assert.deepEqual(contarDesdeCache([]), { osCount: 0, equiposTotal: 0, tieneOs: false });
  assert.deepEqual(contarDesdeCache(null), { osCount: 0, equiposTotal: 0, tieneOs: false });
});

test("cuenta solo las vigentes y suma sus equipos", () => {
  const docs = [
    { equipos_count: 3 },
    { equipos_count: 2 },
    { equipos_count: 5 },
  ];
  assert.deepEqual(contarDesdeCache(docs), { osCount: 3, equiposTotal: 10, tieneOs: true });
});

test("excluye órdenes marcadas eliminado (no cuentan ni suman)", () => {
  const docs = [
    { equipos_count: 3 },
    { equipos_count: 4, eliminado: true }, // no cuenta
    { equipos_count: 2 },
  ];
  assert.deepEqual(contarDesdeCache(docs), { osCount: 2, equiposTotal: 5, tieneOs: true });
});

test("equipos_count ausente o inválido se trata como 0", () => {
  const docs = [
    {},                         // sin equipos_count
    { equipos_count: null },
    { equipos_count: "x" },     // NaN → 0
    { equipos_count: 4 },
  ];
  assert.deepEqual(contarDesdeCache(docs), { osCount: 4, equiposTotal: 4, tieneOs: true });
});

test("entradas nulas en el arreglo se saltan sin romper", () => {
  const docs = [null, { equipos_count: 1 }, undefined, { equipos_count: 2 }];
  assert.deepEqual(contarDesdeCache(docs), { osCount: 2, equiposTotal: 3, tieneOs: true });
});

test("todas eliminadas → tieneOs false y ceros", () => {
  const docs = [
    { equipos_count: 3, eliminado: true },
    { equipos_count: 2, eliminado: true },
  ];
  assert.deepEqual(contarDesdeCache(docs), { osCount: 0, equiposTotal: 0, tieneOs: false });
});
