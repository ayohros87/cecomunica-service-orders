// Recorrido 12 · Aísla la causa del "Guardar" que no guarda tras "Guardar y siguiente" (script 11).
// Variante A: esperar 5 s (el toast ya se fue) y clic real. Variante B: clic inmediato por JS (sin
// geometría). Usa la orden C del 11 (Marcos, 2 equipos). Escribe SOLO en el emulador.
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));
const C = ids.C;
const s = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ordenes' });
const docEquipos = () => s.page.evaluate((id) => ((APP.state.orders || []).find(o => o.ordenId === id)?.equipos || []).map(e => (e.trabajo_tecnico || e.intervencion || '').toString().slice(0, 30)), C);
const geo = () => s.page.evaluate(() => { const b = document.getElementById('btnGuardarTrabajoEquipo'); const r = b.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; const top = document.elementFromPoint(cx, cy); return { btn: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, vh: innerHeight, encima: top ? (top.id || top.className || top.tagName).toString().slice(0, 60) : null, esElBoton: top === b || b.contains(top) }; });
async function ciclo(nombre, accion) {
  await s.ir(`/ordenes/index.html?orden=${C}`);
  await s.page.evaluate((id) => document.querySelector(`[data-action="abrir-equipos-mobile"][data-orden-id="${id}"]`).click(), C); await s.quieto(600, 5000);
  await s.page.evaluate(() => document.querySelectorAll('#equiposMobileList [data-action="abrir-trabajo-equipo"]')[0].click()); await s.quieto(600, 5000);
  await s.page.click('#trabajoEquipoText', { clickCount: 3 }); await s.page.keyboard.type(`Eq1 ${nombre}`);
  await s.page.click('#btnGuardarTrabajoSiguiente'); await s.quieto(800, 10000);
  await s.page.click('#trabajoEquipoText', { clickCount: 3 }); await s.page.keyboard.type(`Eq2 ${nombre}`);
  log(`[${nombre}] geometría antes del clic:`, JSON.stringify(await geo()));
  await s.captura(`12-tecnico-telefono-${nombre}-antes-de-guardar`);
  const t0 = Date.now();
  await accion();
  await s.quieto(800, 10000);
  log(`[${nombre}] ${Date.now() - t0} ms | toasts:`, JSON.stringify((await s.toasts()).slice(-1)), '| modal visible:', await s.page.evaluate(() => !!document.getElementById('modalTrabajoEquipo')?.offsetParent), '| confirm abierto:', await s.page.evaluate(() => !!document.querySelector('.overlay:not(.hidden) .modal, .modal-backdrop.open')));
  await s.ir(`/ordenes/index.html?orden=${C}`);
  log(`[${nombre}] tras recargar:`, JSON.stringify(await docEquipos()));
}
await ciclo('inmediato-mouse', async () => { await s.page.click('#btnGuardarTrabajoEquipo'); });
await ciclo('espera5s-mouse', async () => { await new Promise(r => setTimeout(r, 5000)); log('  geometría tras 5 s:', JSON.stringify(await geo())); await s.page.click('#btnGuardarTrabajoEquipo'); });
await ciclo('inmediato-js', async () => { await s.page.evaluate(() => document.getElementById('btnGuardarTrabajoEquipo').click()); });
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
