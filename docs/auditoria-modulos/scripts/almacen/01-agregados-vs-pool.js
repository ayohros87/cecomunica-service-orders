// ¿Los números que muestra Existencias (agregados_pool) son los del pool?
// Compara, contra el EMULADOR, el resumen por modelo con el conteo real de
// equipos_pool (export de producción del 2026-09-30). Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/almacen/01-agregados-vs-pool.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Solo contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const [pool, ag, modelos] = await Promise.all([db.collection('equipos_pool').get(), db.collection('agregados_pool').get(), db.collection('modelos').get()]);
  const real = new Map();   // key (modelo_id o label) → {est}
  const key = (id, label) => id || ('label:' + String(label || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  pool.forEach(d => { const x = d.data(); if (String(x.notas || '').includes('PRUEBA-AUDIT')) return;
    const k = key(x.modelo_id, x.modelo_label); const g = real.get(k) || { label: x.modelo_label, est: {} }; g.est[x.estado] = (g.est[x.estado] || 0) + 1; real.set(k, g); });
  const agg = new Map(); ag.forEach(d => { const x = d.data(); agg.set(key(x.modelo_id, x.modelo_label), { label: x.modelo_label, est: x.est || {}, at: x.actualizado_en?.toDate?.() }); });
  const tot = (m, e) => [...m.values()].reduce((s, g) => s + (g.est[e] || 0), 0);
  for (const e of ['en_bodega', 'asignado_contrato', 'en_cliente', 'en_taller', 'devuelto_revision', 'por_clasificar', 'vendido', 'baja', 'no_retirado', 'pendiente_cobro']) console.log(e.padEnd(20), 'pool', String(tot(real, e)).padStart(5), 'agregado', String(tot(agg, e)).padStart(5), tot(real, e) === tot(agg, e) ? '' : '  <-- DIFIERE');
  let difs = 0; const fechas = new Set();
  for (const [k, g] of real) { const a = agg.get(k); if (a?.at) fechas.add(a.at.toISOString().slice(0, 16));
    for (const e of new Set([...Object.keys(g.est), ...Object.keys(a?.est || {})])) { if ((g.est[e] || 0) !== (a?.est?.[e] || 0)) { difs++; if (difs <= 15) console.log('  dif', g.label || k, e, 'pool', g.est[e] || 0, 'agregado', a?.est?.[e] || 0); } } }
  console.log('modelos con alguna diferencia (celdas):', difs, '· fechas de actualización del agregado:', [...fechas].join(', '));
  console.log('modelos catálogo', modelos.size, '· grupos en pool', real.size, '· docs agregados', ag.size);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
