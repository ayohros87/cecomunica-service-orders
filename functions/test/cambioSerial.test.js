// domain/cambioSerial.js — las dos preguntas que deciden si una corrección de
// serial ya se puede aplicar. Se prueban a secas porque de ellas depende que
// el trigger reescriba filas del contrato: un falso positivo aquí corrige a
// medias y deja el contrato diciendo una cosa de un radio y otra del vecino.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { itemsAplicables, asignacionCompleta, normSerial } = require("../src/domain/cambioSerial");

test("aplicable: hay serial viejo, serial real y son distintos", () => {
  const g = { items: [{ serial: "26314A1691", serial_nuevo: "26314A1687" }] };
  assert.equal(itemsAplicables(g).length, 1);
});

test("el mismo serial escrito distinto NO es una corrección", () => {
  // Es el caso que más se va a colar: bodega re-teclea lo mismo con un guion.
  const g = { items: [{ serial: "26314A1691", serial_nuevo: " 26314-a1691 " }] };
  assert.deepEqual(itemsAplicables(g), []);
});

test("sin serial real todavía no hay nada que aplicar", () => {
  assert.deepEqual(itemsAplicables({ items: [{ serial: "B1300455", serial_nuevo: null }] }), []);
  assert.deepEqual(itemsAplicables({ items: [{ serial: "B1300455", serial_nuevo: "   " }] }), []);
});

test("un ítem sin el serial viejo no se toca (no se sabe qué corregir)", () => {
  assert.deepEqual(itemsAplicables({ items: [{ serial: "", serial_nuevo: "B1300455" }] }), []);
});

test("asignacionCompleta exige TODOS los ítems, no la mayoría", () => {
  const dos = (a, b) => ({ items: [{ serial: "X1", serial_nuevo: a }, { serial: "X2", serial_nuevo: b }] });
  assert.equal(asignacionCompleta(dos("A1", "A2")), true);
  assert.equal(asignacionCompleta(dos("A1", null)), false);
  assert.equal(asignacionCompleta(dos("A1", "")), false);
});

test("una gestión sin ítems nunca está completa (no se cierra sola en vacío)", () => {
  assert.equal(asignacionCompleta({ items: [] }), false);
  assert.equal(asignacionCompleta({}), false);
  assert.equal(asignacionCompleta(null), false);
});

test("la propuesta de quien la abre cuenta igual que la de bodega", () => {
  // El serial real lo puede proponer recepción al abrir la gestión; bodega lo
  // confirma. Para estas dos preguntas el origen da igual: lo que importa es
  // que el dato esté (el candado de quién escribe vive en las reglas).
  const g = { items: [{ serial: "26314A1691", serial_nuevo: "26314A1687", serial_nuevo_propuesto: true }] };
  assert.equal(asignacionCompleta(g), true);
  assert.equal(itemsAplicables(g).length, 1);
});

test("normSerial es la misma identidad del pool (mayúsculas, sin separadores)", () => {
  assert.equal(normSerial(" 8j4k-022 45 "), "8J4K02245");
  assert.equal(normSerial(null), "");
});
