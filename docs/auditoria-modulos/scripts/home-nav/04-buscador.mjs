// Recorrido 04: buscador Ctrl+K desde varias páginas, con datos reales del emulador. Mide tiempo y qué devuelve.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const CONSULTAS = [
  ['cliente por nombre', 'C COMUNICA'], ['cliente por nombre parcial', 'comunica'], ['cliente por palabra a medias', 'hospi'],
  ['RUC completo', '32977-27-249966'], ['RUC parcial', '32977'], ['RUC otro formato', '8-NT-1-12501'],
  ['orden reciente', '2026093002'], ['orden vieja (no en las 40)', '2026081113'], ['orden número corto', '093002'],
  ['serial en orden y PoC', '23706A0608'], ['serial PoC viejo (fuera de los 500)', '21N18A0318'], ['serial PoC reciente', '23706A0603'],
  ['serial SOLO en el pool', '014290000053877'], ['unit_id PoC', '275643'],
  ['cotización', 'COT-2026-0138'], ['cotización número corto', '0138'], ['cliente de la cotización', 'chorrerana'],
  ['cliente con acento', 'compañía goly'], ['cliente sin acento', 'compania goly'],
];
async function buscar(s, q) {
  const t0 = Date.now();
  await s.page.evaluate((q) => Layout.abrirBusqueda(q), q);
  await s.page.waitForFunction(() => { const r = document.getElementById('sp-results'); return r && !/Buscando|al menos 2/.test(r.innerText); }, { timeout: 15000 }).catch(() => {});
  const ms = Date.now() - t0;
  const d = await s.page.evaluate(() => {
    const groups = [...document.querySelectorAll('#sp-results .sp-group')].map(g => ({ g: g.querySelector('.sp-group-head')?.innerText.replace(/\s+/g, ' ').trim(), rows: [...g.querySelectorAll('.sp-row')].map(r => ({ t: r.querySelector('.sp-row-title')?.innerText.trim(), s: r.querySelector('.sp-row-sub')?.innerText.trim(), h: r.getAttribute('href') })) }));
    return { groups, hint: document.querySelector('#sp-results .sp-hint')?.innerText.trim() || '' };
  });
  await s.page.evaluate(() => window.SearchPalette && SearchPalette.close());
  return { ms, ...d };
}
for (const [rol, pag] of [['admin', '/ordenes/index.html'], ['recepcion', '/clientes/centro.html'], ['inventario', '/almacen/index.html']]) {
  const s = await abrir({ email: USUARIOS[rol], viewport: 'escritorio', carpeta: 'home-nav' });
  await s.ir(pag, { esperar: 1000 });
  console.log(`\n=== ${rol} desde ${pag} ===`);
  // primera apertura: cuánto tarda cargar el palette
  const t0 = Date.now();
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('k'); await s.page.keyboard.up('Control');
  await s.page.waitForSelector('.search-palette-overlay.is-open', { timeout: 10000 }).catch(() => {});
  console.log('Ctrl+K abre en', Date.now() - t0, 'ms; recientes:', await s.page.evaluate(() => document.querySelector('.sp-group--recientes') ? 'sí' : 'no'));
  await s.captura(`30-${rol}-escritorio-ctrlk-vacio`);
  await s.page.evaluate(() => SearchPalette.close());
  const lista = rol === 'admin' ? CONSULTAS : CONSULTAS.filter((_, i) => [0, 3, 6, 9, 12, 14].includes(i));
  for (const [que, q] of lista) {
    const r = await buscar(s, q);
    const resumen = r.groups.map(g => `${g.g}: ${g.rows.map(x => `${x.t}${x.s ? ' (' + x.s.slice(0, 40) + ')' : ''}`).join(' / ')}`).join(' || ') || r.hint;
    console.log(`[${que}] "${q}" → ${r.ms} ms · ${resumen}`);
    if (q === '2026093002' || q === '014290000053877') { await s.page.evaluate((q) => Layout.abrirBusqueda(q), q); await s.page.waitForFunction(() => !/Buscando/.test(document.getElementById('sp-results')?.innerText || ''), { timeout: 15000 }).catch(() => {}); await s.captura(`31-${rol}-escritorio-ctrlk-${q}`); await s.page.evaluate(() => SearchPalette.close()); }
  }
  if (rol === 'admin') {
    // Enter en el primer resultado de una orden: ¿a dónde lleva y qué pasa?
    await s.page.evaluate(() => Layout.abrirBusqueda('2026081113'));
    await s.page.waitForFunction(() => document.querySelector('#sp-results .sp-row'), { timeout: 15000 }).catch(() => {});
    const href = await s.page.evaluate(() => document.querySelector('#sp-results .sp-row')?.getAttribute('href'));
    const t1 = Date.now();
    await s.page.keyboard.press('Enter');
    await s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await s.quieto(1200, 15000);
    const res = await s.page.evaluate(() => ({ url: location.pathname + location.search, filas: document.querySelectorAll('#ordersTable tbody tr').length, resaltada: !!document.querySelector('tr.is-focus, tr.highlight, tr.resaltada, tr[data-orden-id="2026081113"]'), texto: document.body.innerText.includes('2026081113') }));
    console.log(`Enter en orden vieja → ${href} → ${Date.now() - t1} ms → ${JSON.stringify(res)}`);
    await s.captura('32-admin-escritorio-ctrlk-enter-orden-vieja');
    // PoC focus
    await s.page.evaluate(() => Layout.abrirBusqueda('23706A0603'));
    await s.page.waitForFunction(() => document.querySelector('#sp-results .sp-row'), { timeout: 15000 }).catch(() => {});
    const hrefPoc = await s.page.evaluate(() => [...document.querySelectorAll('#sp-results .sp-row')].map(r => r.getAttribute('href')).find(h => h.includes('POC')));
    if (hrefPoc) {
      const t2 = Date.now();
      await s.ir(hrefPoc, { esperar: 1200 });
      const rp = await s.page.evaluate(() => ({ filas: document.querySelectorAll('table tbody tr').length, foco: !!document.querySelector('tr.is-focus, tr.focus, tr.highlight, tr[data-focus], .row-focus'), busq: document.querySelector('#searchInput, input[type=search], #buscar')?.value, texto: document.body.innerText.includes('23706A0603') }));
      console.log(`PoC desde Ctrl+K → ${hrefPoc} → ${Date.now() - t2} ms → ${JSON.stringify(rp)}`);
      await s.captura('33-admin-escritorio-ctrlk-poc-focus');
    }
    // Cliente: ¿a dónde lleva?
    await s.page.evaluate(() => Layout.abrirBusqueda('C COMUNICA'));
    await s.page.waitForFunction(() => document.querySelector('#sp-results .sp-row'), { timeout: 15000 }).catch(() => {});
    console.log('Cliente → href:', await s.page.evaluate(() => document.querySelector('#sp-results .sp-row')?.getAttribute('href')));
  }
  // Home: buscador del home
  if (rol === 'recepcion') {
    await s.ir('/index.html', { esperar: 1200 });
    await s.page.type('#buscador', 'beverly');
    await new Promise(r => setTimeout(r, 900));
    const st = await s.page.evaluate(() => ({ hint: document.getElementById('buscadorHint')?.innerText, abierto: !!document.querySelector('.search-palette-overlay.is-open'), valor: document.getElementById('buscador').value, spVal: document.getElementById('sp-input')?.value }));
    console.log('Home: teclear "beverly" →', JSON.stringify(st));
    await s.captura('34-recepcion-escritorio-home-buscador');
  }
  await s.cerrar();
}
