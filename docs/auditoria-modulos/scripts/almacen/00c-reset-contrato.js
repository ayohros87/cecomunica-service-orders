// Deja el contrato de prueba PRUEBA-AUDIT-almacen-01 como al sembrar (sin
// seriales, seriales_estado pendiente) para repetir 03-asignar-lector.mjs.
// Solo toca datos PRUEBA-AUDIT. Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/almacen/00c-reset-contrato.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Solo contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const id = process.argv[2] || 'PRUEBA-AUDIT-almacen-01';
  if (!/^PRUEBA-AUDIT-almacen/.test(id)) { console.error('solo contratos PRUEBA-AUDIT-almacen'); process.exit(1); }
  const ref = db.collection('contratos').doc(id);
  let n = 0;
  for (const sub of ['seriales', 'seriales_estado']) { const s = await ref.collection(sub).get(); for (const d of s.docs) { await d.ref.delete(); n++; } }
  await ref.update({ seriales_estado: 'pendiente' });
  console.log('reset contrato ok · borrados', n);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
