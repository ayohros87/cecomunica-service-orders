// ¿Los avisos cerrados tienen updated_at? (listCerrados ordena por ese campo: sin él, no salen).
// Solo lectura sobre el EMULADOR. Correr desde functions/ con FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('facturacion_avisos').get();
  const r = { cerrados: 0, cerradosSinUpdatedAt: 0, abiertos: 0, abiertosSinUpdatedAt: 0, fuenteSiembra: 0, qboHechoPorPersonaSinNumero: 0, diasAbiertos: [] };
  snap.forEach(d => { const x = d.data(); if (String(d.id).includes('PRUEBA-AUDIT')) return;
    const cerrado = ['hecho', 'descartado'].includes(x.estado);
    if (cerrado) { r.cerrados++; if (!x.updated_at) r.cerradosSinUpdatedAt++; } else { r.abiertos++; if (!x.updated_at) r.abiertosSinUpdatedAt++;
      const f = x.fecha_efectiva?.toDate?.(); if (f && x.estado === 'pendiente') r.diasAbiertos.push(Math.floor((Date.now() - f) / 864e5)); }
    const q = x.pasos?.qbo; if (q?.fuente === 'siembra') r.fuenteSiembra++; if (q?.hecho && !q.factura && q.fuente !== 'siembra') r.qboHechoPorPersonaSinNumero++; });
  r.diasAbiertos.sort((a, b) => b - a);
  console.log(r);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
