// Recorrido 13 · ¿El conteo del chip y el "Total" cuadran al entrar por URL (?estado=por_asignar)
// y al tocar el chip? (captura 05: chip 44 vs "Total: 9"). Solo lectura, jefa de taller.
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
const leer = () => s.page.evaluate(() => ({ chip: document.querySelector('.estado-chips-bar [data-estado="por_asignar"]')?.innerText.replace(/\s+/g, ' ').trim(), total: document.getElementById('resumenOrdenes')?.innerText, filas: document.querySelectorAll('tr[data-orden-row]').length, cargarMas: !!document.getElementById('btnCargarMas')?.offsetParent, url: location.search }));
await s.ir('/ordenes/index.html?estado=por_asignar');
log('por URL:', JSON.stringify(await leer()));
await s.captura('13-jefe-escritorio-por-asignar-por-url');
await s.page.evaluate(() => document.querySelector('.estado-chips-bar [data-estado="por_asignar"]').click()); await s.quieto(1000, 10000);
log('tocando el chip:', JSON.stringify(await leer()));
await s.ir('/ordenes/index.html');
await s.page.evaluate(() => document.querySelector('.estado-chips-bar [data-estado="por_asignar"]').click()); await s.quieto(1000, 10000);
log('desde Todas → chip:', JSON.stringify(await leer()));
log('consultas:', (await s.consultas()).filter(c => /filterBy|count/.test(c)).slice(-6).join(' ; '));
await s.cerrar();
