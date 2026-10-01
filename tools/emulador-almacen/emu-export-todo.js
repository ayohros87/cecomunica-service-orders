// Export SOLO LECTURA de producción para sembrar el emulador con TODO el app
// (auditoría de módulos 2026-09-30). Correr desde functions/:
//   NODE_PATH=./node_modules node ../tools/emulador-almacen/emu-export-todo.js
// Escribe emu-data.json (en .gitignore: datos reales, nunca al repo).
// Formato: { "<coleccion>": [{id, data}], "__group__/<sub>": [{path, data}] }
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const SALIDA = path.join(__dirname, 'emu-data.json');
const OMITIR = new Set(['qbo_webhook_events', 'mail_queue', 'integraciones', 'integraciones_qbo_oauth_states']);
const SUBS = ['documentos', 'historial', 'ordenes', 'seriales', 'seriales_cambios', 'seriales_estado', 'seriales_historial',
  'movimientos', 'eventos', 'mapeos', 'mensual', 'semanal', 'consumos', 'equipos_meta', 'borradores_cotizacion', 'firmas', 'notas', 'fotos', 'cancelaciones'];

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
  for (const c of await db.listCollections()) {
    if (OMITIR.has(c.id)) { console.log(c.id.padEnd(30), '(omitida)'); continue; }
    const snap = await c.get();
    out[c.id] = snap.docs.map(d => ({ id: d.id, data: ser(d.data()) }));
    total += snap.size;
    console.log(c.id.padEnd(30), snap.size);
  }
  for (const s of SUBS) {
    const snap = await db.collectionGroup(s).get();
    // solo documentos anidados (los de nivel superior ya salieron arriba)
    const docs = snap.docs.filter(d => d.ref.path.split('/').length > 2);
    if (!docs.length) continue;
    out['__group__/' + s] = docs.map(d => ({ path: d.ref.path, data: ser(d.data()) }));
    total += docs.length;
    console.log(('  */' + s).padEnd(30), docs.length);
  }
  fs.writeFileSync(SALIDA, JSON.stringify(out));
  console.log(`total ${total} docs → ${SALIDA} (${Math.round(fs.statSync(SALIDA).size / 1024)} KB)`);
})().catch(e => { console.error(e); process.exit(1); });
