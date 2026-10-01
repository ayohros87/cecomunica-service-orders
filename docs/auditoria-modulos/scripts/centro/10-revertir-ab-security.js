// El recorrido 04 cambió por error el vendedor de AB SECURITY (primera fila del grid) en el EMULADOR. Esto lo devuelve a Alondra.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const us = await db.collection('usuarios').get();
  const al = us.docs.find(d => d.data().email === 'alondra.acevedo@cecomunica.com');
  const q = await db.collection('clientes').where('nombre', '==', 'AB SECURITY').get();
  for (const d of q.docs) {
    console.log('antes', d.id, d.data().vendedor_email);
    await d.ref.update({ vendedor_asignado: al.id, vendedor_email: al.data().email });
    console.log('revertido a', al.data().email);
  }
})();
