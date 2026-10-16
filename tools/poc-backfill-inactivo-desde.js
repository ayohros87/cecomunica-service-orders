// Backfill del sello de baja en la Base PoC (Brenda, 2026-10-16).
//
// Desde el 16-oct-2026 cada radio que pasa a inactivo queda sellado en su
// ficha (inactivo_desde / inactivo_por / inactivo_motivo; ver
// public/js/pages/poc-baja.js) y el chip "Baja reciente" los deja solos. Las
// bajas ANTERIORES no tienen sello, pero sí rastro: cada edición escribió en
// poc_logs un `cambios.antes.activo` / `cambios.despues.activo`. Este script
// reconstruye la fecha de la ÚLTIMA baja de cada ficha viva e inactiva y la
// sella con `inactivo_backfill:true` (sin motivo: no se inventa). Así los 16
// radios de UNIDAD MOVIL (y cualquier baja de los últimos 60 días) salen en el
// chip desde el día uno.
//
// Reglas:
//  - Solo fichas VIVAS (deleted != true) e INACTIVAS (activo == false) SIN sello.
//  - La baja válida es el log más reciente con antes.activo truthy y
//    despues.activo === false y despues.deleted !== true (un cierre no es baja).
//  - Si después de esa baja hay un log que la volvió a activar, se ignora esa
//    ficha (la verdad actual no cuadra con el histórico: se revisa a mano).
//  - Ficha sin ningún log de baja: no se toca (nació inactiva o es anterior a
//    los logs). Se cuenta en el resumen.
//
// Por defecto SOLO CUENTA (no escribe). Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../tools/poc-backfill-inactivo-desde.js
//   … --aplicar                 escribe (en el emulador)
//   … --aplicar --produccion    escribe en PRODUCCIÓN (sin FIRESTORE_EMULATOR_HOST)
//   … --cliente "UNIDAD MOVIL"  solo las fichas cuyo cliente contiene ese texto
//   … --csv <ruta>              deja el detalle por ficha en un CSV
const admin = require('firebase-admin');
const fs = require('fs');
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const PRODUCCION = args.includes('--produccion');
const csvRuta = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
const soloCliente = args.includes('--cliente') ? String(args[args.indexOf('--cliente') + 1] || '').toUpperCase() : '';
if (!process.env.FIRESTORE_EMULATOR_HOST && !PRODUCCION) {
  console.error('Sin FIRESTORE_EMULATOR_HOST. Para producción hay que pasar --produccion explícitamente.');
  process.exit(2);
}
if (PRODUCCION && process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('--produccion con FIRESTORE_EMULATOR_HOST puesto: quita uno de los dos.');
  process.exit(2);
}
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();

const ms = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : (t ? new Date(t).getTime() || 0 : 0));
const fecha = (t) => { const n = ms(t); return n ? new Date(n).toISOString().slice(0, 10) : '?'; };
const nombreCliente = (d, cli) => (d.cliente_id && cli.get(d.cliente_id)) || d.cliente_nombre || d.cliente || '';

(async () => {
  const t0 = Date.now();
  const [snap, cliSnap] = await Promise.all([
    db.collection('poc_devices').where('activo', '==', false).get(),
    db.collection('clientes').get(),
  ]);
  const cli = new Map(cliSnap.docs.map(d => [d.id, d.data().nombre]));
  const candidatas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.deleted !== true && !d.inactivo_desde)
    .filter(d => !soloCliente || nombreCliente(d, cli).toUpperCase().includes(soloCliente));
  console.log(`poc_devices inactivas: ${snap.size}; vivas sin sello${soloCliente ? ` del cliente "${soloCliente}"` : ''}: ${candidatas.length} (${Date.now() - t0} ms)`);
  if (!candidatas.length) { console.log('Nada que sellar.'); return; }

  // Logs: un solo barrido con proyección (equipo_id, fecha, usuario, activo
  // antes/después, deleted después). Es más barato que una consulta por ficha.
  const t1 = Date.now();
  const logSnap = await db.collection('poc_logs')
    .select('equipo_id', 'fecha', 'usuario', 'cambios.antes.activo', 'cambios.despues.activo', 'cambios.despues.deleted')
    .get();
  console.log(`poc_logs: ${logSnap.size} (${Date.now() - t1} ms)`);

  // Por ficha: la última baja y el último evento de activo (para detectar una
  // reactivación posterior sin sello).
  const ultimaBaja = new Map();   // equipo_id → { fecha, usuario }
  const ultimoAlta = new Map();   // equipo_id → fecha
  const ids = new Set(candidatas.map(d => d.id));
  for (const doc of logSnap.docs) {
    const l = doc.data();
    const id = l.equipo_id;
    if (!ids.has(id)) continue;
    const antes = l.cambios && l.cambios.antes ? l.cambios.antes.activo : undefined;
    const desp  = l.cambios && l.cambios.despues ? l.cambios.despues : {};
    const f = ms(l.fecha);
    if (!f) continue;
    if (antes && desp.activo === false && desp.deleted !== true) {
      const prev = ultimaBaja.get(id);
      if (!prev || f > prev.fecha) ultimaBaja.set(id, { fecha: f, usuario: l.usuario || null });
    } else if (antes === false && desp.activo === true) {
      if ((ultimoAlta.get(id) || 0) < f) ultimoAlta.set(id, f);
    }
  }

  const sellar = [], sinLog = [], inconsistentes = [];
  for (const d of candidatas) {
    const baja = ultimaBaja.get(d.id);
    if (!baja) { sinLog.push(d); continue; }
    if ((ultimoAlta.get(d.id) || 0) > baja.fecha) { inconsistentes.push({ d, baja }); continue; }
    sellar.push({ d, baja });
  }
  sellar.sort((a, b) => b.baja.fecha - a.baja.fecha);

  const hace60 = Date.now() - 60 * 86400000;
  const recientes = sellar.filter(s => s.baja.fecha >= hace60);
  console.log(`\nA sellar: ${sellar.length} (de ellas ${recientes.length} con baja en los últimos 60 días)`);
  console.log(`Sin log de baja (no se tocan): ${sinLog.length}`);
  console.log(`Inconsistentes (reactivadas después de la última baja; no se tocan): ${inconsistentes.length}`);

  console.log('\nBajas recientes (últimos 60 días):');
  const porCliente = new Map();
  for (const s of recientes) {
    const k = `${fecha(s.baja.fecha)}  ${nombreCliente(s.d, cli)}`;
    porCliente.set(k, (porCliente.get(k) || 0) + 1);
  }
  for (const [k, n] of [...porCliente.entries()].sort()) console.log(`  ${k}: ${n}`);

  if (csvRuta) {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [['estado', 'device_id', 'cliente', 'serial', 'unit_id', 'baja', 'por'].join(',')];
    for (const s of sellar) filas.push(['sellar', s.d.id, nombreCliente(s.d, cli), s.d.serial, s.d.unit_id, fecha(s.baja.fecha), s.baja.usuario].map(esc).join(','));
    for (const s of inconsistentes) filas.push(['inconsistente', s.d.id, nombreCliente(s.d, cli), s.d.serial, s.d.unit_id, fecha(s.baja.fecha), s.baja.usuario].map(esc).join(','));
    for (const d of sinLog) filas.push(['sin_log', d.id, nombreCliente(d, cli), d.serial, d.unit_id, '', ''].map(esc).join(','));
    fs.writeFileSync(csvRuta, '﻿' + filas.join('\r\n'), 'utf8');
    console.log(`\nCSV: ${csvRuta}`);
  }

  if (!APLICAR) { console.log('\n(solo conteo; pasa --aplicar para escribir)'); return; }

  let hechas = 0;
  for (let i = 0; i < sellar.length; i += 400) {
    const batch = db.batch();
    for (const s of sellar.slice(i, i + 400)) {
      batch.update(db.collection('poc_devices').doc(s.d.id), {
        inactivo_desde:   admin.firestore.Timestamp.fromMillis(s.baja.fecha),
        inactivo_por:     s.baja.usuario || null,
        inactivo_backfill: true,
      });
    }
    await batch.commit();
    hechas += Math.min(400, sellar.length - i);
    console.log(`  selladas ${hechas}/${sellar.length}`);
  }
  console.log(`\nListo: ${hechas} fichas selladas en ${Date.now() - t0} ms.`);
})().catch(e => { console.error(e); process.exit(1); });
