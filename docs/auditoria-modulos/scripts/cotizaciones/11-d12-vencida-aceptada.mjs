// Auditoría de módulos 2026-09-30 · Cotizaciones · D12 (ejecución 2026-10-02).
// Decisión de Alberto: la vencida es terminal (sin recordatorios ni posponer),
// pero si el cliente la acepta después el vendedor la marca Aceptada igual.
// Antes: una comercial vencida no tenía "Cerrar cotización" (solo la de
// taller) y "Cambiar estado" ofrecía Enviada/Borrador, nunca Aceptada.
//   node 11-d12-vencida-aceptada.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (...a) => console.log(...a);
const CONF = '.overlay[style*="flex"]';

// Karla (vendedora): una comercial vencida SUYA; si no hay, admin sobre cualquiera.
let s = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'cotizaciones' });
let P = s.page;
await s.ir('/cotizaciones/index.html');
const buscar = (uid) => P.evaluate(async (uid) => {
  let q = firebase.firestore().collection('cotizaciones').where('estado', '==', 'vencida');
  if (uid) q = q.where('creado_por_uid', '==', uid);
  const snap = await q.limit(50).get();
  const d = snap.docs.find(x => !x.data().deleted && (x.data().origen || '') !== 'orden' && !x.data().orden_id && !x.data().gestion_id);
  return d ? { id: d.id, n: d.data().cotizacion_id, por: d.data().creado_por_email } : null;
}, uid);
let COT = await buscar(await P.evaluate(() => firebase.auth().currentUser.uid));
let quien = 'Karla (vendedora)';
if (!COT) { await s.cerrar(); s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'cotizaciones' }); P = s.page; await s.ir('/cotizaciones/index.html'); COT = await buscar(null); quien = 'Alberto (admin)'; }
log('vencida comercial de prueba:', COT, 'con sesión de', quien);
if (!COT) { log('no hay comerciales vencidas: nada que probar'); await s.cerrar(); process.exit(0); }

// Lista: la fila vencida ofrece la banderita "Cerrar cotización"
await P.type('#filtroTexto', COT.n); await s.quieto(1200);
log('acciones de la fila vencida:', await P.evaluate((id) => [...document.querySelectorAll(`tr[data-id="${id}"] [data-action]`)].map(b => b.dataset.action + ':' + b.title).join(', '), COT.id));

// Detalle: botón + hoja sin "Validez vencida" + Aceptada pide cómo se cerró
let r = await s.ir(`/cotizaciones/detalle-cotizacion.html?id=${COT.id}`, { esperar: 2000 });
await P.waitForSelector('#panelTransiciones', { timeout: 15000 });
log('header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 260));
log('transiciones:', await s.texto('#panelTransiciones'));
const hayCerrar = !!(await P.$('#btnCerrar')); log('¿botón "Cerrar cotización"?', hayCerrar);
await P.click('#btnCerrar'); await s.quieto(600);
const hoja = (await s.texto('.modal-backdrop.open')).replace(/\n/g, ' | ');
log('hoja:', hoja.slice(0, 400));
log('¿ofrece "Validez vencida"?', /Validez vencida/.test(hoja));
await s.captura('63-d12-vencida-cerrar-hoja');
await P.click('.modal-backdrop.open [data-act="convertida"]'); await s.quieto(400);
await P.click('.modal-backdrop.open [data-act="guardar-tarde"]'); await s.quieto(400);
log('sin nota → error:', await s.texto('.modal-backdrop.open #cpErrorTarde'));
await P.type('.modal-backdrop.open #cpComo', 'PRUEBA-AUDIT D12: el cliente confirmó por correo después de vencida');
await s.captura('64-d12-vencida-aceptada-como');
await P.click('.modal-backdrop.open [data-act="guardar-tarde"]'); await s.quieto(1200);
log('toasts:', await s.toasts(), '| errores:', s.errores.slice(0, 3));
log('header tras aceptar:', (await s.texto('.app-page-header h1')).replace(/\n/g, ' '));
log('historial:', (await s.texto('.cc-timeline')).replace(/\n/g, ' | ').slice(0, 400));
await s.captura('65-d12-vencida-aceptada-detalle', { full: true });
const doc = await P.evaluate(async (id) => { const d = (await firebase.firestore().collection('cotizaciones').doc(id).get()).data(); return { estado: d.estado, aceptacion: d.aceptacion && { medio: d.aceptacion.medio, nota: d.aceptacion.nota, por: d.aceptacion.por_email }, fecha_conversion: !!d.fecha_conversion }; }, COT.id);
log('doc:', doc);
// Revertir (emulador): vuelve a vencida
await P.evaluate(async (id) => {
  const FV = firebase.firestore.FieldValue;
  await firebase.firestore().collection('cotizaciones').doc(id).update({ estado: 'vencida', fecha_conversion: FV.delete(), convertida_por_uid: FV.delete(), aceptacion: FV.delete() });
}, COT.id);
await s.cerrar();
