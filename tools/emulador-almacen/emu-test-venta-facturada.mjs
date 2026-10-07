// Venta facturada (2026-10-07): recepción pide en Órdenes → Más, bodega asigna
// desde Almacén · Hoy. Contra el emulador con datos de producción.
//   node emu-test-venta-facturada.mjs
// El trigger (OS + correos) no corre aquí — lo cubre la prueba del servidor.
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// 0) Dos radios en bodega del mismo modelo, y un cliente con ficha.
const bod = await abrir({ email: USUARIOS.inventario, carpeta: 'venta-facturada' });
await bod.ir('/almacen/index.html', { esperar: 2500 });
const base = await bod.page.evaluate(async () => {
  const db = firebase.firestore();
  const s = await db.collection('equipos_pool').where('estado', '==', 'en_bodega').limit(400).get();
  const por = {};
  s.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => u.modelo_id && !u.propietario?.cliente_id && !/__/.test(u.id))
    .forEach(u => (por[u.modelo_id] = por[u.modelo_id] || []).push(u));
  const [modeloId, us] = Object.entries(por).find(([, l]) => l.length >= 2);
  const c = await db.collection('clientes').limit(5).get();
  const cli = c.docs.map(d => ({ id: d.id, nombre: d.data().nombre })).find(x => x.nombre && !x.deleted);
  return { modeloId, seriales: us.slice(0, 2).map(u => u.serial), cli };
});
console.log('   ', JSON.stringify(base));

// 1) Recepción registra la venta facturada.
const rec = await abrir({ email: USUARIOS.recepcion, carpeta: 'venta-facturada' });
await rec.ir('/ordenes/index.html', { esperar: 2500 });
const visible = await rec.page.evaluate(() => getComputedStyle(document.getElementById('topbarBtnVentaFacturada')).display !== 'none');
ok(visible, 'recepción ve "Venta facturada: pedir seriales" en Más');
await rec.page.evaluate(() => document.getElementById('topbarBtnVentaFacturada').click());
await rec.page.waitForSelector('#vfCliente', { timeout: 15000 });
await espera(1500);
await rec.page.type('#vfCliente', base.cli.nombre.slice(0, 12));
await rec.page.waitForSelector('.combo-item', { timeout: 10000 });
await rec.page.evaluate((id) => document.querySelector(`.combo-item[data-id="${id}"]`)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), base.cli.id);
await espera(300);
await rec.page.evaluate((id) => { const it = document.querySelector(`.combo-item[data-id="${id}"]`); if (it) it.click(); }, base.cli.id);
await rec.page.type('#vfFactura', 'TEST-99001');
await rec.page.select('.vf-linea select[data-f="modelo"]', base.modeloId);
await rec.page.evaluate(() => { const q = document.querySelector('.vf-linea [data-f="cantidad"]'); q.value = '2'; });
await rec.captura('01-recepcion-formulario');
await rec.page.click('#vfBtnGuardar');
await espera(2500);
const toastsRec = await rec.toasts();
console.log('    toasts:', JSON.stringify(toastsRec).slice(0, 300));
const ped = await rec.page.evaluate(async () => {
  const s = await firebase.firestore().collection('pedidos_venta').where('factura', '==', 'TEST-99001').get();
  return s.docs.map(d => ({ id: d.id, ...d.data(), creado_at: null }));
});
ok(ped.length === 1 && ped[0].estado === 'pendiente_bodega' && ped[0].lineas[0].cantidad === 2,
  `pedido creado en pendiente_bodega: ${JSON.stringify(ped.map(p => [p.cliente_nombre, p.lineas]))}`);
ok(!rec.errores.length, 'recepción sin errores de página: ' + rec.errores.join(' | '));

// 2) Bodega lo ve en Hoy y asigna con el asistente de venta.
await bod.ir('/almacen/index.html', { esperar: 3000 });
const enHoy = await bod.page.evaluate((id) => !!document.querySelector(`[data-venta="${id}"]`), ped[0]?.id);
ok(enHoy, 'el pedido aparece en Almacén · Hoy con "Asignar seriales"');
await bod.captura('02-bodega-hoy', { full: true });
await bod.page.evaluate((id) => document.querySelector(`[data-venta="${id}"]`).click(), ped[0].id);
await bod.page.waitForSelector('#asvSeriales', { timeout: 15000 });
await espera(800);
const fijo = await bod.page.evaluate(() => ({ cli: document.querySelector('#asvCliente').readOnly, fac: document.querySelector('#asvFactura').value, aviso: document.querySelector('#asvPedido').innerText }));
ok(fijo.cli && fijo.fac === 'TEST-99001' && /2 ×/.test(fijo.aviso), `cliente y factura fijos, pedido a la vista: ${JSON.stringify(fijo)}`);
await bod.page.type('#asvSeriales', base.seriales.join('\n'));
await bod.captura('03-bodega-asistente');
await bod.page.click('#asvBtnGuardar');
await bod.page.waitForSelector('[data-action="confirm"]', { timeout: 20000 });
await bod.page.click('[data-action="confirm"]');
await espera(4000);
const fin = await bod.page.evaluate(async (id, seriales) => {
  const db = firebase.firestore();
  const p = (await db.collection('pedidos_venta').doc(id).get()).data();
  const us = [];
  for (const s of seriales) { const q = await db.collection('equipos_pool').where('serial', '==', s).get(); q.forEach(d => us.push({ estado: d.data().estado, pedido: d.data().venta?.pedido_id })); }
  return { estado: p.estado, seriales: (p.seriales || []).map(s => s.serial), us };
}, ped[0].id, base.seriales);
console.log('   ', JSON.stringify(fin));
ok(fin.estado === 'asignada' && fin.seriales.length === 2, 'pedido asignada con los 2 seriales');
ok(fin.us.every(u => u.estado === 'vendido' && u.pedido === ped[0].id), 'unidades vendidas con venta.pedido_id');
console.log('    toasts:', JSON.stringify(await bod.toasts()).slice(0, 300));
ok(!bod.errores.length, 'bodega sin errores de página: ' + bod.errores.join(' | '));

await rec.cerrar(); await bod.cerrar();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
