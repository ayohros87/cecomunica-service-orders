// Firma digital: match del firmante contra el representante registrado
// (lib/firmas.js). Sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normCedula, normNombre, firmanteCoincide, hashFirma } = require("../src/lib/firmas");

test("normalización de cédula: formato panameño con guiones y espacios", () => {
  assert.equal(normCedula("8-123-4567"), "81234567");
  assert.equal(normCedula(" 8 123 4567 "), "81234567");
  assert.equal(normCedula("PE-12-345"), "PE12345");
  assert.equal(normCedula(null), "");
});

test("normalización de nombre: tildes, mayúsculas y espacios", () => {
  assert.equal(normNombre("  María  José  Pérez "), "MARIA JOSE PEREZ");
  assert.equal(normNombre("JOSÉ ÁNGEL"), "JOSE ANGEL");
});

test("coincide por cédula aunque el nombre difiera (la cédula manda)", () => {
  assert.equal(firmanteCoincide(
    { nombre: "Maria Gomez", cedula: "8-123-4567" },
    { nombre: "María J. Gómez de Pérez", cedula: "81234567" }), true);
});

test("cédulas distintas → NO coincide aunque el nombre calce", () => {
  assert.equal(firmanteCoincide(
    { nombre: "Juan Perez", cedula: "8-111-111" },
    { nombre: "JUAN PEREZ", cedula: "8-222-222" }), false);
});

test("sin cédulas comparables decide el nombre normalizado", () => {
  assert.equal(firmanteCoincide(
    { nombre: "José Ángel Ruiz", cedula: "" },
    { nombre: "jose angel ruiz", cedula: "8-9-999" }), true);
  assert.equal(firmanteCoincide(
    { nombre: "Maria Gomez" }, { nombre: "Pedro Diaz" }), false);
});

test("vacíos nunca coinciden", () => {
  assert.equal(firmanteCoincide({}, {}), false);
  assert.equal(firmanteCoincide(null, { nombre: "X", cedula: "1" }), false);
});

test("hashFirma es estable ante formato y sensible al contenido", () => {
  const a = hashFirma({ contrato_id: "ALQ1", firmante_nombre: "María Gómez", firmante_cedula: "8-123-4567", firmado_at: "2026-08-28T10:00:00Z", total_mensual: 100 });
  const b = hashFirma({ contrato_id: "ALQ1", firmante_nombre: "MARIA GOMEZ", firmante_cedula: "81234567", firmado_at: "2026-08-28T10:00:00Z", total_mensual: 100 });
  const c = hashFirma({ contrato_id: "ALQ1", firmante_nombre: "MARIA GOMEZ", firmante_cedula: "81234567", firmado_at: "2026-08-28T10:00:00Z", total_mensual: 999 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});
