// Recorrido 10: espacio Finanzas como GERENCIA (Zuleika, rol administrador), escritorio.
// Requiere 02-seed-prueba.js corrido antes (avisos PRUEBA-AUDIT-facturacion).
import { abrir, USUARIOS, j } from './_lib.mjs';
const s = await abrir({ email: USUARIOS.gerencia, viewport: 'escritorio' });
const log = (...a) => console.log(...a);

// Hub → redirige a la bandeja
let info = await s.ir('/facturacion/index.html');
log('HUB', j(info));

// Bandeja
info = await s.ir('/facturacion/bandeja.html'); log('BANDEJA', j(info));
log('TABS', j(await s.textos('#wsTabs-mount a, #wsTabs-mount button')));
log('CHIPS', j(await s.textos('#fbChips .fb-chip')));
const filas = await s.textos('#fbRows .fb-row');
log('FILAS', filas.length, 'primera:', filas[0]?.slice(0, 160));
log('CONSULTAS', (await s.consultas()).join(' ; '));
await s.captura('10-gerencia-escritorio-bandeja');
const idPrueba = await s.page.evaluate(() => [...document.querySelectorAll('#fbRows .fb-row')].find(r => r.innerText.includes('PRUEBA-AUDIT-facturacion Empresa Uno'))?.getAttribute('data-row'));
log('ID PRUEBA', idPrueba);
if (idPrueba) { const ms = await s.medir(() => s.page.click(`[data-row="${idPrueba}"] .fb-main`)); log('abrir detalle ms', ms); await s.captura('11-gerencia-escritorio-bandeja-detalle'); }
log('GEO', j(await s.geometria()));
log('ERRORES', j(s.errores.slice(0, 6)));

// Comisiones
info = await s.ir('/facturacion/comisiones.html'); log('COMISIONES', j(info));
log('CHIPS', j(await s.textos('#cmChips .cm-chip')));
log('AVISO', await s.texto('#cmAviso').catch(() => ''));
log('GRUPOS', j((await s.textos('#cmRows .cm-gh')).slice(0, 6)));
await s.captura('12-gerencia-escritorio-comisiones');
await s.clic('#cmChips [data-f="listo"]');
log('LOTE', await s.texto('#cmLote'));
await s.captura('13-gerencia-escritorio-comisiones-listas');
// Flujo: confirmar primer pago en la de prueba 1 (esperando) → listo → cerrar período
await s.clic('#cmChips [data-f="esperando"]');
const idEsp = await s.page.evaluate(() => [...document.querySelectorAll('#cmRows .cm-row')].find(r => r.innerText.includes('PRUEBA-AUDIT-facturacion Empresa Uno'))?.getAttribute('data-row'));
log('ID ESPERANDO', idEsp);
let pasos = 0;
if (idEsp) {
  await s.clic(`[data-row="${idEsp}"] .cm-main`); pasos++;
  await s.captura('14-gerencia-escritorio-comision-detalle');
  await s.hacer((id) => FacturacionComisiones.formPago(id), idEsp); pasos++;
  await s.page.type(`#pgF-${idEsp}`, '11002'); pasos++;
  const ms = await s.medir(() => s.page.evaluate((id) => FacturacionComisiones.guardarPago(id), idEsp)); pasos++;
  log('guardarPago ms', ms, 'toasts', j(await s.toasts()));
  await s.captura('15-gerencia-escritorio-comision-pago-guardado');
  await s.clic('#cmChips [data-f="listo"]');
  await s.clic(`[data-row="${idEsp}"] .cm-main`); pasos++;
  await s.hacer((id) => FacturacionComisiones.formCierre(id), idEsp); pasos++;
  const ms2 = await s.medir(() => s.page.evaluate((id) => FacturacionComisiones.guardarCierre(id), idEsp)); pasos++;
  log('guardarCierre ms', ms2, 'pasos individuales', pasos, 'toasts', j(await s.toasts()));
}
// Lote: seleccionar las 2 de Elvia (prueba 3 y 4) y cerrar
await s.clic('#cmChips [data-f="listo"]');
const nSel = await s.hacer(() => { const b = [...document.querySelectorAll('[data-sel-vendedor]')].find(x => x.getAttribute('data-sel-vendedor').includes('elvia')); if (b) b.click(); return document.querySelectorAll('input[data-sel]:checked').length; });
log('seleccionadas por vendedor', nSel, 'LOTE', await s.texto('#cmLote'));
await s.captura('16-gerencia-escritorio-comisiones-lote');
if (nSel) {
  await s.page.click('#cmLoteBtn');
  await s.espera(500);
  log('CONFIRM', (await s.texto('.modal-backdrop.open')).slice(0, 400));
  await s.captura('17-gerencia-escritorio-comisiones-lote-confirm');
  const ms = await s.medir(() => s.page.evaluate(() => document.querySelector('.modal-backdrop.open .btn-primary, .modal-backdrop.open button.primary')?.click()));
  log('cerrarLote ms', ms, 'toasts', j((await s.toasts()).slice(-3)));
}
log('ERRORES', j(s.errores.slice(0, 6)));

// Activación
info = await s.ir('/facturacion/activacion.html'); log('ACTIVACION', j(info));
log('KPIS', await s.texto('#kpis'));
log('SEG', j(await s.textos('.seg .seg-btn')));
log('CONSULTAS', (await s.consultas()).join(' ; '));
await s.captura('20-gerencia-escritorio-activacion-pendientes');
await s.clic('.seg-btn[data-v="listos"]');
await s.captura('21-gerencia-escritorio-activacion-listos');
log('FILA LISTOS', (await s.textos('#tablaActivacion tr'))[0]);
const btn = await s.page.$('#tablaActivacion button.btn-primary');
if (btn) {
  await btn.click(); await s.espera(400);
  log('CONFIRM', (await s.texto('.modal-backdrop.open')).slice(0, 300));
  await s.captura('22-gerencia-escritorio-activacion-confirm');
  await s.hacer(() => document.querySelector('.modal-backdrop.open .btn-primary, .modal-backdrop.open button.primary')?.click());
  await s.espera(900);
  log('TOASTS', j(await s.toasts()), 'CALLABLES', j(await s.llamadas()));
  await s.captura('23-gerencia-escritorio-activacion-error-callable');
}
await s.clic('.seg-btn[data-v="pendientes"]');
const be = await s.page.$('#tablaActivacion button[onclick*="confirmar_entrega"]');
if (be) {
  await be.click(); await s.espera(400);
  await s.captura('24-gerencia-escritorio-activacion-confirmar-entrega');
  log('MODAL ENTREGA', (await s.texto('.modal-backdrop.open')).slice(0, 200));
  await s.hacer(() => document.querySelector('.modal-backdrop.open .modal-close, .modal-backdrop.open [data-action="cancelar"]')?.click());
}
log('GEO', j(await s.geometria()));
log('ERRORES', j(s.errores.slice(0, 6)));

// Clientes ↔ QBO (la callable falla)
info = await s.ir('/facturacion/clientes-qbo.html'); log('QBO', j(info));
await s.espera(1500);
log('RESUMEN', await s.texto('#qboResumen'), '| ESTADO', await s.texto('#qboEstado'), '| LISTA', (await s.texto('#lista')).slice(0, 200));
log('TOASTS', j(await s.toasts()), 'CALLABLES', j(await s.llamadas()));
await s.captura('30-gerencia-escritorio-clientes-qbo-sin-callable');
log('ERRORES', j(s.errores.slice(0, 6)));

// Emisión
info = await s.ir('/facturacion/emision.html'); log('EMISION', j(info));
await s.captura('40-gerencia-escritorio-emision');

// Cargos
info = await s.ir('/inventario/cargos.html'); log('CARGOS', j(info));
await s.espera(1000);
log('RESUMEN', await s.texto('#resumen'), '| HINT', await s.texto('#qboHint'));
log('SELECT QBO primera fila', j(await s.textos('#tablaCargos tr:first-child select option')));
await s.captura('50-gerencia-escritorio-cargos');
log('GEO', j(await s.geometria()));

// Catálogo modelos (pestaña del espacio)
info = await s.ir('/inventario/modelos.html'); log('MODELOS', j(info));
await s.captura('55-gerencia-escritorio-catalogo-modelos');

// Panorama
info = await s.ir('/admin/financiero.html?volver=finanzas'); log('PANORAMA', j(info));
log('KPI LABELS', j(await s.textos('.stat-card .label')));
await s.captura('60-gerencia-escritorio-panorama');
log('CONSULTAS', (await s.consultas()).join(' ; '));
log('ERRORES', j(s.errores.slice(0, 6)));
log('FUGAS a functions', j(s.fugas));
await s.cerrar();
