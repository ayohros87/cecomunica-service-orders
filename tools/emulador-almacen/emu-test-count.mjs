// Prueba del Query.count() restaurado en compat, contra el emulador con sesión real.
import puppeteer from 'file:///C:/Projects/cecomunica-service-orders/functions/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const EMAIL = 'alberto.yohros@cecomunica.com', PASS = 'emulador123', BASE = 'http://127.0.0.1:5000';
const cache = new Map();
async function chunkParchado(url) {
  if (cache.has(url)) return cache.get(url);
  let src = await (await fetch(url)).text();
  src = src.replace(/settings\(\{merge:!0,/, 'settings({merge:!0,host:"127.0.0.1:8080",ssl:!1,');
  src = src.replace(/(\w+)\.auth\(\)\.setPersistence\(/, (m, y) =>
    `${y}.auth().useEmulator("http://127.0.0.1:9099",{disableWarnings:!0});` +
    `(function(){var a=${y}.auth();var o=a.onAuthStateChanged.bind(a);a.onAuthStateChanged=function(cb){return o(function(u){` +
    `if(u){cb(u);}else if(!window.__login){window.__login=1;a.signInWithEmailAndPassword(${JSON.stringify(EMAIL)},${JSON.stringify(PASS)}).catch(function(e){console.error("login",e.code||e)});}});};})();` +
    `window.__EMULADOR__=1;${y}.auth().setPersistence(`);
  cache.set(url, src); return src;
}
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--disable-extensions', `--user-data-dir=${process.cwd()}/chrome-count-${Date.now()}`] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', async (req) => {
  const u = req.url();
  if (/\/assets\/firebase-init-[^/]+\.js$/.test(u)) { req.respond({ status: 200, contentType: 'application/javascript', body: await chunkParchado(u) }); return; }
  req.continue();
});
page.on('console', m => { if (m.type() === 'error') console.log('   consola:', m.text().slice(0, 160)); });
await page.goto(BASE + '/almacen/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.firebase && firebase.auth().currentUser, { timeout: 20000 });
const r = await page.evaluate(async () => {
  const db = firebase.firestore();
  const out = {};
  out.compatTieneCount = typeof db.collection('x').count === 'function';
  const c = async (q) => (await q.count().get()).data().count;
  // 1) Avanzado / Hoy: sin verificar
  out.sinVerificar = await c(db.collection('equipos_pool').where('verificado', '==', false));
  // 2) colaInventarioService.contarParaBadge (tal cual)
  out.badgeCola = await ColaInventarioService.contarParaBadge();
  // 3) gestionesService.contarAbiertasPorCliente: total abiertas por todos los clientes
  out.gestionesAbiertas = await c(db.collection('gestiones').where('estado', 'in', ['pendiente_firma', 'pendiente_bodega', 'en_proceso']));
  // 4) clientesService: conteo simple sobre una colección
  out.clientes = await c(db.collection('clientes'));
  // 5) FbAgg (modular directo) debe coincidir con compat
  out.sinVerificarFbAgg = await FbAgg.count('equipos_pool', [['verificado', '==', false]]);
  // Un get() normal sigue funcionando (no se rompió el prototipo)
  out.getNormal = (await db.collection('modelos').limit(3).get()).size;
  return out;
});
console.log(JSON.stringify(r, null, 1));
const ok = r.compatTieneCount && r.sinVerificar === 4408 && r.sinVerificarFbAgg === 4408 && r.gestionesAbiertas === 22 && r.clientes === 457 && r.getNormal === 3;
console.log(ok ? 'TODO OK' : 'FALLA');
await browser.close();
process.exit(ok ? 0 : 1);
