// Recorrido 05 · Jefa de taller (escritorio): asignar técnico a A y B (Marcos), y ver
// "Cambiar técnico". Escribe SOLO en el emulador.
import { abrir, USUARIOS, elegirOpcion, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));

const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
// Cómo encuentra la jefa lo que le toca: chip "Por asignar"
let info = await s.ir('/ordenes/index.html?estado=por_asignar');
log('bandeja por asignar:', JSON.stringify(info));
await s.captura('05-jefe-escritorio-por-asignar');
const fila = await s.page.evaluate((A) => { const tr = document.querySelector(`tr[data-orden-id="${A}"][data-orden-row]`); if (!tr) return null; const r = tr.getBoundingClientRect(); return { top: Math.round(r.top), posicion: [...document.querySelectorAll('tr[data-orden-row]')].indexOf(tr) + 1, txt: tr.innerText.replace(/\s+/g, ' ').slice(0, 100) }; }, ids.A);
log('  fila A en la cola:', JSON.stringify(fila));
for (const [k, id] of [['A', ids.A], ['B', ids.B]]) {
  let pasos = 0;
  await medir(s, `abrir Asignar ${k}`, async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="asignar-tecnico"][data-orden-id="${id}"]`).click(), id); pasos++; });
  if (k === 'A') {
    await s.captura('05-jefe-escritorio-modal-asignar');
    const opts = await s.page.$$eval('#asignarTecnicoSelect option', os => os.map(o => ({ v: o.value.slice(0, 6), t: o.textContent.trim(), sel: o.selected })));
    log('  técnicos en el select:', JSON.stringify(opts));
    log('  modal:', (await s.texto('#modalAsignar')).replace(/\s+/g, ' ').slice(0, 300));
  }
  const el = await elegirOpcion(s, '#asignarTecnicoSelect', 'Marcos'); pasos++;
  await medir(s, `confirmar asignar ${k}`, async () => { await s.page.click('#modalAsignar [data-action="confirmar-asignar-tecnico"]'); pasos++; });
  log(`  ${k} → ${el} | ${pasos} interacciones | toasts:`, JSON.stringify((await s.toasts()).slice(-1)));
}
await s.ir(`/ordenes/index.html?orden=${ids.A}`);
log('fila A tras asignar:', await s.page.$eval(`tr[data-orden-id="${ids.A}"]`, tr => tr.innerText.replace(/\s+/g, ' ')));
// Cambiar técnico desde ⋯ (solo abrir, cancelar)
await s.page.evaluate((id) => document.querySelector(`[data-action="toggle-overflow-menu"][data-orden-id="${id}"]`).click(), ids.A); await s.quieto(400, 3000);
await s.captura('05-jefe-escritorio-menu-fila-asignada');
log('menú ⋯ jefa (ASIGNADO):', await s.page.$eval(`#overflow-menu-${ids.A}`, d => [...d.querySelectorAll('.overflow-menu-item')].map(b => b.innerText.trim()).join(' | ')));
await s.page.keyboard.press('Escape');
// Correo al técnico encolado (Functions no corre; queda en mail_queue) → se revisa con 00b
log('errores:', s.errores.slice(0, 5));
await s.cerrar();
