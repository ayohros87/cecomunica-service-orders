// Recorrido 06b · Técnico (Marcos) en teléfono: registrar la intervención de los 2 equipos
// de A (texto + 1 pieza por búsqueda) y del equipo de B. La orden ya está COMPLETADA
// (el 06 la completó con 0/2 por un tropiezo del harness): prueba de paso si la
// intervención sigue editable después de completar. Escribe SOLO en el emulador.
import { abrir, USUARIOS, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));

const s = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ordenes' });
const info = await s.ir('/ordenes/index.html');
log('carga:', JSON.stringify(info));
const cardA = await s.page.$eval(`#ordersCards .card-contrato[data-orden-id="${ids.A}"]`, c => c.innerText.replace(/\s+/g, ' ').slice(0, 160)).catch(() => 'A no está en "mis órdenes"');
log('tarjeta A (COMPLETADA):', cardA);

async function intervenir(id, textos, conPieza) {
  let pasos = 0;
  await medir(s, 'abrir Equipos', async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="abrir-equipos-mobile"][data-orden-id="${id}"]`).click(), id); pasos++; });
  const btnInt = await s.page.$$eval('#equiposMobileList [data-action="abrir-trabajo-equipo"]', b => b.length);
  log('  botones "Intervención" editables:', btnInt);
  if (!btnInt) { log('  → intervención NO editable en este estado'); await s.page.evaluate(() => document.querySelector('#modalEquiposMobile [data-action="cerrar-equipos-mobile"]')?.click()); return; }
  await medir(s, 'abrir intervención eq 1', async () => { await s.page.evaluate(() => document.querySelectorAll('#equiposMobileList [data-action="abrir-trabajo-equipo"]')[0].click()); pasos++; });
  for (let i = 0; i < textos.length; i++) {
    await s.page.click('#trabajoEquipoText'); await s.page.keyboard.type(textos[i]); pasos++;
    if (i === 0 && conPieza) {
      await medir(s, 'abrir materiales', async () => { await s.page.evaluate(() => document.querySelector('[data-action="abrir-material-equipo"]').click()); pasos++; });
      log('  sugerencias al abrir:', (await s.texto('#materialSugerencias')).replace(/\s+/g, ' ').slice(0, 160));
      await s.page.click('#materialBuscar'); await s.page.keyboard.type('cubre'); pasos++;
      await s.quieto(900, 5000);
      const sug = await s.page.$$eval('#materialSugerencias [data-action="pick-material-equipo"]', xs => xs.slice(0, 3).map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 60)));
      log('  sugerencias "cubre":', JSON.stringify(sug));
      await s.captura('06b-tecnico-telefono-materiales-busqueda');
      await s.page.evaluate(() => document.querySelector('#materialSugerencias [data-action="pick-material-equipo"]').click()); pasos++;
      await s.quieto(500, 3000);
      log('  selección:', (await s.texto('#materialSeleccion')).replace(/\s+/g, ' ').slice(0, 160), '| aplicar a otros:', (await s.texto('#materialAplicarOtros')).replace(/\s+/g, ' ').slice(0, 100));
      await medir(s, 'agregar material', async () => { await s.page.click('#btnAgregarMaterial'); pasos++; });
      log('  toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| materiales count:', await s.texto('#equipoMaterialesCount'), '| modales:', JSON.stringify(await modalAbierto(s)).slice(0, 120));
      await s.captura('06b-tecnico-telefono-intervencion-con-pieza');
    }
    const ultimo = i === textos.length - 1;
    await medir(s, ultimo ? 'Guardar' : 'Guardar y siguiente', async () => { await s.page.click(ultimo ? '#btnGuardarTrabajoEquipo' : '#btnGuardarTrabajoSiguiente'); pasos++; });
    log('  toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| pos:', await s.texto('#trabajoNavPos').catch(() => '-'), '| texto ahora:', await s.page.$eval('#trabajoEquipoText', t => t.value.slice(0, 40)).catch(() => '-'));
  }
  await s.quieto(800, 5000);
  log('  lista tras guardar:', (await s.texto('#equiposMobileList')).replace(/\s+/g, ' ').slice(0, 300));
  await s.captura('06b-tecnico-telefono-equipos-tras-guardar');
  await s.page.evaluate(() => document.querySelector('#modalEquiposMobile [data-action="cerrar-equipos-mobile"]')?.click()); pasos++;
  await s.quieto(500, 3000);
  const card = await s.page.$eval(`#ordersCards .card-contrato[data-orden-id="${id}"]`, c => c.innerText.replace(/\s+/g, ' ').slice(0, 160)).catch(() => 'sin tarjeta');
  log(`  tarjeta: ${card} | ${pasos} interacciones`);
}
await intervenir(ids.A, ['Se cambió la batería y se reprogramó (prueba).', 'Limpieza de contactos, funciona (prueba).'], true);
await intervenir(ids.B, ['Se reemplazó el parlante (prueba).'], false);
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
