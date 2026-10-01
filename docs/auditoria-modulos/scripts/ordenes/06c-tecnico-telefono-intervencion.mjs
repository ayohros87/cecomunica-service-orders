// Recorrido 06c · Técnico (Marcos) en teléfono: intervención de A (2 equipos, 1 con pieza)
// con verificación de estado en cada paso (el 06/06b dejaron el modal de materiales
// abierto por debajo). Escribe SOLO en el emulador.
import { abrir, USUARIOS, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));

const s = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ordenes' });
await s.ir('/ordenes/index.html');
const vis = (sel) => s.page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); return cs.display !== 'none' && e.getBoundingClientRect().height > 0; }, sel);
let pasos = 0;
await medir(s, 'abrir Equipos A', async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="abrir-equipos-mobile"][data-orden-id="${id}"]`).click(), ids.A); pasos++; });
await medir(s, 'abrir intervención eq 1', async () => { await s.page.evaluate(() => document.querySelectorAll('#equiposMobileList [data-action="abrir-trabajo-equipo"]')[0].click()); pasos++; });
log('modales:', JSON.stringify(await modalAbierto(s)).slice(0, 200));
await s.page.click('#trabajoEquipoText', { clickCount: 3 }); await s.page.keyboard.type('Se cambió la batería y se reprogramó (prueba).'); pasos++;
// Materiales
await medir(s, 'abrir materiales', async () => { await s.page.evaluate(() => document.querySelector('[data-action="abrir-material-equipo"]').click()); pasos++; });
log('material modal visible:', await vis('#modalMaterialEquipo'));
await s.page.click('#materialBuscar'); await s.page.keyboard.type('cubre'); pasos++;
await s.quieto(900, 5000);
const sugHtml = await s.page.$eval('#materialSugerencias', e => e.innerHTML.replace(/\s+/g, ' ').slice(0, 500));
log('sugerencias html:', sugHtml);
const primero = await s.page.$('#materialSugerencias [data-action="pick-material-equipo"], #materialSugerencias button, #materialSugerencias [data-pieza-id]');
if (primero) { await primero.click(); pasos++; }
await s.quieto(500, 3000);
log('seleccionada:', await s.page.evaluate(() => (document.getElementById('materialSeleccion')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160)));
await s.captura('06c-tecnico-telefono-material-seleccionado', { el: '#modalMaterialEquipo .modal' });
await medir(s, 'agregar material', async () => { await s.page.click('#btnAgregarMaterial'); pasos++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| material modal visible:', await vis('#modalMaterialEquipo'), '| count:', await s.texto('#equipoMaterialesCount'));
if (await vis('#modalMaterialEquipo')) { await s.page.evaluate(() => document.querySelector('[data-action="cerrar-material-equipo"]').click()); await s.quieto(400, 3000); log('  (cerrado a mano)'); }
await s.captura('06c-tecnico-telefono-intervencion-lista');
await medir(s, 'Guardar y siguiente', async () => { await s.page.click('#btnGuardarTrabajoSiguiente'); pasos++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| pos:', await s.texto('#trabajoNavPos'), '| texto:', await s.page.$eval('#trabajoEquipoText', t => t.value.slice(0, 30)));
await s.page.click('#trabajoEquipoText', { clickCount: 3 }); await s.page.keyboard.type('Limpieza de contactos, funciona (prueba).'); pasos++;
await medir(s, 'Guardar', async () => { await s.page.click('#btnGuardarTrabajoEquipo'); pasos++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| intervención visible:', await vis('#modalTrabajoEquipo'));
await s.quieto(800, 5000);
log('lista:', (await s.texto('#equiposMobileList')).replace(/\s+/g, ' ').slice(0, 300));
await s.captura('06c-tecnico-telefono-equipos-tras-guardar');
await s.page.evaluate(() => document.querySelector('#modalEquiposMobile [data-action="cerrar-equipos-mobile"]').click()); pasos++;
await s.quieto(500, 3000);
log(`tarjeta A: ${await s.page.$eval(`#ordersCards .card-contrato[data-orden-id="${ids.A}"]`, c => c.innerText.replace(/\s+/g, ' ').slice(0, 160))} | ${pasos} interacciones (2 equipos, 1 pieza)`);
// ¿El QC caducó al registrar intervención después del QC? (no debería: solo cuenta equipos)
await s.ir(`/ordenes/index.html?orden=${ids.A}`);
log('tarjeta A recargada:', await s.page.$eval(`#ordersCards .card-contrato[data-orden-id="${ids.A}"]`, c => c.innerText.replace(/\s+/g, ' ').slice(0, 160)).catch(() => '-'));
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
