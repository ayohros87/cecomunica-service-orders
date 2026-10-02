// Verdad de las señales de Finanzas del home de contabilidad (FAV / COM), con
// Admin SDK contra el EMULADOR (solo lectura). Mismo criterio que
// SenalesService.listAvisosFacturacionViejos / listComisionesListas.
// Correr desde functions/: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/home-nav/13b-verdad-finanzas.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const now = new Date();
const dias = (ts) => { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d && !isNaN(d) ? Math.floor((now - d) / 86400000) : null; };
(async () => {
  const all = (await db.collection('facturacion_avisos').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const porEstado = all.reduce((a, x) => { a[x.estado || '(vacío)'] = (a[x.estado || '(vacío)'] || 0) + 1; return a; }, {});
  console.log('facturacion_avisos total', all.length, '| por estado', JSON.stringify(porEstado));
  const pend = all.filter(a => a.estado === 'pendiente');
  const viejos = pend.filter(a => (dias(a.fecha_efectiva || a.created_at) || 0) > 7);
  console.log('FAV pendientes', pend.length, '| > 7 días desde fecha_efectiva:', viejos.length, '| más viejos:', viejos.sort((a, b) => dias(b.fecha_efectiva) - dias(a.fecha_efectiva)).slice(0, 5).map(a => `${a.contrato_id || a.gestion_id || a.id}(${dias(a.fecha_efectiva)}d)`).join(' '));
  const conCom = all.filter(a => a.comision && a.comision.aplica === true);
  const estado = (com) => { if (com.liberada_at || com.periodo) return 'pagada'; const req = Object.values(com.requisitos || {}).filter(x => x && x.aplica); return req.length && req.every(x => x.hecho) ? 'listo' : 'esperando'; };
  const porCom = conCom.reduce((a, x) => { const k = estado(x.comision); a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log('COM con comision.aplica=true', conCom.length, '| por estado derivado', JSON.stringify(porCom), '| listas:', conCom.filter(a => estado(a.comision) === 'listo').map(a => a.contrato_id || a.gestion_id || a.id).join(' '));
  process.exit(0);
})();
