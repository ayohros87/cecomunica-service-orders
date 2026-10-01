// Saneo de fichas PoC duplicadas por serial (auditoría de módulos 2026-10-01,
// PoC R3 + D10 + P6). Regla de Alberto (1-oct-2026): cuando un serial tiene
// más de una ficha viva, LA BUENA ES LA MÁS RECIENTE; las demás se CIERRAN
// (deleted:true, activo:false, `cierre` con motivo y referencia a la buena),
// nunca se borran. Se cruza con la custodia del pool (equipos_pool) solo para
// informar si coincide; si esa custodia viene de la migración y nadie la
// verificó ni la movió un flujo real, no vale.
//
// Por defecto SOLO CUENTA (no escribe). Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../tools/poc-saneo-duplicados-serial.js
//   … --aplicar            escribe (en el emulador)
//   … --aplicar --produccion   escribe en PRODUCCIÓN (sin FIRESTORE_EMULATOR_HOST). Solo con el OK de Alberto.
//   … --csv <ruta>         además deja el detalle por serial en un CSV
const admin = require('firebase-admin');
const fs = require('fs');
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const PRODUCCION = args.includes('--produccion');
const csvRuta = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
if (!process.env.FIRESTORE_EMULATOR_HOST && !PRODUCCION) {
  console.error('Sin FIRESTORE_EMULATOR_HOST. Para producción hay que pasar --produccion explícitamente (y tener el OK de Alberto).');
  process.exit(2);
}
if (PRODUCCION && process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('--produccion con FIRESTORE_EMULATOR_HOST puesto: quita uno de los dos.');
  process.exit(2);
}
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const USUARIO = 'sistema (saneo duplicados por serial)';

const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const BASURA = new Set(['', 'ND', 'NA', 'CONSOLA', 'SINSERIAL', 'NA0']);
const ms = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : (t ? new Date(t).getTime() || 0 : 0));
const fecha = (t) => { const n = ms(t); return n ? new Date(n).toISOString().slice(0, 10) : '?'; };
const nombreCliente = (d, cli) => (d.cliente_id && cli.get(d.cliente_id)) || d.cliente_nombre || d.cliente || '';
const normNombre = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Movimientos del kardex que establecen una custodia REAL (no heredada).
const MOV_CUSTODIA_REAL = new Set(['asignacion_contrato', 'reasignacion', 'salida_taller', 'correccion_titular', 'entrega', 'devolucion', 'cierre_entrada', 'ingreso_bodega', 'venta']);

(async () => {
  const t0 = Date.now();
  const [snap, cliSnap] = await Promise.all([db.collection('poc_devices').get(), db.collection('clientes').get()]);
  const cli = new Map(cliSnap.docs.map(d => [d.id, d.data().nombre]));
  const vivas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.deleted !== true);
  console.log(`poc_devices: ${snap.size} (vivas ${vivas.length}) en ${Date.now() - t0} ms`);

  // 1) Agrupar por serial normalizado; la buena = la más reciente.
  const porSerial = new Map();
  for (const d of vivas) { const k = norm(d.serial); if (BASURA.has(k)) continue; (porSerial.get(k) || porSerial.set(k, []).get(k)).push(d); }
  const grupos = [...porSerial.entries()].filter(([, a]) => a.length > 1).map(([clave, fichas]) => {
    fichas.sort((a, b) => (ms(b.created_at) - ms(a.created_at)) || String(b.id).localeCompare(String(a.id)));
    return { clave, serial: fichas[0].serial, fichas, buena: fichas[0], sobrantes: fichas.slice(1) };
  }).sort((a, b) => a.clave.localeCompare(b.clave));
  const sobrantes = grupos.reduce((n, g) => n + g.sobrantes.length, 0);
  console.log(`seriales con >1 ficha viva: ${grupos.length} · fichas ${grupos.reduce((n, g) => n + g.fichas.length, 0)} · SOBRANTES A CERRAR: ${sobrantes}`);

  // 2) Cruce con el pool: doc(s) por serial_norm y su kardex.
  const claves = grupos.map(g => g.clave);
  const pool = new Map();
  for (let i = 0; i < claves.length; i += 10) {
    const s = await db.collection('equipos_pool').where('serial_norm', 'in', claves.slice(i, i + 10)).get();
    s.docs.forEach(d => { const x = { id: d.id, ref: d.ref, ...d.data() }; (pool.get(x.serial_norm) || pool.set(x.serial_norm, []).get(x.serial_norm)).push(x); });
  }
  const C = { sinPool: 0, coincideId: 0, coincideNombre: 0, noCoincide: 0, sinCustodia: 0, migracionSinVerificar: 0, migracionSinMovReal: 0, migracionNoValeAmbas: 0, coincideYvale: 0, dosActivas: 0, buenaInactiva: 0, sobrantesConSim: 0, sobrantesActivas: 0, mismoCliente: 0 };
  const filas = [];
  let kardexLeidos = 0;
  for (const g of grupos) {
    const docs = pool.get(g.clave) || [];
    const ids = new Set(g.fichas.map(f => f.id));
    const eq = docs.find(x => x.poc_device_id && ids.has(x.poc_device_id)) || docs.find(x => x.estado === 'en_cliente') || docs[0] || null;
    const activas = g.fichas.filter(f => f.activo !== false).length;
    if (activas > 1) C.dosActivas++;
    if (g.buena.activo === false) C.buenaInactiva++;
    C.sobrantesConSim += g.sobrantes.filter(f => String(f.sim_number || '').trim()).length;
    C.sobrantesActivas += g.sobrantes.filter(f => f.activo !== false).length;
    if (new Set(g.fichas.map(f => f.cliente_id || 'n:' + normNombre(nombreCliente(f, cli)))).size === 1) C.mismoCliente++;
    const fila = { serial: g.serial, fichas: g.fichas.length, activas, buena_id: g.buena.id, buena_cliente: nombreCliente(g.buena, cli), buena_creada: fecha(g.buena.created_at),
      sobrantes: g.sobrantes.map(f => `${f.id}:${nombreCliente(f, cli)}:${f.activo === false ? 'inact' : 'ACT'}:${fecha(f.created_at)}`).join(' | '),
      pool: '', pool_cliente: '', coincide: '', custodia_vale: '' };
    if (!eq) { C.sinPool++; fila.pool = 'sin doc'; filas.push(fila); continue; }
    fila.pool = eq.estado || '';
    const a = eq.asignacion || null;
    fila.pool_cliente = a?.cliente_nombre || '';
    // ¿La custodia es heredada de la migración? Dos lecturas: (a) origen
    // migración y no verificado; (b) además ningún movimiento real en el kardex.
    const esMigracion = String(eq.origen || '').startsWith('migracion');
    let movReal = true;
    if (esMigracion) {
      const mov = await eq.ref.collection('movimientos').get(); kardexLeidos++;
      movReal = mov.docs.some(m => MOV_CUSTODIA_REAL.has(m.data().tipo));
    }
    const noValeA = esMigracion && eq.verificado !== true;
    const noValeB = esMigracion && !movReal;
    if (noValeA) C.migracionSinVerificar++;
    if (noValeB) C.migracionSinMovReal++;
    if (noValeA && noValeB) C.migracionNoValeAmbas++;
    fila.custodia_vale = noValeB ? 'NO (migración sin movimiento real)' : (noValeA ? 'dudosa (migración sin verificar, con movimiento real)' : 'sí');
    if (!a || !(a.cliente_id || a.cliente_nombre)) { C.sinCustodia++; fila.coincide = 'sin custodia'; filas.push(fila); continue; }
    const idOk = !!(a.cliente_id && g.buena.cliente_id && a.cliente_id === g.buena.cliente_id);
    const nomOk = !!a.cliente_nombre && normNombre(a.cliente_nombre) === normNombre(nombreCliente(g.buena, cli));
    if (idOk) C.coincideId++; else if (nomOk) C.coincideNombre++; else C.noCoincide++;
    fila.coincide = (idOk || nomOk) ? 'sí' : 'NO';
    if ((idOk || nomOk) && !noValeB) C.coincideYvale++;
    filas.push(fila);
  }
  console.log(`\nCruce con el pool (${kardexLeidos} kardex leídos):`);
  console.log(`  sin doc en el pool: ${C.sinPool}`);
  console.log(`  con doc pero sin custodia (asignacion vacía): ${C.sinCustodia}`);
  console.log(`  la MÁS RECIENTE coincide con la custodia del pool: ${C.coincideId + C.coincideNombre} (por id ${C.coincideId}, por nombre ${C.coincideNombre})`);
  console.log(`  NO coincide (el pool dice otro cliente): ${C.noCoincide}`);
  console.log(`  custodia heredada de la migración: sin verificar ${C.migracionSinVerificar} · sin ningún movimiento real en el kardex ${C.migracionSinMovReal} · ambas ${C.migracionNoValeAmbas}`);
  console.log(`  coincide Y la custodia vale (hay movimiento real): ${C.coincideYvale}`);
  console.log(`\nGrupos: con 2+ activas ${C.dosActivas} · la más reciente está INACTIVA ${C.buenaInactiva} · todas del mismo cliente ${C.mismoCliente}`);
  console.log(`Sobrantes: activas ${C.sobrantesActivas} · con SIM ${C.sobrantesConSim} (el SIM se queda en la ficha cerrada)`);
  console.log('\nEjemplos:', filas.slice(0, 5).map(f => `${f.serial}: buena ${f.buena_cliente} (${f.buena_creada}) · pool ${f.pool} ${f.pool_cliente} · coincide ${f.coincide} · vale ${f.custodia_vale}`).join('\n  '));
  if (csvRuta) {
    const cab = Object.keys(filas[0] || {});
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    fs.writeFileSync(csvRuta, [cab.join(','), ...filas.map(f => cab.map(k => esc(f[k])).join(','))].join('\n'), 'utf8');
    console.log(`CSV: ${csvRuta} (${filas.length} filas)`);
  }

  if (!APLICAR) { console.log(`\nSolo conteo. Con --aplicar se cerrarían ${sobrantes} fichas.`); return; }

  // 3) Aplicar: cerrar sobrantes por tandas de 200 (update + log en la misma tanda).
  const FV = admin.firestore.FieldValue;
  const items = [];
  for (const g of grupos) {
    const clienteBuena = nombreCliente(g.buena, cli) || '(sin cliente)';
    for (const f of g.sobrantes) items.push({ f, motivo: `Duplicado por serial: se queda la ficha más reciente (${clienteBuena}, creada ${fecha(g.buena.created_at)})`, ref: { tipo: 'poc_device', id: g.buena.id, label: `ficha ${g.serial} · ${clienteBuena}` } });
  }
  let cerradas = 0;
  for (let i = 0; i < items.length; i += 200) {
    const batch = db.batch();
    for (const { f, motivo, ref } of items.slice(i, i + 200)) {
      const { id, ...antes } = f;
      batch.update(db.collection('poc_devices').doc(id), {
        deleted: true, activo: false,
        cierre: { at: new Date(), motivo, ref, sim_number: f.sim_number || '', sim_phone: f.sim_phone || '', operador: f.operador || '', por: USUARIO },
        updated_at: FV.serverTimestamp(), updated_by: null, updated_by_email: USUARIO,
      });
      batch.set(db.collection('poc_logs').doc(), { equipo_id: id, fecha: FV.serverTimestamp(), usuario: USUARIO, accion: 'eliminar', origen: 'duplicados', motivo, ref, cambios: { antes, despues: { deleted: true, activo: false } } });
    }
    await batch.commit();
    cerradas += Math.min(200, items.length - i);
    console.log(`  cerradas ${cerradas}/${items.length}`);
  }
  console.log(`\nLISTO: ${cerradas} fichas sobrantes cerradas en ${PRODUCCION ? 'PRODUCCIÓN' : 'el emulador'}.`);
})().catch(e => { console.error(e); process.exit(1); });
