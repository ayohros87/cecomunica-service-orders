// Censo (solo lectura, EMULADOR): avisos DEMO/mensual 0, avisos en espera vs. estado real del contrato, comisiones a nombre del dueño.
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/facturacion/07-censo-avisos-huerfanos.js
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const av = (await db.collection('facturacion_avisos').get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(a => !a.id.includes('PRUEBA-AUDIT'));
  const cero = av.filter(a => a.resumen?.mensual === 0 || (a.contrato_id || '').startsWith('DEMO'));
  console.log('avisos con mensual 0 o DEMO', cero.length, cero.map(a => ({ tipo: a.tipo, estado: a.estado, pref: (a.contrato_id || '').slice(0, 4), mensual: a.resumen?.mensual, comAplica: a.comision?.aplica, comEstado: a.comision?.estado })));
  const porPrefijo = {}; av.forEach(a => { const p = (a.contrato_id || a.contexto?.cotizacion_id || '').slice(0, 4); porPrefijo[p] = (porPrefijo[p] || 0) + 1; }); console.log('avisos por prefijo', porPrefijo);
  // esperando: cuánto llevan esperando (created_at) y si el contrato ya tiene entrega_confirmada
  for (const a of av.filter(x => x.estado === 'esperando')) {
    const c = a.contrato_doc_id ? (await db.collection('contratos').doc(a.contrato_doc_id).get()).data() : null;
    console.log('ESPERANDO', a.contrato_id?.slice(0, 4), 'creado', a.created_at?.toDate?.().toISOString().slice(0, 10), 'contrato.entrega_confirmada', c?.entrega_confirmada, 'estado contrato', c?.estado, 'correo', a.correo?.status);
  }
  // Alberto como vendedor de comisión
  console.log('comisiones con vendedor alberto', av.filter(a => (a.comision?.vendedor_email || '').startsWith('alberto')).map(a => ({ tipo: a.tipo, pref: (a.contrato_id || '').slice(0, 4), base: a.comision.base })));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
