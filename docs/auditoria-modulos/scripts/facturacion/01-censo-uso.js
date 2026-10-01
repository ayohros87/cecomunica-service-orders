// Censo de uso del módulo Facturación en el EMULADOR (solo lectura, sin montos):
// audit logs de 30 días por acción/usuario que tocan facturación y QBO, y estructura de uso_diario.
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/facturacion/01-censo-uso.js
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const cnt = (o, k) => { o[k] = (o[k] || 0) + 1; };
(async () => {
  const cols = await db.listCollections();
  const nombres = cols.map(c => c.id);
  console.log('colecciones', nombres.filter(n => /audit|log|uso/i.test(n)));
  const ud = await db.collection('uso_diario').get();
  ud.forEach(d => { const x = d.data(); console.log('uso_diario doc', d.id, Object.keys(x).slice(0, 10), JSON.stringify(x).slice(0, 600)); });
  for (const col of nombres.filter(n => /audit/i.test(n))) {
    const snap = await db.collection(col).get();
    const desde = Date.now() - 30 * 864e5;
    const porAccion = {}, porUsuario = {}, muestra = {};
    snap.forEach(d => { const x = d.data();
      const t = x.timestamp?.toMillis?.() || x.created_at?.toMillis?.() || x.at?.toMillis?.() || 0;
      if (t && t < desde) return;
      const s = JSON.stringify(x).toLowerCase();
      if (!/factur|qbo|quickbooks|comision|cargo/.test(s)) return;
      const acc = x.action || x.accion || x.tipo || x.evento || '?';
      cnt(porAccion, acc); cnt(porUsuario, `${acc} | ${x.user_email || x.por_email || x.usuario || x.uid || '?'}`);
      if (!muestra[acc]) muestra[acc] = Object.keys(x);
    });
    console.log(col, snap.size, 'docs; en 30 días con factur/qbo/comision:', porAccion);
    console.log('por usuario', porUsuario);
    console.log('campos', muestra);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
