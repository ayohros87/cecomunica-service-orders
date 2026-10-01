// Recorrido 01: bandeja de órdenes como Recepción, escritorio y tablet. Solo lectura.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

for (const vp of ['escritorio', 'tablet']) {
  const s = await abrir({ email: USUARIOS.recepcion, viewport: vp, carpeta: 'ordenes' });
  const info = await s.ir('/ordenes/index.html');
  console.log(vp, JSON.stringify(info));
  await s.captura(`01-recepcion-${vp}-bandeja`);
  const chips = await s.texto('#estadoChipsBar').catch(() => '');
  console.log('CHIPS:', chips.replace(/\n/g, ' | '));
  console.log('GEO:', JSON.stringify(await s.geometria()));
  const filas = await s.page.evaluate(() => {
    const trs = [...document.querySelectorAll('#ordersTable tbody tr.filaPrincipal, #ordersTable tbody tr[data-orden-id]')];
    return { n: trs.length, primera: trs[0]?.innerText?.replace(/\n/g, ' | ').slice(0, 300), thead: document.querySelector('#ordersTable thead')?.innerText?.replace(/\n/g, ' | ') };
  });
  console.log('FILAS:', JSON.stringify(filas));
  // ¿Cuánto tarda en aparecer la primera fila real? (ultimaMut vs tAuth)
  const m = await s.page.evaluate(() => ({ tAuth: Math.round(window.__tAuth || 0), ultimaMut: window.__m.ultimaMut, loaderOn: window.__m.loaderOn, loaderOff: window.__m.loaderOff }));
  console.log('TIEMPOS:', JSON.stringify(m));
  console.log('CONSULTAS:', (await s.consultas()).join(' ; '));
  console.log('ERRORES:', s.errores.slice(0, 8));
  console.log('TOASTS:', JSON.stringify(await s.toasts()));
  // Topbar / botones visibles
  const botones = await s.page.evaluate(() => [...document.querySelectorAll('.topbar button, .topbar a, #desktopTopbar button, #desktopTopbar a, #mobileHeader button')].filter(b => b.offsetParent).map(b => (b.innerText || b.title || b.getAttribute('aria-label') || '').trim()).filter(Boolean));
  console.log('BOTONES TOPBAR:', botones.join(' | '));
  await s.cerrar();
}
