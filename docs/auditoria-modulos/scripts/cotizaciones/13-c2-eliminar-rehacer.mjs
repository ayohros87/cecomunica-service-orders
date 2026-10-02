// Auditoría de módulos 2026-09-30 · Cotizaciones · C2 (ejecución 2026-10-02).
// Eliminar es solo para borradores; una enviada se cierra con motivo
// (banderita) o se REHACE: la original queda descartada ("Se rehace como
// COT-…") y se abre la copia en el editor. Antes: Eliminar en cualquier
// estado, sin motivo (8 de 22 eliminadas estaban enviadas).
//   node 13-c2-eliminar-rehacer.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (...a) => console.log(...a);
const CONF = '.overlay[style*="flex"]';

const s = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'cotizaciones' });
const P = s.page;
await s.ir('/cotizaciones/index.html');
await P.click('#tipoSeg [data-tipo="ventas"]'); await s.quieto(300);
const uid = await P.evaluate(() => firebase.auth().currentUser.uid);
const acciones = (id) => P.evaluate((id) => [...document.querySelectorAll(`tr[data-id="${id}"] [data-action]`)].map(b => b.dataset.action).join(','), id);
const filaDe = (estado) => P.evaluate((estado, uid) => {
  const tr = [...document.querySelectorAll('#tablaCotizaciones tr[data-id]')].find(t => new RegExp('\\b' + estado + '\\b', 'i').test(t.querySelector('td:nth-child(4)')?.innerText || '') && /Karla/.test(t.innerText));
  return tr ? { id: tr.dataset.id, txt: tr.innerText.replace(/\n/g, ' | ').slice(0, 80) } : null;
}, estado, uid);

const borr = await filaDe('Borrador'); log('fila borrador:', borr, '→ acciones:', borr && await acciones(borr.id));
const env = await filaDe('Enviada');  log('fila enviada:', env, '→ acciones:', env && await acciones(env.id));
const venc = await filaDe('Vencida');  log('fila vencida:', venc, '→ acciones:', venc && await acciones(venc.id));
log('¿Eliminar en la enviada?', env ? (await acciones(env.id)).includes('eliminar') : 'n/a', '| ¿Rehacer en la enviada?', env ? (await acciones(env.id)).includes('rehacer') : 'n/a');
await s.captura('67-c2-lista-acciones-por-estado');

if (env) {
  const antes = await P.evaluate(async (id) => (await firebase.firestore().collection('cotizaciones').doc(id).get()).data().estado, env.id);
  await P.click(`tr[data-id="${env.id}"] [data-action="rehacer"]`); await s.quieto(500);
  log('confirm:', (await s.texto(CONF)).replace(/\n/g, ' | '));
  await s.captura('68-c2-rehacer-confirm');
  const nav = P.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
  await P.click(CONF + ' [data-action="confirm"]'); await nav; await s.quieto(1500);
  log('tras Rehacer →', P.url(), '| toasts:', await s.toasts(), '| errores:', s.errores.slice(0, 3));
  const nuevoId = new URL(P.url()).searchParams.get('id');
  log('subtítulo del editor:', await s.texto('#cotSubtitulo').catch(() => '(sin subtítulo)'));
  const vieja = await P.evaluate(async (id) => { const d = (await firebase.firestore().collection('cotizaciones').doc(id).get()).data(); return { estado: d.estado, cierre_motivo: d.cierre_motivo, fecha_descarte: !!d.fecha_descarte }; }, env.id);
  const nueva = nuevoId ? await P.evaluate(async (id) => { const d = (await firebase.firestore().collection('cotizaciones').doc(id).get()).data(); return { numero: d.cotizacion_id, estado: d.estado, items: (d.items || []).length, cliente: d.cliente_nombre }; }, nuevoId) : null;
  log('original:', vieja, '| copia:', nueva);
  // El enlace del cliente de la original dice "cerrada"
  const esp = await P.evaluate(async (id) => { const d = await firebase.firestore().collection('cotizacion_verificaciones').doc(id).get(); return d.exists ? { code: d.data().code, estado: d.data().estado } : null; }, env.id);
  if (esp) {
    const ext = await abrir({ email: 'cliente.externo@prueba-audit.test', viewport: 'escritorio', carpeta: 'cotizaciones' });
    await ext.ir(`/verify/cotizacion.html?id=${env.id}&v=${esp.code}`, { esperar: 2500 });
    log('PÚBLICO de la original rehecha:', (await ext.texto('#cqSituacion')).replace(/\n/g, ' | '));
    await ext.cerrar();
  }
  // Revertir (emulador): la original vuelve a su estado; la copia se marca eliminada
  await P.evaluate(async (id, antes, nuevoId) => {
    const FV = firebase.firestore.FieldValue;
    await firebase.firestore().collection('cotizaciones').doc(id).update({ estado: antes, cierre_motivo: FV.delete(), fecha_descarte: FV.delete(), descartada_por_uid: FV.delete() });
    await firebase.firestore().collection('cotizacion_verificaciones').doc(id).update({ estado: antes }).catch(() => {});
    if (nuevoId) await firebase.firestore().collection('cotizaciones').doc(nuevoId).update({ deleted: true, deleted_at: FV.serverTimestamp() });
  }, env.id, antes, nuevoId);
}

// Eliminar un borrador sigue igual (con su confirm); se cancela.
if (borr) {
  await s.ir('/cotizaciones/index.html'); await P.click('#tipoSeg [data-tipo="ventas"]'); await s.quieto(300);
  await P.click(`tr[data-id="${borr.id}"] [data-action="eliminar"]`); await s.quieto(400);
  log('confirm eliminar borrador:', (await s.texto(CONF)).replace(/\n/g, ' | '));
  await P.click(CONF + ' [data-action="cancel"]'); await s.quieto(300);
}
// Detalle de una enviada: botón Rehacer presente, sin Eliminar
if (env) {
  await s.ir(`/cotizaciones/detalle-cotizacion.html?id=${env.id}`, { esperar: 2000 });
  await P.waitForSelector('.app-page-header-actions', { timeout: 15000 });
  log('acciones del detalle (enviada):', (await s.texto('.app-page-header-actions')).replace(/\n/g, ' | '));
}
log('errores:', s.errores.slice(0, 3));
await s.cerrar();
