// Scripts que carga una página, vista como la sirve producción.
//
// Desde la migración a Vite (2026-09-28, docs/plans/PLAN_MIGRACION_MODULAR.md)
// casi ninguna página declara sus scripts con <script src>: cada HTML carga un
// entry (<script type="module" src="/js/entry/<pagina>.js">) que los importa en
// el orden de antes. Las guardias que buscaban "<script src=…modal.js>" en el
// HTML se quedaron ciegas; este helper les devuelve la lista real:
//   · las etiquetas <script src> clásicas que quedan en el HTML (js/core/*,
//     workspace-tabs, vendor…), y
//   · los imports locales de su entry (y de lo que ese entry importe),
// en orden de carga y sin el ?v= del cache-busting. Las rutas salen relativas
// a public/ ("js/ui/modal.js") para que las regex de siempre sigan sirviendo.
//
// Lo comentado en el HTML no cuenta: un <script> dentro de <!-- --> no carga.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "..", "..", "public");

function aPublic(abs) {
  return path.relative(PUBLIC, abs).replace(/\\/g, "/");
}

// "/js/x.js" es relativo a public/; "../js/x.js" o "./x.js", al archivo que lo pide.
function resolver(ref, dirDelQuePide) {
  const limpio = ref.split(/[?#]/)[0];
  if (/^(https?:)?\/\//.test(limpio)) return null;          // CDN: no es del repo
  if (limpio.startsWith("/")) return path.join(PUBLIC, limpio.slice(1));
  if (limpio.startsWith(".")) return path.join(dirDelQuePide, limpio);
  return null;                                              // import pelado (npm)
}

function importsDe(absJs, acc, vistos) {
  if (vistos.has(absJs) || !fs.existsSync(absJs)) return;
  vistos.add(absJs);
  const src = fs.readFileSync(absJs, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const RE = /^\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = RE.exec(src))) {
    const abs = resolver(m[1], path.dirname(absJs));
    if (!abs) continue;
    const rel = aPublic(abs);
    if (!acc.includes(rel)) acc.push(rel);
    importsDe(abs, acc, vistos);
  }
}

/**
 * Scripts que carga una página.
 * @param {string} pagina ruta del HTML relativa a public/ ("almacen/index.html")
 *                        o absoluta.
 * @returns {string[]} rutas relativas a public/, en orden de carga.
 */
function scriptsDePagina(pagina) {
  const absHtml = path.isAbsolute(pagina) ? pagina : path.join(PUBLIC, pagina);
  const html = fs.readFileSync(absHtml, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const dir = path.dirname(absHtml);
  const acc = [];
  const vistos = new Set();
  const RE = /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = RE.exec(html))) {
    const abs = resolver(m[2], dir);
    if (!abs) continue;
    const rel = aPublic(abs);
    if (!acc.includes(rel)) acc.push(rel);
    // Un <script type="module"> local es un entry (o un módulo): se sigue.
    if (/type\s*=\s*["']module["']/i.test(m[1])) importsDe(abs, acc, vistos);
  }
  return acc;
}

/** Lo mismo como un solo texto, para las regex de las guardias. */
function textoScripts(pagina) {
  return scriptsDePagina(pagina).join("\n");
}

module.exports = { scriptsDePagina, textoScripts, PUBLIC };
