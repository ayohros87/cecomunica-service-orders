// Recorre las 8 pestañas del espacio Almacén contra el emulador con sesión
// real y mide, por visita: auth resuelta, primera petición a Firestore,
// spinner encendido/apagado y última mutación del contenido.
//   node emu-walk-almacen.mjs <email> [conCache|sinCache]
import puppeteer from 'file:///C:/Projects/cecomunica-service-orders/functions/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const [EMAIL, MODO = 'conCache'] = process.argv.slice(2);
const PASS = 'emulador123';
const BASE = 'http://127.0.0.1:5000';
const PERFIL = `${process.cwd()}/chrome-emu-${MODO}-${Date.now()}`;

const cache = new Map();
async function chunkParchado(url) {
  if (cache.has(url)) return cache.get(url);
  let src = await (await fetch(url)).text();
  const antes = src.length;
  // Firestore → emulador (settings ya lleva merge:!0)
  src = src.replace(/settings\(\{merge:!0,/, 'settings({merge:!0,host:"127.0.0.1:8080",ssl:!1,');
  if (MODO === 'sinCache') src = src.replace(/localCache:\w+\(\{tabManager:\w+\(\)\}\),/, '');
  // Auth → emulador + login automático cuando no hay sesión (se traga el null
  // que dispararía la redirección a login.html)
  src = src.replace(/(\w+)\.auth\(\)\.setPersistence\(/, (m, y) =>
    `${y}.auth().useEmulator("http://127.0.0.1:9099",{disableWarnings:!0});` +
    `(function(){var a=${y}.auth();var o=a.onAuthStateChanged.bind(a);a.onAuthStateChanged=function(cb){return o(function(u){` +
    `if(u){if(!window.__tAuth){window.__tAuth=performance.now();}cb(u);}else if(!window.__login){window.__login=1;` +
    `a.signInWithEmailAndPassword(${JSON.stringify(EMAIL)},${JSON.stringify(PASS)}).catch(function(e){console.error("login",e.code||e)});}});};})();` +
    `window.__EMULADOR__=1;${y}.auth().setPersistence(`);
  if (src.length === antes) throw new Error('no se pudo parchar ' + url);
  cache.set(url, src);
  return src;
}

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--disable-extensions', `--user-data-dir=${PERFIL}`] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.setRequestInterception(true);
let fsReqs = []; let t0 = 0;
page.on('request', async (req) => {
  const u = req.url();
  if (/\/assets\/firebase-init-[^/]+\.js$/.test(u)) { try { req.respond({ status: 200, contentType: 'application/javascript', body: await chunkParchado(u) }); } catch (e) { console.error(e.message); req.continue(); } return; }
  if (u.includes('127.0.0.1:8080')) fsReqs.push(Date.now() - t0);
  req.continue();
});
const errores = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errores.push(m.text().slice(0, 140)); });
page.on('pageerror', e => errores.push('pageerror ' + String(e).slice(0, 140)));

// Instrumentación en cada documento: spinner on/off y última mutación del contenido.
await page.evaluateOnNewDocument(() => {
  window.__m = { loaderOn: null, loaderOff: null, ultimaMut: 0, filas: null };
  const t = () => Math.round(performance.now());
  // Errores legibles (Error → mensaje) y bitácora de consultas por servicio:
  // los servicios publican window.X = X al final de su módulo; una trampa de
  // setter envuelve sus métodos async para anotar nombre, inicio, fin y tamaño.
  const oe = console.error.bind(console);
  console.error = (...a) => oe(...a.map(x => (x && x.message) ? `${x.code || ''} ${x.message}`.trim() : x));
  window.__q = [];
  const envolver = (nombre, obj) => {
    if (!obj || typeof obj !== 'object' || obj.__envuelto) return obj;
    obj.__envuelto = true;
    for (const k of Object.keys(obj)) {
      const f = obj[k];
      if (typeof f !== 'function' || /^(_|ESTADOS|normalizar|es[A-Z]|chip|modeloKey|tarjetas)/.test(k)) continue;
      obj[k] = function (...args) {
        const r = f.apply(this, args);
        if (!r || typeof r.then !== 'function') return r;
        const q = { n: `${nombre}.${k}`, ini: t(), fin: null, tam: null, err: null };
        window.__q.push(q);
        return r.then(v => { q.fin = t(); q.tam = Array.isArray(v) ? v.length : (v instanceof Map ? v.size : (v && typeof v === 'object' ? Object.keys(v).length : (typeof v === 'number' ? v : null))); return v; },
                      e => { q.fin = t(); q.err = e?.code || e?.message || String(e); throw e; });
      };
    }
    return obj;
  };
  for (const s of ['ColaInventarioService', 'EquiposPoolService', 'ModelosService', 'InventarioService', 'ConflictosPoolService', 'GestionesService',
                   'EquiposDescartadosService', 'EquiposCondicionesService', 'CobrosEquiposService', 'PiezasService', 'UsuariosService', 'ContratosService', 'Sesion']) {
    let v; Object.defineProperty(window, s, { configurable: true, get: () => v, set: (x) => { v = envolver(s, x); } });
  }
  const arrancar = () => {
    const l = document.getElementById('loader');
    if (l) new MutationObserver(() => { const v = l.style.display !== 'none'; if (v && window.__m.loaderOn === null) window.__m.loaderOn = t(); if (!v && window.__m.loaderOn !== null && window.__m.loaderOff === null) window.__m.loaderOff = t(); }).observe(l, { attributes: true, attributeFilter: ['style'] });
    const raiz = document.querySelector('.app-wrap') || document.body;
    new MutationObserver(() => { window.__m.ultimaMut = t(); }).observe(raiz, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
});

const r = (n) => n == null ? '—' : String(Math.round(n)).padStart(5) + 'ms';
async function visita(nombre, url, { click } = {}) {
  errores.length = 0; fsReqs = []; t0 = Date.now();
  if (click) {
    await page.evaluate(() => { window.__m = { loaderOn: null, loaderOff: null, ultimaMut: 0 }; window.__q = []; window.__t0 = performance.now(); });
    await page.click(`.ws-tab[data-ws-tab="${click}"]`);
  } else {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  }
  // espera hasta que el contenido lleve 1,5 s sin cambiar (máx 25 s)
  const fin = Date.now() + 25000; let quieto = false;
  while (Date.now() < fin) {
    await new Promise(res => setTimeout(res, 250));
    const m = await page.evaluate(() => ({ ...window.__m, now: performance.now(), t0: window.__t0 || 0, tAuth: window.__tAuth, emu: window.__EMULADOR__, url: location.pathname + location.search }));
    const pendientes = await page.evaluate(() => window.__q.filter(q => q.fin === null).length);
    if (m.ultimaMut && m.now - m.ultimaMut > 1500 && (m.loaderOn === null || m.loaderOff !== null) && !pendientes) { quieto = true; break; }
    if (!m.ultimaMut && m.now - m.t0 > 3000 && !pendientes) { quieto = true; break; } // clic sin mutaciones (sección ya pintada)
  }
  const m = await page.evaluate(() => {
    const t0 = window.__t0 || 0; const f = (v) => v == null ? null : v - t0;
    const filas = document.querySelectorAll('tbody tr, .bj-card, .bandeja-card, .hoy-grupo, .alm-fila, .eqpool-fila').length;
    const q = (window.__q || []).filter(x => x.ini >= t0).map(x => `${x.n} ${f(x.ini)}→${x.fin == null ? '…' : f(x.fin)}ms${x.tam != null ? ` [${x.tam}]` : ''}${x.err ? ` ERR ${x.err}` : ''}`);
    return { loaderOn: f(window.__m.loaderOn), loaderOff: f(window.__m.loaderOff), ultimaMut: f(window.__m.ultimaMut), tAuth: f(window.__tAuth), emu: window.__EMULADOR__, filas, url: location.pathname + location.search, q };
  });
  if (!m.emu) console.log('   ¡OJO! el parche del emulador no corrió');
  if (!m.url.includes(url.split('?')[0].split('/').pop())) console.log(`   ¡OJO! terminó en ${m.url}`);
  console.log(`${nombre.padEnd(34)} auth ${r(m.tAuth)} · 1ª petición Firestore ${r(fsReqs[0])} (${String(fsReqs.length).padStart(3)} peticiones) · spinner ${r(m.loaderOn)}→${r(m.loaderOff)} · contenido quieto a ${r(m.ultimaMut)}${quieto ? '' : ' (NO se aquietó en 25 s)'} · ${m.filas} filas/tarjetas`);
  if (errores.length) console.log('   errores: ' + [...new Set(errores)].slice(0, 4).join(' | '));
  if (m.q.length) console.log('   consultas: ' + m.q.join(' · '));
}

console.log(`\n=== ${MODO} · ${EMAIL} ===`);
const PAGINAS = [
  ['Hoy (almacen/index.html)', '/almacen/index.html'],
  ['Asignar (?tab=asignar)', '/almacen/index.html?tab=asignar'],
  ['Existencias (?tab=existencias)', '/almacen/index.html?tab=existencias'],
  ['Avanzado (?tab=serial)', '/almacen/index.html?tab=serial'],
  ['Piezas', '/inventario/piezas.html'],
  ['Descartados', '/inventario/descartados.html'],
  ['Con condición', '/inventario/condiciones.html'],
  ['No devueltos', '/inventario/no-devueltos.html'],
];
for (const pasada of ['1ª visita (caché local vacía)', '2ª visita (caché local llena)']) {
  console.log(`\n--- ${pasada} ---`);
  for (const [n, u] of PAGINAS) await visita(n, u);
}
console.log('\n--- cambio de pestaña EN la página (sin recargar), desde Hoy ---');
await visita('Hoy', '/almacen/index.html');
for (const t of ['asignar', 'existencias', 'serial', 'hoy']) await visita(`clic → ${t}`, '/almacen/index.html', { click: t });
await browser.close();
