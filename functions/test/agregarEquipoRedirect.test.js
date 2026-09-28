// Una sola captura de equipos (auditoría UX 2026-09-28, §4.2 #16).
//
// Había dos pantallas para agregar equipos a una orden: agregar-equipo.html
// (un fieldset por radio, con "Todos" en accesorios, duplicar múltiples,
// autocompletar modelo por serial y "Guardar y recibir") y nuevo-batch.html
// (tabla, jalar de POC/contrato/gestión, valores comunes). Cada una con su
// dedup, su aterrizaje y su guard de doble clic. Se consolidó TODO en
// nuevo-batch; agregar-equipo.html quedó como redirección que conserva los
// parámetros, para que marcadores, historial y enlaces viejos sigan vivos.
//
// Estas pruebas fijan ese contrato leyendo los archivos reales. Corre con
// `npm test` (node --test), sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "..", "public");
const leer = (...p) => fs.readFileSync(path.join(PUBLIC, ...p), "utf8");
const existe = (...p) => fs.existsSync(path.join(PUBLIC, ...p));

// Archivos de un directorio (no recursivo) con extensión dada.
const archivos = (dir, ext) => fs.readdirSync(path.join(PUBLIC, dir))
  .filter(f => f.endsWith(ext)).map(f => path.join(dir, f));

test("agregar-equipo.html es un stub que redirige a nuevo-batch con los mismos parámetros", () => {
  const html = leer("ordenes", "agregar-equipo.html");
  assert.match(html, /location\.replace\("nuevo-batch\.html" \+ qs/, "debe redirigir conservando ?orden_id=… y demás");
  assert.match(html, /window\.location\.search/, "los parámetros salen de la URL actual");
  assert.doesNotMatch(html, /<script type="module"/, "no carga entry de Vite: es solo una redirección");
  assert.doesNotMatch(html, /<script src=|firebase\./, "no carga scripts de la app ni arranca Firebase para redirigir");
  assert.ok(html.length < 3000, "un stub, no una página");
});

test("el script y el entry de agregar-equipo ya no existen", () => {
  assert.ok(!existe("js", "pages", "agregar-equipo.js"), "public/js/pages/agregar-equipo.js debe estar borrado");
  assert.ok(!existe("js", "entry", "ordenes-agregar-equipo.js"), "public/js/entry/ordenes-agregar-equipo.js debe estar borrado");
});

test("ningún script ni página de órdenes enlaza a agregar-equipo.html", () => {
  const candidatos = [
    ...archivos(path.join("js", "pages"), ".js"),
    ...archivos(path.join("js", "entry"), ".js"),
    ...archivos("ordenes", ".html").filter(f => !f.endsWith("agregar-equipo.html")),
  ];
  const culpables = candidatos.filter(f => /agregar-equipo\.html\?/.test(leer(f)));
  assert.deepEqual(culpables, [], "enlaces vivos a la página retirada");
});

test("nueva-orden aterriza en nuevo-batch cuando la orden no trae contrato", () => {
  const src = leer("js", "pages", "nueva-orden.js");
  assert.doesNotMatch(src, /agregar-equipo\.html\?/, "ningún destino vivo a la página retirada");
  // Las dos ramas (con contrato → &jalar=contrato en PROGRAMACIÓN; sin
  // contrato → batch pelado con una fila lista) van a la misma página.
  assert.match(src, /destino = `nuevo-batch\.html\?orden_id=\$\{encodeURIComponent\(id\)\}\$\{auto \? "&jalar=contrato" : ""\}`/);
  assert.match(src, /destino = `nuevo-batch\.html\?orden_id=\$\{encodeURIComponent\(id\)\}`;/);
});

test("editar-orden, la bandeja y el flujo llevan a nuevo-batch", () => {
  assert.match(leer("js", "pages", "editar-orden.js"), /lnkAdd\.href = `nuevo-batch\.html\?orden_id=/);
  const flujo = leer("js", "pages", "ordenes-flujo.js");
  assert.match(flujo, /window\.nuevoBatch = function \(ordenId\) \{\s*window\.location\.href = `nuevo-batch\.html\?orden_id=/);
  assert.match(flujo, /window\.agregarEquipo = function \(ordenId\) \{\s*window\.nuevoBatch\(ordenId\);/, "agregarEquipo queda como alias");
  const render = leer("js", "pages", "ordenes-render.js");
  assert.doesNotMatch(render, /data-action="agregar-equipo"/, "un solo botón de captura en la cabecera de la orden");
  assert.match(render, /class="btn-header-compact btn-agregar-equipo" data-action="nuevo-batch"/);
});

test("nuevo-batch absorbió lo que solo tenía agregar-equipo", () => {
  const js = leer("js", "pages", "ordenes-nuevo-batch.js");
  const html = leer("ordenes", "nuevo-batch.html");
  // Accesorios por fila con "Todos".
  assert.match(js, /class="todos-accesorios"/);
  assert.match(js, /ACCESORIOS\.forEach\(a => \{ const c = tr\.querySelector\(`\.\$\{a\}`\); if \(c\) c\.checked = this\.checked; \}\);/);
  // Observaciones por fila (ya existían) y duplicar N filas del mismo modelo.
  assert.match(js, /class="observaciones table-input sm"/);
  assert.match(js, /window\.duplicarFila = /);
  assert.match(js, /window\.aplicarDuplicarMultiples = /);
  assert.match(js, /dupCantidad/, "sin seriales pegados, crea N filas vacías con el mismo modelo");
  assert.match(html, /id="overlayDuplicar"/);
  assert.match(html, /id="dupSeriales"/);
  assert.match(html, /id="dupCantidad"/);
  // Autocompletar modelo por serial del pool (SerialField.onInfo).
  assert.match(js, /onInfo: \(info\) => \{[\s\S]*?modeloDelPool\(info/);
  // "Guardar y recibir" → index.html?orden=<id>&recibir=1 (deep-link de ordenes-index.js).
  assert.match(html, /id="btnGuardarRecibir"[^>]*onclick="guardarBatch\(\{ recibir: true \}\)"/);
  assert.match(js, /`index\.html\?orden=\$\{encodeURIComponent\(ordenId\)\}` \+ \(recibir \? "&recibir=1" : ""\)/);
  assert.match(js, /btnRecibir\.hidden = sinMostrador\(ordenTipo\) \|\| ordenEstado !== "POR ASIGNAR"/,
    "solo se ofrece donde hay recepción en mostrador");
  // El deep-link que lo recibe sigue existiendo en la bandeja.
  assert.match(leer("js", "pages", "ordenes-index.js"), /_paramsRecibir\.get\('recibir'\) !== '1'/);
  // Guard de doble clic (caso 2026071706).
  assert.match(js, /if \(guardandoBatch\) return;/);
});
