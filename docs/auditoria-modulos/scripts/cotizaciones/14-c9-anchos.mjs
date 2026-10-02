// Auditoría de módulos 2026-09-30 · Cotizaciones · C9 (ejecución 2026-10-02).
// Mide el ancho útil de los campos que se cortaban: la descripción del
// renglón en el editor comercial ("HYTERA" de "HYTERA PDC550") y el Nº de
// pieza / descripción en cotizar-orden (12 y 9 caracteres). Correr antes y
// después del cambio de CSS.
//   node 14-c9-anchos.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (...a) => console.log(...a);
const ORDEN = process.env.ORDEN || '2026092905';
const CONF = '.overlay[style*="flex"]';
const medir = (P, sel) => P.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); const px = parseFloat(cs.fontSize) || 14; return { ancho: Math.round(r.width), aproxCaracteres: Math.round((r.width - 20) / (px * 0.55)) }; }, sel);

// Editor comercial (Karla, 1280×800): un renglón con texto largo
const k = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'cotizaciones' });
let P = k.page;
await k.ir('/cotizaciones/nueva-cotizacion.html', { esperar: 1500 });
await P.waitForSelector('.cc-item-row .cc-item-nombre', { timeout: 15000 });
await P.type('.cc-item-row .cc-item-nombre', 'HYTERA PDC550 Radio portátil DMR'); await P.keyboard.press('Escape');
const visible = await P.evaluate(() => { const i = document.querySelector('.cc-item-row .cc-item-nombre'); const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(i).font; let n = 0; while (n < i.value.length && c.measureText(i.value.slice(0, n + 1)).width < i.clientWidth - 20) n++; return i.value.slice(0, n); });
log('EDITOR comercial · descripción:', await medir(P, '.cc-item-row .cc-item-nombre'), '| se lee:', JSON.stringify(visible), '| columnas:', await P.evaluate(() => getComputedStyle(document.querySelector('.cc-item-row')).gridTemplateColumns));
log('  scroll horizontal:', (await k.geometria()).scrollX ?? (await k.geometria()));
await k.captura('69-c9-editor-renglon-ancho', { el: '.cc-item-row' });
await k.cerrar();

// Cotizar orden (Solangel, 1280×800 y tablet 1024)
const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'cotizaciones' });
P = s.page;
for (const vp of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
  await P.setViewport(vp);
  await s.ir(`/ordenes/cotizar-orden.html?id=${ORDEN}`, { esperar: 1500 });
  if (await P.$(CONF)) { await P.click(CONF + ' [data-action="cancel"]'); await s.quieto(800); }
  if (await P.$('.modal-backdrop.open')) { await P.click('.modal-backdrop.open [data-sheet-action="otra"]').catch(() => {}); await s.quieto(800); }
  if (!(await P.$('tr[data-line] .co-sku'))) { await P.click('[data-add]'); await s.quieto(300); }
  await P.evaluate(() => { const r = document.querySelector('tr[data-line]'); r.querySelector('.co-sku').value = '511600009194'; r.querySelector('.co-desc').value = 'Teclado PNC360S-R completo con membrana'; });
  const leido = await P.evaluate(() => { const f = (i) => { const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(i).font; let n = 0; while (n < i.value.length && c.measureText(i.value.slice(0, n + 1)).width < i.clientWidth - 20) n++; return i.value.slice(0, n); }; const r = document.querySelector('tr[data-line]'); return { sku: f(r.querySelector('.co-sku')), desc: f(r.querySelector('.co-desc')) }; });
  log(`COTIZAR ORDEN ${vp.width}px · Nº pieza:`, await medir(P, 'tr[data-line] .co-sku'), '· descripción:', await medir(P, 'tr[data-line] .co-desc'), '| se lee:', JSON.stringify(leido));
  log('  geometría:', await s.geometria());
  await s.captura(`70-c9-cotizar-orden-${vp.width}`, { el: '.co-lineas' });
}
await s.cerrar();
