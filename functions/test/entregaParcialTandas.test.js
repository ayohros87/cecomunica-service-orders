// Entrega parcial por tandas — qué unidades entrega CADA escritura.
//
// El riesgo que fija este test: la orden NO cambia de estado cuando se
// entrega una tanda (sigue COMPLETADO a propósito), así que el pool es lo
// único que registra que esos radios salieron. Si `tandasNuevas` devuelve de
// más, el kardex se llena de intentos sobre radios ya entregados; si devuelve
// de menos, hay radios en manos del cliente que el inventario sigue contando
// como nuestros — el error caro.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { tandasNuevas, serialesEntregadosAhora } = require("../src/domain/entregaTandas");

const orden = (...tandas) => ({
  estado_reparacion: "COMPLETADO (EN OFICINA)",
  entrega: { tandas },
});
const tanda = (n, ...seriales) => ({
  n, numero: `2026090812-E${n}`,
  equipos: seriales.map((s) => ({ id: "id-" + s, serial: s })),
});

test("la primera tanda entrega solo sus seriales", () => {
  const r = tandasNuevas(orden(), orden(tanda(1, "A1", "A2")));
  assert.equal(r.length, 1);
  assert.equal(r[0].numero, "2026090812-E1");
  assert.deepEqual(r[0].equipos.map((e) => e.serial), ["A1", "A2"]);
});

test("una segunda tanda NO reprocesa la primera", () => {
  const antes = orden(tanda(1, "A1", "A2"));
  const despues = orden(tanda(1, "A1", "A2"), tanda(2, "B1"));
  assert.deepEqual(serialesEntregadosAhora(antes, despues), ["B1"]);
});

test("una escritura que no toca las tandas no entrega nada", () => {
  // El caso más frecuente: cualquier edición de la orden (notas, fotos,
  // consumos) dispara el trigger. Ninguna puede volver a sacar radios.
  const igual = orden(tanda(1, "A1"));
  assert.deepEqual(tandasNuevas(igual, orden(tanda(1, "A1"))), []);
  assert.deepEqual(serialesEntregadosAhora(igual, igual), []);
});

test("varias tandas de golpe se entregan todas", () => {
  const r = tandasNuevas(orden(tanda(1, "A1")), orden(tanda(1, "A1"), tanda(2, "B1"), tanda(3, "C1")));
  assert.deepEqual(r.map((t) => t.numero), ["2026090812-E2", "2026090812-E3"]);
  assert.deepEqual(serialesEntregadosAhora(orden(tanda(1, "A1")),
    orden(tanda(1, "A1"), tanda(2, "B1"), tanda(3, "C1"))), ["B1", "C1"]);
});

test("una orden sin tandas nunca entrega por esta vía", () => {
  // La entrega COMPLETA es la transición a ENTREGADO y tiene su propia rama:
  // si esta también moviera unidades, cada radio saldría dos veces.
  assert.deepEqual(tandasNuevas(null, { estado_reparacion: "ENTREGADO AL CLIENTE" }), []);
  assert.deepEqual(tandasNuevas({}, {}), []);
});

test("el borrado de la orden no entrega nada", () => {
  assert.deepEqual(tandasNuevas(orden(tanda(1, "A1")), null), []);
});

test("un array que ENCOGE (corrección de admin) no reprocesa el prefijo", () => {
  // Las rules dejan a admin corregir a mano. Si al quitar una tanda
  // recorriéramos el prefijo por diferencia de tamaños, volveríamos a
  // "entregar" radios al azar.
  assert.deepEqual(tandasNuevas(orden(tanda(1, "A1"), tanda(2, "B1")), orden(tanda(1, "A1"))), []);
});

test("aguanta tandas mal formadas sin reventar el trigger", () => {
  // El trigger corre sobre datos históricos y sobre lo que escriba cualquier
  // versión del front: una tanda sin equipos no puede tumbar la sincronía
  // del pool para el resto de la orden.
  const raro = { entrega: { tandas: [{ n: 1 }, { n: 2, equipos: null }, { n: 3, equipos: [{}, { serial: "  " }, { serial: " C9 " }] }] } };
  const r = tandasNuevas({}, raro);
  assert.equal(r.length, 3);
  assert.deepEqual(r[0].equipos, []);
  assert.deepEqual(r[1].equipos, []);
  assert.deepEqual(r[2].equipos.map((e) => e.serial), ["C9"]);   // recortado
});

test("una tanda sin numero cae a una etiqueta legible", () => {
  const r = tandasNuevas({}, { entrega: { tandas: [{ n: 4, equipos: [{ serial: "Z1" }] }] } });
  assert.equal(r[0].numero, "E4");
});

test("`entrega` sin tandas (o con basura) se trata como vacío", () => {
  assert.deepEqual(tandasNuevas({}, { entrega: {} }), []);
  assert.deepEqual(tandasNuevas({}, { entrega: { tandas: "nope" } }), []);
});
