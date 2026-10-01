// Recorrido 07c · Jefa de taller (escritorio): "Cotizar" desde la orden A, solo hasta abrir el editor.
// Separado de 07 para poder correrlo después del QC por el camino corto (07b). Solo lectura.
import { abrir, USUARIOS, esperarUrl, log } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));
const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
await s.ir(`/ordenes/index.html?orden=${ids.A}`);
log('fila A:', await s.page.$eval(`tr[data-orden-id="${ids.A}"]`, tr => tr.innerText.replace(/\s+/g, ' ')));
await s.page.evaluate((id) => document.querySelector(`[data-action="toggle-overflow-menu"][data-orden-id="${id}"]`).click(), ids.A); await s.quieto(300, 2000);
log('menú ⋯ jefa (COMPLETADO+QC):', await s.page.$eval(`#overflow-menu-${ids.A}`, d => [...d.querySelectorAll('.overflow-menu-item')].map(b => b.innerText.trim()).join(' | ')));
const t0 = Date.now();
await s.page.evaluate((id) => document.querySelector(`#overflow-menu-${id} [data-action="cotizar-orden"]`).click(), ids.A);
const u = await esperarUrl(s, /cotizar-orden\.html/);
log(`cotizar: ${u} en ${Date.now() - t0} ms | 2 interacciones`);
await s.captura('07-jefe-escritorio-cotizar-orden', { full: true });
log('  editor:', (await s.texto('.app-wrap')).replace(/\s+/g, ' ').slice(0, 600));
log('  consultas:', (await s.consultas()).slice(0, 14).join(' ; '));
// ¿Volver a Cotizar crea otra? (solo mirar el menú de nuevo)
await s.ir(`/ordenes/index.html?orden=${ids.A}`);
await s.page.evaluate((id) => document.querySelector(`[data-action="toggle-overflow-menu"][data-orden-id="${id}"]`).click(), ids.A); await s.quieto(300, 2000);
log('menú ⋯ tras cotizar:', await s.page.$eval(`#overflow-menu-${ids.A}`, d => [...d.querySelectorAll('.overflow-menu-item')].map(b => b.innerText.trim()).join(' | ')));
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
