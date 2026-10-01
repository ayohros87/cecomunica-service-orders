// Qué mueve bodega de verdad: kardex del pool (equipos_pool/*/movimientos) de
// los últimos 30 días, por tipo y por quién. Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/almacen/05-movimientos-30d.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Solo contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const desde = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86400000);
  const snap = await db.collectionGroup('movimientos').where('at', '>=', desde).get();
  const porTipo = {}, porQuien = {}, porQuienTipo = {}, porDia = {};
  snap.forEach(d => {
    const m = d.data(); if (/PRUEBA-AUDIT/.test(m.notas || '')) return;
    const q = (m.por_email || m.por || m.uid || 'sistema').replace(/@.*/, '');
    porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1;
    porQuien[q] = (porQuien[q] || 0) + 1;
    porQuienTipo[q + ' · ' + m.tipo] = (porQuienTipo[q + ' · ' + m.tipo] || 0) + 1;
    const dia = m.at?.toDate?.().toISOString().slice(0, 10); if (dia) porDia[dia] = (porDia[dia] || 0) + 1;
  });
  const top = (o, n = 25) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log('movimientos 30 días:', snap.size);
  console.log('por tipo:', top(porTipo));
  console.log('por quién:', top(porQuien, 12));
  console.log('por quién · tipo:', top(porQuienTipo, 30));
  console.log('días con actividad:', Object.keys(porDia).length, '· máx/día', top(porDia, 5));
  const uno = snap.docs.find(d => d.data().por_email); console.log('campos de un movimiento:', Object.keys(uno?.data() || {}).join(', '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
