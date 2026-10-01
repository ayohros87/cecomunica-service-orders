// Lee los correos encolados por las órdenes de prueba (SOLO emulador; Functions no corre, así que quedan en mail_queue).
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const ids = process.argv.slice(2);
  const snap = await db.collection('mail_queue').orderBy('createdAt', 'desc').limit(40).get();
  for (const d of snap.docs) {
    const m = d.data();
    const cuerpo = JSON.stringify(m).slice(0, 4000);
    if (ids.length && !ids.some(id => cuerpo.includes(id))) continue;
    console.log('\n==', d.id, '| to:', JSON.stringify(m.to), '| cc:', JSON.stringify(m.cc || null), '| subject:', m.subject || m.message?.subject);
    const html = m.html || m.message?.html || m.message?.text || '';
    console.log(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 900));
  }
})().catch(e => { console.error(e); process.exit(1); });
