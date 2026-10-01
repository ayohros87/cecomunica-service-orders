// Recorrido 12: qué ve CONTABILIDAD (Cheila) y el home del ADMIN (Alberto). Solo lectura.
import { abrir, USUARIOS, j } from './_lib.mjs';
const log = (...a) => console.log(...a);

let s = await abrir({ email: USUARIOS.contabilidad, viewport: 'escritorio' });
let info = await s.ir('/index.html'); log('HOME CONTABILIDAD', j(info));
log('TARJETAS', j(await s.textos('.mod-card, [data-modulo], .home-card')));
log('SEÑALES', j(await s.textos('#signals, .signal, [data-signal], .senal')));
log('RAIL', j(await s.textos('#rail-mount a')));
await s.captura('90-contabilidad-escritorio-home');
for (const p of ['/facturacion/bandeja.html', '/facturacion/comisiones.html', '/facturacion/activacion.html', '/facturacion/clientes-qbo.html', '/inventario/modelos.html', '/inventario/cargos.html', '/admin/financiero.html?volver=finanzas', '/contratos/index.html', '/clientes/centro.html', '/almacen/index.html', '/inventario/cobros-equipos.html']) {
  info = await s.ir(p);
  const body = (await s.texto('body')).replace(/\n/g, ' ');
  log('CONTABILIDAD EN', p, '→', info.url, '|', body.slice(0, 90), '| errores', j(s.errores.slice(0, 2)));
}
info = await s.ir('/contratos/index.html');
log('CONTRATOS thead', j(await s.textos('table thead th')).slice(0, 300));
await s.captura('91-contabilidad-escritorio-contratos');
info = await s.ir('/facturacion/bandeja.html');
log('TABS', j(await s.textos('#wsTabs-mount a, #wsTabs-mount button')));
await s.captura('92-contabilidad-escritorio-bandeja');
await s.cerrar();

s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio' });
info = await s.ir('/index.html'); log('HOME ADMIN', j(info));
log('TARJETAS', j(await s.textos('.mod-card, [data-modulo], .home-card')));
await s.captura('95-admin-escritorio-home');
info = await s.ir('/index.html?as=contabilidad'); log('VER COMO contabilidad', j(info));
log('TARJETAS as=contabilidad', j(await s.textos('.mod-card, [data-modulo], .home-card')));
log('BANNER', (await s.texto('body')).slice(0, 200).replace(/\n/g, ' '));
await s.captura('96-admin-escritorio-ver-como-contabilidad');
await s.cerrar();
