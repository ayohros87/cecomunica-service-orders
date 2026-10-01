// Recorrido 08c · Recepción en TABLET (1024×768, táctil): aquí "Firmar en la tablet" no aplica
// (FirmaTablet.disponible() devuelve false con pointer:coarse): el cliente firma en el canvas
// del mismo modal. B: entrega con firma en papel. A ya se entregó en 08b. SOLO emulador.
import { abrir, USUARIOS, stubStorage, firmarCanvas, tipear, medir, log, modalAbierto, clicTexto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'ordenes' });
await s.ir(`/ordenes/index.html?orden=${ids.B}`);
log('fila B:', await s.page.$eval(`tr[data-orden-id="${ids.B}"]`, tr => tr.innerText.replace(/\s+/g, ' ')));
let pasosB = 0;
await medir(s, 'clic Entregar B', async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="entregar-orden"][data-orden-id="${id}"]`).click(), ids.B); pasosB++; });
const geo = await s.page.evaluate(() => { const m = document.querySelector('#modalEntrega .modal'); const r = (e) => e ? Math.round(e.getBoundingClientRect().top) : null; return { altoModal: m?.scrollHeight, vh: innerHeight, topPapel: r(document.getElementById('entregaNoRecibido')), topFirma: r(document.getElementById('entregaFirmaCanvas')), topConfirmar: r(document.getElementById('btnConfirmarEntrega')) }; });
log('geometría modal tablet:', JSON.stringify(geo));
// ¿Qué pasa con "Firmar en la tablet" en la tablet misma?
const okTab = await clicTexto(s, 'Firmar en la tablet', '#modalEntrega');
log('Firmar en la tablet (en la tablet):', okTab, '| toasts:', JSON.stringify((await s.toasts()).slice(-1)));
await s.captura('08c-recepcion-tablet-boton-tablet-en-tablet');
// Papel
await s.page.click('#entregaNoRecibido'); pasosB++;
await s.quieto(400, 3000);
await s.captura('08c-recepcion-tablet-modal-entrega-papel');
await tipear(s, '#entregaNoRecibidoMotivo', 'Firmó la nota impresa, había cola (prueba)'); pasosB++;
await tipear(s, '#entregaPersonaInterna', 'Mensajero de MACELLO (prueba)'); pasosB++;
await stubStorage(s);
await medir(s, 'confirmar entrega B papel', async () => { await s.page.click('#btnConfirmarEntrega'); pasosB++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-2)), '| errores:', s.errores.slice(0, 5), `| ${pasosB} interacciones`);
log('fila B:', await s.page.$eval(`tr[data-orden-id="${ids.B}"]`, tr => tr.innerText.replace(/\s+/g, ' ')).catch(() => 'no visible'));
await s.captura('08c-recepcion-tablet-tras-entregar-papel');
await s.page.evaluate((id) => document.querySelector(`[data-action="ver-entrega"][data-orden-id="${id}"]`)?.click(), ids.B); await s.quieto(800, 5000);
await s.captura('08c-recepcion-tablet-ver-entrega-papel');
log('ver entrega B (papel):', JSON.stringify(await modalAbierto(s)).slice(0, 500));
const doc = await s.page.evaluate((id) => { const o = (APP.state.orders || []).find(x => x.ordenId === id); return o ? { receptor_nombre: o.receptor_nombre, entrega_persona_interna: o.entrega_persona_interna, no_recibido: o.no_recibido, no_recibido_motivo: o.no_recibido_motivo, firma_url: o.firma_url } : null; }, ids.B);
log('doc B tras entrega en papel:', JSON.stringify(doc));
await s.cerrar();
