// Export SOLO LECTURA de producción para sembrar el emulador (espacio Almacén).
// Correr desde functions/: NODE_PATH=./node_modules node <este archivo>
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const SALIDA = path.join(__dirname, 'emu-data.json');
const COLS = ['usuarios', 'empresa', 'modelos', 'agregados_pool', 'inventario_actual', 'equipos_pool', 'contratos',
  'gestiones', 'clientes', 'equipos_descartados', 'equipos_condiciones', 'cobros_equipos', 'inventario_piezas'];

function ser(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof admin.firestore.Timestamp) return { __ts: v.toDate().toISOString() };
  if (v instanceof admin.firestore.DocumentReference) return { __ref: v.path };
  if (v instanceof admin.firestore.GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (Array.isArray(v)) return v.map(ser);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = ser(v[k]); return o; }
  return v;
}
(async () => {
  const out = {};
  let total = 0;
  for (const c of COLS) {
    const snap = await db.collection(c).get();
    out[c] = snap.docs.map(d => ({ id: d.id, data: ser(d.data()) }));
    total += snap.size;
    console.log(c.padEnd(22), snap.size);
  }
  fs.writeFileSync(SALIDA, JSON.stringify(out));
  console.log(`total ${total} docs → ${SALIDA} (${Math.round(fs.statSync(SALIDA).size / 1024)} KB)`);
})().catch(e => { console.error(e); process.exit(1); });
