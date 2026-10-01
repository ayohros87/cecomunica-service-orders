// Recorrido 10b: las acciones que pasan por Modal.confirm (monta en .overlay, no en .modal-backdrop):
// cierre de comisiones en lote, "Facturará la app" (callable bloqueada) y el toggle de auto-activación.
import { abrir, USUARIOS, j } from './_lib.mjs';
const s = await abrir({ email: USUARIOS.gerencia, viewport: 'escritorio' });
const log = (...a) => console.log(...a);
const confirmTexto = () => s.page.evaluate(() => [...document.querySelectorAll('.overlay')].filter(o => o.style.display === 'flex').map(o => o.innerText.replace(/\s+/g, ' ')).join(' || '));
const confirmar = () => s.medir(() => s.page.evaluate(() => [...document.querySelectorAll('.overlay [data-action="confirm"]')].pop()?.click()));
const cancelar = () => s.hacer(() => [...document.querySelectorAll('.overlay [data-action="cancel"]')].pop()?.click());

// Comisiones: lote de las 2 de Elvia (PRUEBA-3 y 4)
let info = await s.ir('/facturacion/comisiones.html'); log('COMISIONES', j(info));
await s.clic('#cmChips [data-f="listo"]');
let pasos = 1;                                                                     // 1 chip Listas
const nSel = await s.hacer(() => { const b = [...document.querySelectorAll('[data-sel-vendedor]')].find(x => x.getAttribute('data-sel-vendedor').includes('elvia')); if (b) b.click(); return document.querySelectorAll('input[data-sel]:checked').length; }); pasos++; // 2 "Seleccionar sus N"
log('seleccionadas', nSel);
if (nSel) {
  await s.page.click('#cmLoteBtn'); pasos++;                                       // 3 Cerrar seleccionadas
  await s.espera(400);
  log('CONFIRM LOTE', await confirmTexto());
  await s.captura('17-gerencia-escritorio-comisiones-lote-confirm');
  const msL = await confirmar(); pasos++;                                          // 4 confirmar
  log('cerrarLote ms', msL, 'pasos', pasos, 'toasts', j((await s.toasts()).slice(-2)));
  await s.captura('18-gerencia-escritorio-comisiones-lote-cerrado');
}
await s.clic('#cmChips [data-f="pagada"]');
log('PAGADAS', j((await s.textos('#cmRows .cm-row')).filter(t => t.includes('PRUEBA-AUDIT')).map(t => t.slice(0, 120))));
await s.captura('19-gerencia-escritorio-comisiones-pagadas');
// Reabrir una (para dejar el dato como estaba salvo la traza). reabrir() espera un
// Modal.confirm: NO se puede esperar su promesa desde puppeteer.
const idR = `renovacion_activa__PRUEBA-AUDIT-facturacion-3`;
if (await s.page.$(`[data-row="${idR}"]`)) {
  await s.clic(`[data-row="${idR}"] .cm-main`);
  await s.page.evaluate((id) => { FacturacionComisiones.reabrir(id); }, idR); await s.espera(400);
  log('CONFIRM REABRIR', await confirmTexto());
  await confirmar(); log('toasts', j((await s.toasts()).slice(-1)));
}
log('ERRORES', j(s.errores.slice(0, 4)));

// Activación: "Facturará la app" en un contrato Listo → la callable no corre aquí
info = await s.ir('/facturacion/activacion.html'); log('ACTIVACION', j(info));
await s.clic('.seg-btn[data-v="listos"]');
const btn = await s.page.$('#tablaActivacion button.btn-primary');
if (btn) {
  await btn.click(); await s.espera(400);
  log('CONFIRM ACTIVAR', await confirmTexto());
  await s.captura('22-gerencia-escritorio-activacion-confirm');
  const ms = await confirmar(); await s.espera(600);
  log('activar ms', ms, 'TOASTS', j(await s.toasts()), 'CALLABLES', j(await s.llamadas()));
  await s.captura('23-gerencia-escritorio-activacion-error-callable');
}
// Toggle auto-activar: confirmación y revertir
await s.page.click('#autoActivar'); await s.espera(300);
log('CONFIRM AUTO', await confirmTexto());
await s.captura('25-gerencia-escritorio-activacion-auto-confirm');
await cancelar();
log('checkbox tras cancelar', await s.page.evaluate(() => document.getElementById('autoActivar').checked));
// Vista previa (solo existe en Activos = 0): documentar que no hay botón
await s.clic('.seg-btn[data-v="activos"]');
log('ACTIVOS', await s.texto('#lista'));
log('ERRORES', j(s.errores.slice(0, 4)), 'FUGAS', j(s.fugas));
await s.cerrar();
