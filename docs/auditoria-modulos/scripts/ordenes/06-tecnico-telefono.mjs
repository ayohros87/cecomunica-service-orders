// Recorrido 06 · Técnico (Marcos) en teléfono: encontrar su orden, registrar la intervención
// de 2 equipos (texto + 1 pieza), y completar. Luego B (1 equipo). Escribe SOLO en el emulador.
import { abrir, USUARIOS, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));

const s = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ordenes' });
const info = await s.ir('/ordenes/index.html');
log('carga:', JSON.stringify(info), '| resumen:', await s.texto('#mobileResumen').catch(() => ''));
await s.captura('06-tecnico-telefono-bandeja');
const pos = await s.page.evaluate((A) => { const cs = [...document.querySelectorAll('#ordersCards .card-contrato')]; const i = cs.findIndex(c => c.dataset.ordenId === A); return { i: i + 1, n: cs.length, top: i >= 0 ? Math.round(cs[i].getBoundingClientRect().top) : null }; }, ids.A);
log('  tarjeta A:', JSON.stringify(pos));
const geo = await s.geometria(); log('  GEO:', JSON.stringify(geo));

async function intervenir(id, textos, conPieza) {
  let pasos = 0;
  await medir(s, 'abrir Equipos', async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="abrir-equipos-mobile"][data-orden-id="${id}"]`).click(), id); pasos++; });
  if (id === ids.A) await s.captura('06-tecnico-telefono-equipos');
  for (let i = 0; i < textos.length; i++) {
    if (i === 0) {
      await medir(s, `abrir intervención eq ${i + 1}`, async () => { await s.page.evaluate((i) => document.querySelectorAll('#equiposMobileList [data-action="abrir-trabajo-equipo"]')[i].click(), i); pasos++; });
    }
    await s.page.click('#trabajoEquipoText'); await s.page.keyboard.type(textos[i]); pasos++;
    if (i === 0 && conPieza) {
      await medir(s, 'abrir materiales', async () => { await s.page.evaluate(() => document.querySelector('[data-action="abrir-material-equipo"]').click()); pasos++; });
      if (id === ids.A) await s.captura('06-tecnico-telefono-materiales');
      const sug = await s.page.$$eval('#materialSugerencias [data-action="pick-material-equipo"]', xs => xs.slice(0, 3).map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 60)));
      log('  sugerencias:', JSON.stringify(sug));
      if (sug.length) { await s.page.evaluate(() => document.querySelector('#materialSugerencias [data-action="pick-material-equipo"]').click()); pasos++; }
      else { await s.page.click('#materialBuscar'); await s.page.keyboard.type('bater'); pasos++; await s.quieto(800, 5000); await s.page.evaluate(() => document.querySelector('#materialSugerencias [data-action="pick-material-equipo"]')?.click()); pasos++; }
      await s.quieto(500, 3000);
      log('  selección:', (await s.texto('#materialSeleccion')).replace(/\s+/g, ' ').slice(0, 120));
      await medir(s, 'agregar material', async () => { await s.page.click('#btnAgregarMaterial'); pasos++; });
      log('  toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| materiales count:', await s.texto('#equipoMaterialesCount'));
      if (id === ids.A) await s.captura('06-tecnico-telefono-intervencion-con-pieza', { el: '#modalTrabajoEquipo .modal' });
    }
    const ultimo = i === textos.length - 1;
    await medir(s, ultimo ? 'Guardar' : 'Guardar y siguiente', async () => { await s.page.click(ultimo ? '#btnGuardarTrabajoEquipo' : '#btnGuardarTrabajoSiguiente'); pasos++; });
    log('  toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| pos:', await s.texto('#trabajoNavPos').catch(() => '-'));
  }
  log('  modales:', JSON.stringify(await modalAbierto(s)).slice(0, 160));
  await s.page.evaluate(() => document.querySelector('#modalEquiposMobile [data-action="cerrar-equipos-mobile"]')?.click()); pasos++;
  await s.quieto(500, 3000);
  const card = await s.page.$eval(`#ordersCards .card-contrato[data-orden-id="${id}"]`, c => c.innerText.replace(/\s+/g, ' ').slice(0, 160)).catch(() => 'sin tarjeta');
  log('  tarjeta:', card);
  await medir(s, 'Completar', async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="completar-orden"][data-orden-id="${id}"]`).click(), id); pasos++; });
  log('  confirm:', JSON.stringify(await modalAbierto(s)).slice(0, 260));
  if (id === ids.A) await s.captura('06-tecnico-telefono-completar-confirm');
  await medir(s, 'confirmar', async () => { await s.page.evaluate(() => { const b = [...document.querySelectorAll('.overlay:not(.hidden) button, .modal-backdrop.open button')].find(x => /Confirmar|Aceptar|Sí/i.test(x.textContent)); b.click(); }); pasos++; });
  log('  toasts:', JSON.stringify((await s.toasts()).slice(-1)));
  const card2 = await s.page.$eval(`#ordersCards .card-contrato[data-orden-id="${id}"]`, c => c.innerText.replace(/\s+/g, ' ').slice(0, 160)).catch(() => 'sin tarjeta (ya no es "mía"?)');
  log(`  tarjeta tras completar: ${card2} | ${pasos} interacciones`);
}
await intervenir(ids.A, ['Se cambió la batería y se reprogramó (prueba).', 'Limpieza de contactos, funciona (prueba).'], true);
await s.captura('06-tecnico-telefono-tras-completar');
await intervenir(ids.B, ['Se reemplazó el parlante (prueba).'], false);
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
