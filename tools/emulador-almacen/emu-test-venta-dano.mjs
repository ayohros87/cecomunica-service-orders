// Venta facturada · reposición por DAÑO SIN REPARACIÓN (Brenda, 2026-11-23,
// R. SMITH, factura 11372). Contra el emulador con datos de producción.
//   node emu-test-venta-dano.mjs
// Qué protege: el formulario ofrece el tercer motivo, el pedido lo guarda como
// `dano`, y un radio dañado que está EN EL TALLER se avisa (sin trancar) porque
// su reemplazo sigue por el Centro. Lo que hace el servidor al asignar lo cubre
// functions/test-emulator/reposicion-alquiler.js.
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const FACT = `TEST-DANO-${Date.now()}`;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const rec = await abrir({ email: USUARIOS.recepcion, carpeta: 'venta-dano' });
await rec.ir('/ordenes/index.html', { esperar: 2500 });

// Un radio alquilado con el cliente y otro del mismo tipo que esté en el taller.
const base = await rec.page.evaluate(async () => {
  const db = firebase.firestore();
  const sirve = (u) => u.propiedad !== 'cliente' && u.modelo_id && u.asignacion?.cliente_id && u.asignacion?.contrato_doc_id && u.asignacion?.cliente_nombre && !/__/.test(u.id);
  const uno = async (estado) => {
    const s = await db.collection('equipos_pool').where('estado', '==', estado).limit(300).get();
    const u = s.docs.map(d => ({ id: d.id, ...d.data() })).find(sirve);
    return u ? { serial: u.serial || u.id, modelo: u.modelo_label, cliente_id: u.asignacion.cliente_id, cliente: u.asignacion.cliente_nombre, contrato: u.asignacion.contrato_id, orden: u.orden_actual_id || null } : null;
  };
  return { conCliente: await uno('en_cliente'), enTaller: await uno('en_taller') };
});
console.log('   ', JSON.stringify(base));
ok(!!base.conCliente, 'hay un radio alquilado con el cliente para probar');

async function abrirFormulario(cli) {
  await rec.ir('/ordenes/index.html', { esperar: 2500 });
  await rec.page.evaluate(() => document.getElementById('topbarBtnVentaFacturada').click());
  await rec.page.waitForSelector('#vfCliente', { timeout: 15000 });
  await espera(1500);
  await rec.page.type('#vfCliente', cli.cliente.slice(0, 14));
  await rec.page.waitForSelector(`.combo-item[data-id="${cli.cliente_id}"]`, { timeout: 10000 });
  await rec.page.evaluate((id) => document.querySelector(`.combo-item[data-id="${id}"]`).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), cli.cliente_id);
  await espera(300);
  await rec.page.evaluate((id) => { const it = document.querySelector(`.combo-item[data-id="${id}"]`); if (it) it.click(); }, cli.cliente_id);
  await rec.page.click('#vfReposicion');
  await espera(300);
}
const escribirSerial = async (serial) => {
  await rec.page.evaluate((s) => { const i = document.querySelector('#vfPerdidos'); i.value = s; i.dispatchEvent(new Event('change', { bubbles: true })); }, serial);
  await espera(1500);
};
const resultado = () => rec.page.evaluate(() => document.querySelector('#vfPerdidosRes').innerText);

// 1) El formulario ofrece los tres motivos y ya no habla solo de robo o pérdida.
await abrirFormulario(base.conCliente);
const ui = await rec.page.evaluate(() => ({
  opciones: [...document.querySelectorAll('#vfMotivo option')].map(o => `${o.value}=${o.textContent}`),
  casilla: document.querySelector('#vfReposicion').closest('label').innerText,
  etiqueta: document.querySelector('label[for="vfPerdidos"]').innerText,
  bloque: getComputedStyle(document.querySelector('#vfBloqueRepo')).display,
}));
ok(JSON.stringify(ui.opciones) === JSON.stringify(['robo=Robo', 'perdida=Pérdida', 'dano=Daño sin reparación']), `motivos: ${ui.opciones.join(' · ')}`);
ok(/robado, perdido o dañado sin reparación/.test(ui.casilla) && /el anterior se da de baja/.test(ui.casilla), `casilla: ${ui.casilla.replace(/\s+/g, ' ')}`);
ok(ui.etiqueta === 'Serial del radio que se repone' && ui.bloque !== 'none', `etiqueta del serial: ${ui.etiqueta}`);

// 2) Daño de un radio que está con el cliente: pasa sin aviso y el pedido guarda `dano`.
await rec.page.select('#vfMotivo', 'dano');
await escribirSerial(base.conCliente.serial);
const r1 = await resultado();
ok(r1.includes('✓') && r1.includes(base.conCliente.serial) && !/taller/i.test(r1), `radio con el cliente, sin aviso: ${r1.replace(/\s+/g, ' ')}`);
await rec.page.type('#vfFactura', FACT);
await rec.captura('01-dano-con-cliente');
await rec.page.click('#vfBtnGuardar');
await espera(3000);
const toasts = await rec.toasts();
ok(toasts.some(t => /el anterior se da de baja/.test(JSON.stringify(t))), `toast: ${JSON.stringify(toasts).slice(0, 220)}`);
const ped = await rec.page.evaluate(async (FACT) => {
  const s = await firebase.firestore().collection('pedidos_venta').where('factura', '==', FACT).get();
  return s.docs.map(d => ({ estado: d.data().estado, reposicion: d.data().reposicion, lineas: d.data().lineas }));
}, FACT);
ok(ped.length === 1 && ped[0].estado === 'pendiente_bodega' && ped[0].reposicion?.motivo === 'dano'
  && ped[0].reposicion.items[0].serial_saliente === base.conCliente.serial && ped[0].lineas[0].cantidad === 1,
  `pedido guardado con motivo dano: ${JSON.stringify(ped)}`);

// 3) Daño de un radio que está en el taller: avisa que va por el Centro; con robo no avisa.
if (base.enTaller) {
  await abrirFormulario(base.enTaller);
  await rec.page.select('#vfMotivo', 'dano');
  await escribirSerial(base.enTaller.serial);
  const r2 = await resultado();
  ok(r2.includes('✓') && /está en el taller/.test(r2) && /Centro del cliente/.test(r2), `en taller + daño avisa: ${r2.replace(/\s+/g, ' ')}`);
  await rec.captura('02-dano-en-taller');
  await rec.page.select('#vfMotivo', 'robo');
  await espera(1500);
  const r3 = await resultado();
  ok(r3.includes('✓') && !/está en el taller/.test(r3), `en taller + robo no avisa: ${r3.replace(/\s+/g, ' ')}`);
} else {
  console.log('  --   sin radio alquilado en taller en los datos: no se probó el aviso');
}

ok(!rec.errores.length, 'sin errores de página: ' + rec.errores.join(' | '));
await rec.cerrar();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
