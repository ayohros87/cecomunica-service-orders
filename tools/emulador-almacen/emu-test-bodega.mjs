// Prueba de la bodega por familia (Asignar, Tomar de bodega) y del pintado por
// tandas de Avanzado, contra el emulador con datos de producción y sesión real.
//   node emu-test-bodega.mjs
// Esperados = simulación sobre el export (2026-09-30): familia por catálogo.
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
  args: ['--disable-extensions', `--user-data-dir=${process.cwd()}/chrome-bodega-${Date.now()}`] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', async (req) => {
  const u = req.url();
  if (/\/assets\/firebase-init-[^/]+\.js$/.test(u)) { req.respond({ status: 200, contentType: 'application/javascript', body: await chunkParchado(u) }); return; }
  req.continue();
});
const errores = [];
page.on('pageerror', e => errores.push(String(e).slice(0, 160)));
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
await page.goto(BASE + '/almacen/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.firebase && firebase.auth().currentUser && window.EquiposPoolService, { timeout: 20000 });
// Deja que termine la carga de Hoy: se mide la consulta sola, no compitiendo con el arranque.
await espera(6000);

console.log('1) listarBodegaDe: por familia del catálogo, solo esos modelos');
const r1 = await page.evaluate(async () => {
  const M = { hytp50: 'QiNjZ51R6sgsTxTES2cP', pd606r: 'LJ4N4gDGhVDIiZFN0kua', pnc360sr: 'x7hlVuYhyf22JhzR4hqz',
              ap516r: 'tdvKAWGdJcnmRT1iaEse', hytp50r: 'SgppvPQ0IuWIY2QQukER', pnc460r: '6tdGBjLOmq567GJRTMbQ' };
  const t0 = performance.now();
  const res = await EquiposPoolService.listarBodegaDe(Object.values(M).map(id => ({ modelo_id: id, modelo: '' })));
  const ms = Math.round(performance.now() - t0);
  const n = {}; for (const [k, id] of Object.entries(M)) n[k] = res.deRef({ modelo_id: id, modelo: '' }).length;
  const soloEnBodega = res.unidades.every(u => u.estado === 'en_bodega');
  const hayPro = res.deRef({ modelo_id: M.hytp50 }).some(u => /PRO/i.test(u.modelo_label || ''));
  return { n, leidas: res.unidades.length, sinFicha: res.sinFicha, porFamilia: res.porFamilia, soloEnBodega, hayPro, ms };
});
console.log('   ', JSON.stringify(r1));
ok(r1.porFamilia, 'consulta por familia (no cayó a la lista completa)');
ok(r1.n.hytp50 === 83 && r1.n.hytp50r === 83, `HYT-P50 y HYT-P50-R = 83 (antes 90 con el pareo difuso): ${r1.n.hytp50}/${r1.n.hytp50r}`);
ok(r1.n.pd606r === 175, `PD606-R = 175 (antes 192, sumaba PD606G): ${r1.n.pd606r}`);
ok(r1.n.pnc360sr === 359 && r1.n.pnc460r === 30 && r1.n.ap516r === 41, `PNC360S-R 359 · PNC460-R 30 · AP516VHF-R 41: ${r1.n.pnc360sr}/${r1.n.pnc460r}/${r1.n.ap516r}`);
ok(!r1.hayPro, 'HYT-P50 ya no ofrece HYT-P50 PRO');
ok(r1.soloEnBodega && r1.leidas < 900, `leídas ${r1.leidas} fichas en bodega (antes 2,861) en ${r1.ms} ms`);
ok(r1.sinFicha === 2, `radios en bodega sin modelo: ${r1.sinFicha} (se informan, no se ofrecen)`);

console.log('2) Un fallo de consulta NO se presenta como "no existe"');
const r2 = await page.evaluate(async () => {
  const Q = firebase.firestore.Query.prototype; const orig = Q.get;
  Q.get = function () { return Promise.reject(Object.assign(new Error('simulado'), { code: 'unavailable' })); };
  const out = {};
  try { await EquiposPoolService.findBySeriales(['ABC12345']); out.find = 'no lanzó'; } catch (e) { out.find = e.code; }
  try { await EquiposPoolService.listarBodegaDe([{ modelo_id: 'QiNjZ51R6sgsTxTES2cP' }]); out.bodega = 'no lanzó'; } catch (e) { out.bodega = e.code || e.message; }
  Q.get = orig;
  return out;
});
ok(r2.find === 'pool/consulta-incompleta', `findBySeriales lanza en vez de devolver []: ${r2.find}`);
ok(r2.bodega !== 'no lanzó', `listarBodegaDe lanza en vez de devolver una lista parcial: ${r2.bodega}`);

console.log('3) Asignar: picklist con los disponibles por familia');
await page.evaluate(() => AlmacenPage.abrirAsignar({ g: 'GA20260925-01' }));
await page.waitForFunction(() => (document.getElementById('asPicklist')?.textContent || '').includes('disponible'), { timeout: 20000 }).catch(() => {});
const pl = await page.evaluate(() => document.getElementById('asPicklist')?.innerText || '');
console.log('    picklist:', pl.replace(/\s+/g, ' ').trim());
ok(/PNC360S-R/.test(pl) && /359 disponibles/.test(pl), 'la gestión de PNC360S-R (Fortaleza) dice 359 disponibles, igual que la familia del catálogo');
ok(/sin modelo en su ficha/.test(pl), 'dice que hay radios en bodega sin modelo que no se cuentan');

console.log('4) Asignar: si la consulta falla, NO dice "0 disponibles"');
await page.evaluate(() => { window.__origBD = EquiposPoolService.listarBodegaDe; EquiposPoolService.listarBodegaDe = () => Promise.reject(new Error('simulado')); });
await page.evaluate(() => AlmacenPage.abrirAsignar({ g: 'GD20260929-01' }));
await page.waitForFunction(() => /no consultado|disponible/.test(document.getElementById('asPicklist')?.textContent || ''), { timeout: 20000 }).catch(() => {});
const pl2 = await page.evaluate(() => document.getElementById('asPicklist')?.innerText || '');
await page.evaluate(() => { EquiposPoolService.listarBodegaDe = window.__origBD; });
console.log('    picklist:', pl2.replace(/\s+/g, ' ').trim());
ok(/stock no consultado/.test(pl2) && !/0 disponibles/.test(pl2), 'dice "stock no consultado", no "0 disponibles"');

console.log('5) Avanzado: pinta por tandas y lo dice');
await page.evaluate(() => AlmacenPage.setTab('serial'));
await page.waitForFunction(() => document.querySelectorAll('#eqTabla tr').length > 50, { timeout: 30000 }).catch(() => {});
await espera(800);
const a1 = await page.evaluate(() => ({
  filas: document.querySelectorAll('#eqTabla tr:not(.eq-ver-mas)').length,
  verMas: document.querySelector('#eqTabla .eq-ver-mas')?.innerText.replace(/\s+/g, ' ').trim() || '',
  resumen: document.getElementById('eqResumen')?.innerText.replace(/\s+/g, ' ').trim() || '',
  total: EquiposPool._filtrados().length,
}));
console.log('   ', JSON.stringify(a1));
ok(a1.filas === 200 && a1.total === 2861, `pinta 200 de ${a1.total}`);
ok(/200 de 2,861/.test(a1.verMas) && /cumplen el filtro/.test(a1.verMas), 'la fila final dice cuántos faltan y que cumplen el filtro');
ok(/200 de 2,861/.test(a1.resumen) && /faltan 2,661/.test(a1.resumen), 'el resumen no dice "equipos mostrados" a secas');
const a2 = await page.evaluate(() => { EquiposPool.toggleTodos(true); const n = EquiposPool._sel.size; EquiposPool.limpiarSeleccion(); return n; });
ok(a2 === 200, `"Seleccionar todo" toma solo lo pintado: ${a2}`);
const t0 = Date.now();
await page.evaluate(() => EquiposPool.verMas());
const a3 = await page.evaluate(() => document.querySelectorAll('#eqTabla tr:not(.eq-ver-mas)').length);
ok(a3 === 400, `Ver más → ${a3} filas (${Date.now() - t0} ms)`);
await page.evaluate(() => EquiposPool.verMas(true));
const a4 = await page.evaluate(() => ({ filas: document.querySelectorAll('#eqTabla tr:not(.eq-ver-mas)').length, verMas: !!document.querySelector('#eqTabla .eq-ver-mas'), resumen: document.getElementById('eqResumen')?.innerText.replace(/\s+/g, ' ').trim() }));
ok(a4.filas === 2861 && !a4.verMas && /2,861 equipos mostrados/.test(a4.resumen), `Ver todos → ${a4.filas} filas, sin fila de "ver más": "${a4.resumen}"`);

if (errores.length) console.log('   errores de página:', errores.join(' | '));
ok(!errores.length, 'sin errores de JS en la página');
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
await browser.close();
process.exit(fallos ? 1 : 0);
