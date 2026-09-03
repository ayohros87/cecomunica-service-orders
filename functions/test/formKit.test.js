// Kit de formularios: reglas de formato puras (public/js/ui/formKit.js).
// Solo lo puro — el pegamento con el DOM (barra, guardia) se prueba a mano
// en la página piloto. Sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { esValido, VALIDA } = require("../../public/js/ui/formKit.js");

test("ruc: números y guiones; letras no", () => {
  assert.equal(esValido("ruc", "155612345-2-2015"), true);
  assert.equal(esValido("ruc", "8-712-1043"), true);
  assert.equal(esValido("ruc", "ABC-123"), false);
  assert.equal(esValido("ruc", "155612345 2 2015"), false);
});

test("dv: 1 o 2 dígitos", () => {
  assert.equal(esValido("dv", "8"), true);
  assert.equal(esValido("dv", "86"), true);
  assert.equal(esValido("dv", "860"), false);
  assert.equal(esValido("dv", "8a"), false);
});

test("cédula panameña: provincia, PE/E/N", () => {
  assert.equal(esValido("cedula", "8-712-1043"), true);
  assert.equal(esValido("cedula", "PE-12-345"), true);
  assert.equal(esValido("cedula", "pe-12-345"), true);
  assert.equal(esValido("cedula", "E-8-91234"), true);
  assert.equal(esValido("cedula", "8712043"), false);
  assert.equal(esValido("cedula", "8-712"), false);
});

test("teléfono: dígitos, espacios, guiones y prefijo +", () => {
  assert.equal(esValido("tel", "+507 6674-2210"), true);
  assert.equal(esValido("tel", "6674-2210"), true);
  assert.equal(esValido("tel", "tel: 6674"), false);
});

test("vacío: solo falla si el campo es requerido", () => {
  assert.equal(esValido("ruc", "", { requerido: false }), true);
  assert.equal(esValido("ruc", "  ", { requerido: true }), false);
  assert.equal(esValido(undefined, "", { requerido: true }), false);
  assert.equal(esValido(undefined, "algo", { requerido: true }), true);
});

test("tipo sin regla registrada: cualquier valor no vacío pasa", () => {
  assert.equal(esValido("inexistente", "lo que sea"), true);
  assert.ok(!("inexistente" in VALIDA));
});
