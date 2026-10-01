// Recorrido 13b · Los enlaces de las señales del home (home-signals.js:91,97,166,172) entran con
// ?estado=ASIGNADO / ?estado=COMPLETADO (EN OFICINA) / ?mias=1&estado=ASIGNADO. ¿Cuántas filas
// muestran frente al conteo del chip? Solo lectura. Jefa (escritorio) y Marcos (teléfono).
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
const leer = (s) => s.page.evaluate(() => ({ chips: [...document.querySelectorAll('.estado-chips-bar [data-estado]')].filter(b => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true').map(b => b.innerText.replace(/\s+/g, ' ').trim()), total: document.getElementById('resumenOrdenes')?.innerText || document.getElementById('mobileResumen')?.innerText, filas: document.querySelectorAll('tr[data-orden-row], #ordersCards .card-contrato').length, cargarMas: !!document.getElementById('btnCargarMas')?.offsetParent, url: location.search }));
const j = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
for (const u of ['/ordenes/index.html?estado=ASIGNADO', '/ordenes/index.html?estado=COMPLETADO%20(EN%20OFICINA)', '/ordenes/index.html?qc=1']) {
  await j.ir(u); log('jefa', u, '→', JSON.stringify(await leer(j)));
}
await j.captura('13b-jefe-escritorio-asignado-por-url');
await j.cerrar();
const t = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ordenes' });
for (const u of ['/ordenes/index.html?mias=1&estado=ASIGNADO', '/ordenes/index.html?mias=1&estado=COMPLETADO%20(EN%20OFICINA)']) {
  await t.ir(u); log('técnico', u, '→', JSON.stringify(await leer(t)));
}
await t.cerrar();
