// Recorrido 07 · Jefa de taller (escritorio): QC de A y B (aprobar) y "Cotizar" desde A
// (solo hasta abrir el editor). Escribe SOLO en el emulador.
import { abrir, USUARIOS, esperarUrl, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));

const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
let info = await s.ir('/ordenes/index.html?qc=1');
log('cola QC (?qc=1):', JSON.stringify(info), '| resumen:', await s.texto('#resumenOrdenes'));
await s.captura('07-jefe-escritorio-cola-qc');
for (const [k, id] of [['A', ids.A], ['B', ids.B]]) {
  let pasos = 0;
  const btn = await s.page.$eval(`[data-action="qc-orden"][data-orden-id="${id}"]`, b => ({ t: b.innerText.trim(), title: b.title })).catch(() => null);
  log(`${k}: botón QC`, JSON.stringify(btn));
  if (!btn) { await s.ir(`/ordenes/index.html?orden=${id}`); }
  await medir(s, `abrir QC ${k}`, async () => { await s.page.evaluate((id) => document.querySelector(`[data-action="qc-orden"][data-orden-id="${id}"]`).click(), id); pasos++; });
  if (k === 'A') {
    await s.captura('07-jefe-escritorio-modal-qc');
    log('  modal QC:', (await s.page.evaluate(() => (document.querySelector('.modal-backdrop.open')?.innerText || '').replace(/\s+/g, ' ').slice(0, 700))));
  }
  const chips = await s.page.$$eval('.modal-backdrop.open .qc-chip[data-valor="ok"]', cs => cs.length);
  const filas = await s.page.$$eval('.modal-backdrop.open .qc-item-row', cs => cs.length);
  log(`  filas de checklist: ${filas} (chips OK: ${chips})`);
  await medir(s, 'marcar todo OK', async () => { await s.page.evaluate(() => document.querySelectorAll('.modal-backdrop.open .qc-chip[data-valor="ok"]').forEach(c => c.click())); pasos += chips; });
  const hab = await s.page.$eval('#qcAprobarBtn', b => !b.disabled);
  log('  aprobar habilitado:', hab, '| ¿hay "Todo OK"?', await s.page.evaluate(() => !![...document.querySelectorAll('.modal-backdrop.open button')].find(b => /todo ok|marcar todo/i.test(b.innerText))));
  if (k === 'A') await s.captura('07-jefe-escritorio-modal-qc-lleno');
  await medir(s, `aprobar QC ${k}`, async () => { await s.page.click('#qcAprobarBtn'); pasos++; });
  log(`  toasts:`, JSON.stringify((await s.toasts()).slice(-1)), `| ${pasos} interacciones (1 por ítem de checklist)`);
  log('  modales:', JSON.stringify(await modalAbierto(s)).slice(0, 200));
  await s.page.keyboard.press('Escape'); await s.quieto(400, 3000);
}
await s.ir(`/ordenes/index.html?orden=${ids.A}`);
log('fila A tras QC:', await s.page.$eval(`tr[data-orden-id="${ids.A}"]`, tr => tr.innerText.replace(/\s+/g, ' ')));
await s.captura('07-jefe-escritorio-fila-lista-para-entregar');
// Cotizar desde la orden (⋯ → Cotizar): solo hasta abrir el editor
await s.page.evaluate((id) => document.querySelector(`[data-action="toggle-overflow-menu"][data-orden-id="${id}"]`).click(), ids.A); await s.quieto(300, 2000);
const t0 = Date.now();
await s.page.evaluate((id) => document.querySelector(`#overflow-menu-${id} [data-action="cotizar-orden"]`).click(), ids.A);
const u = await esperarUrl(s, /cotizar-orden\.html/);
log(`cotizar: ${u} en ${Date.now() - t0} ms | 2 interacciones`);
await s.captura('07-jefe-escritorio-cotizar-orden', { full: true });
log('  editor:', (await s.texto('.app-wrap')).replace(/\s+/g, ' ').slice(0, 500));
log('  consultas:', (await s.consultas()).slice(0, 12).join(' ; '));
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
