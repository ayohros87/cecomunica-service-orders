// R2 (ejecución 2026-10-01) · Contrato `?ids=` para el home y Ctrl+K: carga esas órdenes aunque
// no estén entre las 40 recientes; `?orden=` es alias. Al tocar un chip se suelta el recorte.
// Solo lectura. Jefa de taller, escritorio.
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
await s.ir('/ordenes/index.html');
// Tres órdenes viejas (julio) que seguro no están en la primera página.
const viejas = await s.page.evaluate(async () => {
  const snap = await firebase.firestore().collection('ordenes_de_servicio')
    .where('fecha_creacion', '<', new Date('2026-08-01')).orderBy('fecha_creacion', 'desc').limit(3).get();
  return snap.docs.map(d => d.id);
});
log('órdenes viejas:', viejas.join(','));
const leer = () => s.page.evaluate(() => ({
  filas: [...document.querySelectorAll('tr[data-orden-row]')].map(tr => tr.dataset.ordenId),
  total: document.getElementById('resumenOrdenes')?.innerText,
  aviso: document.getElementById('avisoDeepLinkCorreo')?.innerText.replace(/\s+/g, ' ').trim() || null,
  url: location.search,
}));
let t0 = Date.now();
await s.ir(`/ordenes/index.html?ids=${viejas.join(',')}`);
await s.quieto(1200, 10000);
log(`?ids= (3 viejas) en ${Date.now() - t0} ms →`, JSON.stringify(await leer()));
await s.captura('15-r2-ids-tres-viejas');
t0 = Date.now();
await s.ir(`/ordenes/index.html?orden=${viejas[0]}`);
await s.quieto(1200, 10000);
log(`?orden= (alias, 1 vieja) en ${Date.now() - t0} ms →`, JSON.stringify(await leer()));
// Tocar el chip suelta el recorte y consulta al servidor
await s.page.evaluate(() => document.querySelector('.estado-chips-bar [data-estado="por_asignar"]').click());
await s.quieto(1200, 10000);
const r = await leer();
log('chip tras ?orden= →', JSON.stringify({ filas: r.filas.length, total: r.total, aviso: r.aviso, url: r.url }));
// Refrescar con ?ids= en la URL conserva el recorte
await s.ir(`/ordenes/index.html?ids=${viejas[1]}`);
await s.quieto(1200, 10000);
log('refresco con ?ids= →', JSON.stringify(await leer()));
log('errores:', s.errores.slice(0, 5));
await s.cerrar();
