// ¿Quién lee equipos_pool ENTERO al abrir Almacén · Existencias? (auditoría de
// lecturas 2026-10-21: bodega lo bajaba ~10 veces al día, 7,846 fichas cada vez).
//   node emu-cazar-pool-completo.mjs [ruta]   (default: /inventario/index.html)
//   VACIO=1     la primera lectura del resumen llega vacía (lo que pasaba en el
//               Firefox de bodega): el reintento al servidor debe evitar el pool.
//   VACIO=todo  el resumen está vacío también en el servidor: control positivo,
//               ahí SÍ se cae al pool completo (y el gancho lo tiene que ver).
import { abrir, USUARIOS, BASE } from './emu-lib.mjs';

const ruta = process.argv[2] || '/inventario/index.html';
const s = await abrir({ email: USUARIOS.inventario, carpeta: 'pool-completo' });
await s.page.evaluateOnNewDocument((vacio) => {
  window.__poolCompleto = [];
  window.__reintentos = 0;
  const t = setInterval(() => {
    const fs = window.firebase && firebase.firestore;
    if (!fs || !fs.Query || fs.Query.prototype.__cazado) return;
    clearInterval(t);
    const Q = fs.Query.prototype;
    for (const m of ['get', 'onSnapshot']) {
      const orig = Q[m];
      Q[m] = function (...a) {
        if (this instanceof fs.CollectionReference && this.id === 'equipos_pool') {
          window.__poolCompleto.push({ m, t: Math.round(performance.now()), stack: new Error().stack.split('\n').slice(2, 9).join('\n') });
        }
        return orig.apply(this, a);
      };
    }
    Q.__cazado = true;
  }, 5);
  if (!vacio) return;
  const t2 = setInterval(() => {
    const S = window.EquiposPoolService;
    if (!S || S.__parchado) return;
    clearInterval(t2);
    S.__parchado = true;
    const orig = S._leerResumen.bind(S);
    let n = 0;
    S._leerResumen = (a = {}) => {
      if (a.source === 'server') window.__reintentos++;
      if (a.source === 'cache') return orig(a);
      if (vacio === 'todo' || n++ === 0) return Promise.resolve([]);
      return orig(a);
    };
  }, 2);
}, process.env.VACIO || '');
await s.page.goto(BASE + ruta, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 25000));
const r = await s.page.evaluate(() => ({
  url: location.href, hits: window.__poolCompleto || [], cazado: !!firebase.firestore.Query.prototype.__cazado,
  reintentos: window.__reintentos, filas: document.querySelectorAll('#tab-existencias tbody tr').length,
}));
console.log('url final:', r.url, '| gancho:', r.cazado, '| reintentos al servidor:', r.reintentos, '| filas en Existencias:', r.filas);
console.log('lecturas de equipos_pool SIN filtro:', r.hits.length);
for (const h of r.hits) console.log(`--- ${h.m} @${h.t}ms\n${h.stack}`);
console.log('errores:', s.errores.slice(0, 8));
await s.browser.close();
