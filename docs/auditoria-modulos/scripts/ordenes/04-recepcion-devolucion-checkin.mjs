// Recorrido 04 · Recepción (escritorio): crear una DEVOLUCIÓN sin contrato (contrato de
// papel) y hacer el check-in de 1 de 2 radios con acuse firmado. Escribe SOLO en el emulador.
import { abrir, USUARIOS, PREFIJO, stubStorage, firmarCanvas, tipear, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';

const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ordenes' });
await s.ir('/ordenes/index.html');
let pasos = 0;
await s.page.evaluate(() => document.querySelector('[data-action="toggle-topbar-menu"]').click()); pasos++;
await s.quieto(400, 3000);
await s.page.evaluate(() => document.querySelector('[data-action="nueva-devolucion"]').click()); pasos++;
await s.quieto(800, 5000);
await s.captura('04-recepcion-escritorio-nueva-devolucion');
log('modal nueva:', JSON.stringify(await modalAbierto(s)).slice(0, 300));
await tipear(s, '#devNuevaCliente', `${PREFIJO} Cliente de papel ${Date.now().toString().slice(-4)}`); pasos++;
await tipear(s, '#devNuevaRef', 'contrato físico #2019-77'); pasos++;
await tipear(s, '#devNuevaTotal', '2'); pasos++;
await tipear(s, '#devNuevaObs', `${PREFIJO} devolución de prueba`); pasos++;
const t0 = Date.now();
await s.page.click('#devNuevaCrearBtn'); pasos++;
await s.quieto(2500, 20000);
// Espera a que la devolución exista en memoria (el modal de check-in se abre solo al terminar de crear)
for (let i = 0; i < 40; i++) { const ok = await s.page.evaluate((P) => !!(APP.state.orders || []).find(o => (o.cliente_nombre || '').includes(P) && /DEVOLUCION/i.test(o.tipo_de_servicio || '')), PREFIJO); if (ok) break; await new Promise(r => setTimeout(r, 300)); }
await s.quieto(1200, 10000);
log(`crear: ${Date.now() - t0} ms | toasts:`, JSON.stringify(await s.toasts()), '| url:', await s.page.evaluate(() => location.search));
const dev = await s.page.evaluate((P) => (APP.state.orders || []).find(o => (o.cliente_nombre || '').includes(P) && /DEVOLUCION/i.test(o.tipo_de_servicio || ''))?.ordenId, PREFIJO);
log('devolución creada:', dev, `| ${pasos} interacciones`);
log('modales tras crear:', JSON.stringify(await modalAbierto(s)).slice(0, 200));
await s.captura('04-recepcion-escritorio-tras-crear-devolucion');
// Si el check-in no se abrió solo, abrirlo desde la fila
let abierto = (await modalAbierto(s)).some(m => /Registrar|acuse|Devolución/i.test(m));
if (!abierto) {
  const fila = await s.page.$eval(`tr[data-orden-id="${dev}"]`, tr => tr.innerText.replace(/\s+/g, ' ')).catch(() => 'fila no visible');
  log('fila devolución:', fila);
  await medir(s, 'abrir check-in', async () => { await s.page.evaluate((d) => document.querySelector(`[data-action="checkin-devolucion"][data-orden-id="${d}"]`)?.click(), dev); pasos++; });
}
await s.captura('04-recepcion-escritorio-checkin-vacio');
log('check-in:', (await s.page.evaluate(() => ([...document.querySelectorAll('.overlay:not(.hidden), .modal-backdrop.open')].pop()?.innerText || '').replace(/\s+/g, ' ').slice(0, 700))));
// Serial libre + Enter (= escáner)
let pasosCk = 0;
await tipear(s, '#devSerialLibre', 'AUDIT-DEV-0001'); pasosCk++;
await tipear(s, '#devModeloLibre', 'NX-1200'); pasosCk++;
await s.page.click('#devSerialLibre');
await medir(s, 'Enter en serial (check-in)', async () => { await s.page.keyboard.press('Enter'); pasosCk++; });
await s.captura('04-recepcion-escritorio-checkin-minichecklist');
log('mini-checklist visible:', await s.page.$eval('#devRecibidoConfirm', b => !!b.getBoundingClientRect().height).catch(() => false));
await s.page.click('#devAccTodos'); pasosCk++;
await medir(s, 'confirmar recibido', async () => { await s.page.click('#devRecibidoConfirm'); pasosCk++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-3)));
await s.captura('04-recepcion-escritorio-checkin-salta-al-acuse');
const acuse = await s.page.evaluate(() => { const b = document.getElementById('devAcuseBloque'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), vh: innerHeight, txt: b.innerText.replace(/\s+/g, ' ').slice(0, 300) }; });
log('bloque acuse:', JSON.stringify(acuse));
// Firmar el acuse
await tipear(s, '#acuseNombre', 'Cliente de papel (prueba)'); pasosCk++;
await firmarCanvas(s, '#acuseFirmaCanvas'); pasosCk++;
log('stub storage:', await stubStorage(s));
await medir(s, 'guardar acuse', async () => { await s.page.click('#acuseGuardarBtn'); pasosCk++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-3)), '| errores:', s.errores.slice(0, 5));
await s.captura('04-recepcion-escritorio-acuse-guardado');
log('estado check-in:', (await s.page.evaluate(() => ([...document.querySelectorAll('.overlay:not(.hidden), .modal-backdrop.open')].pop()?.innerText || '').replace(/\s+/g, ' ').slice(0, 600))));
log(`check-in de 1 radio con acuse: ${pasosCk} interacciones`);
// Salir: ¿qué pasa al cerrar con 1 pendiente?
await s.page.evaluate(() => document.getElementById('devCerrarModal')?.click()); await s.quieto(600, 4000);
log('al cerrar:', JSON.stringify(await modalAbierto(s)).slice(0, 300));
await s.page.keyboard.press('Escape'); await s.quieto(400, 3000);
const fila2 = await s.page.$eval(`tr[data-orden-id="${dev}"]`, tr => tr.innerText.replace(/\s+/g, ' ')).catch(() => 'fila no visible');
log('fila devolución ahora:', fila2);
await s.captura('04-recepcion-escritorio-fila-devolucion-parcial');
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));
ids.DEV = dev; fs.writeFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', JSON.stringify(ids, null, 2));
await s.cerrar();
