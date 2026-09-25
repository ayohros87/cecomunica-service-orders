#!/usr/bin/env node
/**
 * sellar-versiones.js — sella con `?v=<hash del contenido>` TODAS las
 * etiquetas locales `<script src>` y `<link href="*.css">` de public/**\/*.html.
 *
 * Por qué: firebase.json cachea js/css 1 h con stale-while-revalidate de 24 h.
 * Una etiqueta sin `?v=` (o con un `?v=` que nadie bumpeó) puede servir la
 * versión vieja hasta un día después del deploy. Con el hash del contenido en
 * la URL, cada cambio real produce una URL nueva y las URLs viejas se pueden
 * cachear sin miedo.
 *
 * Es el mecanismo INTERINO del Paso 0 de docs/plans/PLAN_MIGRACION_MODULAR.md:
 * cuando F2 (Vite) llegue a producción, el build pone hashes en el nombre del
 * archivo y este script deja de hacer falta.
 *
 * Uso:   node tools/sellar-versiones.js           (antes de cada deploy de hosting)
 *        node tools/sellar-versiones.js --check   (CI: falla si algo quedó sin sellar)
 *
 * No toca: URLs http(s), tools/, dev-diag-*.html, ni los `?v=` que viven en
 * constantes JS (CargaDiferida, layout.js) — esos siguen a mano.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..');
const PUBLIC = path.join(RAIZ, 'public');
const soloCheck = process.argv.includes('--check');

function caminar(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'tools' && ent.name !== 'node_modules') caminar(p, acc); }
    else if (ent.name.endsWith('.html') && !/^dev-diag-/.test(ent.name)) acc.push(p);
  }
  return acc;
}

const hashes = new Map();
function hashDe(abs) {
  if (!hashes.has(abs)) {
    hashes.set(abs, crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 8));
  }
  return hashes.get(abs);
}

const RE = /(<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*")([^"]+?\.(?:js|css))(\?v=[^"]*)?(")/gi;

let selladas = 0;
let sinVersionAntes = 0;
const rotas = [];
const desactualizadas = [];

for (const html of caminar(PUBLIC)) {
  const orig = fs.readFileSync(html, 'utf8');
  const nuevo = orig.replace(RE, (m, pre, ruta, ver, post) => {
    if (/^(https?:)?\/\//.test(ruta)) return m;
    if (/\/js\/entry\//.test(ruta)) return m; // los entries los empaqueta Vite con hash propio
    const abs = ruta.startsWith('/') ? path.join(PUBLIC, ruta) : path.resolve(path.dirname(html), ruta);
    if (!fs.existsSync(abs)) { rotas.push(`${path.relative(RAIZ, html)} → ${ruta}`); return m; }
    const nv = `?v=${hashDe(abs)}`;
    if (ver === nv) return m;
    if (!ver) sinVersionAntes++;
    selladas++;
    desactualizadas.push(`${path.relative(RAIZ, html)} → ${ruta}${ver || ''}`);
    return pre + ruta + nv + post;
  });
  if (!soloCheck && nuevo !== orig) fs.writeFileSync(html, nuevo);
}

if (rotas.length) {
  console.error('Referencias a archivos que NO existen (no se tocaron):');
  rotas.forEach((r) => console.error('  ' + r));
}

if (soloCheck) {
  if (selladas) {
    console.error(`${selladas} etiqueta(s) con ?v= desactualizado o ausente. Corre: node tools/sellar-versiones.js`);
    desactualizadas.slice(0, 20).forEach((d) => console.error('  ' + d));
    process.exit(1);
  }
  console.log('Versiones selladas: OK');
} else {
  console.log(`Etiquetas selladas: ${selladas} (sin ?v= antes: ${sinVersionAntes})`);
}
if (rotas.length) process.exit(1);
