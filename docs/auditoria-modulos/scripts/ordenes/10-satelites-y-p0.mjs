// Recorrido 10 · Páginas satélite y verificación de los P0 de la auditoría 2026-09-28.
// Solo lectura. Admin (ve todo) y técnico en teléfono (P0 #4).
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));

const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'ordenes' });
// P0 #6: reporte de pendientes
let info = await s.ir('/ordenes/reporte-pendientes.html');
log('reporte-pendientes:', JSON.stringify(info));
const rep = await s.page.evaluate(() => ({ filas: document.querySelectorAll('tbody tr').length, txt: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400) }));
log('  ', JSON.stringify(rep));
await s.captura('10-admin-escritorio-reporte-pendientes');
// P0 #7: importar-exportar
info = await s.ir('/ordenes/importar-exportar.html');
log('importar-exportar:', JSON.stringify(info), '|', (await s.texto('body')).replace(/\s+/g, ' ').slice(0, 300));
await s.captura('10-admin-escritorio-importar-exportar');
// Config
info = await s.ir('/ordenes/config.html');
log('config:', JSON.stringify(info), '|', (await s.texto('.app-wrap')).replace(/\s+/g, ' ').slice(0, 300));
await s.captura('10-admin-escritorio-config');
// Progreso técnicos
info = await s.ir('/ordenes/progreso-tecnicos.html');
log('progreso:', JSON.stringify(info), '|', (await s.texto('.app-wrap, body')).replace(/\s+/g, ' ').slice(0, 500));
await s.captura('10-admin-escritorio-progreso-tecnicos', { full: true });
log('  consultas:', (await s.consultas()).join(' ; ').slice(0, 600));
// Imprimir orden A
info = await s.ir(`/ordenes/imprimir-orden.html?orden=${ids.A}&id=${ids.A}`);
log('imprimir:', JSON.stringify(info), '|', (await s.texto('body')).replace(/\s+/g, ' ').slice(0, 500));
await s.captura('10-admin-escritorio-imprimir-orden', { full: true });
// Editar orden A por URL (ya no está en POR ASIGNAR: ¿valida estado?)
info = await s.ir(`/ordenes/editar-orden.html?orden_id=${ids.A}&id=${ids.A}`);
log('editar-orden (RECIBIDO):', JSON.stringify(info), '|', (await s.texto('.app-wrap')).replace(/\s+/g, ' ').slice(0, 400), '| toasts', JSON.stringify(await s.toasts()));
await s.captura('10-admin-escritorio-editar-orden-recibida');
// admin-equipos-cliente
info = await s.ir('/ordenes/admin-equipos-cliente.html');
log('admin-equipos-cliente:', JSON.stringify(info), '|', (await s.texto('.app-wrap')).replace(/\s+/g, ' ').slice(0, 200));
// Casos viejos (Más → Casos viejos)
info = await s.ir('/ordenes/index.html');
await s.page.evaluate(() => document.querySelector('[data-action="toggle-topbar-menu"]').click()); await s.quieto(400, 3000);
await s.captura('10-admin-escritorio-menu-mas');
await s.page.evaluate(() => document.querySelector('[data-action="casos-viejos"]').click()); await s.quieto(1500, 10000);
log('casos viejos:', (await s.page.evaluate(() => (document.querySelector('.modal-backdrop.open')?.innerText || '').replace(/\s+/g, ' ').slice(0, 500))));
await s.captura('10-admin-escritorio-casos-viejos');
await s.page.keyboard.press('Escape');
// Menú ⋯ de una fila POR ASIGNAR vs ENTREGADA (admin)
const menus = await s.page.evaluate(() => {
  const out = {};
  for (const tr of [...document.querySelectorAll('tr[data-orden-row]')].slice(0, 12)) {
    const est = tr.querySelector('.chip-estado')?.innerText.trim();
    const dd = tr.querySelector('.overflow-menu-dropdown');
    if (dd && !out[est]) out[est] = [...dd.querySelectorAll('.overflow-menu-item')].map(b => b.innerText.trim());
  }
  return out;
});
log('menú ⋯ por estado:', JSON.stringify(menus));
log('errores admin:', s.errores.slice(0, 6));
await s.cerrar();

// P0 #4: técnico en teléfono — ¿cómo va a otro módulo? y entre 769-1024 (tablet) ¿hay rail?
const t = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ordenes' });
info = await t.ir('/ordenes/index.html');
const nav = await t.page.evaluate(() => ({
  rail: !!document.querySelector('#rail-mount')?.offsetParent, topbar: !!document.querySelector('#desktopTopbar')?.offsetParent,
  fab: !!document.querySelector('[class*=fab]')?.offsetParent, bottom: [...document.querySelectorAll('#mobileBottomNav button')].map(b => b.innerText.trim()),
}));
log('P0#4 teléfono técnico:', JSON.stringify(nav));
await t.captura('10-tecnico-telefono-bandeja-nav');
await t.cerrar();
const t2 = await abrir({ email: USUARIOS.tecnico, viewport: { width: 900, height: 700, hasTouch: true }, carpeta: 'ordenes' });
info = await t2.ir('/ordenes/index.html');
const nav2 = await t2.page.evaluate(() => ({ rail: !!document.querySelector('#rail-mount')?.offsetParent, railW: document.querySelector('#rail-mount')?.getBoundingClientRect().width, topbar: !!document.querySelector('#desktopTopbar')?.offsetParent, menuPrincipal: !![...document.querySelectorAll('button, a')].find(b => b.offsetParent && /Menú principal|Inicio/.test(b.innerText)) }));
log('P0#4 900px técnico:', JSON.stringify(nav2));
await t2.captura('10-tecnico-900px-bandeja-nav');
await t2.cerrar();
