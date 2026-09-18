// Documento de identidad del representante legal (public/js/domain/docIdentidad.js).
//
// El caso que lo pidió (Zuleika, 2026-09-18): un cliente nuevo cuyo
// representante se identifica con "Pasaporte No. 150685537". La casilla solo
// aceptaba cédula panameña y el formulario no dejaba guardar la ficha.
//
// Se prueba lo PURO y, como espejo de sincronía, que las dos puntas sigan
// puestas: la regla del formulario (formKit) y la palabra del contrato.
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const D = require("../../public/js/domain/docIdentidad.js");

test("cédula panameña: se acepta y se nombra 'cédula'", () => {
  for (const v of ["8-712-1043", "PE-12-345", "E-8-91234", "N-20-123", "8-NT-1-234"]) {
    assert.equal(D.esValido(v), true, v);
    assert.equal(D.etiqueta(v), "cédula", v);
  }
  assert.equal(D.frase("8-712-1043"), "cédula 8-712-1043");
});

test("pasaporte: el caso que trancaba la ficha", () => {
  assert.equal(D.esValido("150685537"), true);
  assert.equal(D.etiqueta("150685537"), "pasaporte");
  assert.equal(D.frase("150685537"), "pasaporte 150685537");
  assert.equal(D.esValido("PA1234567"), true);
  assert.equal(D.frase("pa1234567"), "pasaporte PA1234567");
});

test("la palabra escrita delante se quita, no se rechaza", () => {
  assert.equal(D.limpiar("Pasaporte No. 150685537"), "150685537");
  assert.equal(D.limpiar("PASAPORTE 150685537"), "150685537");
  assert.equal(D.limpiar("Céd. 8-712-1043"), "8-712-1043");
  assert.equal(D.limpiar("cedula: 8-712-1043"), "8-712-1043");
  assert.equal(D.limpiar("  8-712-1043  "), "8-712-1043");
  // Se guarda el número; la palabra se vuelve a derivar al imprimir.
  assert.equal(D.frase("Pasaporte No. 150685537"), "pasaporte 150685537");
  assert.equal(D.esValido("Pasaporte No. 150685537"), true);
});

test("basura y vacío", () => {
  assert.equal(D.esValido(""), true, "vacío no es error: lo obligatorio lo decide el formulario");
  assert.equal(D.esValido("   "), true);
  assert.equal(D.esValido("123"), false, "demasiado corto para ser pasaporte");
  assert.equal(D.esValido("no tengo"), false, "con espacios adentro no es documento");
  assert.equal(D.esValido("8-712-1043-99-77-55"), false, "más bloques que una cédula");
  assert.equal(D.tipo("123"), "");
});

test("el vacío deja la raya para llenar a mano en el contrato", () => {
  assert.equal(D.frase(""), "cédula ________________");
  assert.equal(D.frase("", "—"), "cédula —");
});

// ── Espejo de sincronía: las puntas que dependen de esta lógica ──
test("el formulario usa la regla 'documento', no la vieja de cédula", () => {
  const fk = leer("public", "js", "ui", "formKit.js");
  assert.match(fk, /documento:\s*\{/, "formKit perdió la regla 'documento'");
  assert.doesNotMatch(fk, /\n\s*cedula:\s*\{/, "volvió la regla que solo aceptaba cédula panameña");
  for (const p of ["public/clientes/ficha.html", "public/contratos/nuevo-cliente.html"]) {
    const html = leer(...p.split("/"));
    assert.match(html, /id="representante_cedula"[^>]*data-fk-valida="documento"/,
      `${p}: la casilla volvió a exigir cédula`);
    assert.match(html, /domain\/docIdentidad\.js/, `${p}: falta cargar docIdentidad.js`);
  }
});

test("el contrato nombra el documento por lo que es", () => {
  const doc = leer("public", "js", "pages", "contrato-documento.js");
  assert.match(doc, /DocIdentidad\.frase/, "el documento v2 volvió a imprimir 'cédula' fijo");
  const firmar = leer("public", "firmar", "index.html");
  assert.match(firmar, /DocIdentidad\.frase/, "la página de firma volvió a imprimir 'cédula' fijo");
  assert.match(firmar, /DocIdentidad\.limpiar/, "la firma dejó de normalizar el documento declarado");
});
