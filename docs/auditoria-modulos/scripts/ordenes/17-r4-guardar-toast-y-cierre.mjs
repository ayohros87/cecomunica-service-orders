// R4 (ejecución 2026-10-01) · Repite el script 12 con el toast ARRIBA: tras "Guardar y siguiente",
// un toque inmediato en "Guardar" del siguiente equipo debe GUARDAR. Y la X con texto sin guardar
// debe preguntar. Escribe SOLO en el emulador: crea/reinicia la orden de prueba 2026100190 (clon
// de la última ASIGNADA de Marcos) con Admin SDK contra el emulador.
import { createRequire } from 'node:module';
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
const require = createRequire('file:///C:/Projects/cecomunica-service-orders/functions/package.json');
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const C = '2026100190';
const MARCOS_UID = 'jI7VgcS4bsRZJPwif2jVLOSJu5f2';

async function prepararOrden() {
  const snap = await db.collection('ordenes_de_servicio').where('tecnico_uid', '==', MARCOS_UID)
    .where('estado_reparacion', '==', 'ASIGNADO').orderBy('fecha_creacion', 'desc').limit(3).get();
  const baseDoc = snap.docs.find(d => d.id !== C);   // no clonar la propia orden de prueba
  if (!baseDoc) throw new Error('Marcos no tiene ASIGNADAS en el emulador');
  const base = baseDoc.data();
  const equipos = (base.equipos || []).filter(e => !e.eliminado).slice(0, 2).map((e, i) => {
    const copia = { ...e, id: `r4-eq-${i + 1}`, numero_de_serie: `R4-TEST-${i + 1}`, serial: `R4-TEST-${i + 1}` };
    for (const k of Object.keys(copia)) if (/^trabajo|^intervencion/.test(k)) delete copia[k];
    return copia;
  });
  if (equipos.length < 2) equipos.push({ ...equipos[0], id: 'r4-eq-2', numero_de_serie: 'R4-TEST-2', serial: 'R4-TEST-2' });
  const doc = { ...base, equipos, observaciones: 'PRUEBA-EXEC-ordenes R4 (emulador)', eliminado: false,
    fecha_creacion: admin.firestore.Timestamp.now(), qc: admin.firestore.FieldValue.delete(), fotos_taller: [] };
  delete doc.qc;
  await db.collection('ordenes_de_servicio').doc(C).set(doc);
  log(`orden ${C} lista (clon de ${baseDoc.id}, ${equipos.length} equipos, técnico ${base.tecnico_asignado})`);
}

await prepararOrden();
const s = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ordenes' });
const docEquipos = async () => { const d = await db.collection('ordenes_de_servicio').doc(C).get(); return (d.data().equipos || []).map(e => (e.trabajo_tecnico || e.intervencion || '').toString().slice(0, 30)); };
const geo = () => s.page.evaluate(() => { const b = document.getElementById('btnGuardarTrabajoEquipo'); const r = b.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; const top = document.elementFromPoint(cx, cy); const t = document.querySelector('.toast-region .toast'); const rt = t ? t.getBoundingClientRect() : null; return { btnY: Math.round(r.y), vh: innerHeight, encima: top ? (top.id || top.className || top.tagName).toString().slice(0, 40) : null, esElBoton: top === b || b.contains(top), toastTop: rt ? Math.round(rt.top) : null, toastBottom: rt ? Math.round(rt.bottom) : null }; });
async function abrirEq1() {
  await s.ir(`/ordenes/index.html?ids=${C}`);
  await s.quieto(1200, 10000);
  await s.page.evaluate((id) => document.querySelector(`[data-action="abrir-equipos-mobile"][data-orden-id="${id}"]`).click(), C); await s.quieto(600, 5000);
  await s.page.evaluate(() => document.querySelectorAll('#equiposMobileList [data-action="abrir-trabajo-equipo"]')[0].click()); await s.quieto(600, 5000);
}
async function ciclo(nombre, accion) {
  await abrirEq1();
  await s.page.click('#trabajoEquipoText', { clickCount: 3 }); await s.page.keyboard.type(`Eq1 ${nombre}`);
  await s.page.click('#btnGuardarTrabajoSiguiente'); await s.quieto(800, 10000);
  await s.page.click('#trabajoEquipoText', { clickCount: 3 }); await s.page.keyboard.type(`Eq2 ${nombre}`);
  log(`[${nombre}] geometría antes del clic:`, JSON.stringify(await geo()));
  await s.captura(`17-r4-telefono-${nombre}-antes-de-guardar`);
  const t0 = Date.now();
  await accion();
  await s.quieto(800, 10000);
  log(`[${nombre}] ${Date.now() - t0} ms | toasts:`, JSON.stringify((await s.toasts()).slice(-1)), '| modal visible:', await s.page.evaluate(() => !!document.getElementById('modalTrabajoEquipo')?.offsetParent));
  log(`[${nombre}] doc:`, JSON.stringify(await docEquipos()));
}
if (!process.argv.includes('--solo-cierre')) {
  await ciclo('inmediato-mouse', async () => { await s.page.click('#btnGuardarTrabajoEquipo'); });
  await ciclo('inmediato-js', async () => { await s.page.evaluate(() => document.getElementById('btnGuardarTrabajoEquipo').click()); });
}

// Cierre con texto sin guardar: X y Cancelar deben preguntar (el confirm de
// Modal.confirm se agrega al FINAL del body: se busca entre todos los overlays).
const visibles = () => s.page.evaluate(() => [...document.querySelectorAll('.overlay, .modal-backdrop')]
  .filter(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0; })
  .map(e => (e.id || e.className) + ' :: ' + (e.innerText || '').replace(/\s+/g, ' ').slice(0, 90)));
for (const sel of ['#modalTrabajoEquipo .modal-header-mobile [data-action="cerrar-trabajo-equipo"]', '#modalTrabajoEquipo .modal-footer-mobile [data-action="cerrar-trabajo-equipo"]']) {
  await abrirEq1();
  await s.page.click('#trabajoEquipoText', { clickCount: 3 }); await s.page.keyboard.type('texto que NO quiero perder');
  await s.page.click(sel); await s.quieto(500, 5000);
  const v = await visibles();
  const pregunta = v.some(t => /sin guardar/i.test(t));
  const trabajoAbierto = v.some(t => t.startsWith('modalTrabajoEquipo'));
  log(`[cierre ${sel.includes('header') ? 'X' : 'Cancelar'}] pregunta: ${pregunta} | modal de intervención sigue abierto: ${trabajoAbierto} |`, JSON.stringify(v.slice(-1)));
  await s.captura(`17-r4-telefono-cierre-${sel.includes('header') ? 'x' : 'cancelar'}`);
  if (pregunta) {
    // "Seguir editando" conserva el texto
    await s.page.evaluate(() => [...document.querySelectorAll('.overlay button, .modal-backdrop button')].find(b => /Seguir editando/.test(b.textContent))?.click());
    await s.quieto(300, 2000);
    log('   tras "Seguir editando": texto =', JSON.stringify(await s.page.$eval('#trabajoEquipoText', t => t.value)));
  }
  await s.page.keyboard.press('Escape'); await s.quieto(300, 2000);
}
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
process.exit(0);
