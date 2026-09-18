// La nota impresa que el cliente firma cuando la firma digital no se pudo
// capturar (flag histórico `no_recibido`).
//
// Por qué (auditoría 2026-09-17): en septiembre 29 de 41 entregas salieron por
// ese camino. El sistema guardaba el motivo y quién recibió, pero NO el papel,
// así que la única prueba de esas entregas vivía en un archivador que el
// sistema no sabía ubicar. Ahora se sube —al entregar o después— y la orden la
// reclama mientras falte.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");
const flujo   = raiz("public", "js", "pages", "ordenes-flujo.js");
const render  = raiz("public", "js", "pages", "ordenes-render.js");
const eventos = raiz("public", "js", "pages", "ordenes-events.js");
const html    = raiz("public", "ordenes", "index.html");
const reglas  = raiz("storage.rules");

test("el modal de firma en papel pide la foto de la nota", () => {
  assert.match(html, /id="entregaFotoPapel"/);
  assert.match(html, /accept="image\/\*,application\/pdf"/);
  // Dentro del bloque de "firmó en papel", no suelta en el modal.
  const i = html.indexOf('id="entregaNoRecibidoBloque"');
  const j = html.indexOf('id="entregaFotoPapel"');
  assert.ok(i > 0 && j > i && j - i < 2000, "va dentro del bloque de firma en papel");
});

test("la nota se sube a su propia ruta y se guarda en la orden", () => {
  assert.match(flujo, /ordenes_notas_firmadas\/\$\{ordenId\}_nota_/);
  assert.match(flujo, /firestoreData\.nota_firmada_url = await refPapel\.getDownloadURL\(\);/);
  assert.match(flujo, /firestoreData\.nota_firmada_path = pathPapel;/);
});

test("no tranca la entrega: la foto es opcional al confirmar", () => {
  // El motivo y quién recibió SÍ son obligatorios; la foto no.
  assert.match(flujo, /if \(!motivo\) \{ Toast\.show\('Indique por qué no se pudo firmar digitalmente'/);
  assert.match(flujo, /if \(!personaInterna\) \{ Toast\.show\('Indique quién recibió los equipos por el cliente'/);
  assert.doesNotMatch(flujo, /Toast\.show\('[^']*nota firmada[^']*', 'bad'\); return;/,
    "la falta de la nota no aborta la entrega");
});

test("la orden reclama la nota mientras falte, y la enseña cuando está", () => {
  assert.match(render, /falta subir la nota/);
  assert.match(render, /nota guardada/);
  assert.match(render, /data-action="subir-nota-firmada"/);
  assert.match(render, /Ver la nota/);
});

test("se puede subir después desde la propia orden", () => {
  assert.match(eventos, /'subir-nota-firmada': \(el\) => \{/);
  assert.match(eventos, /ordenes_notas_firmadas\/\$\{ordenId\}_nota_/);
  assert.match(eventos, /nota_firmada_url: await ref\.getDownloadURL\(\)/);
});

test("Storage acepta la ruta nueva, sin borrado desde el frontend", () => {
  const i = reglas.indexOf("match /ordenes_notas_firmadas/{file}");
  assert.ok(i > 0, "la regla existe");
  const bloque = reglas.slice(i, i + 420);
  assert.match(bloque, /allow read:\s+if request\.auth != null;/);
  assert.match(bloque, /allow update, delete: if false;/,
    "una prueba de entrega no se borra desde el navegador");
  assert.match(bloque, /application\/pdf/, "acepta el escaneo en PDF");
});
