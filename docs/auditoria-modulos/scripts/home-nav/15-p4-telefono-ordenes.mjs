// Verificación P4 (08-home-navegacion-admin): salir de la bandeja de Órdenes en
// teléfono. Antes: sin botón flotante (la barra inferior lo esconde), salida =
// Filtros → desplazar 173-225 px → "Menú principal" → home → módulo (3 toques +
// scroll). Ahora: "Menú" en la barra → cajón → módulo (2 toques), y los enlaces
// del cajón miden ≥ 44 px.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
for (const rol of ['recepcion', 'tecnico']) {
  const s = await abrir({ email: USUARIOS[rol], viewport: 'telefono', carpeta: 'home-nav' });
  await s.ir('/ordenes/index.html', { esperar: 1500 }); await s.quieto(1200, 15000);
  const antes = await s.page.evaluate(() => {
    const nav = document.getElementById('mobileBottomNav');
    const items = [...nav.querySelectorAll('.mnav-item')].map(b => ({ t: b.innerText.trim(), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }));
    const fab = document.querySelector('.rail-fab');
    return { items, fabVisible: !!(fab && fab.offsetParent), navVisible: getComputedStyle(nav).display !== 'none', scrollX: document.documentElement.scrollWidth > innerWidth };
  });
  console.log(`${rol}: barra=${JSON.stringify(antes)}`);
  let toques = 0;
  await s.page.click('#mobileBottomNav #ccRailToggle'); toques++; await s.quieto(500, 4000);
  const drawer = await s.page.evaluate(() => ({ abierto: document.getElementById('ccRail')?.classList.contains('is-open'), links: [...document.querySelectorAll('#ccRail .rail__link')].map(a => ({ t: a.innerText.trim(), h: Math.round(a.getBoundingClientRect().height), href: a.getAttribute('href') })) }));
  console.log(`  toque 1 "Menú" → cajón abierto=${drawer.abierto} · enlaces: ${drawer.links.map(l => `${l.t}(${l.h}px)`).join(' | ')}`);
  await s.captura(`97-${rol}-telefono-ordenes-cajon`);
  const destino = drawer.links.find(l => /PoC|Centro/.test(l.t));
  if (destino) {
    const t0 = Date.now();
    await s.page.evaluate((t) => [...document.querySelectorAll('#ccRail .rail__link')].find(a => a.innerText.trim() === t)?.click(), destino.t); toques++;
    await s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await s.quieto(1000, 15000);
    console.log(`  toque 2 "${destino.t}" → ${await s.page.evaluate(() => location.pathname)} en ${Date.now() - t0} ms · TOQUES TOTALES: ${toques} (antes: 3 + scroll)`);
  }
  await s.cerrar();
}
