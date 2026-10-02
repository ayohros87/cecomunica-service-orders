// Auditoría de módulos 2026-09-30 · Cotizaciones · P6 (ejecución 2026-10-02).
// Autoguardado del borrador de taller: debounce 2.5 s + flush al perder el
// foco de la ventana. Mide cuántas escrituras de borradores_cotizacion deja
// llenar una pieza (3 campos con pausas de 0.8 s entre campo y campo).
// Antes (debounce 600 ms): una escritura por pausa → 3. Después: 1 (y 1 más
// si se cambia de ventana con algo pendiente).
//   node 15-p6-autoguardado.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (...a) => console.log(...a);
const ORDEN = process.env.ORDEN || '2026092905';
const CONF = '.overlay[style*="flex"]';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'cotizaciones' });
const P = s.page;
await s.ir(`/ordenes/cotizar-orden.html?id=${ORDEN}`, { esperar: 1500 });
if (await P.$(CONF)) { await P.click(CONF + ' [data-action="cancel"]'); await s.quieto(800); }
if (await P.$('.modal-backdrop.open')) { await P.click('.modal-backdrop.open [data-sheet-action="otra"]').catch(() => {}); await s.quieto(800); }
const autosaves = async () => (await s.consultas()).filter(q => /setBorradorCotizacion/.test(q)).length;
log('toasts al abrir:', (await s.toasts()).map(t => t.msg));
const a0 = await autosaves(); log('autosaves tras precarga:', a0);

await P.click('[data-add]'); await wait(300);
const fila = (await P.$$('tr[data-line]')).pop();
await (await fila.$('.co-sku')).type('ANT-01', { delay: 80 }); await P.keyboard.press('Escape'); await wait(800);
await (await fila.$('.co-desc')).type('PRUEBA-AUDIT P6 antena corta', { delay: 60 }); await wait(800);
const pre = await fila.$('.co-precio'); await pre.click({ clickCount: 3 }); await pre.type('18.5', { delay: 80 });
const a1 = await autosaves(); log('autosaves con los 3 campos tecleados (pausas de 0.8 s):', a1 - a0);
await wait(3200);
const a2 = await autosaves(); log('autosaves 3.2 s después (debounce vencido):', a2 - a0);
// Cambio pendiente + la ventana pierde el foco → flush inmediato
await P.click('#inpDesc', { clickCount: 3 }); await P.keyboard.type('5'); await wait(300);
const a3 = await autosaves();
await P.evaluate(() => window.dispatchEvent(new Event('blur')));
await wait(600);
const a4 = await autosaves(); log('tras teclear descuento y perder el foco de la ventana: pendiente antes =', a3 - a2, '→ escrituras tras blur =', a4 - a3);
await wait(3000);
log('autosaves 3 s después del blur (no debe sumar otra):', (await autosaves()) - a4);
log('errores:', s.errores.slice(0, 3));
// Limpiar el borrador de prueba
await P.evaluate(() => OrdenesService.deleteBorradorCotizacion(new URLSearchParams(location.search).get('id'), firebase.auth().currentUser.uid)).catch(() => {});
await s.cerrar();
