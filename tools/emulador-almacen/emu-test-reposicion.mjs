// Reposición de un radio alquilado robado/perdido por la puerta de "Venta
// facturada" (2026-10-08, caso Goly factura 11076). Contra el emulador con
// datos de producción:
//   node emu-test-reposicion.mjs
// Recepción marca la casilla y declara el serial perdido: el formulario lo
// valida (alquilado, de ese cliente, en contrato) y arma las líneas. Bodega ve
// "Reposición" en Hoy y asigna. El efecto del trigger (pool, GR, OS) lo cubre
// functions/test-emulator/reposicion-alquiler.js.
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const FACT = `TEST-REPO-${Date.now()}`;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// 0) Un radio alquilado con un cliente (en contrato) y uno en bodega de su modelo.
const bod = await abrir({ email: USUARIOS.inventario, carpeta: 'reposicion' });
await bod.ir('/almacen/index.html', { esperar: 2500 });
const base = await bod.page.evaluate(async () => {
  const db = firebase.firestore();
  const bodega = (await db.collection('equipos_pool').where('estado', '==', 'en_bodega').limit(500).get()).docs.map(d => d.data())
    .filter(u => u.modelo_id && !/__/.test(u.serial || ''));
  const porModelo = new Set(bodega.map(u => u.modelo_id));
  const calle = (await db.collection('equipos_pool').where('estado', '==', 'en_cliente').limit(800).get()).docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => u.propiedad === 'cecomunica' && u.asignacion?.cliente_id && u.asignacion?.contrato_doc_id && porModelo.has(u.modelo_id) && u.id === u.serial_norm);
  const perdido = calle[0];
  const propio = (await db.collection('equipos_pool').where('propiedad', '==', 'cliente').limit(20).get()).docs.map(d => d.id)[0];
  const cli = (await db.collection('clientes').doc(perdido.asignacion.cliente_id).get()).data();
  return {
    perdido: perdido.serial, modeloId: perdido.modelo_id, contrato: perdido.asignacion.contrato_id,
    cli: { id: perdido.asignacion.cliente_id, nombre: cli.nombre }, propio,
    entrante: bodega.find(u => u.modelo_id === perdido.modelo_id).serial,
  };
});
console.log('   ', JSON.stringify(base));

// 1) Recepción: casilla de reposición + serial perdido.
const rec = await abrir({ email: USUARIOS.recepcion, carpeta: 'reposicion' });
await rec.ir('/ordenes/index.html', { esperar: 2500 });
await rec.page.evaluate(() => document.getElementById('topbarBtnVentaFacturada').click());
await rec.page.waitForSelector('#vfCliente', { timeout: 15000 });
await espera(1500);
await rec.page.type('#vfCliente', base.cli.nombre.slice(0, 12));
await rec.page.waitForSelector('.combo-item', { timeout: 10000 });
await rec.page.evaluate((id) => document.querySelector(`.combo-item[data-id="${id}"]`)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), base.cli.id);
await espera(300);
await rec.page.evaluate((id) => { const it = document.querySelector(`.combo-item[data-id="${id}"]`); if (it) it.click(); }, base.cli.id);
await rec.page.type('#vfFactura', FACT);
await rec.page.click('#vfReposicion');
const vis = await rec.page.evaluate(() => ({ repo: getComputedStyle(document.querySelector('#vfBloqueRepo')).display !== 'none', lineas: getComputedStyle(document.querySelector('#vfBloqueLineas')).display !== 'none' }));
ok(vis.repo && !vis.lineas, 'la casilla muestra el serial perdido y esconde las líneas de venta');

// Un radio propio se rechaza con el motivo.
await rec.page.type('#vfPerdidos', base.propio);
await rec.page.evaluate(() => document.querySelector('#vfPerdidos').dispatchEvent(new Event('change')));
await espera(1500);
const rech = await rec.page.evaluate(() => document.querySelector('#vfPerdidosRes').innerText);
ok(/✕/.test(rech), `un radio que no es alquiler de este cliente se marca: ${rech.trim()}`);

// El alquilado del cliente se acepta y dice su contrato.
await rec.page.evaluate(() => { document.querySelector('#vfPerdidos').value = ''; });
await rec.page.type('#vfPerdidos', base.perdido.toLowerCase());
await rec.page.evaluate(() => document.querySelector('#vfPerdidos').dispatchEvent(new Event('change')));
await espera(1500);
const acep = await rec.page.evaluate(() => document.querySelector('#vfPerdidosRes').innerText);
ok(/✓/.test(acep) && acep.includes(base.contrato), `el alquilado se acepta con su contrato: ${acep.trim()}`);
await rec.captura('01-recepcion-reposicion');
await rec.page.click('#vfBtnGuardar');
await espera(2500);
console.log('    toasts:', JSON.stringify(await rec.toasts()).slice(0, 300));
const ped = await rec.page.evaluate(async (FACT) => {
  const s = await firebase.firestore().collection('pedidos_venta').where('factura', '==', FACT).get();
  return s.docs.map(d => ({ id: d.id, ...d.data(), creado_at: null }));
}, FACT);
ok(ped.length === 1 && ped[0].reposicion?.items?.[0]?.serial_saliente === base.perdido && ped[0].reposicion.motivo === 'robo',
  `pedido con la reposición: ${JSON.stringify(ped.map(p => p.reposicion))}`);
ok(ped[0]?.lineas?.length === 1 && ped[0].lineas[0].modelo_id === base.modeloId && ped[0].lineas[0].cantidad === 1,
  'la línea sale del modelo del perdido (1 radio)');
ok(!rec.errores.length, 'recepción sin errores de página: ' + rec.errores.join(' | '));

// 2) Bodega: "Reposición" en Hoy y el asistente lo explica.
await bod.ir('/almacen/index.html', { esperar: 3000 });
const fila = await bod.page.evaluate((id) => document.querySelector(`[data-venta="${id}"]`)?.closest('.bj-fila, li, div')?.innerText || '', ped[0]?.id);
ok(/Reposici/.test(fila) && fila.includes(base.perdido), `Hoy lo marca como reposición: ${fila.replace(/\s+/g, ' ').slice(0, 160)}`);
await bod.page.evaluate((id) => document.querySelector(`[data-venta="${id}"]`).click(), ped[0].id);
await bod.page.waitForSelector('#asvSeriales', { timeout: 15000 });
await espera(800);
const aviso = await bod.page.evaluate(() => document.querySelector('#asvPedido').innerText);
ok(/Reposición de un radio alquilado/.test(aviso), 'el asistente avisa que no es venta');
await bod.page.type('#asvSeriales', base.entrante);
await bod.captura('02-bodega-asistente-reposicion');
await bod.page.click('#asvBtnGuardar');
await bod.page.waitForSelector('[data-action="confirm"]', { timeout: 20000 });
await bod.page.click('[data-action="confirm"]');
await espera(4000);
const fin = await bod.page.evaluate(async (id) => (await firebase.firestore().collection('pedidos_venta').doc(id).get()).data().estado, ped[0].id);
ok(fin === 'asignada', `pedido asignada (el trigger hace el resto): ${fin}`);
ok(!bod.errores.length, 'bodega sin errores de página: ' + bod.errores.join(' | '));

await rec.cerrar(); await bod.cerrar();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
