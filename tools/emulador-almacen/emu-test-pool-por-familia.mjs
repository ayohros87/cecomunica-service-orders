// Lista avanzada por FAMILIA de modelo y grupos del PoC por delta (eficiencia
// de lecturas, 2026-11-11). Bodega bajaba el pool entero (7,860 fichas) cada
// vez que saltaba de Existencias a la lista de UN modelo, y Administración ·
// Grupos bajaba todo poc_devices en cada apertura. Contra el emulador sembrado:
//   firebase emulators:start --only auth,firestore,hosting
//   node emu-test-pool-por-familia.mjs
import { createRequire } from 'node:module';
import { abrir, USUARIOS, BASE } from './emu-lib.mjs';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const require = createRequire('C:/Projects/cecomunica-service-orders/functions/package.json');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Panama' });
const usoPool = async () => {
  const d = (await db.collection('uso_diario').doc(hoy()).get()).data() || {};
  return Object.fromEntries(Object.entries(d.acciones || {}).filter(([k]) => k.startsWith('almacen.pool-completo.')));
};
const tight = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const famKey = (m) => tight(`${m.marca || ''} ${m.modelo || ''}`.trim()).replace(/r$/, '');

// Gancho: toda lectura de una colección ENTERA (sin filtro) queda anotada.
const gancho = (s) => s.page.evaluateOnNewDocument(() => {
  window.__enteras = [];
  const t = setInterval(() => {
    const fs = window.firebase && firebase.firestore;
    if (!fs || !fs.Query || fs.Query.prototype.__cazado) return;
    clearInterval(t);
    const Q = fs.Query.prototype;
    for (const m of ['get', 'onSnapshot']) {
      const orig = Q[m];
      Q[m] = function (...a) {
        const soloCache = m === 'get' && a[0] && a[0].source === 'cache';
        if (this instanceof fs.CollectionReference && !soloCache) window.__enteras.push(this.id);
        return orig.apply(this, a);
      };
    }
    Q.__cazado = true;
  }, 5);
});
const enteras = (s, col) => s.page.evaluate((c) => (window.__enteras || []).filter(x => x === c).length, col);
const quieto = async (s, cond, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await s.page.evaluate(cond)) return true; await espera(250); }
  return false;
};

// ── Verdad del emulador: la familia con más fichas repartidas en ubicaciones ──
const [modSnap, poolSnap] = await Promise.all([db.collection('modelos').get(), db.collection('equipos_pool').get()]);
const modelos = modSnap.docs.map(d => ({ id: d.id, ...d.data() }));
const fams = new Map();
for (const m of modelos.filter(x => x.activo !== false)) { const k = famKey(m); if (!k) continue; (fams.get(k) || fams.set(k, new Set()).get(k)).add(m.id); }
for (const m of modelos.filter(x => x.activo === false)) { const f = fams.get(famKey(m)); if (f) f.add(m.id); }
const pool = poolSnap.docs.map(d => ({ id: d.id, ...d.data() }));
let mejor = null;
for (const [k, ids] of fams) {
  const docs = pool.filter(u => ids.has(u.modelo_id));
  const estados = new Set(docs.map(u => u.estado));
  if (docs.some(u => u.estado === 'en_bodega') && docs.some(u => u.estado === 'en_cliente')
    && (!mejor || estados.size > mejor.estados || (estados.size === mejor.estados && docs.length > mejor.docs.length))) {
    mejor = { k, ids, docs, estados: estados.size };
  }
}
if (!mejor) { console.error('No hay una familia con fichas en bodega y en cliente: ¿emulador sembrado?'); process.exit(2); }
const n = (estado) => mejor.docs.filter(u => u.estado === estado).length;
const modeloId = [...mejor.ids][0];
console.log(`Familia de prueba: ${mejor.k} — ${mejor.docs.length} fichas de ${pool.length} (bodega ${n('en_bodega')}, cliente ${n('en_cliente')})`);
const usoAntes = await usoPool();

// ── 1. De Existencias a la lista de UN modelo: sin bajar el pool ──
console.log('\n1. Existencias → "+N más" de un modelo');
const s = await abrir({ email: USUARIOS.inventario, carpeta: 'pool-familia' });
await gancho(s);
await s.page.goto(BASE + '/almacen/index.html?tab=existencias', { waitUntil: 'domcontentloaded' });
ok(await quieto(s, () => document.querySelectorAll('#tab-existencias tbody tr').length > 3), 'Existencias pinta sus filas');
await s.page.evaluate((id) => AlmacenPage.abrirAvanzado({ estado: 'en_bodega', modelo: id }), modeloId);
ok(await quieto(s, () => window.EquiposPool && EquiposPool._cargadoFamilia && document.querySelectorAll('#eqTabla tr').length > 0
  && !/Cargando|Buscando/.test(document.getElementById('eqTabla').textContent)), 'la lista avanzada carga la familia');
const v1 = await s.page.evaluate(() => ({
  fam: EquiposPool._cargadoFamilia, completo: EquiposPool._completo, enMemoria: EquiposPool._equipos.length,
  filtrados: EquiposPool._filtrados().length, tab: EquiposPool._tab,
  bodega: document.getElementById('countBodega').textContent, cliente: document.getElementById('countCliente').textContent,
  todos: document.getElementById('countTodos').textContent,
  porClasificar: document.getElementById('colaPorClasificar').textContent,
}));
ok(await enteras(s, 'equipos_pool') === 0, 'NO se leyó equipos_pool entero');
ok(v1.fam === mejor.k && v1.completo === false, `modo familia (${v1.fam})`);
ok(v1.enMemoria === mejor.docs.length, `en memoria solo la familia: ${v1.enMemoria} de ${pool.length} (esperado ${mejor.docs.length})`);
ok(v1.tab === 'en_bodega' && v1.filtrados === n('en_bodega'), `pestaña Bodega con ${v1.filtrados} fichas (esperado ${n('en_bodega')})`);
ok(v1.bodega === `(${n('en_bodega').toLocaleString('es-PA')})` && v1.cliente === `(${n('en_cliente').toLocaleString('es-PA')})`
  && v1.todos === `(${mejor.docs.length.toLocaleString('es-PA')})`, `contadores de pestaña de la familia: ${v1.bodega} ${v1.cliente} ${v1.todos}`);
const globalPC = pool.filter(u => u.estado === 'por_clasificar').length;
ok(Number(v1.porClasificar.replace(/\D/g, '')) === globalPC, `tarjeta "Por clasificar" sigue siendo global: ${v1.porClasificar} (esperado ${globalPC})`);

// ── 2. Cambiar de pestaña y buscar dentro de la familia: sin otra carga ──
console.log('\n2. Pestañas y búsqueda dentro de la familia');
await s.page.evaluate(() => EquiposPool.setTab('en_cliente'));
await espera(600);
const v2 = await s.page.evaluate(() => ({ filtrados: EquiposPool._filtrados().length, fam: EquiposPool._cargadoFamilia }));
ok(v2.filtrados === n('en_cliente') && v2.fam === mejor.k, `En cliente: ${v2.filtrados} (esperado ${n('en_cliente')})`);
const conCliente = mejor.docs.find(u => u.estado === 'en_cliente' && (u.asignacion?.cliente_nombre || '').length > 4);
if (conCliente) {
  const q = conCliente.asignacion.cliente_nombre.toLowerCase().slice(0, 12);
  const esperado = mejor.docs.filter(u => [u.serial, u.serial_norm, u.modelo_label, u.asignacion?.cliente_nombre, u.asignacion?.contrato_id, u.notas]
    .map(x => (x || '').toString().toLowerCase()).join(' ').includes(q)).length;
  await s.page.evaluate((t) => { document.getElementById('eqBusqueda').value = t; EquiposPool.render(); }, q);
  await espera(800);
  const v3 = await s.page.evaluate(() => EquiposPool._filtrados().length);
  ok(v3 === esperado, `búsqueda por cliente "${q}" dentro de la familia: ${v3} (esperado ${esperado})`);
  await s.page.evaluate(() => { document.getElementById('eqBusqueda').value = ''; EquiposPool.render(); });
  await espera(400);
}
ok(await enteras(s, 'equipos_pool') === 0, 'sigue sin leerse equipos_pool entero');

// ── 3. Quitar el filtro de modelo: vuelve al modo por pestaña ──
console.log('\n3. Quitar el filtro de modelo');
await s.page.evaluate(() => EquiposPool.quitarFiltro('modelo'));
ok(await quieto(s, () => EquiposPool._cargadoEstado === 'en_cliente' && !/Cargando/.test(document.getElementById('eqTabla').textContent)), 'vuelve a cargar solo la pestaña');
const globalCliente = pool.filter(u => u.estado === 'en_cliente').length;
const v4 = await s.page.evaluate(() => ({ filtrados: EquiposPool._filtrados().length, fam: EquiposPool._cargadoFamilia }));
ok(v4.filtrados === globalCliente && !v4.fam, `En cliente sin filtro: ${v4.filtrados} (esperado ${globalCliente})`);
ok(await enteras(s, 'equipos_pool') === 0, 'tampoco aquí se leyó el pool entero');
const usoMedio = await usoPool();
ok(JSON.stringify(usoMedio) === JSON.stringify(usoAntes), 'ninguna anotación almacen.pool-completo.* hasta aquí');

// ── 4. Control: un filtro que SÍ necesita el pool lo baja y lo deja anotado ──
console.log('\n4. Control: filtro de propiedad');
await s.page.evaluate(() => { document.getElementById('eqFiltroPropiedad').value = 'cliente'; EquiposPool.render(); });
ok(await quieto(s, () => EquiposPool._completo === true), 'el filtro de propiedad carga el pool completo');
ok(await enteras(s, 'equipos_pool') === 1, 'una lectura de equipos_pool entero');
await espera(1500);
const usoFin = await usoPool();
ok((usoFin['almacen.pool-completo.propiedad'] || 0) === (usoAntes['almacen.pool-completo.propiedad'] || 0) + 1,
  `quedó anotado el motivo: ${JSON.stringify(usoFin)}`);
// Con el pool entero en memoria, el filtro de modelo es EXACTO por fila del catálogo.
await s.page.evaluate((k) => { document.getElementById('eqFiltroPropiedad').value = ''; document.getElementById('eqFiltroModelo').value = k; EquiposPool.setTab('todos'); }, mejor.k);
await espera(800);
const v5 = await s.page.evaluate(() => EquiposPool._filtrados().length);
ok(v5 === mejor.docs.length, `filtro de modelo con el pool en memoria: ${v5} (esperado ${mejor.docs.length}; sin las fichas sin modelo ni modelos parecidos)`);
console.log('  errores de consola:', s.errores.slice(0, 5));
await s.browser.close();

// ── 5. Administración · Grupos: sin bajar poc_devices entero ──
console.log('\n5. Administración · Grupos');
const vivas = (await db.collection('poc_devices').where('deleted', '!=', true).orderBy('deleted').orderBy('created_at', 'desc').get())
  .docs.map(d => d.data());
const conGrupos = new Set(vivas.filter(d => d.cliente_id && (Array.isArray(d.grupos) ? d.grupos : []).some(g => String(g || '').trim())).map(d => d.cliente_id));
const a = await abrir({ email: USUARIOS.admin, carpeta: 'pool-familia' });
await gancho(a);
for (const vuelta of [1, 2]) {
  await a.page.goto(BASE + '/admin/grupos.html', { waitUntil: 'domcontentloaded' });
  ok(await quieto(a, () => window.PocService && document.body.innerText.length > 200), `vuelta ${vuelta}: la página abre`);
  await espera(4000);
  const r = await a.page.evaluate(async () => {
    const c = await PocService.getClientesConGrupos({ fresh: true });
    return { ids: c.ids.size, marca: localStorage.getItem('poc_vivas_sync_v1') };
  });
  ok(r.ids === conGrupos.size, `vuelta ${vuelta}: ${r.ids} clientes con grupos (esperado ${conGrupos.size})`);
  ok(await enteras(a, 'poc_devices') === 0, `vuelta ${vuelta}: NO se leyó poc_devices entero`);
  if (vuelta === 1) ok(!!r.marca, 'quedó la marca de sincronización para la próxima vez');
}
await espera(1500);
const usoPoc = Object.fromEntries(Object.entries(((await db.collection('uso_diario').doc(hoy()).get()).data() || {}).acciones || {}).filter(([k]) => k.startsWith('poc.vivas.')));
console.log('  telemetría del PoC:', JSON.stringify(usoPoc));
console.log('  errores de consola:', a.errores.slice(0, 5));
await a.browser.close();

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
