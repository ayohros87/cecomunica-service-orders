#!/usr/bin/env node
/**
 * check-modular.js — radiografía del frontend para la migración a módulos ES
 * (docs/plans/PLAN_MIGRACION_MODULAR.md, Paso 0 / F1).
 *
 * Qué mide, y por qué importa al bundlear con Vite:
 *
 *  1. PUENTES FALTANTES. Un `function f(){}` o `const X = …` de nivel superior
 *     en un <script> clásico es global: lo ven los demás archivos y los
 *     onclick="" del HTML. Como módulo ES pasa a ser privado del archivo. Cada
 *     nombre que OTRO archivo o el HTML usa necesita un puente explícito
 *     (`window.X = X` u `Object.assign(window, { … })`).
 *  2. ESTADO MUTABLE COMPARTIDO. Un `let/var` de nivel superior que se
 *     REASIGNA y que otros leen no se puede puentear por valor: el puente
 *     copia el valor de carga y los demás verían uno viejo. Se arregla a mano.
 *  3. ESCRITURAS AJENAS. `x = 1` sin declarar (o a una variable declarada en
 *     otro archivo) funciona en modo sloppy y truena con ReferenceError en un
 *     módulo (siempre estricto). Se arregla a mano.
 *  4. NO COMPILA COMO MÓDULO. Sintaxis solo válida en sloppy (octales, `with`,
 *     parámetros duplicados…).
 *  5. `this` DE NIVEL SUPERIOR. En un script es window; en un módulo, undefined.
 *  6. CONTADORES de contexto: handlers inline, etiquetas sin ?v=, archivos que
 *     usan la API compat de Firebase, nombres libres sin proveedor conocido.
 *
 * Uso:  node tools/check-modular.js [--json salida.json] [--estricto]
 *   --estricto  sale con código 1 si hay puentes faltantes, estado mutable
 *               compartido, escrituras ajenas o archivos que no compilan como
 *               módulo (para CI, cuando toque).
 *
 * Depende de acorn, eslint-scope y globals; los toma de functions/node_modules
 * si no están en la raíz.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PUBLIC = path.join(RAIZ, 'public');

function req(mod) {
  try { return require(mod); }
  catch { return require(require.resolve(mod, { paths: [path.join(RAIZ, 'functions')] })); }
}
const acorn = req('acorn');
const eslintScope = req('eslint-scope');
const globalsPkg = req('globals');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const estricto = args.includes('--estricto');

// ---------------------------------------------------------------- archivos

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
const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');

const archivosJs = caminar(PUBLIC, (p) =>
  p.endsWith('.js') &&
  !/[\\/]js[\\/]vendor[\\/]/.test(p) &&
  !/[\\/]js[\\/]entry[\\/]/.test(p) &&
  !/[\\/]tools[\\/]/.test(p)
).map(rel).sort();

const archivosHtml = caminar(PUBLIC, (p) =>
  p.endsWith('.html') &&
  !/[\\/]tools[\\/]/.test(p) &&
  !/dev-diag-[^\\/]*\.html$/.test(p)
).map(rel).sort();

// ---------------------------------------------------------------- parseo

function parsear(src, sourceType) {
  return acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType,
    locations: true,
    ranges: true, // eslint-scope los necesita
    allowHashBang: true,
    allowAwaitOutsideFunction: sourceType === 'module',
  });
}

function analizar(ast, sourceType) {
  return eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType });
}

// Recorre el AST sin bajar a funciones ni clases (para `this` de nivel superior).
function thisNivelSuperior(ast) {
  const hallazgos = [];
  (function visitar(n) {
    if (!n || typeof n.type !== 'string') return;
    if (/Function/.test(n.type) || n.type === 'ClassBody') return;
    if (n.type === 'ThisExpression') { hallazgos.push(n.loc.start.line); return; }
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visitar);
      else if (v && typeof v.type === 'string') visitar(v);
    }
  })(ast);
  return hallazgos;
}

// Nombres que el archivo publica explícitamente en window/globalThis:
// `window.X = …`, `globalThis.X = …`, `Object.assign(window, { X, Y })`.
// También `window.X.Y = …` cuando X no es de este archivo (mutación ajena).
function exportsExplicitos(ast, declaradosAqui) {
  const exps = new Set();
  const mutacionesAjenas = [];
  const lecturasWindow = new Set(); // window.X leído (no asignado): X debe existir en window
  // `self` queda fuera a propósito: en este código casi siempre es `const self = this`.
  const esWindow = (n) => n && n.type === 'Identifier' && (n.name === 'window' || n.name === 'globalThis');
  (function visitar(n, padre) {
    if (!n || typeof n.type !== 'string') return;
    if (
      n.type === 'MemberExpression' && esWindow(n.object) && !n.computed && n.property.type === 'Identifier' &&
      !(padre && padre.type === 'AssignmentExpression' && padre.left === n)
    ) {
      lecturasWindow.add(n.property.name);
    }
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression') {
      const l = n.left;
      if (esWindow(l.object) && !l.computed && l.property.type === 'Identifier') {
        exps.add(l.property.name);
      } else if (
        l.object.type === 'MemberExpression' && esWindow(l.object.object) &&
        !l.object.computed && l.object.property.type === 'Identifier' &&
        !declaradosAqui.has(l.object.property.name) && !exps.has(l.object.property.name)
      ) {
        mutacionesAjenas.push({ nombre: l.object.property.name, linea: n.loc.start.line });
      }
    }
    if (
      n.type === 'CallExpression' && n.callee.type === 'MemberExpression' &&
      n.callee.object.type === 'Identifier' && n.callee.object.name === 'Object' &&
      n.callee.property.name === 'assign' && n.arguments.length >= 2 &&
      esWindow(n.arguments[0])
    ) {
      for (const arg of n.arguments.slice(1)) {
        if (arg.type !== 'ObjectExpression') continue;
        for (const prop of arg.properties) {
          if (prop.type !== 'Property') continue;
          const k = prop.key;
          exps.add(k.type === 'Identifier' ? k.name : String(k.value));
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((h) => visitar(h, n));
      else if (v && typeof v.type === 'string') visitar(v, n);
    }
  })(ast, null);
  return { exps, mutacionesAjenas, lecturasWindow };
}

function radiografiaScript(src, sourceType) {
  const ast = parsear(src, sourceType);
  const sm = analizar(ast, sourceType);
  const global = sm.globalScope;
  // En módulos las declaraciones viven en el module scope.
  const propio = sourceType === 'module' ? sm.scopes.find((s) => s.type === 'module') : global;

  const decls = new Map(); // nombre -> { kind, reasignaciones: [lineas] }
  for (const v of propio.variables) {
    if (!v.defs.length) continue;
    const d = v.defs[0];
    let kind = d.type === 'FunctionName' ? 'function'
      : d.type === 'ClassName' ? 'class'
      : d.type === 'Variable' ? d.parent.kind
      : d.type === 'ImportBinding' ? 'import' : d.type;
    decls.set(v.name, { kind, reasignaciones: [] });
  }
  // Reasignaciones en este archivo (escrituras que no son la inicialización).
  for (const s of sm.scopes) {
    for (const r of s.references) {
      const nombre = r.identifier.name;
      if (!decls.has(nombre)) continue;
      if (r.isWrite() && !r.init) decls.get(nombre).reasignaciones.push(r.identifier.loc.start.line);
    }
  }
  // Referencias libres: `through` del global menos las que sí declara el archivo.
  const libres = new Map(); // nombre -> { lecturas, escrituras, lineas }
  for (const r of global.through) {
    const nombre = r.identifier.name;
    if (decls.has(nombre)) continue;
    const e = libres.get(nombre) || { lecturas: 0, escrituras: 0, lineas: [] };
    if (r.isWrite()) e.escrituras++; else e.lecturas++;
    if (e.lineas.length < 3) e.lineas.push(r.identifier.loc.start.line);
    libres.set(nombre, e);
  }
  const { exps, mutacionesAjenas, lecturasWindow } = exportsExplicitos(ast, new Set(decls.keys()));
  return { ast, decls, libres, exps, mutacionesAjenas, lecturasWindow, thisTop: thisNivelSuperior(ast) };
}

// ---------------------------------------------------------------- JS

const JS = new Map(); // ruta -> radiografía
const errores = [];
const noCompilaComoModulo = [];

for (const ruta of archivosJs) {
  const src = fs.readFileSync(path.join(RAIZ, ruta), 'utf8');
  let r;
  try {
    r = radiografiaScript(src, 'script');
  } catch (e) {
    // Puede ser un módulo ES ya (import/export): se analiza como tal.
    try { r = radiografiaScript(src, 'module'); r.esModulo = true; }
    catch (e2) { errores.push(`${ruta}: ${e.message}`); continue; }
  }
  if (!r.esModulo) {
    try { parsear(src, 'module'); }
    catch (e) { noCompilaComoModulo.push(`${ruta}: ${e.message}`); }
  }
  r.usaCompat = /\bfirebase\.(firestore|auth|functions|storage|app)\b/.test(src);
  // Handlers inline GENERADOS desde JS (innerHTML con onclick="fn(...)" o
  // setAttribute('onclick', …)). Se resuelven en el ámbito global, no en el
  // del archivo: cada nombre que citan necesita puente, aunque lo defina el
  // mismo archivo que genera el string.
  r.handlersInline = 0;
  r.refsHandlers = new Set();
  const RE_H_JS = /\bon(?:click|change|input|submit|keyup|keydown|keypress|blur|focus|dblclick|contextmenu|mouseenter|mouseleave)\s*=\s*\\?["']([^"'\n]*)|setAttribute\(\s*["']on\w+["']\s*,\s*[`"']([^`"'\n]*)/g;
  let mh;
  while ((mh = RE_H_JS.exec(src))) {
    r.handlersInline++;
    const snippet = (mh[1] !== undefined ? mh[1] : mh[2] || '').replace(/\$\{[^}]*\}/g, '0');
    let mi;
    const RE_ID = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*[(.]/g;
    while ((mi = RE_ID.exec(snippet))) r.refsHandlers.add(mi[1]);
  }
  JS.set(ruta, r);
}

// ---------------------------------------------------------------- HTML

const HTML = new Map(); // ruta -> { decls, libres, handlers, sinVersion, inlineModulos }
const RE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const RE_HANDLER = /\son(\w+)\s*=\s*("([^"]*)"|'([^']*)')/gi;

for (const ruta of archivosHtml) {
  // Sin comentarios HTML: un <script> mencionado en un comentario no es un script.
  const html = fs.readFileSync(path.join(RAIZ, ruta), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const info = { decls: new Set(), libres: new Map(), handlers: 0, sinVersion: 0, tagsLocales: 0, inlineModulos: 0, exps: new Set() };
  let m;
  RE_SCRIPT.lastIndex = 0;
  while ((m = RE_SCRIPT.exec(html))) {
    const attrs = m[1] || '';
    const cuerpo = m[2];
    const srcAttr = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const esModulo = /type\s*=\s*["']module["']/i.test(attrs);
    if (srcAttr) {
      const src = srcAttr[1];
      if (!/^https?:/.test(src)) {
        info.tagsLocales++;
        if (!/\?v=/.test(src)) info.sinVersion++;
        // Qué archivo JS carga esta página (para cruzar consumidores por página).
        const limpio = src.replace(/[?#].*$/, '');
        const abs = limpio.startsWith('/') ? path.join(PUBLIC, limpio) : path.resolve(path.dirname(path.join(RAIZ, ruta)), limpio);
        info.scripts = info.scripts || new Set();
        if (/[\\/]js[\\/]entry[\\/]/.test(abs) && fs.existsSync(abs)) {
          // Entry de Vite (F2): la página carga lo que el entry importa.
          const ent = fs.readFileSync(abs, 'utf8');
          for (const im of ent.matchAll(/^import\s+['"]\/([^'"]+)['"];?/gm)) info.scripts.add(rel(path.join(PUBLIC, im[1])));
        } else {
          info.scripts.add(rel(abs));
        }
      }
      continue;
    }
    if (/type\s*=\s*["'](?!module|text\/javascript)/i.test(attrs)) continue; // json, plantillas…
    if (!cuerpo.trim()) continue;
    if (esModulo) info.inlineModulos++;
    try {
      const r = radiografiaScript(cuerpo, esModulo ? 'module' : 'script');
      if (!esModulo) for (const n of r.decls.keys()) info.decls.add(n);
      for (const n of r.exps) info.exps.add(n);
      info.lecturasWindow = info.lecturasWindow || new Set();
      for (const n of r.lecturasWindow) info.lecturasWindow.add(n);
      for (const [n, e] of r.libres) {
        const acc = info.libres.get(n) || { lecturas: 0, escrituras: 0 };
        acc.lecturas += e.lecturas; acc.escrituras += e.escrituras;
        info.libres.set(n, acc);
      }
    } catch (e) {
      errores.push(`${ruta} (inline): ${e.message} — ${JSON.stringify(cuerpo.trim().slice(0, 60))}`);
    }
  }
  RE_HANDLER.lastIndex = 0;
  while ((m = RE_HANDLER.exec(html))) {
    const codigo = m[3] !== undefined ? m[3] : m[4];
    info.handlers++;
    try {
      const r = radiografiaScript(`function __h(event){ ${codigo.replace(/&quot;/g, '"').replace(/&amp;/g, '&')} }`, 'script');
      for (const [n, e] of r.libres) {
        const acc = info.libres.get(n) || { lecturas: 0, escrituras: 0 };
        acc.lecturas += e.lecturas; acc.escrituras += e.escrituras;
        info.libres.set(n, acc);
      }
    } catch { /* handler con sintaxis rara: se ignora */ }
  }
  const links = html.match(/<link\b[^>]*\bhref\s*=\s*["'][^"'?]+\.css["']/gi) || [];
  info.sinVersion += links.length;
  HTML.set(ruta, info);
}

// ---------------------------------------------------------------- cruce

// Proveedores conocidos de cada nombre global.
const NAVEGADOR = new Set([
  ...Object.keys(globalsPkg.browser), ...Object.keys(globalsPkg.es2021), ...Object.keys(globalsPkg.builtin || {}),
]);
const EXTERNOS = new Set(['firebase', 'lucide', 'XLSX', 'jspdf', 'jsPDF', 'html2canvas', 'Chart', 'QRCode', 'SignaturePad', 'pdfjsLib']);

const proveedores = new Map(); // nombre -> Set<'js:ruta' | 'html:ruta'>
const agregar = (n, quien) => { if (!proveedores.has(n)) proveedores.set(n, new Set()); proveedores.get(n).add(quien); };
for (const [ruta, r] of JS) {
  for (const n of r.decls.keys()) agregar(n, 'js:' + ruta);
  for (const n of r.exps) agregar(n, 'js:' + ruta);
}
for (const [ruta, h] of HTML) {
  for (const n of h.decls) agregar(n, 'html:' + ruta);
  for (const n of h.exps) agregar(n, 'html:' + ruta);
}

// Quién usa cada nombre libre (y si lo escribe).
const usos = new Map(); // nombre -> [{ quien, lecturas, escrituras }]
for (const [ruta, r] of JS) for (const [n, e] of r.libres) {
  if (!usos.has(n)) usos.set(n, []);
  usos.get(n).push({ quien: 'js:' + ruta, ...e });
}
for (const [ruta, h] of HTML) for (const [n, e] of h.libres) {
  if (!usos.has(n)) usos.set(n, []);
  usos.get(n).push({ quien: 'html:' + ruta, ...e });
}
const PALABRAS = new Set(['this', 'event', 'return', 'if', 'else', 'new', 'typeof', 'void', 'true', 'false', 'null', 'undefined', 'e', 'ev', 'evt', 'function', 'async', 'await']);
for (const [ruta, r] of JS) for (const n of r.refsHandlers) {
  if (PALABRAS.has(n) || NAVEGADOR.has(n) || EXTERNOS.has(n)) continue;
  if (!usos.has(n)) usos.set(n, []);
  usos.get(n).push({ quien: 'handler:' + ruta, lecturas: 1, escrituras: 0 });
}
// `window.X` leído desde cualquier archivo (incluido el propio): X tiene que
// estar en window, y una declaración de nivel superior de un módulo no lo está.
for (const [ruta, r] of JS) for (const n of r.lecturasWindow) {
  if (NAVEGADOR.has(n)) continue;
  if (!usos.has(n)) usos.set(n, []);
  usos.get(n).push({ quien: 'window:' + ruta, lecturas: 1, escrituras: 0 });
}
for (const [ruta, h] of HTML) for (const n of h.lecturasWindow || []) {
  if (NAVEGADOR.has(n)) continue;
  if (!usos.has(n)) usos.set(n, []);
  usos.get(n).push({ quien: 'window:' + ruta, lecturas: 1, escrituras: 0 });
}

// Páginas que cargan cada archivo JS por etiqueta. Un consumidor cuenta para
// una declaración solo si comparten página (o si alguno de los dos no se carga
// por etiqueta: CargaDiferida y compañía, donde no se sabe y se asume que sí).
const paginasDe = new Map(); // ruta js -> Set<ruta html>
for (const [ruta, h] of HTML) for (const s of h.scripts || []) {
  if (!paginasDe.has(s)) paginasDe.set(s, new Set());
  paginasDe.get(s).add(ruta);
}
function compartenPagina(rutaDecl, quien) {
  const pd = paginasDe.get(rutaDecl);
  if (!pd) return true;
  const [tipo, rutaUso] = [quien.slice(0, quien.indexOf(':')), quien.slice(quien.indexOf(':') + 1)];
  if (tipo === 'html') return pd.has(rutaUso);
  const pu = paginasDe.get(rutaUso);
  if (!pu) return true;
  for (const p of pu) if (pd.has(p)) return true;
  return false;
}

const puentes = [];          // { ruta, nombre, kind, usadoPor }
const mutableCompartido = []; // { ruta, nombre, kind, reasignaciones, usadoPor }
const escriturasAjenas = []; // { quien, nombre, declaradoEn }
const sinProveedor = new Map(); // nombre -> usos
const thisTop = [];
const mutacionesAjenas = [];

for (const [ruta, r] of JS) {
  if (r.thisTop.length) thisTop.push({ ruta, lineas: r.thisTop });
  // window.location.href = … no es mutar un namespace ajeno: solo cuentan los propios.
  for (const m of r.mutacionesAjenas) if (!NAVEGADOR.has(m.nombre)) mutacionesAjenas.push({ ruta, ...m });
  for (const [nombre, d] of r.decls) {
    if (d.kind === 'import') continue;
    const externos = (usos.get(nombre) || []).filter((u) => u.quien !== 'js:' + ruta && compartenPagina(ruta, u.quien));
    if (!externos.length) continue;
    const escritoFuera = externos.some((u) => u.escrituras > 0);
    if (d.reasignaciones.length || escritoFuera) {
      mutableCompartido.push({ ruta, nombre, kind: d.kind, reasignaciones: d.reasignaciones.slice(0, 5), escritoFuera, usadoPor: externos.map((u) => u.quien) });
    } else if (!r.exps.has(nombre)) {
      puentes.push({ ruta, nombre, kind: d.kind, usadoPor: externos.map((u) => u.quien) });
    }
  }
}
for (const [nombre, lista] of usos) {
  const prov = proveedores.get(nombre);
  for (const u of lista) {
    if (u.escrituras > 0 && !NAVEGADOR.has(nombre)) {
      // Escribir un global sin declararlo (o declarado en otro archivo) truena en módulo.
      const declaradoEn = prov ? [...prov].filter((p) => p !== u.quien) : [];
      escriturasAjenas.push({ quien: u.quien, nombre, declaradoEn });
    }
  }
  if (!prov && !NAVEGADOR.has(nombre) && !EXTERNOS.has(nombre)) sinProveedor.set(nombre, lista);
}

// ---------------------------------------------------------------- resumen

const porArchivo = (lista) => {
  const m = new Map();
  for (const x of lista) { if (!m.has(x.ruta)) m.set(x.ruta, []); m.get(x.ruta).push(x); }
  return m;
};

const totalHandlersHtml = [...HTML.values()].reduce((a, h) => a + h.handlers, 0);
const totalHandlersJs = [...JS.values()].reduce((a, r) => a + r.handlersInline, 0);
const totalSinVersion = [...HTML.values()].reduce((a, h) => a + h.sinVersion, 0);
const totalCompat = [...JS.values()].filter((r) => r.usaCompat).length;
const archivosConPuentes = porArchivo(puentes);
const archivosMutables = porArchivo(mutableCompartido);

console.log('=== check-modular ===');
console.log(`Archivos JS analizados: ${JS.size}   HTML: ${HTML.size}`);
console.log(`Puentes faltantes: ${puentes.length} nombres en ${archivosConPuentes.size} archivos`);
console.log(`Estado mutable compartido: ${mutableCompartido.length} variables en ${archivosMutables.size} archivos`);
console.log(`Escrituras ajenas (truenan en módulo): ${escriturasAjenas.length}`);
console.log(`No compilan como módulo: ${noCompilaComoModulo.length}`);
console.log(`this de nivel superior: ${thisTop.length} archivos`);
console.log(`Mutación de namespace ajeno (window.X.y = …): ${mutacionesAjenas.length}`);
console.log(`Handlers inline: ${totalHandlersHtml} en HTML + ${totalHandlersJs} en JS`);
console.log(`Etiquetas <script>/<link> locales sin ?v=: ${totalSinVersion}`);
console.log(`Archivos que usan firebase.* compat: ${totalCompat}`);
console.log(`Nombres libres sin proveedor conocido: ${sinProveedor.size}`);
if (errores.length) console.log(`Errores de parseo: ${errores.length}`);

const seccion = (titulo, lista, fmt) => {
  if (!lista.length) return;
  console.log(`\n--- ${titulo} ---`);
  for (const x of lista) console.log(fmt(x));
};

seccion('Puentes faltantes (F1: Object.assign(window, {...}))', [...archivosConPuentes], ([ruta, xs]) =>
  `${ruta}\n    ${xs.map((x) => `${x.nombre} [${x.kind}] ← ${x.usadoPor.length} usuario(s)`).join('\n    ')}`);
seccion('Estado mutable compartido (arreglo a mano)', [...archivosMutables], ([ruta, xs]) =>
  `${ruta}\n    ${xs.map((x) => `${x.nombre} [${x.kind}] reasignada en líneas ${x.reasignaciones.join(',') || '—'}${x.escritoFuera ? ' y ESCRITA DESDE FUERA' : ''} ← ${x.usadoPor.join(', ')}`).join('\n    ')}`);
seccion('Escrituras ajenas (arreglo a mano)', escriturasAjenas, (x) =>
  `${x.quien}: escribe "${x.nombre}"${x.declaradoEn.length ? ' declarada en ' + x.declaradoEn.join(', ') : ' (sin declarar en ningún lado)'}`);
seccion('No compilan como módulo', noCompilaComoModulo, (x) => x);
seccion('this de nivel superior', thisTop, (x) => `${x.ruta}: líneas ${x.lineas.join(', ')}`);
seccion('Mutación de namespace ajeno', mutacionesAjenas, (x) => `${x.ruta}:${x.linea} window.${x.nombre}.…`);
seccion('Errores de parseo', errores, (x) => x);

const sinProv = [...sinProveedor].map(([n, l]) => ({ nombre: n, usos: l.length, ejemplo: l[0].quien }))
  .sort((a, b) => b.usos - a.usos);
seccion('Nombres libres sin proveedor conocido (top 40: CDN, bug latente o global de otra página)', sinProv.slice(0, 40), (x) =>
  `${x.nombre} (${x.usos} uso(s), p.ej. ${x.ejemplo})`);

if (jsonOut) {
  const datos = {
    puentes, mutableCompartido, escriturasAjenas, noCompilaComoModulo, thisTop, mutacionesAjenas,
    sinProveedor: sinProv,
    html: Object.fromEntries([...HTML].map(([r, h]) => [r, { handlers: h.handlers, sinVersion: h.sinVersion, tagsLocales: h.tagsLocales, decls: [...h.decls] }])),
    js: Object.fromEntries([...JS].map(([r, x]) => [r, {
      decls: Object.fromEntries([...x.decls].map(([n, d]) => [n, d.kind])),
      exps: [...x.exps], usaCompat: x.usaCompat, esModulo: !!x.esModulo,
    }])),
  };
  fs.writeFileSync(jsonOut, JSON.stringify(datos, null, 2));
  console.log(`\nJSON escrito en ${jsonOut}`);
}

if (estricto && (puentes.length || mutableCompartido.length || escriturasAjenas.length || noCompilaComoModulo.length || errores.length)) {
  process.exit(1);
}
