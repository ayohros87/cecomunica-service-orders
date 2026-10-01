// D3 + D4 (ejecución 2026-10-01) · Entrega con firma en papel SIN la foto de la nota: el app
// advierte "no quedará registro de la entrega en el sistema", pide la razón (obligatoria) y la
// guarda; "Volver" no escribe nada. Los correos de la nota van a cliente, vendedor, recepción y
// jefa de taller: el técnico ya no. Escribe SOLO en el emulador: crea la orden 2026100191 (clon
// de una LISTA PARA ENTREGAR real) con Admin SDK contra el emulador y lee mail_queue.
import { createRequire } from 'node:module';
import { abrir, USUARIOS, stubStorage, tipear, medir, log } from './lib-ordenes.mjs';
const require = createRequire('file:///C:/Projects/cecomunica-service-orders/functions/package.json');
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const ID = '2026100191';

async function prepararOrden() {
  const snap = await db.collection('ordenes_de_servicio').where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)')
    .orderBy('fecha_creacion', 'desc').limit(40).get();
  const baseDoc = snap.docs.find(d => { const o = d.data(); return !o.eliminado && /REPARACI/i.test(o.tipo_de_servicio || '') && o.qc?.resultado === 'aprobado' && o.tecnico_uid && !(o.contrato?.aplica === true) && (o.equipos || []).length; });
  if (!baseDoc) throw new Error('no hay una REPARACIÓN lista para entregar con QC aprobado y técnico');
  const base = baseDoc.data();
  const doc = { ...base, observaciones: 'PRUEBA-EXEC-ordenes D3/D4 (emulador)', eliminado: false, fecha_creacion: admin.firestore.Timestamp.now() };
  for (const k of ['fecha_entrega', 'no_recibido', 'no_recibido_motivo', 'entrega_persona_interna', 'nota_firmada_url', 'nota_firmada_path', 'nota_firmada_at', 'nota_firmada_omitida_motivo', 'nota_firmada_omitida_at', 'receptor_nombre', 'firma_url', 'entrega']) delete doc[k];
  await db.collection('ordenes_de_servicio').doc(ID).set(doc);
  log(`orden ${ID} lista (clon de ${baseDoc.id}; técnico ${base.tecnico_asignado}, vendedor ${base.vendedor_asignado || '—'})`);
  return base;
}
const base = await prepararOrden();
const tecnico = base.tecnico_uid ? (await db.collection('usuarios').doc(base.tecnico_uid).get()).data()?.email : null;
const antesCola = (await db.collection('mail_queue').get()).size;

const s = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'ordenes' });
await s.ir(`/ordenes/index.html?ids=${ID}`); await s.quieto(1200, 10000);
let pasos = 0;
await s.page.evaluate((id) => document.querySelector(`[data-action="entregar-orden"][data-orden-id="${id}"]`).click(), ID); pasos++; await s.quieto(800, 6000);
await s.page.click('#entregaNoRecibido'); pasos++; await s.quieto(300, 3000);
log('etiqueta nota:', await s.page.$eval('#entregaFotoPapel', i => i.closest('.form-field').querySelector('label').innerText.replace(/\s+/g, ' ').trim()));
await tipear(s, '#entregaNoRecibidoMotivo', 'La tablet estaba ocupada; firmó la nota impresa (prueba)'); pasos++;
await tipear(s, '#entregaPersonaInterna', 'Mensajero del cliente (prueba)'); pasos++;
await stubStorage(s);
const overlays = () => s.page.evaluate(() => [...document.querySelectorAll('.overlay')].filter(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 140)));
// 1) Confirmar sin nota → advertencia; "Volver" no escribe
await s.page.click('#btnConfirmarEntrega'); pasos++; await s.quieto(500, 5000);
let v = await overlays();
log('advertencia:', JSON.stringify(v.filter(t => /nota firmada/i.test(t)).slice(-1)));
await s.captura('20-d3-advertencia-sin-nota');
await s.page.evaluate(() => [...document.querySelectorAll('.overlay button')].find(b => b.textContent.trim() === 'Volver')?.click()); await s.quieto(400, 3000);
let d = (await db.collection('ordenes_de_servicio').doc(ID).get()).data();
log('tras Volver: estado =', d.estado_reparacion, '| modal entrega abierto:', await s.page.$eval('#modalEntrega', m => !m.classList.contains('hidden')), '| botón:', await s.page.$eval('#btnConfirmarEntrega', b => ({ disabled: b.disabled, txt: b.innerText.trim() })));
// 2) Confirmar de nuevo → razón vacía no pasa (toast, modal abierto, nada escrito); con razón, cierra
await s.page.click('#btnConfirmarEntrega'); await s.quieto(500, 5000);
await s.page.evaluate(() => [...document.querySelectorAll('.overlay button')].find(b => /Cerrar sin nota/.test(b.textContent))?.click()); await s.quieto(400, 3000);
d = (await db.collection('ordenes_de_servicio').doc(ID).get()).data();
log('razón vacía → toast:', JSON.stringify((await s.toasts()).slice(-1)), '| estado =', d.estado_reparacion, '| modal entrega abierto:', await s.page.$eval('#modalEntrega', m => !m.classList.contains('hidden')));
await s.page.click('#btnConfirmarEntrega'); await s.quieto(500, 5000);
await s.page.type('.overlay [data-role="prompt-input"]', 'Hay cola en el mostrador; la subo esta tarde (prueba)'); pasos++;
await medir(s, 'Cerrar sin nota', async () => { await s.page.evaluate(() => [...document.querySelectorAll('.overlay button')].find(b => /Cerrar sin nota/.test(b.textContent))?.click()); pasos++; });
log('toasts:', JSON.stringify((await s.toasts()).slice(-2)), '| errores:', s.errores.slice(0, 4), `| ${pasos} interacciones`);
d = (await db.collection('ordenes_de_servicio').doc(ID).get()).data();
log('doc:', JSON.stringify({ estado: d.estado_reparacion, no_recibido: d.no_recibido, persona: d.entrega_persona_interna, motivo_papel: d.no_recibido_motivo, nota_omitida: d.nota_firmada_omitida_motivo, nota_omitida_at: !!d.nota_firmada_omitida_at, nota_url: d.nota_firmada_url || null }));
// 3) Ver entrega muestra la razón
await s.page.evaluate((id) => document.querySelector(`[data-action="ver-entrega"][data-orden-id="${id}"]`)?.click(), ID); await s.quieto(800, 5000);
const txt = await s.page.evaluate(() => (document.querySelector('.modal-backdrop.open')?.innerText || '').replace(/\s+/g, ' '));
log('Ver entrega:', (txt.match(/Recibido por.{0,60}/) || [''])[0], '|', (txt.match(/Falta subir la nota[^.]*\./) || ['(sin aviso de nota)'])[0]);
await s.captura('20-d3-ver-entrega-sin-nota');
// 4) D4: correos encolados
await new Promise(r => setTimeout(r, 1500));
const todos = (await db.collection('mail_queue').orderBy('createdAt', 'desc').limit(30).get()).docs
  .map(x => x.data()).filter(m => (m.subject || '').includes(ID));
log(`correos "Nota de Entrega" de ${ID}: ${todos.length} (cola antes ${antesCola}) → para:`, JSON.stringify(todos.map(m => m.to)));
log('¿va al técnico', tecnico, '?', todos.some(m => String(m.to).toLowerCase() === String(tecnico).toLowerCase()));
await s.cerrar();
process.exit(0);
