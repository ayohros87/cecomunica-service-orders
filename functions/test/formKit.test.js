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

// El detalle del formato vive en functions/test/docIdentidad.test.js; aquí
// solo que el kit delegue en esa regla (y no estorbe si no está cargada).
test("documento: cédula panameña o pasaporte", () => {
  global.DocIdentidad = require("../../public/js/domain/docIdentidad.js");
  assert.equal(esValido("documento", "8-712-1043"), true);
  assert.equal(esValido("documento", "PE-12-345"), true);
  assert.equal(esValido("documento", "150685537"), true, "el pasaporte trancaba la ficha");
  assert.equal(esValido("documento", "Pasaporte No. 150685537"), true);
  assert.equal(esValido("documento", "8-712"), false);
  delete global.DocIdentidad;
  assert.equal(esValido("documento", "lo que sea"), true, "sin docIdentidad el campo no estorba");
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
