// Bloque de contrato de ENTRADA en editar-orden (auditoría UX 2026-09-28,
// §4.2 #16, proyecto 3).
//
// nueva-orden pide contrato para PROGRAMACIÓN y ENTRADA (es el contrato del
// que vuelve el equipo: sin él la devolución no se amarra y la cancelación
// queda en el aire). editar-orden solo mostraba el bloque para PROGRAMACIÓN:
// una ENTRADA creada sin contrato, o con el contrato equivocado, no se podía
// corregir sin rehacer la orden. Ahora las dos páginas usan el mismo criterio
// (requiereContrato) y el bloque se edita mientras la orden esté en POR
// ASIGNAR — el gate de estado que ya tenía la página entera.
//
// Pruebas estáticas sobre los archivos reales. Corre con `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "..", "public");
const leer = (...p) => fs.readFileSync(path.join(PUBLIC, ...p), "utf8");

test("editar-orden define requiereContrato como nueva-orden (PROGRAMACIÓN o ENTRADA)", () => {
  const editar = leer("js", "pages", "editar-orden.js");
  const nueva = leer("js", "pages", "nueva-orden.js");
  const RE = /function requiereContrato\(tipo\) \{\s*return esProgramacion\(tipo\) \|\| esEntrada\(tipo\);\s*\}/;
  assert.match(nueva, RE);
  assert.match(editar, RE, "mismo criterio en las dos páginas");
  assert.match(editar, /function esEntrada\(tipo\) \{\s*return normalizarTipo\(tipo\) === "ENTRADA";/);
});

test("el bloque de contrato de editar-orden se muestra, valida y guarda por requiereContrato", () => {
  const editar = leer("js", "pages", "editar-orden.js");
  // Mostrar al cargar la orden y al cambiar el tipo.
  assert.match(editar, /if \(requiereContrato\(d\.tipo_de_servicio\)\) \{\s*contratoBlock\.style\.display = "block";/);
  assert.match(editar, /if \(requiereContrato\(tipo\)\) \{[^]*?contratoBlock\.style\.display = "block";/);
  // Validar y guardar.
  assert.match(editar, /if \(requiereContrato\(tipoServicio\)\) \{\s*if \(!contratoNoAplica\.checked && !contratoSelect\.value\)/);
  assert.match(editar, /throw new Error\(`Para \$\{etiquetaTipoContrato\(tipoServicio\)\} selecciona un contrato o marca 'No aplica'\.`\)/);
  assert.match(editar, /if \(requiereContrato\(tipoServicio\)\) \{\s*if \(contratoNoAplica\.checked\) \{/);
  // Limpiar la caché del contrato anterior también cuando una ENTRADA cambia de contrato.
  assert.match(editar, /if \(!requiereContrato\(tipoServicio\) \|\|/);
  // Ninguna puerta del bloque sigue mirando solo PROGRAMACIÓN.
  assert.doesNotMatch(editar, /if \(esProgramacion\((tipo|tipoServicio|d\.tipo_de_servicio)\)\)/);
  assert.doesNotMatch(editar, /!esProgramacion\(tipoServicio\)/);
});

test("la orden solo se edita en POR ASIGNAR (gate al cargar y al guardar)", () => {
  const editar = leer("js", "pages", "editar-orden.js");
  assert.match(editar, /if \(estadoActual !== "POR ASIGNAR"\) \{/);
  assert.match(editar, /if \(estadoFresco !== "POR ASIGNAR"\) \{/);
});

test("el HTML de editar-orden explica el contrato de la ENTRADA como nueva-orden", () => {
  const html = leer("ordenes", "editar-orden.html");
  assert.match(html, /Obligatorio para PROGRAMACIÓN y ENTRADA\./);
  assert.match(html, /En una ENTRADA es el contrato\s*del que vuelve el equipo/);
  assert.doesNotMatch(html, /Para PROGRAMACIÓN selecciona un contrato/, "el mensaje de error ya no nombra solo a PROGRAMACIÓN");
});
