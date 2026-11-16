// Venta pedida por los dos caminos (2026-11-16, SHIRLEY DE LA ROSA): si el
// cliente tiene un contrato vigente con radios propios SIN factura de venta,
// "Venta facturada: pedir seriales" avisa al elegirlo y pide confirmación al
// enviar. Contra el emulador con datos de producción.
//   node emu-test-venta-dos-caminos.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const FACT = `TEST-2C-${Date.now()}`;

const rec = await abrir({ email: USUARIOS.recepcion, carpeta: 'venta-dos-caminos' });
await rec.ir('/ordenes/index.html', { esperar: 2500 });

// Un cliente CON contrato propio sin factura y otro SIN ninguno.
const base = await rec.page.evaluate(async () => {
  const db = firebase.firestore();
  const VIG = ['pendiente', 'pendiente_aprobacion', 'pendiente_firma', 'aprobado', 'activo'];
  const s = await db.collection('contratos').where('estado', 'in', ['aprobado', 'activo']).limit(800).get();
  const cs = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.deleted);
  const propio = (c) => (c.codigo_tipo === 'PROP' || /^propio$/i.test(c.tipo_contrato || '')
    || (c.equipos || []).some(e => String(e.modalidad || '').toLowerCase() === 'propio'));
  const con = cs.find(c => propio(c) && !c.factura_venta?.numero && c.cliente_id && c.cliente_nombre);
  const tienen = new Set(cs.filter(c => propio(c) && !c.factura_venta?.numero).map(c => c.cliente_id));
  // El "sin" se verifica contra TODOS sus contratos, no solo los aprobados.
  let sin = null;
  for (const c of cs) {
    if (tienen.has(c.cliente_id) || !c.cliente_nombre) continue;
    const todos = await db.collection('contratos').where('cliente_id', '==', c.cliente_id).get();
    const alguno = todos.docs.map(d => d.data()).some(x => !x.deleted && VIG.includes(x.estado) && propio(x) && !x.factura_venta?.numero);
    if (!alguno) { sin = { id: c.cliente_id, nombre: c.cliente_nombre }; break; }
  }
  return { con: con && { id: con.cliente_id, nombre: con.cliente_nombre, contrato: con.contrato_id }, sin };
});
console.log('   ', JSON.stringify(base));
ok(base.con && base.sin, 'hay un cliente con contrato propio sin factura y otro sin');

async function abrirForm() {
  await rec.page.evaluate(() => document.getElementById('topbarBtnVentaFacturada').click());
  await rec.page.waitForSelector('#vfCliente', { timeout: 15000 });
  await espera(1500);
}
async function elegir(cli) {
  await rec.page.type('#vfCliente', cli.nombre.slice(0, 14));
  await rec.page.waitForSelector(`.combo-item[data-id="${cli.id}"]`, { timeout: 10000 });
  await rec.page.evaluate((id) => {
    const it = document.querySelector(`.combo-item[data-id="${id}"]`);
    it?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); it?.click();
  }, cli.id);
  await espera(1500);
}
async function llenar() {
  await rec.page.type('#vfFactura', FACT);
  await rec.page.evaluate(() => {
    const s = document.querySelector('.vf-linea select[data-f="modelo"]');
    s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const aviso = () => rec.page.evaluate(() => document.getElementById('vfAvisoContrato')?.innerText || '');
const confirmVisible = () => rec.page.evaluate(() =>
  [...document.querySelectorAll('.overlay .sheet-title')].map(t => t.textContent).find(t => /contrato\?/.test(t)) || '');
const pedidos = () => rec.page.evaluate(async (F) =>
  (await firebase.firestore().collection('pedidos_venta').where('factura', '==', F).get()).size, FACT);

// 1) Cliente CON contrato propio sin factura → aviso + confirmación; "No enviar" no crea nada.
await abrirForm();
await elegir(base.con);
const a1 = await aviso();
ok(a1.includes(base.con.contrato), `al elegirlo, el aviso nombra ${base.con.contrato}`);
await llenar();
await rec.captura('01-aviso-en-formulario');
await rec.page.click('#vfBtnGuardar');
await espera(1500);
ok(!!(await confirmVisible()), 'al enviar, pide confirmación');
await rec.captura('02-confirmacion');
await rec.page.evaluate(() => document.querySelector('.overlay [data-action="cancel"]')?.click());
await espera(1500);
ok((await pedidos()) === 0, '"No enviar" no crea el pedido');
ok(await rec.page.evaluate(() => !!document.getElementById('vfCliente')), 'el formulario sigue abierto');

// 2) "Es otra venta: enviar" sí lo crea.
await rec.page.click('#vfBtnGuardar');
await espera(1500);
await rec.page.evaluate(() => document.querySelector('.overlay [data-action="confirm"]')?.click());
await espera(2500);
ok((await pedidos()) === 1, '"Es otra venta: enviar" crea el pedido');

// 3) Cliente SIN contrato propio → sin aviso ni confirmación.
await abrirForm();
await elegir(base.sin);
ok((await aviso()) === '', 'cliente sin contrato propio: no hay aviso');
await rec.page.evaluate(() => { document.getElementById('vfFactura').value = ''; });
await llenar();
await rec.page.evaluate(() => { document.getElementById('vfFactura').value += '-B'; });
await rec.page.click('#vfBtnGuardar');
await espera(2500);
ok(!(await confirmVisible()), 'no pide confirmación');
const nB = await rec.page.evaluate(async (F) =>
  (await firebase.firestore().collection('pedidos_venta').where('factura', '==', F + '-B').get()).size, FACT);
ok(nB === 1, 'el pedido se crea directo');

const errs = (rec.errores || []).filter(e => /PRODUCCIÓN|pageerror|venta|contratos/i.test(e));
ok(!errs.length, `sin errores de consola${errs.length ? ': ' + JSON.stringify(errs).slice(0, 300) : ''}`);
await rec.cerrar();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
