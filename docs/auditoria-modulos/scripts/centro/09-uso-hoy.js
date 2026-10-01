// Páginas vistas HOY (uso_diario solo tiene un día) del módulo clientes. Solo lectura.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const d = await db.collection('uso_diario').doc('2026-09-30').get();
  const x = d.data();
  const pag = x.paginas || {};
  for (const [k, v] of Object.entries(pag)) if (/clientes|contratos/.test(k)) console.log(k, JSON.stringify(v).slice(0, 200));
  const us = x.usuarios || {};
  for (const [k, v] of Object.entries(us)) { const s = JSON.stringify(v); if (/clientes/.test(s)) console.log('USR', k, s.slice(0, 300)); }
})();
