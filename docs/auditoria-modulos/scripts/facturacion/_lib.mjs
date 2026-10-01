// Ayudas del auditor de Facturación sobre emu-lib.mjs. Bloquea las callables de Cloud
// Functions (no hay emulador de functions y NADA debe salir a producción): cualquier
// httpsCallable rechaza como lo haría una función caída, y se registra si algún request
// intentó salir a cloudfunctions.net.
import { abrir as abrirBase, USUARIOS, BASE } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
export { USUARIOS, BASE };

export async function abrir(opts) {
  const s = await abrirBase({ ...opts, carpeta: 'facturacion' });
  s.fugas = [];
  s.page.on('request', (req) => { const u = req.url(); if (/cloudfunctions\.net|run\.app/.test(u)) s.fugas.push(u.slice(0, 120)); });
  await s.page.evaluateOnNewDocument(() => {
    window.__callables = [];
    const stubFunctions = (fx) => {
      if (!fx || fx.__stub) return fx;
      fx.__stub = true;
      fx.httpsCallable = (name) => () => {
        window.__callables.push({ name, t: Math.round(performance.now()) });
        return new Promise((_, rej) => setTimeout(() => { const e = new Error('internal'); e.code = 'functions/internal'; rej(e); }, 400));
      };
      return fx;
    };
    let fb;
    Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
      fb = v;
      if (v && typeof v.functions === 'function' && !v.__fxWrapped) {
        v.__fxWrapped = true;
        const of = v.functions.bind(v); v.functions = (...a) => stubFunctions(of(...a));
        const oa = v.app.bind(v);
        v.app = (...a) => {
          const app = oa(...a);
          if (app && typeof app.functions === 'function' && !app.__fxWrapped) {
            app.__fxWrapped = true;
            const af = app.functions.bind(app); app.functions = (...b) => stubFunctions(af(...b));
          }
          return app;
        };
      }
    } });
  });
  s.llamadas = () => s.page.evaluate(() => window.__callables || []);
  s.textos = (sel) => s.page.evaluate((q) => [...document.querySelectorAll(q)].map(e => e.innerText.replace(/\s+/g, ' ').trim()), sel);
  // Mide una acción: ms hasta que el DOM se aquieta
  s.medir = async (fn) => { const t0 = Date.now(); await fn(); await s.quieto(600, 10000); return Date.now() - t0; };
  s.espera = (ms) => new Promise(r => setTimeout(r, ms));
  return s;
}
export const j = (o) => JSON.stringify(o);
