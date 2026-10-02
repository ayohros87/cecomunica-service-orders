// Verificación R2/P2 (08-home-navegacion-admin): "Abrir orden" de las señales,
// "Órdenes sin movimiento" y el resultado de orden de Ctrl+K llevan a
// ordenes/index.html?ids=<id> y la orden APARECE aunque sea vieja.
// Antes (auditoría 2026-09-30): editar-orden.html → toast → ?orden= → 0 filas.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

const VIEJA = process.env.ORDEN_VIEJA || '2026081113';
const filas = (s) => s.page.evaluate((id) => ({
  filas: document.querySelectorAll('table.orders-table tbody tr.filaOrden').length || document.querySelectorAll('table.orders-table tbody tr').length,
  tieneId: document.body.innerText.includes(id),
  url: location.pathname + location.search,
}), VIEJA);

{
  const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'home-nav' });
  for (const qs of [`?ids=${VIEJA}`, `?orden=${VIEJA}`]) {
    const info = await s.ir(`/ordenes/index.html${qs}`, { esperar: 1500 });
    await s.quieto(1500, 15000);
    console.log(`deep-link ${qs} → ${info.msTotal} ms →`, JSON.stringify(await filas(s)), s.errores.filter(e => !/favicon/.test(e)).slice(0, 2));
  }
  await s.cerrar();
}
{
  // Admin: panel EST (sin movimiento) → CTA de la fila; Ctrl+K orden vieja → Enter.
  const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'home-nav' });
  await s.ir('/index.html', { esperar: 1500 });
  await s.page.waitForFunction(() => !document.querySelector('.kpi.is-loading'), { timeout: 20000 }).catch(() => {});
  await s.page.click('[data-signal="EST"]').catch(() => console.log('EST no está en pantalla'));
  await s.quieto(1000, 15000);
  const est = await s.page.evaluate(() => {
    const p = document.querySelector('.bj-panel');
    const ctas = [...(p?.querySelectorAll('a[href]') || [])].map(a => a.getAttribute('href'));
    return { filas: p?.querySelectorAll('.bj-row').length, hrefPanel: ctas[0], ctaFila: ctas.find(h => /ids=/.test(h) && !/,/.test(h)), aEditar: ctas.filter(h => /editar-orden/.test(h)).length };
  });
  console.log('panel EST:', JSON.stringify(est));
  if (est.ctaFila) {
    const t0 = Date.now();
    await s.ir('/' + est.ctaFila, { esperar: 1500 });
    await s.quieto(1500, 15000);
    const id = decodeURIComponent(est.ctaFila.split('ids=')[1]);
    const r = await s.page.evaluate((id) => ({ filas: document.querySelectorAll('table.orders-table tbody tr').length, tieneId: document.body.innerText.includes(id), toasts: (window.__toasts || []).map(t => t.msg).slice(0, 2) }), id);
    console.log(`CTA "Abrir orden" (${id}) → ${Date.now() - t0} ms →`, JSON.stringify(r));
    await s.captura('90-admin-escritorio-abrir-orden-desde-EST');
  }
  // Ctrl+K con la orden vieja
  await s.ir('/ordenes/index.html', { esperar: 1000 });
  await s.page.evaluate((q) => Layout.abrirBusqueda(q), VIEJA);
  await s.page.waitForFunction(() => document.querySelector('#sp-results .sp-row'), { timeout: 15000 }).catch(() => {});
  const href = await s.page.evaluate(() => document.querySelector('#sp-results .sp-row')?.getAttribute('href'));
  const t1 = Date.now();
  await s.page.keyboard.press('Enter');
  await s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await s.quieto(1500, 15000);
  console.log(`Ctrl+K "${VIEJA}" → ${href} → Enter → ${Date.now() - t1} ms →`, JSON.stringify(await filas(s)));
  await s.captura('91-admin-escritorio-ctrlk-enter-orden-vieja');
  // Nada en el app apunta a editar-orden.html salvo "Editar" en la fila
  for (const pag of ['/admin/integridad.html', '/almacen/index.html?tab=serial']) {
    await s.ir(pag, { esperar: 1500 }); await s.quieto(1500, 25000);
    console.log(pag, 'enlaces a editar-orden:', await s.page.evaluate(() => document.querySelectorAll('a[href*="editar-orden"]').length));
  }
  await s.cerrar();
}
