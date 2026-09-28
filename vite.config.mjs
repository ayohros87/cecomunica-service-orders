// vite.config.js — build multipágina del frontend (F2 de
// docs/plans/PLAN_MIGRACION_MODULAR.md).
//
// Qué hace el build:
//   · Cada public/**/*.html es una entrada (menos tools/ y dev-diag-*).
//   · Los <script type="module" src="/js/entry/…"> se empaquetan: un archivo
//     minificado con hash por página, más chunks compartidos.
//   · Los <link rel="stylesheet"> locales también se empaquetan con hash.
//   · Los <script src> CLÁSICOS locales (js/core/*, js/ui/workspace-tabs.js,
//     login.html entero, js/vendor/*, firebase-aggregates.js) NO se empaquetan:
//     corren síncronos a propósito (los bloques inline del HTML los usan al
//     parsear) o son módulos con imports por URL. Se sirven tal cual desde
//     dist/ y la etiqueta sale con ?v=<hash del contenido>.
//   · Todo lo demás de public/ (js/, css/, img/, brand/, manifest…) se copia
//     verbatim a dist/: CargaDiferida, layout.js (palette) e icons.js cargan
//     archivos por URL en tiempo de ejecución y tienen que existir.
//
// Salida: dist/ (firebase.json → hosting.public). `npm run dev` sirve public/
// con los mismos entries sin build.

import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(RAIZ, 'public');
const DIST = path.join(RAIZ, 'dist');

function caminar(dir, filtro, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      caminar(p, filtro, acc);
    } else if (filtro(p)) acc.push(p);
  }
  return acc;
}

// Entradas: todos los HTML de public/ menos herramientas locales.
const entradas = {};
for (const abs of caminar(PUBLIC, (p) => p.endsWith('.html'))) {
  const rel = path.relative(PUBLIC, abs).replace(/\\/g, '/');
  if (rel.startsWith('tools/') || /(^|\/)dev-diag-[^/]*\.html$/.test(rel)) continue;
  entradas[rel.replace(/\.html$/, '').replace(/\//g, '__')] = abs;
}

const hashes = new Map();
function hashDe(abs) {
  if (!hashes.has(abs)) {
    hashes.set(abs, crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 8));
  }
  return hashes.get(abs);
}

// Etiquetas que Vite no debe tocar: <script> clásico local y <script
// type="module"> local que NO sea un entry. Se esconden en un comentario
// antes de que Vite procese el HTML y se restauran después con ?v=<hash>.
function pluginClasicos() {
  const RE = /<script\b([^>]*)\bsrc\s*=\s*"([^"]+)"([^>]*)><\/script>/gi;
  // Los CSS tampoco se empaquetan. Vite concatena las hojas de la página en
  // un archivo propio y saca aparte las compartidas (ceco-ui), y con eso
  // CAMBIA EL ORDEN de la cascada: en /ordenes/ ceco-ui quedó después de
  // ordenes-index y pisó la tabla (2026-09-28, producción). Las hojas se
  // sirven verbatim desde dist/css con ?v=<hash>, en el orden del HTML; los
  // @import internos (app-kit-extras) siguen funcionando igual. Lo mismo para
  // los <link rel="preload"> de fuentes: deben apuntar al mismo archivo que
  // referencia el CSS verbatim, no a una copia con hash.
  const RE_LINK = /<link\b([^>]*)\bhref\s*=\s*"([^"]+)"([^>]*)>/gi;
  return {
    name: 'ceco-clasicos',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const dirHtml = path.dirname(ctx.filename);
        html = html.replace(RE_LINK, (m, a1, href, a2) => {
          const attrs = a1 + ' ' + a2;
          if (/^(https?:)?\/\//.test(href)) return m;
          if (!/\brel\s*=\s*"(stylesheet|preload|prefetch|modulepreload)"/i.test(attrs)) return m;
          const limpio = href.replace(/[?#].*$/, '');
          const abs = limpio.startsWith('/') ? path.join(PUBLIC, limpio) : path.resolve(dirHtml, limpio);
          if (!fs.existsSync(abs)) {
            throw new Error(`${path.relative(RAIZ, ctx.filename)}: <link href="${href}"> no existe`);
          }
          const url = '/' + path.relative(PUBLIC, abs).replace(/\\/g, '/') + '?v=' + hashDe(abs);
          const tag = `<link${a1}href="${url}"${a2}>`;
          return `<!--ceco-clasico:${Buffer.from(tag).toString('base64')}-->`;
        });
        return html.replace(RE, (m, a1, src, a2) => {
          if (/^https?:/.test(src)) return m;
          const esModulo = /type\s*=\s*"module"/i.test(a1 + a2);
          const limpio = src.replace(/[?#].*$/, '');
          if (esModulo && /\/js\/entry\//.test(limpio)) return m; // lo empaqueta Vite
          const abs = limpio.startsWith('/') ? path.join(PUBLIC, limpio) : path.resolve(dirHtml, limpio);
          if (!fs.existsSync(abs)) {
            throw new Error(`${path.relative(RAIZ, ctx.filename)}: <script src="${src}"> no existe`);
          }
          const url = '/' + path.relative(PUBLIC, abs).replace(/\\/g, '/') + '?v=' + hashDe(abs);
          const attrs = (a1 + ' ' + a2).replace(/\s+/g, ' ').trim();
          const tag = `<script ${attrs ? attrs + ' ' : ''}src="${url}"></script>`;
          return `<!--ceco-clasico:${Buffer.from(tag).toString('base64')}-->`;
        });
      },
    },
  };
}

function pluginRestaurar() {
  return {
    name: 'ceco-clasicos-restaurar',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/<!--ceco-clasico:([A-Za-z0-9+/=]+)-->/g, (m, b64) => Buffer.from(b64, 'base64').toString('utf8'));
      },
    },
  };
}

// Copia verbatim de public/ (menos HTML, tools/, dev-diag-*, js/entry/) a dist/.
function pluginCopiaVerbatim() {
  return {
    name: 'ceco-copia-verbatim',
    apply: 'build',
    closeBundle() {
      fs.cpSync(PUBLIC, DIST, {
        recursive: true,
        filter: (src) => {
          const rel = path.relative(PUBLIC, src).replace(/\\/g, '/');
          if (!rel) return true;
          if (rel === 'tools' || rel.startsWith('tools/')) return false;
          if (rel === 'js/entry' || rel.startsWith('js/entry/')) return false;
          if (/(^|\/)dev-diag-[^/]*\.html$/.test(rel)) return false;
          if (rel.endsWith('.html')) return false;
          return true;
        },
      });
    },
  };
}

export default defineConfig({
  root: PUBLIC,
  base: '/',
  publicDir: false,
  appType: 'mpa',
  plugins: [pluginClasicos(), pluginRestaurar(), pluginCopiaVerbatim()],
  build: {
    outDir: DIST,
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: entradas,
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
