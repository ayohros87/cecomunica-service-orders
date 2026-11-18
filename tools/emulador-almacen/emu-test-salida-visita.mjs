// Salida de radios a la visita (2026-11-18): bloque "Radios con técnicos" en
// Almacén · Hoy, hoja de salida (visitas abiertas + preview) y hoja de
// regreso, la pista en "Registrar cambio de radio en sitio", el aviso al
// cerrar la visita y el candado del cliente sobre un radio con_tecnico.
//
// Los callables NO se llaman (irían a producción): su lógica se prueba en
// functions/test-emulator/p4-modelo-reemplazo.js. Aquí se SIEMBRA con el
// Admin SDK contra el emulador (visitas y radios propios, prefijo ZZSV) y se
// abren las pantallas.
//   node tools/emulador-almacen/emu-test-salida-visita.mjs
import { createRequire } from 'node:module';
import { abrir, USUARIOS } from './emu-lib.mjs';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const require = createRequire('file:///C:/Projects/cecomunica-service-orders/functions/');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK     ' : 'FALLA  ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// ── Siembra ───────────────────────────────────────────────────────────────
const V_ABIERTA = '2099010101';   // ASIGNADO, con técnico, 2 radios afuera
const V_CERRADA = '2099010102';   // CERRADA (VISITA) con 1 radio sin devolver
const V_SINTEC  = '2099010103';   // POR ASIGNAR, sin técnico
const V_VIEJA   = '2099010104';   // visita vieja: ENTREGADO AL CLIENTE
const visita = (id, extra) => db.collection('ordenes_de_servicio').doc(id).set({
  ordenId: id, tipo_de_servicio: 'VISITA TECNICA', cliente_id: 'zzsv-cli', cliente_nombre: 'ZZSV CLIENTE DE PRUEBA',
  eliminado: false, equipos: [{ id: 'e1', numero_de_serie: 'ZZSV9A0001', modelo: 'PNC360S' }],
  fecha_creacion: TS.now(), informe_visita: { trabajo_realizado: 'Revisión general', motivo: 'preventivo' }, ...extra });
const radio = (serial, orden, tecnico) => db.collection('equipos_pool').doc(serial).set({
  serial, serial_norm: serial, modelo_label: 'HYTERA PNC360S', estado: 'con_tecnico', propiedad: 'cecomunica',
  salida_visita: { orden_id: orden, cliente_id: 'zzsv-cli', cliente_nombre: 'ZZSV CLIENTE DE PRUEBA', tecnico, at: TS.now(), por_email: USUARIOS.inventario } });
const linea = (s) => ({ serial: s, modelo: 'HYTERA PNC360S', estado: 'llevado', at: TS.now(), por_email: USUARIOS.inventario });
await visita(V_ABIERTA, { estado_reparacion: 'ASIGNADO', tecnico_asignado: 'Marcos Perez',
  radios_salida: { ZZSV1A0001: linea('ZZSV1A0001'), ZZSV1A0002: linea('ZZSV1A0002') } });
await visita(V_CERRADA, { estado_reparacion: 'CERRADA (VISITA)', tecnico_asignado: 'Ovidio Adames', radios_salida: { ZZSV1A0003: linea('ZZSV1A0003') } });
await visita(V_SINTEC, { estado_reparacion: 'POR ASIGNAR', tecnico_asignado: '' });
await visita(V_VIEJA, { estado_reparacion: 'ENTREGADO AL CLIENTE', tecnico_asignado: 'Marcos Perez' });
await radio('ZZSV1A0001', V_ABIERTA, 'Marcos Perez');
await radio('ZZSV1A0002', V_ABIERTA, 'Marcos Perez');
await radio('ZZSV1A0003', V_CERRADA, 'Ovidio Adames');

// ── Bodega: Almacén · Hoy ─────────────────────────────────────────────────
const bo = await abrir({ email: USUARIOS.inventario, carpeta: 'salida-visita' });
const p = bo.page;
const malas = [];
p.on('response', r => { if (r.status() === 400) malas.push(r.url().slice(0, 200)); });
await bo.ir('/almacen/index.html', { esperar: 4000 });
await p.waitForSelector('[data-salida-cerrada]', { timeout: 30000 }).catch(() => {});
const filas = await p.evaluate(() => [...document.querySelectorAll('#hoySalidas .bj-row')].map(r => ({
  txt: r.innerText.replace(/\s+/g, ' ').trim(), cerrada: r.hasAttribute('data-salida-cerrada'),
  alerta: !!r.querySelector('.bj-chip--alerta') })));
const fAb = filas.find(f => f.txt.includes(V_ABIERTA)); const fCe = filas.find(f => f.txt.includes(V_CERRADA));
ok(!!fAb && !fAb.cerrada && /2 radios/.test(fAb.txt) && /Marcos Perez/.test(fAb.txt), 'visita abierta: fila normal con 2 radios y su técnico');
ok(!!fCe && fCe.cerrada && fCe.alerta && /Visita cerrada: falta 1/.test(fCe.txt) && /Pídeselos al técnico/.test(fCe.txt), 'visita cerrada con radio afuera: fila en alerta — ' + (fCe?.txt || '').slice(0, 120));
await bo.captura('01-hoy');

// Hoja de salida: visitas abiertas con técnico, y candados de la visita.
await p.click('[data-salida-nueva]');
await p.waitForSelector('#svVisita');
await p.waitForSelector('#svAbiertas [data-sv-visita]', { timeout: 15000 }).catch(() => {});
const abiertas = await p.evaluate(() => [...document.querySelectorAll('#svAbiertas [data-sv-visita]')].map(b => b.dataset.svVisita));
ok(abiertas.includes(V_ABIERTA) && !abiertas.includes(V_SINTEC) && !abiertas.includes(V_CERRADA) && !abiertas.includes(V_VIEJA),
  'la hoja ofrece solo visitas abiertas con técnico: ' + JSON.stringify(abiertas.slice(0, 6)));
await p.click(`#svAbiertas [data-sv-visita="${V_ABIERTA}"]`);
await espera(1500);
let info = await p.evaluate(() => document.getElementById('svInfo').innerText);
ok(/ZZSV CLIENTE DE PRUEBA/.test(info) && /Marcos Perez/.test(info), 'elegir una visita llena el número y enseña cliente y técnico: ' + info);
const probar = async (id) => {
  await p.evaluate((id) => { const i = document.getElementById('svVisita'); i.value = id; i.dispatchEvent(new Event('change')); }, id);
  await espera(1500);
  return p.evaluate(() => document.getElementById('svInfo').innerText);
};
info = await probar(V_SINTEC);
ok(/no tiene técnico asignado/.test(info), 'visita sin técnico: no admite salida — ' + info);
info = await probar(V_VIEJA);
ok(/ya está cerrada \(ENTREGADO AL CLIENTE\)/.test(info), 'visita vieja terminada: no admite salida — ' + info);
await bo.captura('02-salida');
await p.keyboard.press('Escape'); await espera(600);

// Hoja de regreso.
await p.click(`[data-salida-devolver="${V_ABIERTA}"]`);
await p.waitForSelector('input[name="svDev"]');
ok((await p.evaluate(() => document.querySelectorAll('input[name="svDev"]').length)) === 2, 'hoja de regreso lista los 2 radios de la visita');
await bo.captura('03-recibir');
await p.keyboard.press('Escape'); await espera(600);

// Candado del cliente: un con_tecnico no se mueve a mano.
const candado = await p.evaluate(async () => {
  try { await EquiposPoolService.corregirUbicacion('ZZSV1A0001', { destino: 'devuelto_revision', motivo: 'prueba' }, firebase.auth().currentUser); return 'pasó'; }
  catch (e) { return `${e.code}: ${e.message}`; }
});
ok(/^con-tecnico:/.test(candado) && /Recibir de vuelta/.test(candado), 'corregir ubicación a mano se rechaza: ' + candado.slice(0, 110));
ok((await db.collection('equipos_pool').doc('ZZSV1A0001').get()).data().estado === 'con_tecnico', 'la ficha sigue con_tecnico');
const errBo = bo.errores.filter(e => !/favicon|clipboard|Clipboard/.test(e));
ok(!errBo.length, 'bodega: sin errores de consola ' + JSON.stringify(errBo.slice(0, 3)) + ' ' + JSON.stringify(malas.slice(0, 3)));
await bo.cerrar?.();

// ── Taller: cambio en sitio y cierre de la visita ─────────────────────────
const te = await abrir({ email: USUARIOS.recepcion, carpeta: 'salida-visita' });
await te.ir(`/ordenes/index.html?ids=${V_ABIERTA}`, { esperar: 4000 });
await te.page.evaluate(() => CargaDiferida.regularizarReemplazo()).catch(() => {});
await te.page.evaluate((id) => { void abrirRegularizarReemplazo(id); }, V_ABIERTA);
await te.page.waitForSelector('#rrEnt', { timeout: 15000 }).catch(() => {});
const pista = await te.page.evaluate(() => ({ dl: document.querySelectorAll('#rrLlevados option').length, txt: document.querySelector('.modal-body')?.innerText || '' }));
ok(pista.dl === 2 && /Salieron de bodega con esta visita/.test(pista.txt), 'cambio en sitio sugiere los radios que salieron: ' + pista.dl);
await te.captura('04-cambio-en-sitio');
await te.page.keyboard.press('Escape'); await espera(600);
await te.page.evaluate(() => CargaDiferida.visita());
await te.page.evaluate((id) => { void abrirCierreVisita(id); }, V_ABIERTA);
await espera(2500);
const cierre = await te.page.evaluate(() => [...document.querySelectorAll('.modal-body, .sheet-body, .overlay')].map(x => x.innerText).join(' ').replace(/\s+/g, ' '));
ok(/Tienes 2 radios de bodega de esta visita/.test(cierre) && /ZZSV1A0001/.test(cierre) && /devuélvelos a bodega/.test(cierre),
  'al cerrar la visita se le recuerdan los radios de bodega: ' + (cierre.match(/Tienes 2 radios[^.]*\./) || [''])[0]);
await te.captura('05-cierre-visita');
await te.cerrar?.();

// ── Limpieza de lo sembrado ───────────────────────────────────────────────
for (const id of [V_ABIERTA, V_CERRADA, V_SINTEC, V_VIEJA]) await db.collection('ordenes_de_servicio').doc(id).delete();
for (const s of ['ZZSV1A0001', 'ZZSV1A0002', 'ZZSV1A0003']) await db.recursiveDelete(db.collection('equipos_pool').doc(s));

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
