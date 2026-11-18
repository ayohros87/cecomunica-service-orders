// Tres acciones en masa de la Base PoC (Brenda, 2026-11-18):
//   A. Más → "Reconectar…": los inactivos seleccionados vuelven a activo, sin
//      sello de baja y con poc_log accion 'reconexion';
//   B. Más → "Agregar grupos…": suma grupos del catálogo a los seleccionados
//      de UN cliente conservando los que cada radio ya tenía;
//   C. "Asignar del pool" con MENOS SIMs que radios: se asignan los marcados
//      a los primeros radios y los pendientes quedan seleccionados.
// Corre contra el emulador sembrado con `npm run build` hecho:
//   node tools/emulador-almacen/emu-test-poc-masa.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

const fallos = [];
const ok = (cond, msg) => { console.log((cond ? 'OK     ' : 'FALLA  ') + msg); if (!cond) fallos.push(msg); };
const CLIENTE = process.env.CLIENTE || 'unidad mo';
const GRUPO = 'ZZ-EMU-' + Date.now().toString(36).toUpperCase();
const pausa = (ms) => new Promise(r => setTimeout(r, ms));
// Espera a que salga un Toast que case (los avisos llegan cuando termina la
// escritura; un tiempo fijo se queda corto con el emulador cargado).
const esperarToast = async (fuente) => {
  try { await p.waitForFunction((f) => (window.__toasts || []).some(t => new RegExp(f).test(t.msg)), { timeout: 20000 }, fuente); } catch (_) { /* el ok() de abajo lo reporta */ }
};

const s = await abrir({ email: USUARIOS.recepcion, carpeta: 'poc-masa' });
const p = s.page;
p.on('response', r => { if (r.status() >= 400) console.log('       HTTP', r.status(), r.url().slice(0, 160)); });
await s.ir('/POC/index.html', { esperar: 1500 });

const filas = () => p.evaluate(() => [...document.querySelectorAll('#devicesTable tr[data-id]')].map(r => ({
  id: r.dataset.id,
  activo: r.cells[3]?.dataset.activo === 'true',
  marcado: !!r.querySelector('.seleccion-sim')?.checked,
})));
const doc = (id) => p.evaluate(async (id) => {
  const d = await firebase.firestore().collection('poc_devices').doc(id).get();
  const x = d.data() || {};
  return { activo: x.activo, inactivo_desde: !!x.inactivo_desde, inactivo_motivo: x.inactivo_motivo || null, grupos: x.grupos || [], sim_number: x.sim_number || '', operador: x.operador || '' };
}, id);
const logs = (id, accion) => p.evaluate(async (id, accion) => {
  const q = await firebase.firestore().collection('poc_logs').where('equipo_id', '==', id).get();
  return q.docs.map(d => d.data()).filter(l => l.accion === accion).map(l => ({ motivo: l.motivo, antes: l.cambios?.antes, despues: l.cambios?.despues }));
}, id, accion);
const marcar = (ids) => p.evaluate((ids) => {
  document.querySelectorAll('#devicesTable tr[data-id]').forEach(r => { const cb = r.querySelector('.seleccion-sim'); cb.checked = ids.includes(r.dataset.id); });
  PocList.actualizarSeleccion();
}, ids);
const menuMas = async (boton) => { await p.click('#pocMasBtn'); await s.quieto(300); await p.click(boton); };
const esperarBusqueda = async () => {
  await p.waitForFunction(() => /en la búsqueda/.test(document.getElementById('resumenEquiposTop')?.textContent || ''), { timeout: 90000 });
  await s.quieto(800);
};

await p.type('#filtroValor', CLIENTE);
await esperarBusqueda();
// Reinicio: emu-test-baja-poc deja dados de baja los radios del cliente; se
// devuelven a activo los que dio de baja recepción en una corrida anterior.
const reiniciadas = await p.evaluate(async (email) => {
  const db = firebase.firestore();
  const docs = [...PocList._docsPorId.values()].filter(d => d.inactivo_por === email);
  if (!docs.length) return 0;
  const b = db.batch();
  const del = firebase.firestore.FieldValue.delete();
  docs.forEach(d => b.update(db.collection('poc_devices').doc(d.id), { activo: true, inactivo_desde: del, inactivo_por: del, inactivo_motivo: del, inactivo_detalle: del }));
  await b.commit();
  return docs.length;
}, USUARIOS.recepcion);
if (reiniciadas) {
  console.log(`       reinicio: ${reiniciadas} radios devueltos a activo`);
  await p.evaluate(() => PocList.limpiarFiltro());
  await s.quieto(1500);
  await p.type('#filtroValor', CLIENTE);
  await esperarBusqueda();
}
let lista = await filas();
const activos =lista.filter(f => f.activo).map(f => f.id);
console.log(`       ${CLIENTE}: ${lista.length} radios, ${activos.length} activos`);
ok(activos.length >= 4, 'el cliente del seed tiene al menos 4 radios activos');
ok(await p.evaluate(() => !!document.getElementById('btnReconectar') && !!document.getElementById('btnAgregarGrupos')), 'recepción ve "Reconectar…" y "Agregar grupos…" en Más');

// ── A. Reconectar ─────────────────────────────────────────────────────────
const objetivo = activos.slice(0, 3);
await marcar(objetivo);
await menuMas('#btnDarDeBaja');
await p.waitForSelector('#pocBajaMotivo', { timeout: 5000 });
await p.select('#pocBajaMotivo', 'falta_pago');
await p.type('#pocBajaDetalle', 'prueba emulador');
await p.evaluate(() => { document.getElementById('pocBajaCopiar').checked = false; });
await p.click('[data-sheet-action="confirmar"]');
try { await p.waitForSelector('.overlay [data-action="cancel"]', { timeout: 6000 }); await p.click('.overlay [data-action="cancel"]'); } catch (_) { /* sin pregunta de SIM */ }
await s.quieto(2000);
ok((await doc(objetivo[0])).activo === false, 'preparación: 3 radios dados de baja por falta de pago');
ok(await p.evaluate(() => document.getElementById('soloRecientes').checked), 'preparación: chip "Baja reciente" prendido');

// Con un activo mezclado en la selección: no se toca.
lista = await filas();
ok(objetivo.every(id => lista.some(f => f.id === id)), 'los 3 dados de baja están en la lista del chip');
await marcar(objetivo);
await menuMas('#btnReconectar');
await p.waitForSelector('#pocReconCopiar', { timeout: 5000 });
const tituloRecon = await p.evaluate(() => document.querySelector('.sheet-title, .modal-title:not(#simPoolModalTitle)')?.textContent || '');
await s.captura('01-hoja-reconectar');
await p.evaluate(() => { document.getElementById('pocReconCopiar').checked = false; });
await p.click('[data-sheet-action="confirmar"]');
await esperarToast('radios reconectados');
await s.quieto(1500);
let toasts = await s.toasts();
ok(toasts.some(t => /3 radios reconectados/.test(t.msg) && t.type === 'ok'), 'toast de reconexión: ' + JSON.stringify(toasts.slice(-2).map(t => t.msg)) + ' · hoja: ' + tituloRecon.trim());
for (const id of objetivo) {
  const d = await doc(id);
  ok(d.activo === true && !d.inactivo_desde && !d.inactivo_motivo, `ficha ${id.slice(0, 6)}… activa y sin sello: ` + JSON.stringify({ a: d.activo, s: d.inactivo_desde, m: d.inactivo_motivo }));
}
const lr = await logs(objetivo[0], 'reconexion');
// (>= 1 y sin orden garantizado: una corrida anterior deja sus logs)
ok(lr.length >= 1 && /Reconexión \(baja previa: Falta de pago — prueba emulador\)/.test(lr.map(l => l.motivo).join(' | ')) && lr.every(l => l.antes?.activo === false && l.despues?.activo === true && !('inactivo_desde' in (l.despues || {}))),
  'poc_log accion=reconexion: ' + JSON.stringify(lr.map(l => l.motivo)));
ok(!(await p.evaluate(() => document.getElementById('soloRecientes').checked)), 'el chip "Baja reciente" se apagó');
lista = await filas();
ok(objetivo.every(id => lista.find(f => f.id === id)?.activo === true), 'la lista los enseña activos (verde) tras reconectar');
await s.captura('02-tras-reconectar');

// Solo activos seleccionados → no abre hoja, avisa.
await marcar(objetivo);
await menuMas('#btnReconectar');
await pausa(600);
toasts = await s.toasts();
ok(toasts.some(t => /Ninguno de los seleccionados está inactivo/.test(t.msg)) && !(await p.$('#pocReconCopiar')), 'con solo activos seleccionados no hay nada que reconectar');
await p.evaluate(() => document.body.click());

// ── B. Agregar grupos ─────────────────────────────────────────────────────
const cli = await p.evaluate(async (id, grupo) => {
  const d = PocList._docsPorId.get(id);
  if (!d?.cliente_id) return null;
  const ref = firebase.firestore().collection('clientes').doc(d.cliente_id);
  const antes = (await ref.get()).data()?.poc_grupos || [];
  await ref.update({ poc_grupos: firebase.firestore.FieldValue.arrayUnion(grupo) });
  return { id: d.cliente_id, catalogo: antes.length };
}, activos[0], GRUPO);
ok(!!cli, `catálogo del cliente (${cli?.catalogo} grupos) + grupo de prueba ${GRUPO}`);
const paraGrupos = activos.slice(0, 4);
const gruposAntes = {};
for (const id of paraGrupos) gruposAntes[id] = (await doc(id)).grupos;
// Uno de los cuatro ya trae el grupo: no debe duplicarse ni contarse.
await p.evaluate(async (id, grupo) => {
  await firebase.firestore().collection('poc_devices').doc(id).update({ grupos: firebase.firestore.FieldValue.arrayUnion(grupo) });
}, paraGrupos[3], GRUPO);
await s.quieto(1500);
await marcar(paraGrupos);
await menuMas('#btnAgregarGrupos');
await p.waitForSelector('#pocGruposMasaChips .grupo-chip', { timeout: 8000 });
const chip = await p.evaluate((g) => {
  const b = [...document.querySelectorAll('#pocGruposMasaChips .grupo-chip')].find(x => x.dataset.grupo === g);
  return b ? { texto: b.textContent.replace(/\s+/g, ' ').trim(), disabled: b.disabled } : null;
}, GRUPO);
ok(chip && /· 1\/4$/.test(chip.texto) && !chip.disabled, 'el chip del grupo dice cuántos ya lo tienen: ' + JSON.stringify(chip));
// Confirmar sin elegir nada: la hoja sigue abierta.
await p.click('[data-sheet-action="confirmar"]');
await pausa(400);
ok(!!(await p.$('#pocGruposMasaChips')), 'sin grupo elegido la hoja no se cierra');
await p.evaluate((g) => { [...document.querySelectorAll('#pocGruposMasaChips .grupo-chip')].find(x => x.dataset.grupo === g).click(); }, GRUPO);
const resumenG = await p.evaluate(() => document.getElementById('pocGruposMasaResumen').textContent.replace(/\s+/g, ' ').trim());
ok(/agrega 1 grupo a 3 radios/.test(resumenG), 'resumen de la hoja: "' + resumenG + '"');
await s.captura('03-hoja-grupos');
await p.click('[data-sheet-action="confirmar"]');
await esperarToast('Grupo agregado');
await s.quieto(1500);
toasts = await s.toasts();
ok(toasts.some(t => /Grupo agregado a 3 radios · 1 ya lo tenía/.test(t.msg)), 'toast de grupos: ' + JSON.stringify(toasts.slice(-2).map(t => t.msg)));
for (const id of paraGrupos.slice(0, 3)) {
  const g = (await doc(id)).grupos;
  ok(g.includes(GRUPO) && gruposAntes[id].every(x => g.includes(x)) && g.length === gruposAntes[id].length + 1,
    `ficha ${id.slice(0, 6)}…: ${gruposAntes[id].length} grupos → ${g.length}, conserva los suyos`);
}
const g4 = (await doc(paraGrupos[3])).grupos;
ok(g4.filter(x => x === GRUPO).length === 1, 'el que ya lo tenía no lo duplica');
const lg = (await logs(paraGrupos[0], 'grupos_agregar')).filter(l => l.motivo.includes(GRUPO));
ok(lg.length === 1 && lg[0].motivo.includes(GRUPO) && lg[0].despues?.grupos?.includes(GRUPO) && !lg[0].antes?.grupos?.includes(GRUPO), 'poc_log accion=grupos_agregar');
ok((await logs(paraGrupos[3], 'grupos_agregar')).filter(l => l.motivo.includes(GRUPO)).length === 0, 'el que no cambió no deja log');
const celda = await p.evaluate((id, g) => {
  const r = [...document.querySelectorAll('#devicesTable tr[data-id]')].find(x => x.dataset.id === id);
  return { html: r.innerHTML.includes(g), marcado: r.querySelector('.seleccion-sim').checked };
}, paraGrupos[0], GRUPO);
ok(celda.html && celda.marcado, 'la fila se repinta con el grupo nuevo y conserva la selección');

// ── C. Asignación parcial de SIMs ─────────────────────────────────────────
const paraSim = activos.slice(0, 3);
await marcar(paraSim);
const simAntes = {};
for (const id of paraSim) simAntes[id] = (await doc(id)).sim_number;
await p.click('#btnSimPool');
await p.waitForSelector('#poolTabla .pool-check', { timeout: 15000 });
const simsMarcados = await p.evaluate(() => {
  const cbs = [...document.querySelectorAll('#poolTabla .pool-check')].slice(0, 2);
  cbs.forEach(cb => cb.click());
  return PocSimPool.seleccionados();
});
ok(simsMarcados.length === 2, 'se marcaron 2 SIMs para 3 radios: ' + (await p.evaluate(() => document.getElementById('poolContador').textContent)));
const ordenModal = await p.evaluate(() => PocSimPool._devices.map(d => d.id));
// El aviso de "SIM en otro radio" tiene su propia prueba; aqui se apaga para
// que el SIM que toque del seed no cambie el recorrido.
await p.evaluate(() => { PocSimConflicto.revisar = async () => ({ cancelado: false, motivo: '', conflictos: new Map() }); });
p.evaluate(() => { PocSimPool.procesar(); });
// Puede aparecer primero el aviso de "SIM en otro radio" (pide motivo).
try {
  await p.waitForFunction(() => [...document.querySelectorAll('.overlay')].some(o => o.style.display !== 'none' && /Asignación parcial|otro radio|motivo/i.test(o.textContent)), { timeout: 12000 });
} catch (e) {
  console.log('       DIAG overlays: ' + JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.overlay, .modal-backdrop.open')].map(o => o.textContent.replace(/\s+/g, ' ').trim().slice(0, 200)))));
  console.log('       DIAG toasts: ' + JSON.stringify((await s.toasts()).slice(-3)) + ' errores: ' + JSON.stringify(s.errores.slice(-4)));
  throw e;
}
let textoConfirm = await p.evaluate(() => [...document.querySelectorAll('.overlay')].filter(o => o.style.display !== 'none').map(o => o.textContent.replace(/\s+/g, ' ').trim()).join(' || '));
if (!/Asignación parcial/.test(textoConfirm)) {
  console.log('       aviso previo: ' + textoConfirm.slice(0, 160));
  await p.evaluate(() => { const t = document.querySelector('.overlay textarea, .overlay input[type="text"]'); if (t) { t.value = 'prueba emulador parcial'; t.dispatchEvent(new Event('input', { bubbles: true })); } });
  await p.evaluate(() => { const b = [...document.querySelectorAll('.overlay [data-action="confirm"], .overlay [data-sheet-action]')].filter(x => !/cancel/.test(x.dataset.action || x.dataset.sheetAction)).pop(); b?.click(); });
  await p.waitForFunction(() => [...document.querySelectorAll('.overlay')].some(o => /Asignación parcial/.test(o.textContent)), { timeout: 8000 });
  textoConfirm = await p.evaluate(() => [...document.querySelectorAll('.overlay')].map(o => o.textContent.replace(/\s+/g, ' ').trim()).find(t => /Asignación parcial/.test(t)));
}
ok(/Marcaste 2 SIMs para 3 equipos/.test(textoConfirm) && /Queda sin SIM/.test(textoConfirm) && simsMarcados.every(x => textoConfirm.includes(x)),
  'la confirmación enseña el emparejamiento y el pendiente: ' + textoConfirm.slice(0, 220));
await s.captura('04-confirmacion-parcial');
await p.evaluate(() => { const o = [...document.querySelectorAll('.overlay')].find(o => /Asignación parcial/.test(o.textContent)); o.querySelector('[data-action="confirm"]').click(); });
await s.quieto(3500);
toasts = await s.toasts();
ok(toasts.some(t => /2 equipos con SIM del pool\. Queda 1 seleccionado sin SIM/.test(t.msg)), 'toast parcial: ' + JSON.stringify(toasts.slice(-1).map(t => t.msg)));
const d1 = await doc(ordenModal[0]), d2 = await doc(ordenModal[1]), d3 = await doc(ordenModal[2]);
ok(d1.sim_number === simsMarcados[0] && d2.sim_number === simsMarcados[1], `los 2 primeros radios recibieron los 2 SIMs en orden (${d1.sim_number}, ${d2.sim_number})`);
ok(d3.sim_number === simAntes[ordenModal[2]], 'el tercero quedó como estaba: "' + d3.sim_number + '"');
const estadoPool = await p.evaluate(async (ids) => Promise.all(ids.map(async id => (await firebase.firestore().collection('sim_cards').doc(id).get()).data()?.estado)), simsMarcados);
ok(estadoPool.every(e => e === 'asignado'), 'los 2 SIMs quedaron "asignado" en el pool: ' + JSON.stringify(estadoPool));
lista = await filas();
const marcados = lista.filter(f => f.marcado).map(f => f.id);
ok(marcados.length === 1 && marcados[0] === ordenModal[2], 'queda seleccionado SOLO el radio pendiente');
ok(!(await p.evaluate(() => document.getElementById('simPoolModal').classList.contains('open') || document.getElementById('simPoolModal').style.display === 'flex')), 'el modal del pool se cerró');
await s.captura('05-tras-parcial');

// Más SIMs que radios sigue bloqueado.
await p.click('#btnSimPool');
// (las filas de la apertura anterior siguen en el DOM hasta que abrir() termina)
await p.waitForFunction(() => PocSimPool._devices.length === 1 && document.getElementById('simPoolModal').classList.contains('open'), { timeout: 15000 });
await p.evaluate(() => { [...document.querySelectorAll('#poolTabla .pool-check')].slice(0, 2).forEach(cb => cb.click()); PocSimPool.procesar(); });
await pausa(600);
toasts = await s.toasts();
ok(toasts.some(t => /Marcaste 2 SIMs para 1 equipos\. Desmarca los que sobran/.test(t.msg)), 'más SIMs que radios: bloqueado con aviso ' + JSON.stringify(toasts.slice(-2).map(t => t.msg)));
await p.evaluate(() => PocSimPool.cerrar());

const errores = s.errores.filter(e => !/favicon|rebotó a login|clipboard|Clipboard/.test(e));
ok(!errores.length, 'sin errores de consola ' + JSON.stringify(errores.slice(0, 5)));

await s.browser.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
