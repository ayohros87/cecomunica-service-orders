// Recorrido 07: panel admin completo como admin (escritorio), más index/operacion en tablet. Solo lectura: no se ejecuta ningún backfill ni fusión.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const PAGS = ['index', 'operacion', 'financiero', 'kpi-reportes', 'uso', 'usuarios', 'auditoria', 'config', 'alertas', 'pii', 'clientes-duplicados', 'refs-huerfanas', 'grupos', 'salud', 'integridad', 'backfills', 'email-preview'];
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'home-nav' });
let n = 60;
for (const p of PAGS) {
  const info = await s.ir(`/admin/${p}.html`, { esperar: 1500 });
  await s.page.waitForFunction(() => !document.querySelector('.is-loading, .skeleton, [aria-busy="true"]'), { timeout: 25000 }).catch(() => {});
  await s.quieto(1500, 20000);
  const real = await s.page.evaluate(() => Math.round(window.__m.ultimaMut || 0));
  const d = await s.page.evaluate(() => {
    const txt = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
    const stats = [...document.querySelectorAll('.stat-card')].map(c => `${txt(c.querySelector('.label'))}=${txt(c.querySelector('.value'))} (${txt(c.querySelector('.sub'))})`);
    const banners = [...document.querySelectorAll('.alert-banner')].filter(b => b.offsetParent).map(txt).map(t => t.slice(0, 120));
    const h = [...document.querySelectorAll('h1,h2,h3')].filter(e => e.offsetParent).map(txt).slice(0, 14);
    const tablas = [...document.querySelectorAll('table')].filter(t => t.offsetParent).map(t => `${t.querySelectorAll('tbody tr').length} filas × ${t.querySelectorAll('thead th').length} col`);
    const vacios = [...document.querySelectorAll('.empty-state, .empty-state-hint, .bj-lista-vacia')].filter(e => e.offsetParent).map(txt).slice(0, 4);
    const btnsPeligro = [...document.querySelectorAll('button')].filter(b => b.offsetParent && /ejecutar|fusionar|purgar|borrar|eliminar|activar/i.test(b.innerText)).map(b => `${b.innerText.trim()}${b.disabled ? '(desh.)' : ''}`);
    return { stats, banners, h, tablas, vacios, btnsPeligro, scrollX: document.documentElement.scrollWidth > innerWidth + 1, texto: document.body.innerText.length };
  });
  const cons = await s.consultas();
  console.log(`\n=== admin/${p}.html · ${info.msTotal} ms total, quieto a los ${real} ms, fs=${info.fsReqs}, consultas de servicio=${cons.length}` + (s.errores.length ? ` | ERR ${s.errores.slice(0, 3).join(' ; ')}` : ''));
  if (d.stats.length) console.log('  KPIs:', d.stats.join(' | '));
  if (d.banners.length) console.log('  banners:', d.banners.join(' || '));
  console.log('  secciones:', d.h.join(' / '));
  if (d.tablas.length) console.log('  tablas:', d.tablas.join(' ; '));
  if (d.vacios.length) console.log('  vacíos:', d.vacios.join(' | '));
  if (d.btnsPeligro.length) console.log('  botones de acción:', d.btnsPeligro.join(' | '));
  if (cons.length) console.log('  consultas:', cons.slice(0, 12).join(' ; '));
  await s.captura(`${n++}-admin-escritorio-${p}`, { full: true });
  if (p === 'uso') {
    const u = await s.page.evaluate(() => ({ resumen: document.getElementById('usoResumen')?.innerText, rango: document.getElementById('selRango')?.value, opciones: [...document.querySelectorAll('#selRango option')].map(o => o.value) }));
    console.log('  uso:', JSON.stringify(u));
  }
  if (p === 'usuarios') {
    const u = await s.page.evaluate(() => ({ filas: [...document.querySelectorAll('table tbody tr')].slice(0, 20).map(tr => tr.innerText.replace(/\s+/g, ' ').slice(0, 90)), selects: [...document.querySelectorAll('select')].slice(0, 1).map(sel => [...sel.options].map(o => o.text)) }));
    console.log('  usuarios:', JSON.stringify(u));
  }
  if (p === 'auditoria') console.log('  auditoría filtros:', JSON.stringify(await s.page.evaluate(() => [...document.querySelectorAll('select, input')].map(e => `${e.id || e.name}=${e.value}`).slice(0, 10))));
  if (p === 'operacion') console.log('  operación atención:', JSON.stringify(await s.page.evaluate(() => [...document.querySelectorAll('.att-row')].slice(0, 6).map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 100)))));
}
await s.cerrar();
// Tablet
const t = await abrir({ email: USUARIOS.admin, viewport: 'tablet', carpeta: 'home-nav' });
for (const p of ['index', 'operacion', 'usuarios']) {
  const info = await t.ir(`/admin/${p}.html`, { esperar: 1500 });
  await t.quieto(1500, 15000);
  console.log(`tablet admin/${p}: ${info.msTotal} ms | scrollX=${await t.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)} | FAB=${await t.page.evaluate(() => !!document.querySelector('.rail-fab') && getComputedStyle(document.querySelector('.rail-fab')).display !== 'none')}`);
  await t.captura(`80-admin-tablet-${p}`);
}
await t.cerrar();
