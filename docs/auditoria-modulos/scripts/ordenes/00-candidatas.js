// Lista órdenes candidatas para el recorrido (solo lectura, SOLO emulador).
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/ordenes/00-candidatas.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('ordenes_de_servicio').orderBy('fecha_creacion', 'desc').limit(400).get();
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const f = (o) => `${o.id} | ${o.tipo_de_servicio || '?'} | ${o.estado_reparacion || '?'} | ${(o.cliente_nombre || o.cliente || '?').toString().slice(0, 28)} | eq=${(o.equipos || []).length} | tec=${o.tecnico_asignado || o.tecnico_nombre || '-'} (${o.tecnico_uid || '-'}) | qc=${o.qc?.resultado || (o.qc_requerido ? 'req' : '-')} | elim=${o.eliminado ? 1 : 0}`;
  const grupos = {};
  for (const o of rows) { if (o.eliminado) continue; const k = `${o.tipo_de_servicio}|${o.estado_reparacion}`; (grupos[k] ||= []).push(o); }
  for (const k of Object.keys(grupos).sort()) { console.log(`\n== ${k} (${grupos[k].length})`); grupos[k].slice(0, 4).forEach(o => console.log('  ' + f(o))); }
  const tecs = await db.collection('usuarios').get();
  console.log('\n== usuarios técnicos');
  tecs.docs.forEach(d => { const u = d.data(); if (/tecnico|jefe/.test(u.rol || '')) console.log(`  ${d.id} ${u.email} ${u.rol} ${u.nombre || ''}`); });
  const total = await db.collection('ordenes_de_servicio').count().get();
  console.log('\ntotal órdenes:', total.data().count);
})().catch(e => { console.error(e); process.exit(1); });
