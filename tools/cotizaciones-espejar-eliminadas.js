// Saneo del espejo público de cotizaciones ELIMINADAS (auditoría de módulos
// 2026-09-30, Cotizaciones R1). Hasta el 2026-10-02 `softDelete` solo marcaba
// la cotización; el espejo cotizacion_verificaciones/{id} (lo que abre el
// cliente desde el enlace del correo) seguía "Vigente" con el panel
// "¿Aceptas?". Desde esa fecha la app espeja `deleted`; este script pone al
// día los espejos de las que ya estaban eliminadas: `deleted:true` +
// `deleted_at`. No borra nada (el espejo no admite delete en rules) y no toca
// la cotización.
//
// Por defecto SOLO CUENTA (no escribe). Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../tools/cotizaciones-espejar-eliminadas.js
//   … --aplicar                escribe (en el emulador)
//   … --aplicar --produccion   escribe en PRODUCCIÓN (sin FIRESTORE_EMULATOR_HOST). Solo con el OK de Alberto.
const admin = require('firebase-admin');
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const PRODUCCION = args.includes('--produccion');
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

(async () => {
  const t0 = Date.now();
  const cots = await db.collection('cotizaciones').where('deleted', '==', true).get();
  const filas = [];
  for (const d of cots.docs) {
    const e = await db.collection('cotizacion_verificaciones').doc(d.id).get();
    if (!e.exists) continue;                       // nunca se envió: no hay enlace que cerrar
    const v = e.data();
    filas.push({ id: d.id, num: d.data().cotizacion_id || d.id, estado: d.data().estado || 'borrador', espejoEstado: v.estado || null, marcado: v.deleted === true });
  }
  const pendientes = filas.filter(f => !f.marcado);
  console.log(`cotizaciones eliminadas: ${cots.size} · con espejo público: ${filas.length} · espejo sin marca deleted: ${pendientes.length} (${Date.now() - t0} ms)`);
  for (const f of pendientes) console.log(`  ${f.num}  estado=${f.estado}  espejo.estado=${f.espejoEstado ?? '—'}`);
  if (!APLICAR) { console.log('\nSolo conteo. Pasa --aplicar para escribir.'); return; }
  let n = 0;
  for (const f of pendientes) {
    await db.collection('cotizacion_verificaciones').doc(f.id).update({ deleted: true, deleted_at: admin.firestore.FieldValue.serverTimestamp() });
    n++;
  }
  console.log(`\nEspejos marcados como eliminados: ${n}`);
})().catch((e) => { console.error(e); process.exit(1); });
