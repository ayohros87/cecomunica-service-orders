// Auditoría de módulos 2026-09-30 · Cotizaciones · R1 + R2 (ejecución 2026-10-02).
// R1: eliminar una ENVIADA espeja `deleted` en cotizacion_verificaciones y el
//     cliente sin sesión ve "Cotización cerrada" (antes: "Vigente" + "¿Aceptas?").
//     Restaurar vuelve a dejar el enlace como estaba.
// R2: el detalle muestra quién rechazó y por qué, el motivo del descarte y
//     quién aprobó (antes `toUi` no copiaba esos campos).
//   node 10-r1-r2.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (...a) => console.log(...a);
const ENVIADA = { id: 'g8LlCgbzAU0Dm0OkvjJb', n: 'COT-2026-0138' };     // comercial enviada con carta (Elvia)
// La descartada se busca en los datos (el emulador se re-siembra con producción).

const a = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'cotizaciones' });
const P = a.page;
await a.ir('/cotizaciones/index.html');
const espejo = (id) => P.evaluate(async (id) => {
  const d = await firebase.firestore().collection('cotizacion_verificaciones').doc(id).get();
  const v = d.data() || {}; return { code: v.code, estado: v.estado || null, deleted: v.deleted ?? null, deleted_at: !!v.deleted_at };
}, id);

// ── Dato "antes": espejos de cotizaciones eliminadas que siguen sin marca ──
const huerfanos = await P.evaluate(async () => {
  const db = firebase.firestore();
  const cots = await db.collection('cotizaciones').where('deleted', '==', true).get();
  const out = [];
  for (const d of cots.docs) {
    const e = await db.collection('cotizacion_verificaciones').doc(d.id).get();
    if (e.exists && e.data().deleted !== true) out.push(d.data().cotizacion_id || d.id);
  }
  return out;
});
log('ESPEJOS de eliminadas sin marca `deleted` (antes):', huerfanos.length, huerfanos);

// ── R1 ──────────────────────────────────────────────────────────────────────
log('espejo antes:', await espejo(ENVIADA.id));
await P.evaluate((id) => CotizacionesService.softDelete(id), ENVIADA.id);
await a.quieto(600);
const e1 = await espejo(ENVIADA.id); log('espejo tras softDelete:', e1);

const ext = await abrir({ email: 'cliente.externo@prueba-audit.test', viewport: 'escritorio', carpeta: 'cotizaciones' });
const situ = async () => ({ situacion: (await ext.texto('#cqSituacion')).replace(/\n/g, ' | '), respuesta: (await ext.texto('#cqRespuesta').catch(() => '')).replace(/\n/g, ' | ').slice(0, 80) || '(sin panel)' });
await ext.ir(`/verify/cotizacion.html?id=${ENVIADA.id}&v=${e1.code}`, { esperar: 2500 });
const pubEliminada = await situ(); log('PÚBLICO con la cotización ELIMINADA:', pubEliminada);
await ext.captura('60-r1-cliente-sin-sesion-enlace-eliminada');

await P.evaluate((id) => CotizacionesService.restore(id), ENVIADA.id);
await a.quieto(600);
const e2 = await espejo(ENVIADA.id); log('espejo tras restore:', e2);
await ext.ir(`/verify/cotizacion.html?id=${ENVIADA.id}&v=${e1.code}`, { esperar: 2500 });
const pubRestaurada = await situ(); log('PÚBLICO tras RESTAURAR:', pubRestaurada);
log('errores externo:', ext.errores.filter(e => !/login|auth/.test(e)).slice(0, 5));
await ext.cerrar();

// ── R2 ──────────────────────────────────────────────────────────────────────
const DESCARTADA = await P.evaluate(async () => {
  const s = await firebase.firestore().collection('cotizaciones').where('estado', '==', 'descartada').get();
  const d = s.docs.find(x => x.data().cierre_motivo) || s.docs[0];
  return d ? { id: d.id, n: d.data().cotizacion_id, motivo: d.data().cierre_motivo || null } : null;
});
log('descartada de prueba:', DESCARTADA);
let r = await a.ir(`/cotizaciones/detalle-cotizacion.html?id=${DESCARTADA.id}`, { esperar: 2000 }); log('ir detalle:', r, a.errores.slice(0, 3));
await P.waitForSelector('.cc-timeline', { timeout: 15000 }).catch(() => log('sin .cc-timeline'));
log('DETALLE descartada · historial:', (await a.texto('.cc-timeline')).replace(/\n/g, ' | '));
await a.captura('61-r2-detalle-descartada-con-motivo', { full: true });

// Rechazo del aprobador: se simula sobre la misma de prueba y se revierte.
await P.waitForFunction(() => firebase.auth().currentUser, { timeout: 15000 });
const antes = await P.evaluate(async (id) => (await firebase.firestore().collection('cotizaciones').doc(id).get()).data(), DESCARTADA.id);
await P.evaluate(async (id) => {
  const FV = firebase.firestore.FieldValue;
  await firebase.firestore().collection('cotizaciones').doc(id).update({
    estado: 'rechazada', rechazo_origen: 'aprobador', rechazo_motivo: 'PRUEBA-AUDIT R2: 25 % supera el máximo',
    rechazado_por_email: firebase.auth().currentUser.email, fecha_rechazo: firebase.firestore.Timestamp.now(),
    fecha_aprobacion: FV.delete(),
  });
}, DESCARTADA.id);
r = await a.ir(`/cotizaciones/detalle-cotizacion.html?id=${DESCARTADA.id}`, { esperar: 2000 });
await P.waitForSelector('.cc-timeline', { timeout: 15000 }).catch(() => log('sin .cc-timeline'));
log('DETALLE rechazada por aprobador · header:', (await a.texto('.app-page-header h1')).replace(/\n/g, ' '), '| historial:', (await a.texto('.cc-timeline')).replace(/\n/g, ' | '));
await a.captura('62-r2-detalle-rechazada-aprobador', { full: true });
// Revertir al estado anterior
await P.evaluate(async (id, antes) => {
  const FV = firebase.firestore.FieldValue;
  await firebase.firestore().collection('cotizaciones').doc(id).update({
    estado: antes.estado, rechazo_origen: FV.delete(), rechazo_motivo: FV.delete(), rechazado_por_email: FV.delete(), fecha_rechazo: FV.delete(),
    fecha_aprobacion: antes.fa ? new firebase.firestore.Timestamp(antes.fa.seconds, antes.fa.nanoseconds) : FV.delete(),
  });
}, DESCARTADA.id, { estado: antes.estado, fa: antes.fecha_aprobacion ? { seconds: antes.fecha_aprobacion.seconds, nanoseconds: antes.fecha_aprobacion.nanoseconds } : null });
log('errores admin:', a.errores.slice(0, 5));
await a.cerrar();
