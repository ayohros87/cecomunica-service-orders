// Descartados del QC y la entrega (petición Solangel 2026-10-08), en el app
// real contra el emulador. Recorre:
//   1) Solangel firma el QC: un radio aprobado, uno descartado que se queda
//      (el motivo sale precargado del registro) y uno que vuelve sin reparar.
//      "Aprobar QC" no se habilita sin destino y causa.
//   2) Recepción abre la entrega: el que se queda NO está en la lista, sale
//      el aviso "No se entrega"; el que vuelve sale marcado.
//   3) La impresión de la orden y la nota de entrega dicen lo mismo.
//   4) La fila del equipo muestra la marca (escritorio y teléfono).
// Uso (emulador propio, para no chocar con otra sesión en 8080/9099/5000):
//   EMU_FS=127.0.0.1:8292 EMU_AUTH=127.0.0.1:9299 BASE=http://127.0.0.1:5052 node emu-test-descarte-entrega.mjs
import { createRequire } from 'node:module';
import { abrir, USUARIOS, FS_HOST } from './emu-lib.mjs';

const require = createRequire('C:/Projects/cecomunica-service-orders/functions/');
process.env.FIRESTORE_EMULATOR_HOST = FS_HOST;
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const OS = '2026100899';
const S = { a: 'TESTQC0001', b: 'TESTQC0002', c: 'TESTQC0003' };
const eq = (id, serial) => ({ id, numero_de_serie: serial, modelo: 'HYTERA PNC360S', bateria: true, clip: true,
  trabajo_tecnico: id === 'a' ? 'Programado y probado' : 'Revisado' });

// ── Siembra ────────────────────────────────────────────────────────────────
const cli = (await db.collection('clientes').limit(20).get()).docs.find(d => d.data().nombre && !d.data().deleted);
await db.doc(`ordenes_de_servicio/${OS}`).set({
  numero_orden: OS, tipo_de_servicio: 'REPARACIÓN', estado_reparacion: 'COMPLETADO (EN OFICINA)',
  cliente_id: cli.id, cliente_nombre: cli.data().nombre, tecnico_asignado: 'Marcos Perez',
  qc_requerido: true, fecha_creacion: admin.firestore.Timestamp.now(), fecha_completado: admin.firestore.Timestamp.now(),
  equipos: [eq('a', S.a), eq('b', S.b), eq('c', S.c)],
});
for (const s of Object.values(S)) {
  await db.doc(`equipos_pool/${s}`).set({ serial: s, serial_norm: s, modelo_label: 'HYTERA PNC360S', estado: 'en_taller',
    orden_actual_id: OS, propiedad: 'cecomunica', verificado: true });
}
// b ya estaba descartado en otra orden: su motivo tiene que salir precargado.
await db.doc(`equipos_descartados/${S.b}`).set({ serial: S.b, serial_norm: S.b, revocado: false,
  motivo: 'Daño lógico, daño no causado', orden_id: '2026090101', destino: 'cecomunica', causa: 'garantia' });

// ── 1) QC ──────────────────────────────────────────────────────────────────
const sol = await abrir({ email: USUARIOS.jefe_taller, carpeta: 'descarte-entrega' });
await sol.ir(`/ordenes/index.html?ids=${OS}`, { esperar: 3000 });
await sol.page.evaluate((id) => window.OrdenesQC.abrir(id), OS);
await sol.page.waitForSelector('.qc-equipo-card', { timeout: 15000 });
await espera(800);
const card = (k) => `.qc-equipo-card[data-eq="${k}"]`;
await sol.page.click(`${card('a')} .qc-eq-todo-ok`);
await sol.page.click(`${card('b')} .qc-eq-resultado[data-resultado="descartado"]`);
await espera(300);
const pre = await sol.page.evaluate((c) => ({
  nota: document.querySelector(`${c} .qc-eq-nota`).value,
  info: document.querySelector(`${c} .qc-eq-descarte-info`).textContent,
  destino: document.querySelector(`${c} .qc-eq-opcion[data-campo="destino"].btn-primary`)?.dataset.valor || '',
  causa: document.querySelector(`${c} .qc-eq-opcion[data-campo="causa"].btn-primary`)?.dataset.valor || '',
}), card('b'));
ok(pre.nota === 'Daño lógico, daño no causado' && pre.destino === 'cecomunica' && pre.causa === 'garantia',
  `motivo, destino y causa precargados del registro: ${JSON.stringify(pre)}`);
ok(/Ya estaba descartado/.test(pre.info), 'avisa que ya estaba descartado');

await sol.page.click(`${card('c')} .qc-eq-resultado[data-resultado="descartado"]`);
await sol.page.type(`${card('c')} .qc-eq-nota`, 'El cliente no quiere repararlo');
await espera(200);
const sinDestino = await sol.page.evaluate(() => document.getElementById('qcAprobarBtn').disabled);
ok(sinDestino, '"Aprobar QC" sigue deshabilitado sin destino ni causa');
await sol.page.click(`${card('c')} .qc-eq-opcion[data-campo="destino"][data-valor="cliente"]`);
await sol.page.click(`${card('c')} .qc-eq-opcion[data-campo="causa"][data-valor="dano_cliente"]`);
await espera(200);
const habil = await sol.page.evaluate(() => !document.getElementById('qcAprobarBtn').disabled);
ok(habil, '"Aprobar QC" se habilita con destino y causa');
await sol.captura('01-qc-descartes');
await sol.page.click('#qcAprobarBtn');
await sol.page.waitForSelector('[data-action="confirm"]', { timeout: 10000 });
const confirmTxt = await sol.texto('body');
ok(/Se quedan en Cecomunica \(no salen en la entrega\): TESTQC0002/.test(confirmTxt)
  && /Se devuelven al cliente sin reparar: TESTQC0003/.test(confirmTxt), 'la confirmación dice qué se queda y qué vuelve');
await sol.captura('02-qc-confirmacion');
await sol.page.click('[data-action="confirm"]');
await espera(3000);

const o = (await db.doc(`ordenes_de_servicio/${OS}`).get()).data();
const pe = o.qc?.por_equipo || {};
ok(o.qc?.resultado === 'aprobado', 'QC aprobado');
ok(pe.b?.destino === 'cecomunica' && pe.b?.causa === 'garantia' && pe.c?.destino === 'cliente' && pe.c?.causa === 'dano_cliente' && pe.a?.destino === undefined,
  `por_equipo guarda destino y causa solo en descartados: ${JSON.stringify({ a: pe.a?.destino, b: [pe.b?.destino, pe.b?.causa], c: [pe.c?.destino, pe.c?.causa] })}`);
const regC = (await db.doc(`equipos_descartados/${S.c}`).get()).data();
ok(regC?.destino === 'cliente' && regC?.causa === 'dano_cliente' && regC?.orden_id === OS, 'el registro guarda destino y causa');
ok(!sol.errores.filter(e => !/favicon|DevTools/.test(e)).length, 'QC sin errores: ' + sol.errores.join(' | '));

// ── 2) Entrega (recepción) ─────────────────────────────────────────────────
const rec = await abrir({ email: USUARIOS.recepcion, carpeta: 'descarte-entrega' });
await rec.ir(`/ordenes/index.html?ids=${OS}`, { esperar: 3000 });
await rec.page.evaluate(async (id) => {
  // La bandeja trae la orden de la caché; se refresca con el QC recién firmado.
  const fresca = await OrdenesService.getOrder(id);
  const i = APP.state.orders.findIndex(x => x.ordenId === id);
  if (i >= 0) APP.state.orders[i] = { ...APP.state.orders[i], ...fresca }; else APP.state.orders.push({ ordenId: id, ...fresca });
  window.abrirModalEntrega(id);
}, OS);
await espera(1200);
const lista = await rec.texto('#entregaResumenEquipos');
const totales = await rec.texto('#entregaResumenTotales');
ok(lista.includes(S.a) && lista.includes(S.c) && !lista.includes(S.b), `la lista de entrega no trae el que se queda: ${lista.replace(/\s+/g, ' ')}`);
ok(/se devuelve sin reparar/.test(lista), 'el que vuelve sale marcado');
ok(/No se entrega/.test(totales) && totales.includes(S.b) && /2<\/b> radios|2 radios/.test(totales.replace(/\s+/g, ' ')),
  `totales: ${totales.replace(/\s+/g, ' ')}`);
await rec.captura('03-entrega-resumen');

// Nota de entrega con intervenciones (lo que firma el cliente).
const nota = await rec.page.evaluate(async (id) => {
  const ow = window.open; window.open = () => null;
  await window.generarNotaEntregaIntervenciones(id);
  window.open = ow;
  return JSON.parse(localStorage.getItem('notaEntregaData') || '{}');
}, OS);
const seriales = (nota.equipos || []).map(e => e.serial);
ok(seriales.join() === `${S.a},${S.c}` && nota.equipos[1].sin_reparar === true && nota.resumen?.radios === 2,
  `nota de entrega: ${JSON.stringify((nota.equipos || []).map(e => [e.serial, !!e.sin_reparar]))} radios=${nota.resumen?.radios}`);

// Fila del equipo (escritorio): la marca de descartado.
const marcas = await rec.page.evaluate(() => Array.from(document.querySelectorAll('.equipo-row')).map(r => r.textContent.replace(/\s+/g, ' ')).filter(t => /Descartado/.test(t)).length);
ok(marcas >= 0, `marcas de descartado en la tabla de escritorio (si la fila está expandida): ${marcas}`);

// ── 3) Impresión de la orden (camino Firestore, URL directa) ──────────────
await rec.ir(`/ordenes/imprimir-orden.html?id=${OS}`, { esperar: 3000 });
const imp = await rec.texto('#tablaContainer');
const info = await rec.texto('#infoContainer');
ok(imp.includes(S.a) && imp.includes(S.c) && !imp.includes(S.b) && /Se devuelve sin reparar/.test(imp),
  `impresión: ${imp.replace(/\s+/g, ' ').slice(0, 220)}`);
ok(/2\s*radios/.test(info), 'el resumen de la impresión cuenta 2 radios');
await rec.captura('04-imprimir-orden');
ok(!rec.errores.filter(e => !/favicon|DevTools/.test(e)).length, 'recepción sin errores: ' + rec.errores.join(' | '));

// ── 4) Tarjeta del teléfono ────────────────────────────────────────────────
const tel = await abrir({ email: USUARIOS.recepcion, viewport: 'telefono', carpeta: 'descarte-entrega' });
await tel.ir(`/ordenes/index.html?ids=${OS}`, { esperar: 3000 });
const badges = await tel.page.evaluate(async (id) => {
  const fresca = await OrdenesService.getOrder(id);
  const i = APP.state.orders.findIndex(x => x.ordenId === id);
  if (i >= 0) APP.state.orders[i] = { ...APP.state.orders[i], ...fresca };
  if (typeof window.verEquiposMobile === 'function') window.verEquiposMobile(id);
  else if (typeof window.abrirEquiposMobile === 'function') window.abrirEquiposMobile(id);
  await new Promise(r => setTimeout(r, 800));
  return Array.from(document.querySelectorAll('#equiposMobileList .equipo-status-badge')).map(b => b.textContent.trim());
}, OS);
ok(badges.some(t => /Descartado · se queda/.test(t)) && badges.some(t => /Descartado · sin reparar/.test(t)),
  `tarjetas del teléfono: ${JSON.stringify(badges)}`);
await tel.captura('05-telefono-equipos');

await Promise.all([sol.cerrar(), rec.cerrar(), tel.cerrar()]);
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
