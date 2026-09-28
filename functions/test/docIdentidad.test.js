// Documento de identidad del representante legal (public/js/domain/docIdentidad.js).
//
// El caso que lo pidió (Zuleika, 2026-09-18): un cliente nuevo cuyo
// representante se identifica con "Pasaporte No. 150685537". La casilla solo
// aceptaba cédula panameña y el formulario no dejaba guardar la ficha.
//
// LA REGLA: qué documento es lo CONTESTA EL VENDEDOR en el selector
// (`representante_doc_tipo`), y el contrato imprime esa palabra. El sistema no
// lo deduce del número ni de cómo esté escrito. Lo que sigue aquí es el
// respaldo para las fichas viejas, que no tienen selector — y los casos salen
// del barrido de los 452 clientes de producción.
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { textoScripts } = require("./_helpers/entryScripts");
const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const D = require("../../public/js/domain/docIdentidad.js");

test("manda el tipo que contestó el vendedor", () => {
  assert.equal(D.frase("150685537", "pasaporte"), "pasaporte 150685537");
  assert.equal(D.frase("8-712-1043", "cedula"), "cédula 8-712-1043");
  // Y manda aunque el texto diga otra cosa: el selector es la respuesta.
  assert.equal(D.frase("PASAPORTE 150685537", "cedula"), "cédula 150685537");
  assert.equal(D.etiqueta("8-712-1043", "pasaporte"), "pasaporte");
});

test("ficha vieja sin selector: la palabra escrita, y si no, cédula", () => {
  // 5 fichas de producción traen "PASAPORTE: XDB367055" metido en el número.
  assert.equal(D.frase("PASAPORTE: XDB367055"), "pasaporte XDB367055");
  assert.equal(D.frase("Pasaporte No. 150685537"), "pasaporte 150685537");
  // Los 4 ambiguos: a ojo son cédulas sin guiones. Sin respuesta se imprimen
  // como siempre — declararlos pasaporte sería una declaración falsa.
  for (const v of ["8928240", "62255978", "15406942", "107230214"]) {
    assert.equal(D.etiqueta(v), "cédula", `${v}: nadie contestó, no se adivina`);
  }
  assert.equal(D.frase("8-712-1043"), "cédula 8-712-1043");
});

test("el número se guarda pelado: la palabra no vive dentro del dato", () => {
  assert.equal(D.limpiar("Pasaporte No. 150685537"), "150685537");
  assert.equal(D.limpiar("PASAPORTE: XDB367055"), "XDB367055");
  assert.equal(D.limpiar("Céd. 8-712-1043"), "8-712-1043");
  assert.equal(D.limpiar("  pe-12-345 "), "PE-12-345");
  // Pegar la palabra en la casilla mueve el selector (lo hace la página).
  assert.equal(D.traePalabraPasaporte("Pasaporte No. 150685537"), true);
  assert.equal(D.traePalabraPasaporte("8-712-1043"), false);
});

test("qué número se acepta", () => {
  for (const v of ["8-712-1043", "PE-12-345", "E-8-91234", "N-20-123", "8-NT-1-234",
    "E-13077112", "150685537", "XDB367055"]) {
    assert.equal(D.esValido(v), true, v);
  }
  assert.equal(D.esValido(""), true, "vacío no es error: lo obligatorio lo decide el formulario");
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
  assert.equal(D.frase("", "pasaporte"), "cédula ________________");
});

// ── Espejo de sincronía: las puntas que dependen de esta lógica ──
test("los formularios PREGUNTAN el tipo de documento", () => {
  // Un solo formulario de cliente (auditoría UX 2026-09-28, T9): el viejo
  // contratos/nuevo-cliente.html solo redirige a la ficha, conservando ?id=.
  const viejo = leer("public", "contratos", "nuevo-cliente.html");
  assert.match(viejo, /clientes\/ficha\.html\?/, "contratos/nuevo-cliente.html debe redirigir a la ficha");
  assert.doesNotMatch(viejo, /id="representante_cedula"/, "volvió el segundo formulario de cliente");
  for (const p of ["public/clientes/ficha.html"]) {
    const html = leer(...p.split("/"));
    assert.match(html, /<select[^>]*id="representante_doc_tipo"/,
      `${p}: se fue el selector y el tipo volvería a adivinarse`);
    assert.match(html, /value="pasaporte"/, `${p}: el selector perdió la opción pasaporte`);
    assert.match(html, /id="representante_cedula"[^>]*data-fk-valida="documento"/,
      `${p}: la casilla volvió a exigir cédula`);
    // El script llega por el entry de la página (Vite), no por <script src>.
    assert.match(textoScripts(p.replace(/^public\//, "")), /domain\/docIdentidad\.js/, `${p}: falta cargar docIdentidad.js`);
  }
  // Y la respuesta viaja: ficha → cliente → contrato → documento.
  assert.match(leer("public", "js", "pages", "clientes-ficha.js"),
    /representante_doc_tipo: g\('representante_doc_tipo'\)\.value/, "la ficha no guarda la respuesta");
  assert.match(leer("public", "js", "services", "clientesService.js"),
    /'representante_doc_tipo' in raw/,
    "el payload canónico volvería a pisar el tipo de una ficha que nadie preguntó");
  assert.match(leer("public", "js", "domain", "contratoTarifario.js"),
    /representante_doc_tipo:/, "el contrato no congela el tipo");
  assert.match(leer("public", "js", "pages", "contrato-documento.js"),
    /DocIdentidad\.frase\(c\.representante_cedula, c\.representante_doc_tipo\)/,
    "el documento v2 volvió a imprimir 'cédula' fijo");
  assert.match(leer("functions", "src", "domain", "clientesHistorial.js"),
    /representante_doc_tipo/, "cambiar el tipo no quedaría en el historial de la ficha");
  assert.match(leer("firestore.rules"),
    /representante_doc_tipo/, "cambiar el tipo no está protegido como dato de identidad");
});

test("la página de firma también pregunta, no deduce", () => {
  const firmar = leer("public", "firmar", "index.html");
  assert.match(firmar, /<select id="fDocTipo">/, "el firmante ya no declara qué documento presenta");
  assert.match(firmar, /doc_tipo: docTipo/, "la declaración no viaja con la firma");
  assert.match(firmar, /DocIdentidad\.limpiar/, "la firma dejó de normalizar el número declarado");
  assert.match(leer("functions", "src", "triggers", "firmas", "onFirmaContrato.js"),
    /representante_doc_tipo: after\.firma\.doc_tipo/, "la ficha no aprende el tipo que declaró quien firmó");
});

test("un dato viejo que nadie tocó no tranca el guardado", () => {
  const fk = leer("public", "js", "ui", "formKit.js");
  assert.match(fk, /if \(!validarCampo\(el\) && sucios\.has\(el\) && !primero\)/,
    "volvió a trancar la ficha por un campo heredado que el usuario no editó");
  assert.match(fk, /documento:\s*\{/, "formKit perdió la regla 'documento'");
  assert.doesNotMatch(fk, /\n\s*cedula:\s*\{/, "volvió la regla que solo aceptaba cédula panameña");
});
