// Documento de identidad del representante legal (public/js/domain/docIdentidad.js).
//
// El caso que lo pidió (Zuleika, 2026-09-18): un cliente nuevo cuyo
// representante se identifica con "Pasaporte No. 150685537". La casilla solo
// aceptaba cédula panameña y el formulario no dejaba guardar la ficha.
//
// La regla: el pasaporte se declara ESCRIBIENDO LA PALABRA; sin palabra, el
// documento es cédula, como siempre. Los casos de abajo salieron de barrer los
// 452 clientes de producción — están ahí para que nadie vuelva a "mejorar"
// esto adivinando el tipo por la forma del número.
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const D = require("../../public/js/domain/docIdentidad.js");

test("cédula: se acepta y se nombra 'cédula'", () => {
  for (const v of ["8-712-1043", "PE-12-345", "E-8-91234", "N-20-123", "8-NT-1-234",
    "E-13077112"]) {
    assert.equal(D.esValido(v), true, v);
    assert.equal(D.etiqueta(v), "cédula", v);
  }
  assert.equal(D.frase("8-712-1043"), "cédula 8-712-1043");
  assert.equal(D.limpiar("Céd. 8-712-1043"), "8-712-1043", "la palabra 'cédula' sobra: es el caso normal");
});

test("pasaporte: la palabra ES la declaración", () => {
  assert.equal(D.esValido("Pasaporte No. 150685537"), true);
  assert.equal(D.limpiar("Pasaporte No. 150685537"), "PASAPORTE 150685537");
  assert.equal(D.limpiar("PASAPORTE: XDB367055"), "PASAPORTE XDB367055", "5 fichas de producción venían así");
  assert.equal(D.frase("PASAPORTE 150685537"), "pasaporte 150685537");
  assert.equal(D.numero("PASAPORTE 150685537"), "150685537", "se compara el número, no la palabra");
  assert.equal(D.tipo("PASAPORTE 150685537"), "pasaporte");
});

test("sin la palabra NO se adivina: el número pelado sigue siendo cédula", () => {
  // Los ambiguos de producción: a ojo son cédulas sin guiones. Llamarlos
  // pasaporte sería una declaración falsa en un contrato firmado.
  for (const v of ["8928240", "62255978", "15406942", "107230214", "150685537"]) {
    assert.equal(D.esValido(v), true, v);
    assert.equal(D.etiqueta(v), "cédula", `${v}: sin palabra no se declara pasaporte`);
  }
  assert.equal(D.frase("150685537"), "cédula 150685537");
});

test("qué se rechaza: lo que no es un documento", () => {
  assert.equal(D.esValido(""), true, "vacío no es error: lo obligatorio lo decide el formulario");
  assert.equal(D.esValido("   "), true);
  assert.equal(D.esValido("EUSEBIO LEZCANO CANDANEDO"), false, "un nombre en la casilla del documento");
  assert.equal(D.esValido("-"), false);
  assert.equal(D.esValido("8"), false, "un dígito suelto no es documento");
  assert.equal(D.esValido("ABCDE"), false, "sin un solo número no es documento");
});

test("lo feo que ya está guardado se deja pasar: corregirlo es de a uno", () => {
  // Rechazarlos trancaba la ficha entera para cualquier otra corrección.
  assert.equal(D.esValido("8-243--921"), true, "guion de más, pero es un documento");
  assert.equal(D.esValido("2031170-1-74884"), true, "un RUC en la casilla: feo, no basura");
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
    assert.match(html, /PASAPORTE 150685537/, `${p}: la ayuda ya no enseña a declarar el pasaporte`);
  }
});

test("un dato viejo que nadie tocó no tranca el guardado", () => {
  const fk = leer("public", "js", "ui", "formKit.js");
  assert.match(fk, /if \(!validarCampo\(el\) && sucios\.has\(el\) && !primero\)/,
    "volvió a trancar la ficha por un campo heredado que el usuario no editó");
});

test("el contrato nombra el documento por lo que es", () => {
  const doc = leer("public", "js", "pages", "contrato-documento.js");
  assert.match(doc, /DocIdentidad\.frase/, "el documento v2 volvió a imprimir 'cédula' fijo");
  const firmar = leer("public", "firmar", "index.html");
  assert.match(firmar, /DocIdentidad\.frase/, "la página de firma volvió a imprimir 'cédula' fijo");
  assert.match(firmar, /DocIdentidad\.limpiar/, "la firma dejó de normalizar el documento declarado");
});
