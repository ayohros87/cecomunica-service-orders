import { abrir, USUARIOS, medir, log, tipear } from './lib-ordenes.mjs';
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ordenes' });
await s.ir('/ordenes/index.html');
const th = await s.page.evaluate(() => [...document.querySelectorAll('thead th')].map(t => ({ t: t.innerText.trim(), w: Math.round(t.getBoundingClientRect().width) })));
log('columnas:', JSON.stringify(th));
const num = await s.page.evaluate(() => { const tr = document.querySelector('tr[data-orden-row]'); const td = tr.querySelector('td'); const a = td.querySelector('a') || td; const r = a.getBoundingClientRect(), rt = td.getBoundingClientRect(), rc = tr.querySelectorAll('td')[1].getBoundingClientRect(); return { numero: a.innerText.trim(), textoW: a.scrollWidth, linkW: Math.round(r.width), celdaW: Math.round(rt.width), finLink: Math.round(r.right), inicioCliente: Math.round(rc.left), overflowTd: getComputedStyle(td).overflow, font: getComputedStyle(a).fontFamily.slice(0, 30) }; });
log('numero vs cliente:', JSON.stringify(num));
for (const q of ['2026081004', '20260810', 'colon', 'COLON CONTAINER TERMINAL', 'MUNICIPIO', '25512A1843', 'ventas', 'Marcos']) {
  await tipear(s, '#filtroRapido', q);
  await medir(s, `buscar "${q}"`, async () => { await s.page.keyboard.press('Enter'); });
  const r = await s.page.evaluate(() => ({ filas: document.querySelectorAll('tr[data-orden-row]').length, total: document.getElementById('resumenOrdenes')?.innerText, primera: document.querySelector('tr[data-orden-row]')?.innerText.replace(/\s+/g, ' ').slice(0, 70) }));
  log('  →', JSON.stringify(r));
}
log('consultas:', (await s.consultas()).filter(c => /buscar|search/i.test(c)).join(' ; '));
await s.cerrar();
