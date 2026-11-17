// Recepción verifica la cédula física de quien retira (Brenda, 2026-11-17),
// en el app real contra el emulador. Recorre:
//   1) Entrega completa con firma en la TABLET: la cédula que escribe el
//      cliente llega al modal; sin el gancho "verifiqué" no se confirma; si se
//      toca el nombre el gancho se desmarca; con el gancho queda id_verificada.
//   2) Entrega completa con "No presentó identificación": pasa sin gancho y
//      sin cédula; id_verificada queda null.
//   3) Entrega parcial: el mismo candado y la tanda guarda id_verificada.
//   4) "Ver entrega" muestra quién verificó.
// Uso: emulador con auth,firestore,hosting sembrado (emu-seed-todo.js).
import { createRequire } from 'node:module';
import { abrir, USUARIOS, FS_HOST } from './emu-lib.mjs';
import { stubStorage, firmarCanvas } from '../../docs/auditoria-modulos/scripts/ordenes/lib-ordenes.mjs';

const require = createRequire('C:/Projects/cecomunica-service-orders/functions/');
process.env.FIRESTORE_EMULATOR_HOST = FS_HOST;
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const OS = { tablet: '2026111791', sinId: '2026111792', parcial: '2026111793' };
const cli = (await db.collection('clientes').limit(20).get()).docs.find(d => d.data().nombre && !d.data().deleted);
for (const [k, id] of Object.entries(OS)) {
  const n = k === 'parcial' ? 3 : 1;
  await db.doc(`ordenes_de_servicio/${id}`).set({
    numero_orden: id, tipo_de_servicio: 'REPARACIÓN', estado_reparacion: 'COMPLETADO (EN OFICINA)',
    cliente_id: cli.id, cliente_nombre: cli.data().nombre, tecnico_asignado: 'Marcos Perez',
    fecha_creacion: admin.firestore.Timestamp.now(), fecha_completado: admin.firestore.Timestamp.now(),
    equipos: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, numero_de_serie: `TESTCED${id.slice(-2)}${i}`,
      modelo: 'HYTERA PNC360S', bateria: true, trabajo_tecnico: 'Revisado' })),
  });
}

const toastsDesde = async (s, n) => (await s.toasts()).slice(n).map(t => (t.msg || t.message || JSON.stringify(t)));
const abrirOrden = async (s, id, fn) => s.page.evaluate(async (id, fn) => {
  const fresca = await OrdenesService.getOrder(id);
  const i = APP.state.orders.findIndex(x => x.ordenId === id);
  if (i >= 0) APP.state.orders[i] = { ...APP.state.orders[i], ...fresca }; else APP.state.orders.push({ ordenId: id, ...fresca });
  window[fn](id);
}, id, fn);

// ── 1) Entrega completa, firma en la tablet ────────────────────────────────
const tab = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'cedula-verificada' });
await tab.ir('/firmar/tablet.html');
const rec = await abrir({ email: USUARIOS.recepcion, carpeta: 'cedula-verificada' });
await rec.ir(`/ordenes/index.html?ids=${OS.tablet}`, { esperar: 3000 });
await abrirOrden(rec, OS.tablet, 'abrirModalEntrega');
await espera(1000);
await rec.page.evaluate(() => window._entregaFirmarEnTablet());
await tab.quieto(1500, 15000);
await tab.page.click('#fNombre', { clickCount: 3 }); await tab.page.keyboard.type('Juan Pérez');
await tab.page.click('#fCedula', { clickCount: 3 }); await tab.page.keyboard.type('8-123-4567');
await firmarCanvas(tab, '#firmaCanvas');
await stubStorage(tab);
await tab.page.click('#fConfirmar');
await rec.quieto(1500, 10000);
const llego = await rec.page.evaluate(() => ({
  listo: !document.getElementById('entregaTabletListo').classList.contains('hidden'),
  nombre: document.getElementById('entregaReceptorNombre').value,
  cedula: document.getElementById('entregaReceptorCedula').value,
  gancho: document.getElementById('entregaIdVerificada').checked,
}));
ok(llego.listo && llego.nombre === 'Juan Pérez' && llego.cedula === '8-123-4567' && !llego.gancho,
  `la firma de la tablet trae nombre y cédula, gancho sin marcar: ${JSON.stringify(llego)}`);
await rec.captura('01-modal-con-cedula-de-tablet');

await stubStorage(rec);
let n0 = (await rec.toasts()).length;
await rec.page.click('#btnConfirmarEntrega'); await espera(800);
let t = await toastsDesde(rec, n0);
ok(t.some(x => /verificó la cédula física/.test(x)), `sin el gancho no se confirma: ${JSON.stringify(t)}`);
ok((await db.doc(`ordenes_de_servicio/${OS.tablet}`).get()).data().estado_reparacion === 'COMPLETADO (EN OFICINA)', 'la orden sigue sin entregar');

await rec.page.click('#entregaIdVerificada');
ok(await rec.page.$eval('#entregaIdVerificada', e => e.checked), 'el gancho se marca');
await rec.page.click('#entregaReceptorNombre'); await rec.page.keyboard.type(' A');
ok(!(await rec.page.$eval('#entregaIdVerificada', e => e.checked)), 'tocar el nombre desmarca el gancho');
await rec.page.keyboard.press('Backspace'); await rec.page.keyboard.press('Backspace');
await rec.page.click('#entregaIdVerificada');
await rec.captura('02-gancho-marcado');
n0 = (await rec.toasts()).length;
await rec.page.click('#btnConfirmarEntrega');
await rec.quieto(1500, 15000);
let o = (await db.doc(`ordenes_de_servicio/${OS.tablet}`).get()).data();
ok(o.estado_reparacion === 'ENTREGADO AL CLIENTE', `entregada (toasts: ${JSON.stringify(await toastsDesde(rec, n0))})`);
ok(o.receptor_cedula === '8-123-4567' && o.receptor_nombre === 'Juan Pérez', `cédula y nombre: ${o.receptor_cedula} · ${o.receptor_nombre}`);
ok(o.id_verificada?.por_email === USUARIOS.recepcion && o.id_verificada?.at?.toDate && !!o.id_verificada.por_uid,
  `id_verificada: ${JSON.stringify(o.id_verificada)}`);
ok(o.sin_id === false, 'sin_id false');

// ── 4) Ver entrega ──────────────────────────────────────────────────────────
await abrirOrden(rec, OS.tablet, 'mostrarEntregaRecepcion');
await espera(1000);
const fases = await rec.texto('body');
ok(/Cédula verificada por cecrecep@cecomunica\.com/.test(fases), 'el detalle muestra quién verificó la cédula');
ok(!fases.includes('8-123-4567'), 'el detalle no muestra el número de cédula');
await rec.captura('03-ver-entrega');

// ── 2) No presentó identificación ───────────────────────────────────────────
await rec.ir(`/ordenes/index.html?ids=${OS.sinId}`, { esperar: 3000 });
await abrirOrden(rec, OS.sinId, 'abrirModalEntrega');
await espera(1000);
const limpio = await rec.page.evaluate(() => ({
  cedula: document.getElementById('entregaReceptorCedula').value, gancho: document.getElementById('entregaIdVerificada').checked }));
ok(!limpio.cedula && !limpio.gancho, `el modal abre limpio: ${JSON.stringify(limpio)}`);
await rec.page.type('#entregaReceptorNombre', 'María Gómez');
await rec.page.$eval('#entregaFirmaCanvas', e => e.scrollIntoView({ block: 'center' }));
await firmarCanvas(rec, '#entregaFirmaCanvas');
n0 = (await rec.toasts()).length;
await rec.page.click('#btnConfirmarEntrega'); await espera(800);
t = await toastsDesde(rec, n0);
ok(t.some(x => /Escriba la cédula o pasaporte/.test(x)), `sin cédula ni "no presentó" no se confirma: ${JSON.stringify(t)}`);
await rec.page.click('#entregaSinId');
await rec.page.type('#entregaSinIdMotivo', 'La olvidó en la oficina; la empresa avisó por correo');
await stubStorage(rec);
await rec.page.click('#btnConfirmarEntrega');
await rec.quieto(1500, 15000);
o = (await db.doc(`ordenes_de_servicio/${OS.sinId}`).get()).data();
ok(o.estado_reparacion === 'ENTREGADO AL CLIENTE' && o.sin_id === true && o.id_verificada === null && o.receptor_cedula === null,
  `sin ID: ${JSON.stringify({ estado: o.estado_reparacion, sin_id: o.sin_id, id_verificada: o.id_verificada, ced: o.receptor_cedula })}`);

// ── 3) Entrega parcial ─────────────────────────────────────────────────────
await rec.ir(`/ordenes/index.html?ids=${OS.parcial}`, { esperar: 3000 });
await abrirOrden(rec, OS.parcial, 'entregarParcialOrden');
await rec.page.waitForSelector('#epLista', { timeout: 10000 });
await rec.page.click('.ep-check');
await rec.page.type('#epReceptor', 'Pedro Ruiz');
await rec.page.type('#epCedula', '4-555-1212');
await rec.page.$eval('#epFirma', e => e.scrollIntoView({ block: 'center' }));
await firmarCanvas(rec, '#epFirma');
await stubStorage(rec);
n0 = (await rec.toasts()).length;
await rec.page.click('#epEntregar'); await espera(800);
t = await toastsDesde(rec, n0);
ok(t.some(x => /verificó la cédula física/.test(x)), `parcial: sin el gancho no se registra: ${JSON.stringify(t)}`);
await rec.page.click('#epIdVerificada');
await rec.page.click('#epCedula'); await rec.page.keyboard.type('3');
ok(!(await rec.page.$eval('#epIdVerificada', e => e.checked)), 'parcial: tocar la cédula desmarca el gancho');
await rec.page.keyboard.press('Backspace');
await rec.page.click('#epIdVerificada');
await rec.captura('04-parcial-gancho');
await rec.page.click('#epEntregar');
await rec.page.waitForSelector('[data-action="confirm"]', { timeout: 10000 });
await rec.page.click('[data-action="confirm"]');
await rec.quieto(1500, 15000);
o = (await db.doc(`ordenes_de_servicio/${OS.parcial}`).get()).data();
const tanda = o.entrega?.tandas?.[0];
ok(tanda?.receptor_cedula === '4-555-1212' && tanda?.id_verificada?.por_email === USUARIOS.recepcion,
  `tanda: ${JSON.stringify({ ced: tanda?.receptor_cedula, idv: tanda?.id_verificada })}`);

const errores = [...rec.errores, ...tab.errores].filter(e => !/favicon|DevTools|stub\.emulador/.test(e));
ok(!errores.length, 'sin errores de consola: ' + errores.slice(0, 5).join(' | '));
await rec.cerrar(); await tab.cerrar();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
