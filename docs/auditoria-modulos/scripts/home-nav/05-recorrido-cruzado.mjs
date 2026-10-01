// Recorrido 05: enlaces cruzados y el costo de un recorrido típico de 5 pantallas (recepción, escritorio, sesión ya caliente).
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'home-nav' });
await s.ir('/index.html', { esperar: 1200 }); // calienta la sesión (Sesion.memo)
const enlaces = async (etq) => s.page.evaluate((etq) => {
  const vis = (a) => a.getClientRects().length > 0;
  const as = [...document.querySelectorAll('a[href]')].filter(vis);
  const mod = (h) => /centro\.html/.test(h) ? 'centro' : /contratos\//.test(h) ? 'contratos' : /almacen\/|inventario\//.test(h) ? 'almacen' : /POC\//.test(h) ? 'poc' : /ordenes\//.test(h) ? 'ordenes' : /cotizaciones\//.test(h) ? 'cotizaciones' : /facturacion\//.test(h) ? 'facturacion' : null;
  const cruz = as.map(a => ({ m: mod(a.getAttribute('href') || ''), h: a.getAttribute('href'), t: (a.innerText || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 40), blank: a.target === '_blank', rail: !!a.closest('#ccRail') })).filter(x => x.m && !x.rail);
  return cruz;
}, etq);
const paso = async (n, url, que, esperar = 1200) => {
  const info = await s.ir(url, { esperar });
  const real = await s.page.evaluate(() => Math.round(window.__m.ultimaMut || 0));
  const e = await enlaces();
  const porMod = e.reduce((a, x) => (a[x.m] = (a[x.m] || 0) + 1, a), {});
  const blanks = e.filter(x => x.blank).length;
  console.log(`${n}. ${que} · ${url} → total ${info.msTotal} ms (última mutación a los ${real} ms desde el arranque de la página; primer viaje Firestore a los ${info.primeraFs} ms; ${info.fsReqs} peticiones) | enlaces cruzados visibles: ${JSON.stringify(porMod)} (${blanks} en pestaña nueva)` + (s.errores.length ? ` | ERR ${s.errores.slice(0, 2).join(';')}` : ''));
  return { info, real, e };
};
console.log('=== Recorrido: home → orden → cliente (Centro) → contrato → serial en Almacén ===');
const r1 = await paso(1, '/index.html', 'Home');
const r2 = await paso(2, '/ordenes/editar-orden.html?id=2026093002', 'Detalle de orden 2026093002 (SKY CHEFS)');
console.log('   enlaces de la orden:', r2.e.map(x => `${x.m}:"${x.t}"→${x.h}${x.blank ? ' [nueva pestaña]' : ''}`).join(' | ') || 'NINGUNO');
await s.captura('40-recepcion-escritorio-editar-orden-enlaces');
const r3 = await paso(3, '/clientes/centro.html?id=KDDQ7nRrOlbDlIOAAkmm', 'Centro · ficha SKY CHEFS', 1500);
console.log('   enlaces del Centro (primeros 12):', r3.e.slice(0, 12).map(x => `${x.m}:"${x.t}"→${x.h}${x.blank ? ' [nueva pestaña]' : ''}`).join(' | ') || 'NINGUNO');
await s.captura('41-recepcion-escritorio-centro-ficha', { full: true });
// ¿La ficha lista contratos y seriales? ¿enlace del serial al pool?
const fic = await s.page.evaluate(() => { const t = document.body.innerText; return { contratos: (t.match(/ALQ\d{8}-\d{2}|PROP\d{8}-\d{2}|REEMP\d{8}-\d{2}/g) || []).slice(0, 5), seriales: (t.match(/\b\d{2}[A-Z0-9]\d{2}[A-Z]\d{4}\b/g) || []).slice(0, 5), linksSerial: [...document.querySelectorAll('a[href*="almacen"], a[href*="serial"]')].map(a => a.getAttribute('href')).slice(0, 5) }; });
console.log('   ficha: contratos', fic.contratos, 'seriales', fic.seriales, 'links a serial/almacén', fic.linksSerial);
const r4 = await paso(4, '/contratos/index.html?buscar=ALQ20260226-01', 'Archivo de contratos (buscar ALQ20260226-01)');
console.log('   enlaces del archivo (primeros 10):', r4.e.slice(0, 10).map(x => `${x.m}:"${x.t}"→${x.h}${x.blank ? ' [nueva pestaña]' : ''}`).join(' | ') || 'NINGUNO');
const r5 = await paso(5, '/almacen/index.html?tab=serial&q=23706A0608', 'Almacén · Serial 23706A0608', 1500);
const alm = await s.page.evaluate(() => ({ tab: document.querySelector('.is-active, [aria-selected=true]')?.innerText?.trim(), hay: document.body.innerText.includes('23706A0608'), input: document.querySelector('input[type=search], #q, #buscarSerial')?.value }));
console.log('   almacén:', JSON.stringify(alm), '| enlaces:', r5.e.slice(0, 8).map(x => `${x.m}:"${x.t}"`).join(' | '));
await s.captura('42-recepcion-escritorio-almacen-serial');
const tot = [r1, r2, r3, r4, r5].reduce((a, r) => a + r.real, 0);
console.log(`\nSUMA de tiempos hasta quieto (5 pantallas): ${tot} ms · promedio ${Math.round(tot / 5)} ms por pantalla (sesión caliente; el emulador es local, en producción súmale ~150-250 ms de red por viaje)`);
// Viaje repetido a la misma página (caché)
const rep = await s.ir('/ordenes/editar-orden.html?id=2026093002', { esperar: 1200 });
console.log('repetir detalle de orden:', rep.msTotal, 'ms total, última mutación a los', await s.page.evaluate(() => Math.round(window.__m.ultimaMut)), 'ms');
await s.cerrar();
