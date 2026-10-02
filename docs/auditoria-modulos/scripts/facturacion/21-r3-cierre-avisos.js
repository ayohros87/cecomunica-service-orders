// Ejecución 2026-10-02 · R3: el contrato murió → sus avisos abiertos se cierran
// solos (lib/facturacionAvisos.cerrarAvisosDeContrato). No hay emulador de
// functions, así que la escritura se ejercita DIRECTO con el Admin SDK contra
// el Firestore del emulador: siembra tres avisos PRUEBA-AUDIT-facturacion de
// un mismo contrato (pendiente con comisión esperando, esperando con correo
// en error, hecho) y corre los dos caminos (vencido por fecha → solo el que
// espera; anulado → todo lo abierto). Requiere 02-seed-prueba.js para el
// resto de la bandeja.
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/facturacion/21-r3-cierre-avisos.js
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const FA = require('../../../../functions/src/lib/facturacionAvisos');
const T = admin.firestore.Timestamp;
const hace = (d) => T.fromDate(new Date(Date.now() - d * 864e5));
const PREF = 'PRUEBA-AUDIT-facturacion';
const CONTRATO = `${PREF}-contrato-6`;
const paso = (aplica, extra = {}) => ({ aplica, hecho: false, at: null, por_email: null, ...extra });
const base = (n, estado, correo) => ({
  tipo: 'contrato_activo', titulo: 'Contrato activo', efecto: 'arranca', estado,
  cliente_id: `${PREF}-cli-6`, cliente_nombre: `${PREF} Seis Muerto S.A.`, vendedor_email: 'karla.ferrer@cecomunica.com',
  contrato_id: 'DEMO20260901-06', contrato_doc_id: CONTRATO, origen: { col: 'contratos', id: CONTRATO },
  fecha_efectiva: estado === 'esperando' ? null : hace(12), created_at: hace(12), updated_at: hace(12), historial: [],
  correo, pasos: { qbo: paso(true), poc: paso(true) },
  resumen: { mensual: 0, con_itbms: 0, exento: false, equipos: '2 × PNC360S', seriales_total: 2, seriales_count: 2 },
  contexto: { entrega_pendiente: estado === 'esperando' }, detalle: { lineas: [{ cantidad: 2, modelo: 'PNC360S', precio: 0 }] },
  comision: { aplica: true, estado: 'esperando', motivo: null, vendedor_email: 'karla.ferrer@cecomunica.com', base: 0, base_de: 'mensual',
    requisitos: { firma: { aplica: true, hecho: true }, entrega: { aplica: true, hecho: false, motivo: 'los equipos no se han entregado' },
      pago: { aplica: true, hecho: false, factura: null, motivo: 'falta confirmar el primer pago (factura en cero)' } },
    periodo: null, liberada_por: null, liberada_at: null, nota: null },
});
const ids = {
  pendiente: `contrato_activo__${CONTRATO}`,
  esperando: `contrato_activo__${CONTRATO}__esp`,
  hecho: `contrato_activo__${CONTRATO}__hecho`,
};
(async () => {
  const b = db.batch();
  b.set(db.collection('facturacion_avisos').doc(ids.pendiente), base(1, 'pendiente', { mail_queue_id: 'mq-prueba-1', status: 'sent', error: null }));
  b.set(db.collection('facturacion_avisos').doc(ids.esperando), base(2, 'esperando', { mail_queue_id: 'mq-prueba-2', status: 'error', error: 'SMTP 550 buzón lleno' }));
  b.set(db.collection('facturacion_avisos').doc(ids.hecho), { ...base(3, 'hecho', { mail_queue_id: 'mq-prueba-3', status: 'sent' }),
    pasos: { qbo: paso(true, { hecho: true, factura: '11020' }), poc: paso(true, { hecho: true }) } });
  await b.commit();
  const estados = async () => {
    const out = {};
    for (const [k, id] of Object.entries(ids)) { const d = (await db.collection('facturacion_avisos').doc(id).get()).data(); out[k] = `${d.estado}${d.descarte?.motivo ? ` (${d.descarte.motivo})` : ''} · comisión ${d.comision?.estado}`; }
    return out;
  };
  console.log('ANTES', await estados());

  // 1) Venció POR FECHA: el contrato sigue operando → solo el que espera entrega.
  let r = await FA.cerrarAvisosDeContrato(CONTRATO, { motivo: 'contrato_vencido', soloEsperando: true });
  console.log('vencido por fecha →', JSON.stringify(r));
  const d1 = await estados(); console.log('TRAS VENCER POR FECHA', d1);
  const ok1 = d1.esperando.startsWith('descartado (contrato_vencido)') && d1.pendiente.startsWith('pendiente') && d1.hecho.startsWith('hecho') && d1.esperando.includes('comisión esperando');
  console.log(ok1 ? 'R3-A OK: solo el que esperaba, y su comisión no se tocó' : 'R3-A FALLA');

  // 2) Anulado: todo lo abierto, y la comisión no pagada pasa a no_aplica.
  r = await FA.cerrarAvisosDeContrato(CONTRATO, { motivo: 'contrato_anulado', detalle: 'Error en el papel' });
  console.log('anulado →', JSON.stringify(r));
  const d2 = await estados(); console.log('TRAS ANULAR', d2);
  const ok2 = d2.pendiente.startsWith('descartado (contrato_anulado)') && d2.pendiente.includes('comisión no_aplica') && d2.hecho.startsWith('hecho');
  console.log(ok2 ? 'R3-B OK: el pendiente se cerró con comisión no_aplica; el hecho intacto' : 'R3-B FALLA');

  // 3) Idempotente
  r = await FA.cerrarAvisosDeContrato(CONTRATO, { motivo: 'contrato_anulado' });
  console.log(r.cerrados.length === 0 ? 'R3-C OK: segunda pasada no toca nada' : 'R3-C FALLA', JSON.stringify(r));
  const h = (await db.collection('facturacion_avisos').doc(ids.pendiente).get()).data().historial;
  console.log('HISTORIAL pendiente:', h.map(x => x.detalle));

  // Deja un aviso con correo en error para la prueba del navegador (chip + Reenviar en la fila).
  await db.collection('facturacion_avisos').doc(ids.pendiente).set({ estado: 'pendiente', descarte: null,
    correo: { mail_queue_id: 'mq-prueba-1', status: 'error', error: 'SMTP 550 buzón lleno' },
    comision: { aplica: true, estado: 'esperando', motivo: null } }, { merge: true });
  console.log('listo: queda', ids.pendiente, 'pendiente con correo en error, y', ids.esperando, 'cerrado por contrato vencido');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
