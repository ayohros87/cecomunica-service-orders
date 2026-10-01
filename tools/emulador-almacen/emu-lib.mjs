// Librería compartida para recorrer el app REAL contra los emuladores con
// sesión de cualquier usuario sembrado (clave emulador123). Auditoría de
// módulos 2026-09-30. Uso:
//   import { abrir, USUARIOS } from './emu-lib.mjs';
//   const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ordenes' });
//   await s.ir('/ordenes/index.html');          // navega y espera a que el contenido se aquiete
//   await s.captura('01-bandeja');               // PNG en docs/auditoria-modulos/capturas/<carpeta>/
//   s.errores  await s.toasts()  await s.consultas()   // errores de consola, Toast.show acumulados, consultas por servicio
//   await s.cerrar();
// Viewports: escritorio 1280×800 · tablet 1024×768 · telefono 390×844 (isMobile+touch)
import puppeteer from 'file:///C:/Projects/cecomunica-service-orders/functions/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE || 'http://127.0.0.1:5000';
export const PASS = 'emulador123';
export const CAPTURAS = 'C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas';
export const VIEWPORTS = {
  escritorio: { width: 1280, height: 800 },
  tablet: { width: 1024, height: 768, hasTouch: true },
  telefono: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
export const USUARIOS = {
  admin: 'alberto.yohros@cecomunica.com', gerencia: 'zuleika.diaz@cecomunica.com',
  recepcion: 'cecrecep@cecomunica.com', cobros: 'cobros@cecomunica.com',
  jefe_taller: 'solangel.hosang@cecomunica.com', tecnico: 'marcos.perez@cecomunica.com',
  tecnico_operativo: 'ovidio.adames@cecomunica.com', inventario: 'jose.solis@cecomunica.com',
  vendedor: 'karla.ferrer@cecomunica.com', contabilidad: 'cheila.sanchez@cecomunica.com',
};

const cacheChunks = new Map();
async function chunkParchado(url, email) {
  const k = url + '|' + email;
  if (cacheChunks.has(k)) return cacheChunks.get(k);
  let src = await (await fetch(url)).text();
  const antes = src.length;
  src = src.replace(/settings\(\{merge:!0,/, 'settings({merge:!0,host:"127.0.0.1:8080",ssl:!1,');
  src = src.replace(/(\w+)\.auth\(\)\.setPersistence\(/, (m, y) =>
    `${y}.auth().useEmulator("http://127.0.0.1:9099",{disableWarnings:!0});` +
    `(function(){var a=${y}.auth();var o=a.onAuthStateChanged.bind(a);a.onAuthStateChanged=function(cb){return o(function(u){` +
    `if(u){if(!window.__tAuth){window.__tAuth=performance.now();}cb(u);}else if(!window.__login){window.__login=1;` +
    `a.signInWithEmailAndPassword(${JSON.stringify(email)},${JSON.stringify(PASS)}).catch(function(e){console.error("login",e.code||e)});}});};})();` +
    `window.__EMULADOR__=1;${y}.auth().setPersistence(`);
  if (src.length === antes) throw new Error('no se pudo parchar ' + url);
  cacheChunks.set(k, src);
  return src;
}

export async function abrir({ email, viewport = 'escritorio', carpeta = 'varios', headless = true } = {}) {
  if (!email) throw new Error('falta email');
  const vp = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport;
  const perfil = `${(process.env.TEMP || 'C:/Temp').replace(/\\/g, '/')}/chrome-emu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless,
    args: ['--disable-extensions', `--user-data-dir=${perfil}`, '--lang=es-PA'] });
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.setRequestInterception(true);
  const s = { browser, page, errores: [], fsReqs: [], _t0: Date.now(), viewport: vp, email, carpeta };
  page.on('request', async (req) => {
    const u = req.url();
    if (/\/assets\/firebase-init-[^/]+\.js$/.test(u)) { try { req.respond({ status: 200, contentType: 'application/javascript', body: await chunkParchado(u, email) }); } catch (e) { console.error(e.message); req.continue(); } return; }
    if (/googleapis\.com|gstatic\.com\/firebasejs|identitytoolkit/.test(u) && !u.includes('fonts') && !u.includes('127.0.0.1')) { s.errores.push('¡PRODUCCIÓN! ' + u.slice(0, 100)); }
    if (u.includes('127.0.0.1:8080')) s.fsReqs.push(Date.now() - s._t0);
    req.continue();
  });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') s.errores.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => s.errores.push('pageerror ' + String(e).slice(0, 200)));
  page.on('dialog', async d => { s.errores.push('dialog nativo: ' + d.message().slice(0, 100)); await d.accept(); });

  await page.evaluateOnNewDocument(() => {
    window.__m = { loaderOn: null, loaderOff: null, ultimaMut: 0 };
    window.__toasts = []; window.__q = [];
    const t = () => Math.round(performance.now());
    const oe = console.error.bind(console);
    console.error = (...a) => oe(...a.map(x => (x && x.message) ? `${x.code || ''} ${x.message}`.trim() : x));
    // Toast.show acumulado
    let toast; Object.defineProperty(window, 'Toast', { configurable: true, get: () => toast, set: (v) => {
      toast = v; if (v && typeof v.show === 'function' && !v.__envuelto) { const os = v.show.bind(v); v.__envuelto = true;
        v.show = (msg, type, d) => { window.__toasts.push({ t: t(), msg: String(msg), type: type || 'ok' }); return os(msg, type, d); };
        if (typeof v.persist === 'function') { const op = v.persist.bind(v); v.persist = (msg, type) => { window.__toasts.push({ t: t(), msg: String(msg), type: type || 'ok', persist: true }); return op(msg, type); }; } } } });
    // Consultas por servicio (trampa de setter en window.<Service>)
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
    for (const sName of ['OrdenesService', 'ContratosService', 'CotizacionesService', 'ClientesService', 'EquiposPoolService', 'ModelosService', 'InventarioService',
      'GestionesService', 'PocService', 'PocDevicesService', 'SimCardsService', 'ColaInventarioService', 'ConflictosPoolService', 'EquiposDescartadosService',
      'EquiposCondicionesService', 'CobrosEquiposService', 'PiezasService', 'UsuariosService', 'SenalesService', 'FacturacionService', 'CargosService', 'Sesion']) {
      let v; Object.defineProperty(window, sName, { configurable: true, get: () => v, set: (x) => { v = envolver(sName, x); } });
    }
    const arrancar = () => {
      const l = document.getElementById('loader');
      if (l) new MutationObserver(() => { const v = l.style.display !== 'none'; if (v && window.__m.loaderOn === null) window.__m.loaderOn = t(); if (!v && window.__m.loaderOn !== null && window.__m.loaderOff === null) window.__m.loaderOff = t(); }).observe(l, { attributes: true, attributeFilter: ['style'] });
      const raiz = document.querySelector('.app-wrap') || document.body;
      new MutationObserver(() => { window.__m.ultimaMut = t(); }).observe(raiz, { childList: true, subtree: true, characterData: true, attributes: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
  });

  // Espera a que el DOM lleve `ms` sin mutar y no haya consultas pendientes (máx `max`).
  s.quieto = async (ms = 1200, max = 20000) => {
    const fin = Date.now() + max;
    while (Date.now() < fin) {
      await new Promise(r => setTimeout(r, 200));
      const m = await page.evaluate(() => ({ ...window.__m, now: performance.now(), pend: (window.__q || []).filter(q => q.fin === null).length })).catch(() => null);
      if (!m) continue;
      if (m.now - (m.ultimaMut || 0) > ms && (m.loaderOn === null || m.loaderOff !== null) && !m.pend) return true;
    }
    return false;
  };
  s.ir = async (url, { esperar = 1200 } = {}) => {
    s.errores.length = 0; s.fsReqs = []; s._t0 = Date.now();
    const t0 = Date.now();
    await page.goto(url.startsWith('http') ? url : BASE + url, { waitUntil: 'domcontentloaded' });
    const ok = await s.quieto(esperar);
    const info = await page.evaluate(() => ({ url: location.pathname + location.search, emu: !!window.__EMULADOR__, tAuth: window.__tAuth, ultimaMut: window.__m.ultimaMut, titulo: document.title })).catch(() => ({}));
    info.msTotal = Date.now() - t0; info.quieto = ok; info.fsReqs = s.fsReqs.length; info.primeraFs = s.fsReqs[0];
    if (!info.emu) s.errores.push('¡OJO! el parche del emulador no corrió en ' + url);
    if (info.url && info.url.includes('login.html')) s.errores.push('rebotó a login.html desde ' + url);
    return info;
  };
  s.captura = async (nombre, { full = false, el = null } = {}) => {
    const dir = path.join(CAPTURAS, carpeta); fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${nombre}.png`).replace(/\\/g, '/');
    if (el) { const h = await page.$(el); if (h) { await h.screenshot({ path: p }); return p; } }
    await page.screenshot({ path: p, fullPage: full });
    return p;
  };
  s.toasts = () => page.evaluate(() => window.__toasts || []);
  s.consultas = () => page.evaluate(() => (window.__q || []).map(x => `${x.n} ${x.ini}→${x.fin == null ? '…' : x.fin}ms${x.tam != null ? ` [${x.tam}]` : ''}${x.err ? ` ERR ${x.err}` : ''}`));
  // Clic que espera a que la página se aquiete después.
  s.clic = async (sel, { esperar = 800 } = {}) => { await page.click(sel); return s.quieto(esperar, 15000); };
  // Ejecuta en la página y espera aquietamiento.
  s.hacer = async (fn, ...args) => { const r = await page.evaluate(fn, ...args); await s.quieto(800, 15000); return r; };
  // Texto visible de la página (para juzgar sin captura)
  s.texto = (sel = 'body') => page.evaluate((q) => (document.querySelector(q)?.innerText || '').replace(/\n{3,}/g, '\n\n'), sel);
  // Geometría: alto total, scroll horizontal, objetivos táctiles chicos (< 36 px)
  s.geometria = () => page.evaluate(() => {
    const vh = innerHeight, vw = innerWidth;
    const objs = [...document.querySelectorAll('button, a[href], input, select, [role=button]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const chicos = objs.filter(e => { const r = e.getBoundingClientRect(); return r.height < 36 || r.width < 36; }).length;
    return { vw, vh, altoTotal: document.documentElement.scrollHeight, scrollHorizontal: document.documentElement.scrollWidth > vw + 1, objetivos: objs.length, objetivosChicos: chicos };
  });
  s.cerrar = async () => { try { await browser.close(); } catch {} try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {} };
  return s;
}
