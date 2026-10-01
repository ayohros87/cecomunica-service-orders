// Recorrido 08: verificaciones puntuales — deep-link ?orden= del buscador, FAB tapado en el detalle de orden (teléfono),
// ficha del Centro por ?id=, y recuento de recepción (S2/LPC) para descartar deriva del emulador compartido.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
{
  const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'home-nav' });
  for (const id of ['2026081113', '2026093002']) {
    const info = await s.ir(`/ordenes/index.html?orden=${id}`, { esperar: 2000 });
    await s.quieto(2000, 15000);
    const r = await s.page.evaluate((id) => ({ filas: document.querySelectorAll('#ordersTable tbody tr').length, tieneId: document.body.innerText.includes(id), modal: document.querySelector('.modal-backdrop.open, .overlay:not(.hidden)')?.innerText?.slice(0, 80) || null, busq: [...document.querySelectorAll('input')].filter(i => i.value.includes(id)).map(i => i.id), chips: document.querySelector('#estadoChipsBar')?.innerText.replace(/\s+/g, ' ').slice(0, 120) }), id);
    console.log(`?orden=${id} → ${info.msTotal} ms →`, JSON.stringify(r), s.errores.slice(0, 2));
    await s.captura(`35-recepcion-escritorio-deeplink-orden-${id}`);
  }
  // Home de recepción otra vez (S2 / LPC)
  await s.ir('/index.html', { esperar: 1500 });
  await s.page.waitForFunction(() => !document.querySelector('.kpi.is-loading'), { timeout: 15000 }).catch(() => {});
  console.log('home recepción (2.ª vez):', await s.page.evaluate(() => [...document.querySelectorAll('[data-signal]')].map(e => e.dataset.signal + '=' + e.querySelector('.kpi__val')?.innerText).join(' ')));
  // Abrir el panel de S1 y ver las filas + el grupo "por depurar"
  await s.page.click('[data-signal="S1"]'); await s.quieto(1000, 10000);
  const p = await s.page.evaluate(() => { const p = document.querySelector('.bj-panel'); return { filas: p?.querySelectorAll('.bj-row').length, head: p?.querySelector('.bj-panel-head, .bj-head')?.innerText.replace(/\s+/g, ' ').slice(0, 120), grupos: [...(p?.querySelectorAll('.bj-grupo, details, .bj-group') || [])].map(g => g.innerText.replace(/\s+/g, ' ').slice(0, 80)), primera: p?.querySelector('.bj-row')?.innerText.replace(/\s+/g, ' ').slice(0, 160) }; });
  console.log('panel S1:', JSON.stringify(p));
  await s.captura('36-recepcion-escritorio-home-panel-S1', { full: true });
  await s.page.click('[data-signal="ENT"]'); await s.quieto(1000, 10000);
  const p2 = await s.page.evaluate(() => { const p = document.querySelector('.bj-panel'); return { filas: p?.querySelectorAll('.bj-row').length, primera: p?.querySelector('.bj-row')?.innerText.replace(/\s+/g, ' ').slice(0, 160), botones: [...new Set([...(p?.querySelectorAll('button, a.bj-cta, a.btn') || [])].map(b => b.innerText.trim()))].slice(0, 8) }; });
  console.log('panel ENT:', JSON.stringify(p2));
  await s.captura('37-recepcion-escritorio-home-panel-ENT', { full: true });
  await s.cerrar();
}
{
  const t = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'home-nav' });
  await t.ir('/ordenes/editar-orden.html?id=2026093002', { esperar: 1200 });
  const g = await t.page.evaluate(() => { const f = document.querySelector('.rail-fab, #ccRailToggle'); if (!f) return null; const r = f.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { fab: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, encima: el ? (el.tagName + '#' + el.id + '.' + el.className).slice(0, 80) : null, esFab: el === f || f.contains(el), z: getComputedStyle(f).zIndex, vh: innerHeight }; });
  console.log('editar-orden teléfono FAB:', JSON.stringify(g));
  await t.captura('38-tecnico-telefono-editar-orden-fab');
  await t.page.mouse.click(g.fab.x + g.fab.w / 2, g.fab.y + g.fab.h / 2).catch(() => {});
  await t.quieto(500, 3000);
  console.log('   drawer abierto tras clic real:', await t.page.evaluate(() => document.getElementById('ccRail')?.classList.contains('is-open')));
  await t.cerrar();
}
{
  const c = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'home-nav' });
  const info = await c.ir('/clientes/centro.html?id=KDDQ7nRrOlbDlIOAAkmm', { esperar: 2000 });
  await c.quieto(2000, 15000);
  const f = await c.page.evaluate(() => { const t = document.body.innerText; return { titulo: document.querySelector('.cg-ficha h2, .cg-ficha-head, h2')?.innerText?.slice(0, 60), tieneSky: t.includes('SKY CHEFS'), contratos: (t.match(/[A-Z]{3,5}\d{8}-\d{2}/g) || []).slice(0, 6), pestañas: [...document.querySelectorAll('[role=tab], .cg-tab, .ws-tab')].map(e => e.innerText.trim()).slice(0, 10), linksCruzados: [...document.querySelectorAll('a[href]')].filter(a => a.getClientRects().length && !a.closest('#ccRail')).map(a => a.getAttribute('href')).filter(h => /ordenes|almacen|contratos\/|POC|cotizaciones/.test(h)).slice(0, 10) }; });
  console.log('Centro ?id= →', info.msTotal, 'ms', JSON.stringify(f));
  await c.captura('43-recepcion-escritorio-centro-ficha-sky', { full: true });
  await c.cerrar();
}
