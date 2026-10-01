// Siembra el emu-data.json de emu-export-todo.js en los emuladores (Firestore 8080, Auth 9099).
// Correr desde functions/ con:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 NODE_PATH=./node_modules node ../tools/emulador-almacen/emu-seed-todo.js
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('FALTA FIRESTORE_EMULATOR_HOST — no se siembra producción'); process.exit(2); }
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'emu-data.json'), 'utf8'));

function des(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(des);
  if (typeof v === 'object') {
    if (v.__ts) return admin.firestore.Timestamp.fromDate(new Date(v.__ts));
    if (v.__ref) return db.doc(v.__ref);
    if (v.__geo) return new admin.firestore.GeoPoint(v.__geo[0], v.__geo[1]);
    const o = {}; for (const k of Object.keys(v)) o[k] = des(v[k]); return o;
  }
  return v;
}
(async () => {
  let total = 0;
  for (const [col, docs] of Object.entries(data)) {
    for (let i = 0; i < docs.length; i += 400) {
      const b = db.batch();
      docs.slice(i, i + 400).forEach(d => b.set(d.path ? db.doc(d.path) : db.collection(col).doc(d.id), des(d.data)));
      await b.commit();
    }
    total += docs.length;
    console.log(col.padEnd(34), docs.length);
  }
  let creados = 0;
  for (const u of data.usuarios) {
    const email = (u.data.email || `${u.id}@test.local`).toLowerCase();
    try { await admin.auth().createUser({ uid: u.id, email, password: 'emulador123', displayName: u.data.nombre || '' }); creados++; }
    catch (e) { console.warn('auth', u.id, e.message); }
  }
  console.log(`total ${total} docs · ${creados} usuarios de auth`);
  console.log('usuarios (uid · email · rol · nombre):');
  for (const u of data.usuarios) console.log(`  ${u.id} · ${(u.data.email || u.id + '@test.local').toLowerCase()} · ${u.data.rol} · ${u.data.nombre || ''}${u.data.activo === false ? ' (inactivo)' : ''}`);
})().catch(e => { console.error(e); process.exit(1); });
