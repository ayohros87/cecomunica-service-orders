// Equipos no devueltos para la jefa de taller (2026-10-15, Solangel):
//   1. la bandeja está en su rail y la página la deja entrar, sin pestañas de Almacén;
//   2. un renglón abierto con monto trae "Cotizar la reposición"; al pedirla el
//      renglón queda marcado (las rules la dejan escribir SOLO esa marca);
//   3. el servidor arma la cotización (aquí se invoca la lib directamente: el
//      emulador de Functions no corre) y la bandeja enlaza COT-… en borrador;
//   4. ella abre esa cotización como dueña y es un "no devuelto".
// Corre contra el emulador con datos (auth+firestore+hosting) y `npm run build`:
//   node tools/emulador-almacen/emu-test-no-devueltos-taller.mjs
import { execFileSync } from 'node:child_process';
import { abrir, USUARIOS } from './emu-lib.mjs';

const fallos = [];
const ok = (cond, msg) => { console.log((cond ? 'OK     ' : 'FALLA  ') + msg); if (!cond) fallos.push(msg); };
const limpio = (s) => s.errores.filter(e => !/favicon|Uso|uso_diario/.test(e));
const RAIZ = 'C:/Projects/cecomunica-service-orders';

// Un renglón abierto con monto, creado como ADMIN (quien gestiona seriales) si
// la base no trae ninguno. Serial propio para no tocar fichas reales.
const adm = await abrir({ email: USUARIOS.admin, carpeta: 'no-devueltos-taller' });
await adm.ir('/inventario/no-devueltos.html', { esperar: 1500 });
const sufijo = Date.now().toString().slice(-6);
const rowId = await adm.page.evaluate(async (suf) => {
  const S = window.CobrosEquiposService;
  const id = await S.abrir({
    cliente_id: 'emu-cli-' + suf, cliente_nombre: 'CLIENTE EMULADOR ' + suf, orden_devolucion_id: '2026101599',
    serial: 'EMUND' + suf, modelo_id: '', modelo_label: 'NX-420 (emulador)', cantidad: 1,
    motivo_codigo: 'perdido', motivo_detalle: 'Prueba del emulador', monto_catalogo_unit: 285, monto_unit: 285,
  });
  return id;
}, sufijo);
ok(!!rowId, 'admin: renglón abierto de prueba ' + rowId);
await adm.browser.close();

// ── 1 y 2. Jefa de taller ────────────────────────────────────────────────
const s = await abrir({ email: USUARIOS.jefe_taller, carpeta: 'no-devueltos-taller' });
const p = s.page;
await s.ir('/ordenes/index.html', { esperar: 1500 });
const enRail = await p.evaluate(() => !![...document.querySelectorAll('.rail__link')].find(a => /no devueltos/i.test(a.textContent)));
ok(enRail, 'jefa de taller: "Equipos no devueltos" está en su rail');

const i = await s.ir('/inventario/no-devueltos.html', { esperar: 1500 });
ok(i.url.startsWith('/inventario/no-devueltos.html'), 'jefa de taller: la página la deja entrar (' + i.url + ')');
await s.quieto(1500);
const v = await p.evaluate((id) => {
  const tabs = document.getElementById('wsTabs-mount');
  const btn = document.querySelector(`.nd-cotizar[data-id="${id}"]`);
  return { tabsOcultas: !tabs || tabs.style.display === 'none' || tabs.offsetParent === null, boton: !!btn,
    otros: document.querySelectorAll('.nd-facturar, .nd-monto-btn, .nd-condonar').length };
}, rowId);
ok(v.tabsOcultas, 'sin pestañas de Almacén');
ok(v.boton, 'el renglón trae "Cotizar la reposición"');
ok(v.otros === 0, 'no ve Monto/Facturar/Condonar (no gestiona el cobro)');
await s.captura('taller-boton-cotizar');

// Clic desde el DOM (la celda de acciones puede quedar bajo el borde de la tabla).
await p.$eval(`.nd-cotizar[data-id="${rowId}"]`, (b) => b.click());
// Modal.confirm pinta un .overlay con data-action (no la hoja .modal-backdrop).
await p.waitForSelector('.overlay [data-action="confirm"]', { timeout: 5000 }).catch(() => null);
const conf = await p.$('.overlay [data-action="confirm"]');
ok(!!conf, 'pide confirmación ' + (conf ? '' : JSON.stringify(s.errores.slice(-3))));
if (conf) await conf.click();
await s.quieto(1500);
const marcado = await p.evaluate(async (id) => {
  const d = (await firebase.firestore().collection('cobros_equipos').doc(id).get()).data();
  return { pedida: !!d.cotizacion_pedida, por: d.cotizacion_pedida?.por_email || '', doc: d.cotizacion_doc_id || null };
}, rowId);
ok(marcado.pedida && /solangel/.test(marcado.por), 'el renglón quedó marcado cotizacion_pedida por ella (rules OK) ' + JSON.stringify(marcado));
const toasts = await s.toasts();
ok(toasts.some(t => /Pedida/.test(t.msg)), 'aviso "Pedida…"');
ok(!toasts.some(t => t.type === 'bad'), 'sin errores de permiso ' + JSON.stringify(toasts.filter(t => t.type === 'bad')));

// ── 3. El servidor arma la cotización (lib directa contra el emulador) ────
const out = execFileSync('node', ['-e', `
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'; process.env.GCLOUD_PROJECT='cecomunica-service-orders';
  const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'cecomunica-service-orders' });
  require('./src/lib/reposicionNoDevuelto').crearCotizacionNoDevuelto(${JSON.stringify(rowId)})
    .then(r => { console.log(JSON.stringify(r)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
`], { cwd: RAIZ + '/functions', env: { ...process.env, NODE_PATH: RAIZ + '/functions/node_modules' }, encoding: 'utf8' });
const creada = JSON.parse(out.trim().split('\n').pop());
ok(creada && creada.docId && /^COT-\d{4}-\d{4}$/.test(creada.cotizacionId), 'servidor: cotización creada ' + JSON.stringify(creada));

await s.ir('/inventario/no-devueltos.html', { esperar: 1500 });
await s.quieto(1500);
const chip = await p.evaluate((id) => {
  const a = [...document.querySelectorAll('.nd-cot a')].find(x => x.href.includes(id));
  return a ? { txt: a.closest('.nd-cot').textContent.trim(), href: a.getAttribute('href') } : null;
}, creada.docId);
ok(chip && /en borrador/.test(chip.txt), 'la bandeja enlaza la cotización en borrador: ' + (chip && chip.txt));
ok(!(await p.$(`.nd-cotizar[data-id="${rowId}"]`)), 'ya no ofrece cotizar otra vez');
await s.captura('taller-renglon-cotizado');

// ── 4. La abre como dueña ────────────────────────────────────────────────
const d = await s.ir('/cotizaciones/detalle-cotizacion.html?id=' + encodeURIComponent(creada.docId), { esperar: 1800 });
ok(d.url.includes('detalle-cotizacion.html'), 'abre el detalle de la cotización');
const det = await p.evaluate(() => document.body.innerText);
ok(/no devuelto/i.test(det) && /EMUND/.test(det), 'el detalle es la reposición del equipo no devuelto');
ok(/304\.95/.test(det), 'total 285 + ITBMS');
await s.captura('taller-cotizacion-no-devuelto');

const errs = limpio(s);
ok(!errs.length, 'sin errores ' + JSON.stringify(errs));
await s.browser.close();
console.log(fallos.length ? `\n${fallos.length} FALLA(S)` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
