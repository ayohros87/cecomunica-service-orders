// Baja de radios con fecha y motivo en la Base PoC (Brenda, 2026-10-16):
//   1. recepción busca un cliente, segmento "Activos", casilla del encabezado
//      → "N de N seleccionados";
//   2. Más → "Dar de baja (desconexión)…" → motivo "Falta de pago" → los N
//      quedan inactivos con sello, el chip "Baja reciente" se prende solo y la
//      lista muestra SOLO esos N con "desde dd/mm/aaaa · Falta de pago";
//   3. Firestore: inactivo_desde / inactivo_por / inactivo_motivo en la ficha
//      y un poc_log con accion 'baja' por radio;
//   4. edición en masa: reactivar 2 → pierden el sello y salen del chip;
//   5. ficha (drawer): quitar "Activo" pide motivo y sella; cancelar no guarda.
// Corre contra el emulador sembrado con `npm run build` hecho:
//   node tools/emulador-almacen/emu-test-baja-poc.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

const fallos = [];
const ok = (cond, msg) => { console.log((cond ? 'OK     ' : 'FALLA  ') + msg); if (!cond) fallos.push(msg); };
const CLIENTE = process.env.CLIENTE || 'unidad mo';

const s = await abrir({ email: USUARIOS.recepcion, carpeta: 'baja-poc' });
const p = s.page;
const i = await s.ir('/POC/index.html', { esperar: 1500 });
ok(i.url.startsWith('/POC/index.html'), 'recepción abre la Base PoC');

const filas = () => p.evaluate(() => [...document.querySelectorAll('#devicesTable tr[data-id]')].map(r => ({
  id: r.dataset.id,
  activo: r.cells[3]?.dataset.activo === 'true',
  sub: r.querySelector('.poc-inactivo-sub')?.textContent || '',
  serial: r.cells[4]?.textContent.trim(),
})));
const resumenSel = () => p.evaluate(() => document.getElementById('resumenSeleccionados')?.textContent || '');
const doc = (id) => p.evaluate(async (id) => {
  const d = await firebase.firestore().collection('poc_devices').doc(id).get();
  const x = d.data() || {};
  return { activo: x.activo, inactivo_desde: x.inactivo_desde ? x.inactivo_desde.toMillis() : null, inactivo_por: x.inactivo_por || null, inactivo_motivo: x.inactivo_motivo || null, inactivo_detalle: x.inactivo_detalle || null };
}, id);
const logsBaja = (id) => p.evaluate(async (id) => {
  const q = await firebase.firestore().collection('poc_logs').where('equipo_id', '==', id).get();
  return q.docs.map(d => d.data()).filter(l => l.accion === 'baja').map(l => ({ motivo: l.motivo, antes: l.cambios?.antes?.activo, despues: l.cambios?.despues?.activo }));
}, id);

// La primera búsqueda abre la suscripción a las ~4,600 fichas vivas: en el
// emulador tarda varios segundos. Se espera a que el resumen diga "en la
// búsqueda" (lo pinta filtrar() al terminar) y a que la tabla se aquiete.
const esperarBusqueda = async () => {
  await p.waitForFunction(() => /en la búsqueda/.test(document.getElementById('resumenEquiposTop')?.textContent || ''), { timeout: 90000 });
  await s.quieto(800);
};

// ── 0. Reinicio: deshacer las bajas de una corrida anterior ───────────────
await p.type('#filtroValor', CLIENTE);
await esperarBusqueda();
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

// ── 1. Buscar el cliente, solo activos, seleccionar todos ─────────────────
let lista = await filas();
const nActivosTotal = lista.filter(f => f.activo).length;
console.log(`       ${CLIENTE}: ${lista.length} radios, ${nActivosTotal} activos`);
ok(nActivosTotal >= 2, 'el cliente del seed tiene al menos 2 radios activos');

await p.click('input[name="pocEstadoActivo"][value="activos"]');
await s.quieto(1000);
lista = await filas();
ok(lista.length === nActivosTotal && lista.every(f => f.activo), `segmento Activos deja ${lista.length} filas, todas activas`);
await p.click('#encabezadoTabla .check-all');
await s.quieto(300);
ok((await resumenSel()) === `${lista.length} de ${lista.length} seleccionados`, `resumen dice "${lista.length} de ${lista.length} seleccionados" (${await resumenSel()})`);
await s.captura('01-activos-seleccionados');

// ── 2. Más → Dar de baja ──────────────────────────────────────────────────
const idsBaja = lista.map(f => f.id);
await p.click('#pocMasBtn');
await s.quieto(300);
await p.click('#btnDarDeBaja');
await p.waitForSelector('#pocBajaMotivo', { timeout: 5000 });
await s.captura('02-hoja-motivo');
await p.select('#pocBajaMotivo', 'falta_pago');
await p.type('#pocBajaDetalle', 'prueba emulador');
await p.evaluate(() => { document.getElementById('pocBajaCopiar').checked = false; document.getElementById('pocBajaCorreo').checked = false; });
await p.click('[data-sheet-action="confirmar"]');
// SIM de los radios: "Conservar en el equipo" si aparece la pregunta.
try {
  await p.waitForSelector('.overlay [data-action="cancel"]', { timeout: 6000 });
  await p.click('.overlay [data-action="cancel"]');
  console.log('       SIM: se conservaron en el equipo');
} catch (_) { console.log('       (sin pregunta de SIM)'); }
await s.quieto(2000);

const toasts = await s.toasts();
ok(toasts.some(t => /dados? de baja/.test(t.msg) && t.type === 'ok'), 'toast de baja: ' + JSON.stringify(toasts.map(t => t.msg)));
ok(await p.evaluate(() => document.getElementById('soloRecientes').checked), 'el chip "Baja reciente" quedó prendido');
ok(await p.evaluate(() => document.querySelector('input[name="pocEstadoActivo"][value="todos"]').checked), 'el segmento volvió a "Todos"');
lista = await filas();
ok(lista.length === idsBaja.length && lista.every(f => idsBaja.includes(f.id)), `la lista muestra SOLO los ${idsBaja.length} dados de baja (${lista.length} filas)`);
ok(lista.every(f => !f.activo && /desde \d{2}\/\d{2}\/\d{4} · Falta de pago/.test(f.sub)), 'cada fila dice "desde dd/mm/aaaa · Falta de pago": ' + JSON.stringify(lista[0]?.sub));
await s.captura('03-baja-reciente');

// ── 3. Firestore ──────────────────────────────────────────────────────────
const d0 = await doc(idsBaja[0]);
ok(d0.activo === false && d0.inactivo_desde && d0.inactivo_motivo === 'falta_pago' && d0.inactivo_detalle === 'prueba emulador' && d0.inactivo_por === USUARIOS.recepcion,
  'ficha sellada: ' + JSON.stringify(d0));
const l0 = await logsBaja(idsBaja[0]);
// (>= 1: el reinicio de una corrida anterior no borra sus logs)
ok(l0.length >= 1 && l0.every(l => /Falta de pago — prueba emulador/.test(l.motivo) && l.antes === true && l.despues === false), 'poc_log accion=baja: ' + JSON.stringify(l0));

// El chip combinado con el cliente sigue mostrando los mismos; sin el cliente, también los incluye.
await p.evaluate(() => { document.getElementById('filtroValor').value = ''; });
await p.evaluate(() => PocList.manejarCambioRecientes());
await s.quieto(1500);
const sinCliente = await filas();
ok(idsBaja.every(id => sinCliente.some(f => f.id === id)), `sin texto en el buscador, el chip trae los ${idsBaja.length} (lista: ${sinCliente.length})`);
ok(sinCliente.every(f => !f.activo && f.sub), 'todo lo del chip es inactivo con sello');

// ── 4. Edición en masa: reactivar 2 → pierden el sello ────────────────────
// Teclear no muta el DOM: quieto() no ve el debounce del buscador (300 ms).
await p.type('#filtroValor', CLIENTE);
await new Promise(r => setTimeout(r, 500));
await s.quieto(1000);
const reactivar = idsBaja.slice(0, 2);
await p.evaluate((ids) => {
  document.querySelectorAll('#devicesTable tr[data-id]').forEach(r => { const cb = r.querySelector('.seleccion-sim'); cb.checked = ids.includes(r.dataset.id); cb.dispatchEvent(new Event('change', { bubbles: true })); });
}, reactivar);
ok((await resumenSel()) === `2 de ${idsBaja.length} seleccionados`, `resumen "2 de ${idsBaja.length} seleccionados" (${await resumenSel()})`);
const nToastsAntes = (await s.toasts()).length;
const nErrAntes = s.errores.length;
await p.click('#btnEditarMasivo');
await s.quieto(500);
const diag = await p.evaluate(() => ({ modo: PocBulk._modo, mass: document.querySelectorAll('.mass-activo').length, sel: PocList.obtenerSeleccionados().length }));
console.log('       edición en masa: ' + JSON.stringify(diag) + ' toasts: ' + JSON.stringify((await s.toasts()).slice(nToastsAntes).map(t => t.msg)) + ' errores: ' + JSON.stringify(s.errores.slice(nErrAntes)));
ok(diag.modo && diag.mass === 2, 'Editar en masa convirtió las 2 filas seleccionadas');
await p.evaluate((ids) => {
  document.querySelectorAll('#devicesTable tr[data-id]').forEach(r => { if (ids.includes(r.dataset.id)) r.querySelector('.mass-activo').checked = true; });
}, reactivar);
await p.click('#btnGuardarMasivo');
await p.waitForSelector('.overlay [data-action="confirm"]', { timeout: 5000 });
ok(!(await p.$('#pocBajaMotivo')), 'reactivar no pide motivo (confirmación simple)');
await p.click('.overlay [data-action="confirm"]');
await s.quieto(2500);
const dr = await doc(reactivar[0]);
ok(dr.activo === true && !dr.inactivo_desde && !dr.inactivo_motivo, 'reactivado sin sello: ' + JSON.stringify(dr));
lista = await filas();
ok(lista.length === idsBaja.length - 2 && !lista.some(f => reactivar.includes(f.id)), `el chip ya no los trae (${lista.length} filas)`);
await s.captura('04-tras-reactivar');

// ── 5. Ficha (drawer): quitar Activo pide motivo; cancelar no guarda ──────
await p.click('input[name="pocEstadoActivo"][value="activos"]');
await s.quieto(300);
ok(!(await p.evaluate(() => document.getElementById('soloRecientes').checked)), '"Activos" apaga el chip');
await s.quieto(1200);
lista = await filas();
const objetivo = lista.find(f => reactivar.includes(f.id)) || lista[0];
ok(!!objetivo && objetivo.activo, 'hay un radio activo para la prueba del drawer');
await p.evaluate((id) => { [...document.querySelectorAll('#devicesTable tr[data-id]')].find(r => r.dataset.id === id).querySelector('button[title="Editar equipo"]').click(); }, objetivo.id);
await s.quieto(600);
await p.evaluate(() => { document.getElementById('drawer-activo').checked = false; });
await p.evaluate(() => { PocEdit.guardar(); });
await p.waitForSelector('#pocBajaMotivo', { timeout: 5000 });
await p.click('[data-sheet-action="cancel"]');
await s.quieto(800);
ok((await doc(objetivo.id)).activo === true, 'cancelar el motivo no guarda la baja');
await p.evaluate(() => { PocEdit.guardar(); });
await p.waitForSelector('#pocBajaMotivo', { timeout: 5000 });
await p.select('#pocBajaMotivo', 'devolucion');
await p.click('[data-sheet-action="confirmar"]');
try {
  await p.waitForSelector('.overlay [data-action="cancel"]', { timeout: 4000 });
  await p.click('.overlay [data-action="cancel"]');
} catch (_) { /* sin SIM */ }
await s.quieto(1500);
const dd = await doc(objetivo.id);
ok(dd.activo === false && dd.inactivo_motivo === 'devolucion' && dd.inactivo_desde, 'drawer: baja con sello "devolucion": ' + JSON.stringify(dd));
await s.captura('05-drawer-baja');

const errores = s.errores.filter(e => !/favicon|rebotó a login|clipboard|Clipboard/.test(e));
ok(!errores.length, 'sin errores de consola ' + JSON.stringify(errores.slice(0, 5)));

await s.browser.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
