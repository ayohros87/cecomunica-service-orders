// Modalidad de servicio en cotizaciones (pedido de Elvia, 2026-11-25).
//   1. Editor: el renglón tiene 4 modalidades; elegir "Activación" o "Servicio
//      GPS" del catálogo de cargos le pone su modalidad; los totales dicen
//      "Pago único" y "Mensualidad".
//   2. Detalle e impresión de una cotización como la del hotel de la captura:
//      la activación dice "Servicio único", los renglones de texto no dicen
//      "Venta" ni "$0.00".
// Emuladores (auth, firestore, hosting con dist/ recién construido) y siembra
// de emu-seed-todo.js. Correr desde la raíz:
//   EMU_FS=127.0.0.1:8186 EMU_AUTH=127.0.0.1:9196 BASE=http://127.0.0.1:5156 node tools/emulador-almacen/emu-test-cotizacion-servicios.mjs
import { createRequire } from 'node:module';
process.env.FIRESTORE_EMULATOR_HOST = process.env.EMU_FS || '127.0.0.1:8080';
const require = createRequire('C:/Projects/cecomunica-service-orders/functions/package.json');
const admin = require('firebase-admin');
const { abrir, USUARIOS } = await import('./emu-lib.mjs');

admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();

const fallos = [];
const ok = (cond, msg) => { console.log((cond ? 'OK     ' : 'FALLA  ') + msg); if (!cond) fallos.push(msg); };
// El diálogo vacío es el beforeunload del editor con cambios (salir sin guardar): esperado.
const limpio = (s) => s.errores.filter(e => !/favicon|Uso|uso_diario|aggregates|identitytoolkit|PRODUCCIÓN/.test(e) && e !== 'dialog nativo: ');

// ── Siembra: una cotización comercial como la de la captura ──────────────
const snap = await db.collection('cotizaciones').where('estado', '==', 'borrador').limit(20).get();
const base = snap.docs.find(d => !d.data().deleted && (d.data().origen || 'comercial') !== 'orden');
if (!base) { console.error('no hay borrador comercial para sembrar'); process.exit(2); }
const ID = base.id;
const ITEMS = [
  { id: 'i1', modelo: 'NX-420', nombre: 'RADIOS KENWOOD NX-420', spec: 'INCLUYE: CARGADOR, FUENTE ANTENA Y BATERIA', cant: 45, precio: 30, desc: 0, modalidad: 'alquiler', equipo: null },
  { id: 'i2', modelo: '', nombre: 'ACTIVACION', spec: 'SOLO SE PAGA UNA VEZ', cant: 45, precio: 30, desc: 0, modalidad: 'servicio_unico', equipo: null },
  { id: 'i3', modelo: '', nombre: 'Sistema Digital de Repetidoras Kenwood NXR-800 / NXR-900', spec: '', cant: 0, precio: 0, desc: 0, modalidad: 'venta', equipo: null },
  { id: 'i4', modelo: '', nombre: 'SERVICIO INCLUYE: Mantenimiento integral preventivo y correctivo', spec: '', cant: 0, precio: 0, desc: 0, modalidad: 'venta', equipo: null },
  { id: 'i5', modelo: '', nombre: 'MONITOREO REMOTO', spec: '', cant: 1, precio: 50, desc: 0, modalidad: 'servicio_mensual', equipo: null },
];
await db.collection('cotizaciones').doc(ID).update({ items: ITEMS, plazoMeses: 36, descuentoPct: 0 });
console.log('sembrada', ID, base.data().cotizacion_id);

const s = await abrir({ email: USUARIOS.vendedor, carpeta: 'cotizacion-servicios' });
const p = s.page;
p.on('response', (res) => { if (res.status() >= 400) console.log('   [http ' + res.status() + '] ' + res.url().slice(0, 160)); });

// ── 1. Editor ─────────────────────────────────────────────────────────────
await s.ir('/cotizaciones/nueva-cotizacion.html', { esperar: 1500 });
await p.waitForSelector('.cc-item-row .cc-item-mod', { timeout: 20000 });
const opciones = await p.$$eval('.cc-item-row .cc-item-mod option', os => os.map(o => o.textContent));
ok(JSON.stringify(opciones) === JSON.stringify(['Venta', 'Alquiler', 'Servicio único', 'Servicio mensual']), 'el renglón ofrece las 4 modalidades: ' + opciones.join(' / '));

// Renglón 1: "Activ" → Activación del catálogo de cargos.
const pick = async (fila, texto, nombre) => {
  const row = (await p.$$('.cc-item-row'))[fila];
  const inp = await row.$('.cc-item-nombre');
  await inp.click({ clickCount: 3 });
  await inp.type(texto, { delay: 20 });
  await p.waitForFunction((f, n) => [...document.querySelectorAll('.cc-item-row')][f]?.querySelector('.cc-cat-pop:not([hidden])')?.textContent.includes(n), { timeout: 5000 }, fila, nombre);
  await p.evaluate((f, n) => {
    const it = [...[...document.querySelectorAll('.cc-item-row')][f].querySelectorAll('.cc-cat-item')].find(el => el.querySelector('.cc-cat-name').textContent.trim() === n);
    it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, fila, nombre);
  await new Promise(r => setTimeout(r, 300));
};
await pick(0, 'Activ', 'Activación');
let r = await p.evaluate(() => { const row = document.querySelectorAll('.cc-item-row')[0];
  return { mod: row.querySelector('.cc-item-mod').value, clase: row.className, nombre: row.querySelector('.cc-item-nombre').value }; });
ok(r.mod === 'servicio_unico' && r.clase.includes('cc-mod-servicio_unico'), `Activación del catálogo → Servicio único (${r.mod})`);
const toasts = await p.evaluate(() => window.__toasts.map(t => t.msg));
ok(toasts.some(t => /Activación no tiene monto/.test(t)), 'sin monto en el catálogo avisa en vez de poner $0 callado');

// Precio y cantidad de la activación.
const setNum = async (fila, sel, v) => {
  const el = (await (await p.$$('.cc-item-row'))[fila].$(sel));
  await el.click({ clickCount: 3 }); await el.type(String(v));
};
await setNum(0, '.cc-item-cant', 45);
await setNum(0, '.cc-item-precio', 30);

// Renglón 2: Servicio GPS (mensual, $5 en el catálogo).
await p.click('#btnAddItem');
await p.waitForFunction(() => document.querySelectorAll('.cc-item-row').length === 2);
await pick(1, 'GPS', 'Servicio GPS');
r = await p.evaluate(() => { const row = document.querySelectorAll('.cc-item-row')[1];
  return { mod: row.querySelector('.cc-item-mod').value, precio: row.querySelector('.cc-item-precio').value, total: row.querySelector('.cc-item-total').textContent }; });
ok(r.mod === 'servicio_mensual' && Number(r.precio) === 5 && /\/mes/.test(r.total), `Servicio GPS → Servicio mensual a $5/mes (${r.mod}, ${r.precio}, ${r.total})`);

// Renglón 3: radio escrito a mano, cambiado a Alquiler con el select.
await p.click('#btnAddItem');
await p.waitForFunction(() => document.querySelectorAll('.cc-item-row').length === 3);
await p.evaluate(() => { const row = document.querySelectorAll('.cc-item-row')[2];
  const n = row.querySelector('.cc-item-nombre'); n.value = 'RADIO X'; n.dispatchEvent(new Event('input', { bubbles: true }));
  document.body.click(); });
await setNum(2, '.cc-item-precio', 12);
await p.select('.cc-item-row:nth-child(3) .cc-item-mod', 'servicio_mensual');
await new Promise(r2 => setTimeout(r2, 300));
r = await p.evaluate(() => { const row = document.querySelectorAll('.cc-item-row')[2];
  return { mod: row.querySelector('.cc-item-mod').value, precio: row.querySelector('.cc-item-precio').value }; });
ok(r.mod === 'servicio_mensual' && Number(r.precio) === 12, `un renglón a mano conserva su precio al cambiar de modalidad (${r.precio})`);

const resumen = await p.$eval('#panelResumen', el => el.innerText);
ok(/Pago único/i.test(resumen) && /Mensualidad/i.test(resumen), 'los totales dicen "Pago único" y "Mensualidad"');
ok(/1[,.]?350\.00/.test(resumen), 'pago único = activación 45 × $30 = $1,350 (+ ITBMS)');
ok(/Plazo \(meses\)/.test(resumen), 'el campo de plazo ya no dice "del alquiler"');
await s.captura('01-editor', { full: true });
await p.setViewport({ width: 1366, height: 657 });
await new Promise(r2 => setTimeout(r2, 400));
await s.captura('01b-editor-1366');
const solape = await p.evaluate(() => { const row = document.querySelector('.cc-item-row'); const sel = row.querySelector('.cc-item-mod');
  return sel.scrollWidth > sel.clientWidth + 2; });
ok(!solape, 'el select de modalidad cabe en su columna');
ok(!limpio(s).length, 'editor sin errores de consola: ' + limpio(s).join(' | '));

// ── 2. Detalle ────────────────────────────────────────────────────────────
await s.ir(`/cotizaciones/detalle-cotizacion.html?id=${ID}`, { esperar: 1500 });
await p.waitForSelector('.cc-mod-chip', { timeout: 20000 });
const chips = await p.$$eval('.cc-mod-chip', cs => cs.map(c => c.textContent.trim()));
ok(JSON.stringify(chips) === JSON.stringify(['Alquiler', 'Servicio único', 'Servicio mensual']), 'detalle: chips ' + chips.join(', ') + ' (los de texto no llevan)');
const txtDetalle = await p.evaluate(() => document.body.innerText);
ok(/Pago único/i.test(txtDetalle) && /Mensualidad/i.test(txtDetalle), 'detalle: totales con los rótulos nuevos');
await s.captura('02-detalle', { full: true });
ok(!limpio(s).length, 'detalle sin errores: ' + limpio(s).join(' | '));

// ── 3. Impresión ──────────────────────────────────────────────────────────
await s.ir(`/cotizaciones/imprimir-cotizacion.html?id=${ID}`, { esperar: 1500 });
await p.waitForSelector('.cq-table', { timeout: 20000 });
const filas = await p.$$eval('.cq-items:not(.cq-resumen) .cq-table tbody tr', trs => trs.map(tr => ({
  texto: tr.classList.contains('cq-texto'), mod: tr.querySelector('.cq-mod')?.textContent.trim(), cel: tr.innerText })));
ok(filas[1].mod === 'Servicio único', 'impresión: la ACTIVACION dice Servicio único');
ok(filas[2].texto && filas[3].texto && !/\$0\.00|Venta/.test(filas[2].cel + filas[3].cel), 'impresión: los renglones de texto sin $0.00 ni "Venta"');
const tot = await p.evaluate(() => document.body.innerText);
ok(/Una sola vez/i.test(tot) && /Cada mes/i.test(tot) && /Pago único/i.test(tot), 'impresión: "Una sola vez · Pago único" y "Cada mes · Mensualidad"');
await s.captura('03-impresion', { full: true });
ok(!limpio(s).length, 'impresión sin errores: ' + limpio(s).join(' | '));

await s.cerrar();
console.log(fallos.length ? `\n${fallos.length} FALLA(S)` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
