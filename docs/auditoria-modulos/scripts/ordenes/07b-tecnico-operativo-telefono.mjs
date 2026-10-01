// Recorrido 07b · Técnico operativo (Ovidio) en teléfono: SOLO LECTURA sobre sus
// órdenes reales. ¿Encuentra su orden? ¿Puede trabajar de pie? ¿Cómo sale a otro módulo?
import { abrir, USUARIOS, medir, log, modalAbierto } from './lib-ordenes.mjs';

const s = await abrir({ email: USUARIOS.tecnico_operativo, viewport: 'telefono', carpeta: 'ordenes' });
const info = await s.ir('/ordenes/index.html');
log('carga:', JSON.stringify(info));
await s.captura('07b-tecop-telefono-bandeja');
log('GEO:', JSON.stringify(await s.geometria()));
const tarjetas = await s.page.$$eval('#ordersCards .card-contrato, #ordersCards [data-orden-id]', cs => cs.slice(0, 6).map(c => ({ id: c.dataset.ordenId, txt: c.innerText.replace(/\s+/g, ' ').slice(0, 140), h: Math.round(c.getBoundingClientRect().height) })));
log('tarjetas:', JSON.stringify(tarjetas));
log('mis órdenes marcado:', await s.page.$eval('#mobileSoloMias', c => c.checked).catch(() => '?'), '| resumen:', await s.texto('#mobileResumen').catch(() => ''));
// Navegación: ¿cómo salgo a otro módulo?
const nav = await s.page.evaluate(() => ({
  bottomNav: [...document.querySelectorAll('#mobileBottomNav button')].map(b => b.innerText.trim()),
  topbarVisible: !!document.querySelector('#desktopTopbar')?.offsetParent,
  railVisible: !!document.querySelector('#rail-mount')?.offsetParent,
  fab: !!document.querySelector('.rail-fab, [data-rail-fab], .fab')?.offsetParent,
  headerMobile: (document.querySelector('#mobileHeader')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
}));
log('navegación móvil:', JSON.stringify(nav));
// Abrir filtros → ¿dónde está "Menú principal"?
await s.page.evaluate(() => document.querySelector('#mobileBottomNav [data-action="mobile-open-filters"]').click()); await s.quieto(600, 4000);
const drawer = await s.page.evaluate(() => { const d = document.getElementById('mobileDrawer'); const m = [...d.querySelectorAll('.mmenu-item')].map(b => { const r = b.getBoundingClientRect(); return { t: b.innerText.trim(), top: Math.round(r.top) }; }); return { altoDrawer: d.scrollHeight, vh: innerHeight, items: m }; });
log('drawer:', JSON.stringify(drawer));
await s.captura('07b-tecop-telefono-drawer-filtros');
await s.page.evaluate(() => document.querySelector('#mobileDrawer [data-action="mobile-close-filters"]').click()); await s.quieto(400, 3000);
// Abrir la primera orden ASIGNADO
const first = tarjetas.find(t => /ASIGNADO/i.test(t.txt)) || tarjetas[0];
if (first) {
  await medir(s, 'abrir equipos de la orden', async () => { await s.page.evaluate((id) => document.querySelector(`#ordersCards [data-orden-id="${id}"] [data-action="abrir-equipos-mobile"], [data-action="abrir-equipos-mobile"][data-orden-id="${id}"]`)?.click(), first.id); });
  await s.captura('07b-tecop-telefono-equipos-modal');
  const lista = await s.page.evaluate(() => ({ titulo: document.getElementById('equiposMobileTitle')?.innerText, sub: document.getElementById('equiposMobileSub')?.innerText, n: document.querySelectorAll('#equiposMobileList .equipo-card, #equiposMobileList [data-idx]').length, txt: (document.getElementById('equiposMobileList')?.innerText || '').replace(/\s+/g, ' ').slice(0, 400) }));
  log('modal equipos:', JSON.stringify(lista));
  log('GEO modal:', JSON.stringify(await s.geometria()));
  // Abrir la intervención del primer equipo (sin guardar)
  await medir(s, 'abrir intervención', async () => { await s.page.evaluate(() => document.querySelector('#equiposMobileList [data-action="abrir-trabajo-equipo"]')?.click()); });
  await s.captura('07b-tecop-telefono-intervencion');
  const inter = await s.page.evaluate(() => { const m = document.getElementById('modalTrabajoEquipo'); return { visible: !!m?.offsetParent, alto: m?.querySelector('.modal')?.scrollHeight, vh: innerHeight, txt: (m?.innerText || '').replace(/\s+/g, ' ').slice(0, 500) }; });
  log('intervención:', JSON.stringify(inter));
  const botones = await s.page.$$eval('#modalTrabajoEquipo button', bs => bs.filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return { t: (b.innerText || b.title).trim().slice(0, 22), h: Math.round(r.height), w: Math.round(r.width) }; }));
  log('botones intervención:', JSON.stringify(botones));
  // Materiales: abrir el buscador (sin agregar)
  await s.page.evaluate(() => document.querySelector('[data-action="abrir-material-equipo"]')?.click()); await s.quieto(600, 4000);
  await s.captura('07b-tecop-telefono-materiales');
  const mat = await s.page.evaluate(() => ({ visible: !!document.getElementById('modalMaterialEquipo')?.offsetParent, sugerencias: (document.getElementById('materialSugerencias')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300) }));
  log('materiales:', JSON.stringify(mat));
  // ¿el modal cierra con el mismo cerrar, o cierra todo?
  await s.page.evaluate(() => document.querySelector('[data-action="cerrar-material-equipo"]')?.click()); await s.quieto(400, 3000);
  await s.page.evaluate(() => document.querySelector('[data-action="cerrar-trabajo-equipo"]')?.click()); await s.quieto(400, 3000);
  log('modales abiertos al cerrar:', JSON.stringify(await modalAbierto(s)));
}
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
