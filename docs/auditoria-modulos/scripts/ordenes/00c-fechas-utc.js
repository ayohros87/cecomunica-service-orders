// Cuenta órdenes cuya fecha_creacion cae en otro día en UTC que en hora de Panamá (UTC-5):
// la bandeja e imprimir-orden pintan toISOString().slice(0,10) (ordenes-state.js:246,
// imprimir-orden.js:205). SOLO lectura, SOLO emulador.
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('ordenes_de_servicio').get();
  let total = 0, corridas = 0, corridasEntrega = 0, conEntrega = 0, desde90 = 0, corridas90 = 0;
  const hace90 = Date.now() - 90 * 86400000;
  const pa = (d) => new Date(d.getTime() - 5 * 3600000).toISOString().slice(0, 10);
  const ej = [];
  for (const doc of snap.docs) {
    const o = doc.data(); if (o.eliminado) continue;
    const fc = o.fecha_creacion?.toDate?.(); if (!fc) continue;
    total++;
    const mal = fc.toISOString().slice(0, 10) !== pa(fc);
    if (mal) { corridas++; if (ej.length < 5) ej.push(`${doc.id} creada ${fc.toISOString()} → bandeja muestra ${fc.toISOString().slice(0,10)}, Panamá ${pa(fc)}`); }
    if (fc.getTime() > hace90) { desde90++; if (mal) corridas90++; }
    const fe = o.fecha_entrega?.toDate?.();
    if (fe) { conEntrega++; if (fe.toISOString().slice(0, 10) !== pa(fe)) corridasEntrega++; }
  }
  console.log(`órdenes con fecha_creacion: ${total}; con el día corrido en la bandeja: ${corridas} (${(100*corridas/total).toFixed(1)}%)`);
  console.log(`últimos 90 días: ${desde90}; corridas: ${corridas90} (${(100*corridas90/Math.max(1,desde90)).toFixed(1)}%)`);
  console.log(`con fecha_entrega: ${conEntrega}; entrega con día corrido: ${corridasEntrega}`);
  ej.forEach(e => console.log('  ej:', e));
})().catch(e => { console.error(e); process.exit(1); });
