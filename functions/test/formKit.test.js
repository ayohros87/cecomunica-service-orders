// Kit de formularios: reglas de formato puras (public/js/ui/formKit.js).
// Solo lo puro — el pegamento con el DOM (barra, guardia) se prueba a mano
// en la página piloto. Sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { esValido, VALIDA } = require("../../public/js/ui/formKit.js");

test("ruc: números, letras y guiones; al menos un número y sin espacios", () => {
  assert.equal(esValido("ruc", "155612345-2-2015"), true);
  assert.equal(esValido("ruc", "8-712-1043"), true);
  assert.equal(esValido("ruc", "8-NT-2-39271"), true, "el RUC NT del PNUD trancaba el alta (Karla, 2026-09-25)");
  assert.equal(esValido("ruc", "8-nt-2-39271"), true);
  assert.equal(esValido("ruc", "PE-12-345"), true);
  assert.equal(esValido("ruc", "E-8-123456"), true);
  assert.equal(esValido("ruc", "NT-"), false, "sin número no es un RUC");
  assert.equal(esValido("ruc", "155612345 2 2015"), false);
  assert.equal(esValido("ruc", "8-NT-2-39271."), false);
});

test("ruc: al salir del campo queda en mayúsculas", () => {
  assert.equal(VALIDA.ruc.norm(" 8-nt-2-39271 "), "8-NT-2-39271");
  assert.equal(VALIDA.ruc.norm("155612345-2-2015"), "155612345-2-2015");
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
  assert.equal(esValido("documento", "E-13077112"), true);
  assert.equal(esValido("documento", "EUSEBIO LEZCANO"), false);
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
