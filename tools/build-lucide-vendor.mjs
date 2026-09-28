#!/usr/bin/env node
/**
 * build-lucide-vendor.mjs — regenera public/js/vendor/lucide.min.js, el
 * vendor A MEDIDA de lucide: solo los iconos del censo tools/lucide-iconos.json.
 *
 * Por qué a medida: el lucide completo pesa 401 KB (lucide.full.min.js);
 * el censo pesa ~50 KB y cubre todos los data-lucide="…" del app. Si un
 * render usa un icono fuera del censo, js/core/icons.js lo detecta, avisa en
 * consola ("iconos fuera del vendor a medida") y carga el completo como red
 * de seguridad — pero cuesta la descarga. La solución de fondo es agregar
 * el nombre PascalCase aquí y regenerar.
 *
 * Uso:  node tools/build-lucide-vendor.mjs
 *       (lucide viene de package.json — pineado; la versión queda en el header)
 *
 * Salida: window.lucide = { createIcons(opts) } con `icons` = el censo por
 * defecto, igual que el vendor original (esbuild, 2026-08-28). Los alias de
 * nombres viejos (AlertCircle → circle-alert, etc.) los resuelve lucide.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CENSO = path.join(RAIZ, 'tools', 'lucide-iconos.json');
const SALIDA = path.join(RAIZ, 'public', 'js', 'vendor', 'lucide.min.js');

const nombres = JSON.parse(fs.readFileSync(CENSO, 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(RAIZ, 'node_modules', 'lucide', 'package.json'), 'utf8')).version;

// Nombre PascalCase → archivo del icono. Los alias de nombres viejos
// (AlertCircle → circle-alert.mjs, Filter → funnel.mjs…) solo existen en
// iconsAndAliases.mjs, no como export de 'lucide', así que se importa cada
// archivo directo y el objeto `icons` lleva el nombre que usa el app.
const mapa = new Map();
const tabla = fs.readFileSync(path.join(RAIZ, 'node_modules', 'lucide', 'dist', 'esm', 'iconsAndAliases.mjs'), 'utf8');
// Formato: export { default as CircleAlert, default as AlertCircle } from './icons/circle-alert.mjs';
for (const m of tabla.matchAll(/export \{([^}]+)\} from '\.\/icons\/([a-z0-9-]+)\.mjs';/g)) {
  for (const n of m[1].matchAll(/default as ([A-Za-z0-9]+)/g)) mapa.set(n[1], m[2]);
}
const sinIcono = nombres.filter((n) => !mapa.has(n));
if (sinIcono.length) throw new Error(`lucide ${version} no tiene: ${sinIcono.join(', ')}`);
const archivos = [...new Set(nombres.map((n) => mapa.get(n)))];
const id = (f) => 'i_' + f.replace(/-/g, '_');

// Dentro del proyecto para que 'lucide' se resuelva desde node_modules.
const tmp = path.join(RAIZ, 'node_modules', '.lucide-vendor');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const entrada = path.join(tmp, 'entrada.js');
fs.writeFileSync(entrada,
  `import { createIcons } from 'lucide';\n` +
  archivos.map((f) => `import ${id(f)} from 'lucide/dist/esm/icons/${f}.mjs';`).join('\n') + '\n' +
  `const icons = { ${nombres.map((n) => `${n}: ${id(mapa.get(n))}`).join(', ')} };\n` +
  `window.lucide = { createIcons: (a = {}) => createIcons({ icons, ...a }) };\n`);

await build({
  configFile: false,
  root: tmp,
  logLevel: 'error',
  build: {
    lib: { entry: entrada, formats: ['iife'], name: '__lucideVendor', fileName: () => 'lucide.min.js' },
    outDir: path.join(tmp, 'out'),
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
  },
});

const js = fs.readFileSync(path.join(tmp, 'out', 'lucide.min.js'), 'utf8');
const header = `/*! lucide v${version} — vendor a medida de Cecomunica: ${nombres.length} iconos (tools/lucide-iconos.json). Regenerar con node tools/build-lucide-vendor.mjs. ISC. */\n`;
fs.writeFileSync(SALIDA, header + js);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${path.relative(RAIZ, SALIDA)}: ${nombres.length} iconos, ${(fs.statSync(SALIDA).size / 1024).toFixed(0)} KB (lucide ${version})`);
