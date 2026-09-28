// Almacén · Existencias en tablet (auditoría UX 2026-09-28, P2 §4.6): a
// ≤1024 px la tabla deja solo las columnas esenciales y el resto se lee en
// la fila expandida. Se congela porque el HTML (cabecera), el JS (celdas y
// resumen) y el CSS (media query) viven en tres sitios y se desincronizan.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

test("la cabecera marca como secundarias exactamente Asignado, Cliente, Taller, Otros y Últ. conteo", () => {
  const html = leer("public", "almacen", "index.html");
  const thead = html.slice(html.indexOf('<tbody id="exTabla">') - 1400, html.indexOf('<tbody id="exTabla">'));
  const sec = [...thead.matchAll(/<th class="ex-sec"[^>]*>([^<]+)<\/th>/g)].map(m => m[1].trim());
  assert.deepEqual(sec, ["Asignado", "Cliente", "Taller", "Otros", "Últ. conteo"]);
  // Las esenciales NO llevan la clase: Modelo, Bodega, Devueltos, Conteo, Dif.
  for (const t of ["<th>Modelo</th>", '<th style="text-align:right;">Bodega</th>', '<th style="text-align:right;">Conteo</th>']) {
    assert.ok(thead.includes(t), `${t} se queda en tablet`);
  }
  assert.match(html, /@media \(max-width: 1024px\) \{\s*#tab-existencias \.ex-sec \{ display: none; \}/, "la media query esconde .ex-sec");
  assert.match(html, /\.ex-sec-resumen \{ display: none; \}/, "en escritorio el resumen no se pinta");
});

test("las celdas secundarias llevan .ex-sec y la expansión trae su resumen", () => {
  const js = leer("public", "js", "pages", "almacen-existencias.js");
  const fila = js.slice(js.indexOf("function filaHtml(f)"), js.indexOf("function ultimoConteo(f)"));
  const sec = (fila.match(/celda\([^)]*, false, true\)/g) || []).length;
  assert.equal(sec, 4, "Asignado, Cliente, Taller y Otros van como secundarias");
  assert.match(fila, /<td class="ex-sec"[^>]*>\$\{ultimoConteo\(f\)\}/, "Últ. conteo también");
  assert.doesNotMatch(fila, /celda\(f\.est\['en_bodega'\] \|\| 0, false, true\)/, "Bodega es esencial");
  assert.doesNotMatch(fila, /celda\(f\.est\['devuelto_revision'\] \|\| 0, true, true\)/, "Devueltos es esencial");
  const exp = js.slice(js.indexOf("function expansionHtml(f)"), js.indexOf("function toggleFila(key)"));
  assert.equal((exp.match(/\$\{resumenSecHtml\(f\)\}/g) || []).length, 2, "el resumen va en la expansión, también mientras carga");
  const res = js.slice(js.indexOf("function resumenSecHtml(f)"), js.indexOf("function expansionHtml(f)"));
  for (const k of ["Asignado", "Cliente", "Taller", "Otros", "Últ. conteo"]) assert.ok(res.includes(k), `el resumen dice ${k}`);
});
