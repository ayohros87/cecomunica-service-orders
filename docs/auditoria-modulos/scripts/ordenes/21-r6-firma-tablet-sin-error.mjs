// R6 (ejecución 2026-10-01) · Al confirmar la firma en /firmar/tablet.html la consola no debe
// tirar "Cannot read properties of null (reading 'data')" y la tablet debe mostrar el "Gracias".
// Escribe SOLO en el emulador: crea la orden 2026100192 (clon de una LISTA PARA ENTREGAR real)
// con Admin SDK contra el emulador; Storage stubeado. Adaptado del recorrido 08/08b.
import { createRequire } from 'node:module';
import { abrir, USUARIOS, stubStorage, firmarCanvas, tipear, medir, log, clicTexto } from './lib-ordenes.mjs';
const require = createRequire('file:///C:/Projects/cecomunica-service-orders/functions/package.json');
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const ID = '2026100192';
{
  const snap = await db.collection('ordenes_de_servicio').where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)').orderBy('fecha_creacion', 'desc').limit(40).get();
  const baseDoc = snap.docs.find(d => { const o = d.data(); return !o.eliminado && /REPARACI/i.test(o.tipo_de_servicio || '') && o.qc?.resultado === 'aprobado' && !(o.contrato?.aplica === true) && (o.equipos || []).length; });
  if (!baseDoc) throw new Error('no hay una REPARACIÓN lista para entregar con QC aprobado');
  const doc = { ...baseDoc.data(), observaciones: 'PRUEBA-EXEC-ordenes R6 (emulador)', eliminado: false, fecha_creacion: admin.firestore.Timestamp.now() };
  for (const k of ['fecha_entrega', 'no_recibido', 'no_recibido_motivo', 'entrega_persona_interna', 'nota_firmada_url', 'nota_firmada_path', 'nota_firmada_at', 'receptor_nombre', 'receptor_cedula', 'firma_url', 'entrega']) delete doc[k];
  await db.collection('ordenes_de_servicio').doc(ID).set(doc);
  log(`orden ${ID} lista (clon de ${baseDoc.id})`);
}
const t = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'ordenes' });
await t.ir('/firmar/tablet.html');
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ordenes' });
await s.ir(`/ordenes/index.html?ids=${ID}`); await s.quieto(1200, 10000);
await s.page.evaluate((id) => document.querySelector(`[data-action="entregar-orden"][data-orden-id="${id}"]`).click(), ID); await s.quieto(800, 6000);
await tipear(s, '#entregaReceptorNombre', 'Cliente que recibe (prueba R6)');
const okTab = await clicTexto(s, 'Firmar en la tablet', '#modalEntrega');
log('Firmar en la tablet:', okTab, '| toasts:', JSON.stringify((await s.toasts()).slice(-1)));
await t.quieto(1500, 15000);
log('tablet ve:', (await t.texto('body')).replace(/\s+/g, ' ').slice(0, 160));
await t.page.click('#fNombre', { clickCount: 3 }); await t.page.keyboard.type('Cliente que recibe (prueba R6)');
await t.page.click('#fCedula', { clickCount: 3 }); await t.page.keyboard.type('8-123-4567');
const canvasSel = await t.page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].find(c => c.getBoundingClientRect().height > 0); return c?.id ? '#' + c.id : 'canvas'; });
await firmarCanvas(t, canvasSel);
log('stub storage tablet:', await stubStorage(t));
const erroresAntes = t.errores.length;
await medir(t, 'confirmar firma en tablet', async () => { await t.page.click('#fConfirmar'); });
await new Promise(r => setTimeout(r, 1500));
const nuevos = t.errores.slice(erroresAntes);
log('tablet tras firmar:', (await t.texto('body')).replace(/\s+/g, ' ').slice(0, 140));
log(`errores nuevos en la tablet: ${nuevos.length}`, JSON.stringify(nuevos.slice(0, 4)), '| con "reading \'data\'":', nuevos.some(e => /reading 'data'/.test(e)));
await t.captura('21-r6-tablet-tras-firmar');
await s.quieto(1500, 10000);
log('firma llegó a recepción:', await s.page.$eval('#entregaTabletListo', e => !e.classList.contains('hidden')).catch(() => null), '|', await s.texto('#entregaTabletNombre').catch(() => ''));
await stubStorage(s);
await medir(s, 'confirmar entrega', async () => { await s.page.click('#btnConfirmarEntrega'); });
log('recepción toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| errores recepción:', s.errores.slice(0, 4));
// La tablet vuelve sola a la espera
await new Promise(r => setTimeout(r, 4500));
log('tablet 4 s después:', (await t.texto('body')).replace(/\s+/g, ' ').slice(0, 100), '| errores totales tablet:', t.errores.length);
await s.cerrar(); await t.cerrar();
process.exit(0);
