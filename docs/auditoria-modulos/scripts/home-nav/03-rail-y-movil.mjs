// Recorrido 03: el rail en cada módulo (admin, escritorio): activo, título de la página vs rótulo del rail,
// botón Volver/Menú principal; y la salida desde Órdenes/Centro/Almacén en teléfono y tablet.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const PAGS = ['/ordenes/index.html', '/POC/index.html', '/POC/vendedores-batch.html', '/clientes/centro.html', '/cotizaciones/index.html', '/contratos/index.html', '/almacen/index.html', '/facturacion/bandeja.html', '/inventario/modelos.html', '/admin/index.html', '/perfil.html', '/firma-correo.html', '/ordenes/editar-orden.html?id=2026093002', '/ordenes/nueva-orden.html', '/inventario/piezas.html', '/inventario/pendientes.html', '/clientes/index.html', '/facturacion/activacion.html'];
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'home-nav' });
console.log('=== RAIL POR PÁGINA (admin, escritorio) ===');
for (const p of PAGS) {
  const info = await s.ir(p, { esperar: 1000 });
  const d = await s.page.evaluate(() => {
    const txt = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
    const act = [...document.querySelectorAll('#ccRail .rail__link.is-active')].map(a => txt(a.querySelector('.rail__txt')));
    const rail = !!document.getElementById('ccRail');
    const titulo = txt(document.querySelector('.topbar-title, .topbar__title, h1'));
    const btns = [...document.querySelectorAll('.topbar a.btn, .topbar button.btn, .app-topbar a.btn, .app-topbar button.btn')].filter(b => b.offsetParent).map(b => txt(b) || b.getAttribute('aria-label') || b.title).filter(Boolean);
    const mini = document.documentElement.getAttribute('data-cc-rail');
    const nLinks = document.querySelectorAll('#ccRail .rail__link').length;
    return { doc: document.title, titulo, act, rail, btns, mini, nLinks, buscar: !!document.querySelector('[data-cc-buscar]') };
  });
  console.log(`${p} · ${info.msTotal}ms fs=${info.fsReqs} quieto=${info.quieto} | rail=${d.rail}(${d.nLinks}) activo=[${d.act.join(',')}] | <title>=${d.doc} | topbar="${d.titulo}" | btns=${d.btns.join('/')} | buscar=${d.buscar}` + (s.errores.length ? ` | ERR ${s.errores.slice(0, 3).join(' ; ')}` : ''));
}
await s.captura('20-admin-escritorio-rail-ordenes').catch(() => {});
// Rail contraído
await s.ir('/ordenes/index.html');
await s.page.click('#ccRailCollapse').catch(() => {});
await s.quieto(600, 3000);
await s.captura('21-admin-escritorio-rail-mini');
await s.ir('/clientes/centro.html');
console.log('rail mini persiste al cambiar de página:', await s.page.evaluate(() => document.documentElement.getAttribute('data-cc-rail')));
await s.cerrar();

console.log('\n=== MÓVIL / TABLET: salir de un módulo ===');
for (const [rol, vp] of [['recepcion', 'telefono'], ['recepcion', 'tablet'], ['tecnico', 'telefono'], ['inventario', 'telefono']]) {
  const t = await abrir({ email: USUARIOS[rol], viewport: vp, carpeta: 'home-nav' });
  for (const p of (rol === 'inventario' ? ['/almacen/index.html'] : rol === 'tecnico' ? ['/ordenes/index.html', '/ordenes/editar-orden.html?id=2026093002'] : ['/ordenes/index.html', '/clientes/centro.html', '/POC/index.html'])) {
    const info = await t.ir(p, { esperar: 1000 });
    const d = await t.page.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
      const fab = document.querySelector('.rail-fab');
      const toggle = document.getElementById('ccRailToggle');
      const bnav = document.querySelector('#mobileBottomNav, .bottom-nav, .mobile-bottom-nav');
      const bnavItems = bnav ? [...bnav.querySelectorAll('button, a')].filter(vis).map(b => b.innerText.trim().replace(/\s+/g, ' ')) : [];
      const topbarVisible = vis(document.querySelector('.topbar, .app-topbar'));
      const homeLink = [...document.querySelectorAll('a[href*="index.html"], button')].filter(b => vis(b) && /men[uú] principal|inicio/i.test(b.innerText || '')).map(b => b.innerText.trim());
      const objs = [...document.querySelectorAll('button, a[href]')].filter(vis);
      const chicos = objs.filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).length;
      return { fab: vis(fab), fabHidden: fab?.hidden, toggle: vis(toggle), bnav: vis(bnav), bnavItems, topbarVisible, homeLink, objs: objs.length, chicos44: chicos, scrollX: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    console.log(`${rol}@${vp} ${p} · ${info.msTotal}ms | FAB=${d.fab}(hidden=${d.fabHidden}) toggle=${d.toggle} bottomNav=${d.bnav}[${d.bnavItems.join(',')}] topbar=${d.topbarVisible} homeLink=[${d.homeLink.join(',')}] objetivos=${d.objs} <44px=${d.chicos44} scrollX=${d.scrollX}` + (t.errores.length ? ` | ERR ${t.errores.slice(0, 2).join(';')}` : ''));
    await t.captura(`22-${rol}-${vp}-${p.split('/')[1]}${p.includes('editar') ? '-editar' : ''}`);
    // Camino para salir: FAB → drawer → link
    if (d.fab || d.toggle) {
      await t.page.click(d.fab ? '.rail-fab' : '#ccRailToggle').catch(() => {});
      await t.quieto(500, 3000);
      const abierto = await t.page.evaluate(() => document.getElementById('ccRail')?.classList.contains('is-open'));
      console.log(`   → 1 toque abre el drawer: ${abierto}; 2.º toque = módulo. Total 2.`);
      await t.captura(`23-${rol}-${vp}-${p.split('/')[1]}-drawer`);
    } else if (d.bnav) {
      // Órdenes: Filtros → scroll → Menú principal
      const btnFiltros = await t.page.$('[data-action="mobile-open-filters"]');
      if (btnFiltros) {
        await btnFiltros.click(); await t.quieto(500, 3000);
        const g = await t.page.evaluate(() => { const b = document.querySelector('#mobileDrawer [data-action="go-menu-principal"]'); const r = b?.getBoundingClientRect(); const dr = document.getElementById('mobileDrawer'); return { y: r?.top, h: innerHeight, scrollDrawer: dr ? dr.scrollHeight - dr.clientHeight : null, items: dr ? [...dr.querySelectorAll('.mmenu-item')].map(x => x.innerText.trim()) : [] }; });
        console.log(`   → sin FAB: Filtros(1) → "Menú principal" en y=${Math.round(g.y)} de ${g.h}px (scroll del cajón ${g.scrollDrawer}px) → home(2) → módulo(3). Total 3 + scroll. Ítems: ${g.items.join(',')}`);
        await t.captura(`23-${rol}-${vp}-ordenes-filtros`);
      }
    } else console.log('   → SIN salida visible');
  }
  await t.cerrar();
}
