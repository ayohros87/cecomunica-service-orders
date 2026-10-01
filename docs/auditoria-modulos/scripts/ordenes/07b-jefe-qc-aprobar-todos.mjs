// Recorrido 07b · Jefa de taller: QC por el camino corto ("Aprobar todos" + "Aprobar QC")
// en A y B. Escribe SOLO en el emulador.
import { abrir, USUARIOS, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));

const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
await s.ir('/ordenes/index.html?qc=1');
for (const [k, id] of [['A', ids.A], ['B', ids.B]]) {
  let pasos = 0;
  await medir(s, `abrir QC ${k}`, async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="qc-orden"][data-orden-id="${id}"]`).click(), id); pasos++; });
  const sinInt = await s.page.evaluate(() => [...document.querySelectorAll('.modal-backdrop.open')].pop()?.innerText.match(/SIN intervención/g)?.length || 0);
  log(`  ${k}: equipos "SIN intervención registrada": ${sinInt}`);
  await medir(s, 'Aprobar todos', async () => { await s.page.evaluate(() => [...document.querySelectorAll('.modal-backdrop.open button')].find(b => /Aprobar todos|Marcar todo OK/.test(b.innerText)).click()); pasos++; });
  const hab = await s.page.$eval('#qcAprobarBtn', b => !b.disabled);
  log('  aprobar habilitado:', hab);
  if (k === 'A') await s.captura('07b-jefe-escritorio-qc-aprobar-todos');
  await medir(s, `Aprobar QC ${k}`, async () => { await s.page.click('#qcAprobarBtn'); pasos++; });
  log(`  toasts:`, JSON.stringify((await s.toasts()).slice(-1)), `| ${pasos} interacciones | modales:`, JSON.stringify(await modalAbierto(s)).slice(0, 120));
}
await s.ir(`/ordenes/index.html?orden=${ids.A}`);
log('fila A tras QC:', await s.page.$eval(`tr[data-orden-id="${ids.A}"]`, tr => tr.innerText.replace(/\s+/g, ' ')));
await s.captura('07b-jefe-escritorio-fila-lista-para-entregar');
// Ver QC
await s.page.evaluate((id) => document.querySelector(`[data-action="qc-orden"][data-orden-id="${id}"]`).click(), ids.A); await s.quieto(800, 5000);
await s.captura('07b-jefe-escritorio-ver-qc');
log('ver QC:', (await s.page.evaluate(() => ([...document.querySelectorAll('.modal-backdrop.open')].pop()?.innerText || '').replace(/\s+/g, ' ').slice(0, 300))));
log('errores:', s.errores.slice(0, 5));
await s.cerrar();
