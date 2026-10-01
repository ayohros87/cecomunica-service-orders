// Remates: el buscador del directorio (¿dispara consulta?), el historial de la ficha (modal), la constancia de equipos,
// y el directorio + ficha en tablet. Admin. Solo lectura.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1600));
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });

await s.ir('/clientes/centro.html');
const n0 = (await s.consultas()).length;
const t0 = Date.now();
await s.page.type('#cgBuscar', 'seprosa');
await new Promise(r => setTimeout(r, 2500));
log('r_buscar_seprosa', { ms: Date.now() - t0, nuevas: (await s.consultas()).slice(n0), resumen: await s.texto('#cgResumen'), filas: (await s.texto('#cgLista')).split('\n').filter(Boolean).slice(0, 8) });
await s.captura('70-admin-escritorio-buscar-seprosa');
// búsqueda por RUC parcial y por representante
for (const q of ['297612237318', 'guardia', 'SEGURIDAD']) {
  await s.page.evaluate(() => { const i = document.getElementById('cgBuscar'); i.value = ''; });
  await s.page.type('#cgBuscar', q);
  await new Promise(r => setTimeout(r, 2000));
  log('r_buscar_' + q, { resumen: await s.texto('#cgResumen'), primeras: (await s.texto('#cgLista')).split('\n').filter(Boolean).slice(0, 6) });
}
// Ctrl+K: ¿encuentra clientes?
await s.page.keyboard.down('Control'); await s.page.keyboard.press('k'); await s.page.keyboard.up('Control');
await s.quieto(600);
await s.page.keyboard.type('seprosa');
await new Promise(r => setTimeout(r, 2000));
log('r_ctrlk', (await s.texto('body')).split('\n').filter(l => /seprosa|SEPROSA|Cliente|cliente/i.test(l)).slice(0, 8));
await s.captura('71-admin-escritorio-ctrlk-cliente');
await s.page.keyboard.press('Escape');

// Historial de la ficha (modal) en ficha.html
await s.ir('/clientes/ficha.html?id=6yoaiUMRAhhSMtiC4O0S&from=centro');
await s.hacer(() => document.getElementById('chipHistorial')?.click());
await new Promise(r => setTimeout(r, 2500));
log('r_historial', { modal: (await s.texto('#modalHist')).slice(0, 1200), abierto: await s.page.evaluate(() => document.getElementById('modalHist')?.className + ' ' + getComputedStyle(document.getElementById('modalHist')).display) });
await s.captura('72-admin-escritorio-historial-modal');

// Constancia de equipos desde el Centro
await s.ir('/clientes/centro.html?id=6yoaiUMRAhhSMtiC4O0S');
await s.clic('#btnMasFicha');
const href = await s.page.evaluate(() => [...document.querySelectorAll('#cgMasMenu a, #cgMasMenu button')].map(a => a.getAttribute('href') || a.getAttribute('onclick')).filter(Boolean));
log('r_mas_hrefs', href);
await s.page.evaluate(() => [...document.querySelectorAll('#cgMasMenu button, #cgMasMenu a')].find(b => /Constancia/.test(b.innerText))?.click());
await s.quieto(1500);
log('r_constancia', { url: await s.page.evaluate(() => location.pathname + location.search), modal: (await s.texto('.modal-backdrop.open')).slice(0, 800), paginas: await s.page.evaluate(() => document.title) });
await s.captura('73-admin-escritorio-constancia');
await s.cerrar();

// Tablet
const t = await abrir({ email: USUARIOS.admin, viewport: 'tablet', carpeta: 'centro' });
let info = await t.ir('/clientes/centro.html');
log('r_tab_dir', { ms: info.msTotal, geo: await t.geometria() });
await t.captura('74-admin-tablet-directorio');
info = await t.ir('/clientes/centro.html?id=gFs21DErNjbZFbkGrdAH');
log('r_tab_ficha', { ms: info.msTotal, geo: await t.geometria() });
await t.captura('75-admin-tablet-ficha-grande');
await t.page.evaluate(() => Centro.wizReemplazo());
await t.quieto(1000);
await t.captura('76-admin-tablet-wiz-reemplazo');
await t.cerrar();
