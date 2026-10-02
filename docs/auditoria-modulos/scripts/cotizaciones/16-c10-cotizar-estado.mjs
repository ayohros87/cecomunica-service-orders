// Auditoría de módulos 2026-09-30 · Cotizaciones · C10 (ejecución 2026-10-02).
// El ⋯ de la bandeja ofrece "Cotizar" solo cuando hay intervención registrada
// (o la orden ya pasó del taller); en POR ASIGNAR / ASIGNADO sin intervención
// aparece gris "Cotizar · sin intervención registrada". Por URL directa se
// avisa y se deja seguir.
//   node 16-c10-cotizar-estado.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (...a) => console.log(...a);

const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'cotizaciones' });
const P = s.page;
await s.ir('/ordenes/index.html', { esperar: 1500 });
const casos = await P.evaluate(() => {
  const ords = (window.APP?.state?.orders || []);
  const conInt = (o) => Array.isArray(o.equipos) && o.equipos.some(e => e && e.eliminado !== true && String(e.trabajo_tecnico || '').trim());
  const pick = (f) => ords.find(f);
  const out = {};
  const sin = pick(o => /POR ASIGNAR|RECIBIDO|^ASIGNADO/.test(String(o.estado_reparacion || '').toUpperCase()) && !conInt(o) && !o.cotizacion_doc_id);
  const con = pick(o => /^ASIGNADO/.test(String(o.estado_reparacion || '').toUpperCase()) && conInt(o) && !o.cotizacion_doc_id);
  const paso = pick(o => /COMPLETADO|ENTREGAD/.test(String(o.estado_reparacion || '').toUpperCase()) && !o.cotizacion_doc_id);
  for (const [k, o] of [['sin_intervencion', sin], ['asignado_con_intervencion', con], ['paso_el_taller', paso]]) {
    if (!o) { out[k] = null; continue; }
    const id = o.ordenId;
    const cotizar = !!document.querySelector(`[data-action="cotizar-orden"][data-orden-id="${id}"]`);
    const fila = document.querySelector(`[data-orden-id="${id}"]`)?.closest('tr, .orden-card');
    const gris = fila ? [...fila.querySelectorAll('.disabled, [class*="disabled"]')].map(x => x.textContent.trim()).filter(t => /Cotizar/.test(t)) : [];
    out[k] = { orden: id, estado: o.estado_reparacion, equiposConIntervencion: (o.equipos || []).filter(e => String(e?.trabajo_tecnico || '').trim()).length, ofreceCotizar: cotizar, gris };
  }
  out.enBandeja = ords.length;
  return out;
});
log(JSON.stringify(casos, null, 2));
// URL directa a una sin intervención: avisa y deja seguir
if (casos.sin_intervencion) {
  await s.ir(`/ordenes/cotizar-orden.html?id=${casos.sin_intervencion.orden}`, { esperar: 1500 });
  log('URL directa sin intervención → toasts:', (await s.toasts()).map(t => t.type + ': ' + t.msg), '| título:', await s.texto('h1'));
}
if (casos.paso_el_taller) {
  await s.ir(`/ordenes/cotizar-orden.html?id=${casos.paso_el_taller.orden}`, { esperar: 1500 });
  log('URL directa COMPLETADO/ENTREGADO → toasts:', (await s.toasts()).map(t => t.type + ': ' + t.msg));
}
log('errores:', s.errores.slice(0, 3));
await s.cerrar();
