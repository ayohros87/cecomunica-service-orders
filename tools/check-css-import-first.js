#!/usr/bin/env node
/**
 * Guard: en CSS, @import SOLO vale al inicio de la hoja.
 *
 * La especificación permite que precedan a un @import únicamente @charset y
 * los statements @layer. Si un @import queda después de cualquier otra regla
 * —incluido un @font-face— el navegador lo IGNORA EN SILENCIO: no hay error de
 * consola, no hay 404, la hoja importada simplemente nunca se descarga.
 *
 * Eso pasó de verdad: e7f935a metió 12 bloques @font-face al tope de
 * ceco-ui.css, por encima del `@import url('./app-kit-extras.css')` que llevaba
 * ahí desde 824a37a. Resultado: app-kit-extras.css (561 líneas: .auth-shell,
 * .alert-banner, .dropdown-*, .module-card, .bulk-bar…) dejó de cargar en toda
 * la app y el login quedó con texto blanco sobre fondo blanco.
 *
 * Uso: node tools/check-css-import-first.js [dir]   (default: public)
 */

const fs = require('fs');
const path = require('path');

const raiz = process.argv[2] || 'public';

function archivosCss(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) archivosCss(p, acc);
    else if (ent.name.endsWith('.css')) acc.push(p);
  }
  return acc;
}

// Quita comentarios /* */ conservando los saltos de línea, para que el número
// de línea que reportamos siga cuadrando con el archivo real.
function sinComentarios(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const fallas = [];

for (const archivo of archivosCss(raiz)) {
  const limpio = sinComentarios(fs.readFileSync(archivo, 'utf8'));
  const lineas = limpio.split('\n');

  // Recorre el preámbulo: mientras solo veamos @charset/@layer/@import seguimos
  // en zona válida. La primera línea con cualquier otra cosa la cierra.
  let zonaValida = true;
  let cierre = null; // { linea, texto } de la regla que cerró la zona

  for (let i = 0; i < lineas.length; i++) {
    const t = lineas[i].trim();
    if (!t) continue;

    const esImport = /^@import\b/i.test(t);

    if (esImport && !zonaValida) {
      fallas.push(
        `${archivo}:${i + 1}  @import ignorado por el navegador — ` +
          `lo precede "${cierre.texto}" (línea ${cierre.linea}). ` +
          `Muévelo al tope del archivo.`
      );
      continue;
    }
    if (esImport) continue;

    // @charset y los statements @layer (`@layer a, b;` sin bloque) sí pueden ir antes.
    if (/^@charset\b/i.test(t)) continue;
    if (/^@layer\b[^{]*;\s*$/i.test(t)) continue;

    if (zonaValida) {
      zonaValida = false;
      cierre = { linea: i + 1, texto: t.slice(0, 60) };
    }
  }
}

if (fallas.length) {
  for (const f of fallas) {
    console.error(`::error::${f}`);
    if (!process.env.GITHUB_ACTIONS) console.error(f);
  }
  process.exit(1);
}

console.log('@import al inicio: OK');
