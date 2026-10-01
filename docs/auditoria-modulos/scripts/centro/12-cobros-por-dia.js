// Qué hizo la cuenta de cobros en las fichas de clientes, por día y campo (historial inmutable, 30 días). Solo lectura.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const snap = await db.collectionGroup('historial').get();
  const desde = Date.now() - 30 * 86400000;
  const porDia = {}, sinUsuario = {};
  for (const d of snap.docs) {
    if (d.ref.parent.parent?.parent?.id !== 'clientes') continue;
    const h = d.data(); const ts = h.at?.toMillis ? h.at.toMillis() : null; if (!ts || ts < desde) continue;
    const dia = new Date(ts).toISOString().slice(0, 10);
    const campos = h.campos || Object.keys(h.cambios || {});
    if (h.por_email === 'cobros@cecomunica.com') { porDia[dia] = porDia[dia] || {}; for (const c of campos) porDia[dia][c] = (porDia[dia][c] || 0) + 1; }
    if (!h.por_email) { const k = dia + ' ' + (h.tipo || '?') + ' ' + (h.origen || h.motivo || ''); sinUsuario[k] = (sinUsuario[k] || 0) + 1; }
  }
  console.log('cobros por día', JSON.stringify(porDia));
  console.log('sin usuario', JSON.stringify(sinUsuario).slice(0, 800));
})();
