// Recorrido 08 · Recepción en TABLET: entrega de A con firma en la tablet del mostrador
// (segunda sesión en /firmar/tablet.html) y entrega de B con firma en papel.
// Storage stubeado (no corre en el emulador). Escribe SOLO en el emulador.
import { abrir, USUARIOS, stubStorage, firmarCanvas, tipear, medir, log, modalAbierto, clicTexto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));

// La tablet del mostrador: sesión aparte, misma cuenta de recepción
const t = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'ordenes' });
let info = await t.ir('/firmar/tablet.html');
log('tablet idle:', JSON.stringify(info), '|', (await t.texto('body')).replace(/\s+/g, ' ').slice(0, 200));
await t.captura('08-recepcion-tablet-firmar-idle');

// Recepción en su tablet (1024×768) — es donde entrega
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'ordenes' });
info = await s.ir(`/ordenes/index.html?orden=${ids.A}`);
log('bandeja A:', await s.page.$eval(`tr[data-orden-id="${ids.A}"]`, tr => tr.innerText.replace(/\s+/g, ' ')));
let pasos = 0;
await medir(s, 'clic Entregar', async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="entregar-orden"][data-orden-id="${id}"]`).click(), ids.A); pasos++; });
log('modales:', JSON.stringify(await modalAbierto(s)).slice(0, 400));
await s.captura('08-recepcion-tablet-modal-entrega');
const entregaVisible = await s.page.$eval('#modalEntrega', m => !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none');
if (!entregaVisible) { log('ENTREGA BLOQUEADA — modal visible:', JSON.stringify(await modalAbierto(s))); await s.cerrar(); await t.cerrar(); process.exit(2); }
log('modal entrega:', (await s.texto('#modalEntrega')).replace(/\n+/g, ' | ').slice(0, 1200));
const geo = await s.page.evaluate(() => { const m = document.querySelector('#modalEntrega .modal'); const chk = document.getElementById('entregaNoRecibido'); const f = document.getElementById('entregaFirmaCanvas'); const b = document.getElementById('btnConfirmarEntrega'); const r = (e) => e ? Math.round(e.getBoundingClientRect().top) : null; return { altoModal: m?.scrollHeight, vh: innerHeight, topFirma: r(f), topPapel: r(chk), topConfirmar: r(b) }; });
log('geometría modal:', JSON.stringify(geo));
await tipear(s, '#entregaReceptorNombre', 'Cliente que recibe (prueba)'); pasos++;
// Firmar en la tablet
const okTab = await clicTexto(s, 'Firmar en la tablet', '#modalEntrega'); pasos++;
log('Firmar en la tablet:', okTab, '| toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| espera visible:', await s.page.$eval('#entregaTabletEspera', e => !e.classList.contains('hidden')));
await s.captura('08-recepcion-tablet-esperando-tablet');
// En la tablet: aparece la solicitud
await t.quieto(1500, 15000);
log('tablet ve:', (await t.texto('body')).replace(/\s+/g, ' ').slice(0, 500));
await t.captura('08-recepcion-tablet-firmar-solicitud');
let pasosTab = 0;
await t.page.click('#fNombre', { clickCount: 3 }); await t.page.keyboard.type('Cliente que recibe (prueba)'); pasosTab++;
await t.page.click('#fCedula', { clickCount: 3 }); await t.page.keyboard.type('8-123-4567'); pasosTab++;
const canvasSel = await t.page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].find(c => c.offsetParent || c.getBoundingClientRect().height > 0); return c ? ('#' + c.id || 'canvas') : 'canvas'; });
await firmarCanvas(t, canvasSel === '#' ? 'canvas' : canvasSel); pasosTab++;
log('stub storage tablet:', await stubStorage(t));
const hab = await t.page.$eval('#fConfirmar', b => !b.disabled).catch(() => null);
log('confirmar habilitado:', hab);
await medir(t, 'confirmar firma en tablet', async () => { await t.page.click('#fConfirmar'); pasosTab++; });
log('tablet tras firmar:', (await t.texto('body')).replace(/\s+/g, ' ').slice(0, 250), '| errores:', t.errores.slice(0, 4));
await t.captura('08-recepcion-tablet-firmar-listo');
// De vuelta en la bandeja: la firma llegó
await s.quieto(1500, 10000);
log('firma llegó:', await s.page.$eval('#entregaTabletListo', e => !e.classList.contains('hidden')), '|', await s.texto('#entregaTabletNombre'));
await s.captura('08-recepcion-tablet-firma-recibida');
log('stub storage bandeja:', await stubStorage(s));
await medir(s, 'confirmar entrega A', async () => { await s.page.click('#btnConfirmarEntrega'); pasos++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-2)), '| errores:', s.errores.slice(0, 5));
log(`A entregada con tablet: ${pasos} interacciones en recepción + ${pasosTab} del cliente en la tablet`);
await s.captura('08-recepcion-tablet-tras-entregar');
log('fila A:', await s.page.$eval(`tr[data-orden-id="${ids.A}"]`, tr => tr.innerText.replace(/\s+/g, ' ')).catch(() => 'no visible'));

// B: firma en papel
info = await s.ir(`/ordenes/index.html?orden=${ids.B}`);
let pasosB = 0;
await medir(s, 'clic Entregar B', async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="entregar-orden"][data-orden-id="${id}"]`).click(), ids.B); pasosB++; });
const papel = await s.page.evaluate(() => { const c = document.getElementById('entregaNoRecibido'); const l = c?.closest('label') || c?.parentElement; const r = l.getBoundingClientRect(); return { txt: l.innerText.replace(/\s+/g, ' ').slice(0, 120), top: Math.round(r.top), vh: innerHeight, altoModal: document.querySelector('#modalEntrega .modal')?.scrollHeight }; });
log('casilla papel:', JSON.stringify(papel));
await s.page.click('#entregaNoRecibido'); pasosB++;
await s.quieto(400, 3000);
await s.captura('08-recepcion-tablet-modal-entrega-papel');
log('bloque papel:', (await s.texto('#entregaNoRecibidoBloque')).replace(/\n+/g, ' | ').slice(0, 400));
await tipear(s, '#entregaNoRecibidoMotivo', 'Firmó la nota impresa, la tablet estaba ocupada (prueba)'); pasosB++;
await tipear(s, '#entregaPersonaInterna', 'Mensajero de MACELLO (prueba)'); pasosB++;
await stubStorage(s);
await medir(s, 'confirmar entrega B papel', async () => { await s.page.click('#btnConfirmarEntrega'); pasosB++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-2)), '| errores:', s.errores.slice(0, 5), `| ${pasosB} interacciones`);
log('fila B:', await s.page.$eval(`tr[data-orden-id="${ids.B}"]`, tr => tr.innerText.replace(/\s+/g, ' ')).catch(() => 'no visible'));
await s.captura('08-recepcion-tablet-tras-entregar-papel');
// Ver entrega
await s.page.evaluate((id) => document.querySelector(`[data-action="ver-entrega"][data-orden-id="${id}"]`)?.click(), ids.B); await s.quieto(800, 5000);
await s.captura('08-recepcion-tablet-ver-entrega-papel');
log('ver entrega:', JSON.stringify(await modalAbierto(s)).slice(0, 400));
await s.cerrar(); await t.cerrar();
