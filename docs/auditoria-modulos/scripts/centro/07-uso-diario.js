// uso_diario: páginas vistas hoy por pantalla del módulo clientes/centro y por usuario (solo un día disponible). Solo lectura.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('uso_diario').get();
  console.log('docs uso_diario', snap.size);
  for (const d of snap.docs) {
    const x = d.data();
    const keys = Object.keys(x);
    console.log(d.id, keys.slice(0, 8));
    const s = JSON.stringify(x);
    const m = s.match(/"[^"]*(clientes|centro)[^"]*":\{[^}]*\}/g) || [];
    m.slice(0, 20).forEach(l => console.log('  ', l.slice(0, 300)));
  }
})();
