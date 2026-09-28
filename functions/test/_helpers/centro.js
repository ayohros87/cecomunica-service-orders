// El Centro de gestión, como lo carga el navegador.
//
// clientes-centro.js se partió el 2026-09-28 (auditoría UX §4.3 #13) en
// public/js/pages/centro-core.js (define window.Centro) más centro-*.js, una
// por sección, que le suman sus métodos con Object.assign. Los tests que lo
// montaban en un vm con UN readFileSync necesitan el conjunto en el mismo
// orden que producción — y ese orden vive en js/entry/clientes-centro.js. De
// ahí se lee, para que un archivo nuevo no haya que anotarlo en dos sitios.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "..", "..", "public");
const ENTRY = path.join(PUBLIC, "js", "entry", "clientes-centro.js");

/** Rutas absolutas de centro-core.js y sus secciones, en orden de carga. */
function archivosCentro() {
  const entry = fs.readFileSync(ENTRY, "utf8");
  const out = [];
  const RE = /^\s*import\s+['"]\/js\/pages\/(centro-[\w-]+\.js)['"]/gm;
  let m;
  while ((m = RE.exec(entry))) out.push(path.join(PUBLIC, "js", "pages", m[1]));
  // centro-aprobaciones.js (window.CentroAprobaciones) va ANTES del núcleo y
  // no es una sección del Centro: el conjunto empieza en centro-core.js.
  const i = out.findIndex(f => f.endsWith("centro-core.js"));
  if (i < 0) throw new Error("js/entry/clientes-centro.js no importa centro-core.js");
  return out.slice(i);
}

/** Todo el fuente concatenado: sirve tanto para vm.runInContext como para las guardias por regex. */
function fuenteCentro() {
  return archivosCentro().map(f => fs.readFileSync(f, "utf8")).join("\n");
}

module.exports = { archivosCentro, fuenteCentro };
