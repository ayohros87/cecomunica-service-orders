// Recorrido 15 (recepción, escritorio): el paso QBO del contrato de prueba con el toast ya ido
// (en el 11 el toast tapó "Marcar hecho"), "anotar el número" de un QBO hecho sin número, y
// "Ver hechos y no aplica" en carga limpia vs. después de cerrar algo en la misma sesión.
import { abrir, USUARIOS, j } from './_lib.mjs';
const log = (...a) => console.log(...a);
const PREF = 'PRUEBA-AUDIT-facturacion';
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio' });

// A. Ver hechos en carga limpia: ¿cuántos trae y cuánto tarda?
let info = await s.ir('/facturacion/bandeja.html'); log('BANDEJA', j(info));
let ms = await s.medir(() => s.page.click('#fbVerHechos'));
log('Ver hechos (limpio) ms', ms, '|', await s.texto('.fb-sep').catch(() => ''), '| consultas', (await s.consultas()).filter(c => /Cerrados/.test(c)).join(' ; '));
await s.captura('84-recepcion-escritorio-ver-hechos-limpio');
log('GEO con hechos', j(await s.geometria()));

// B. Anotar el número en un QBO hecho SIN número (PRUEBA-4, cerrado)
const id4 = `contrato_activo__${PREF}-4`;
let pasos = 0;
const tieneQ = await s.page.$(`[data-row="${id4}"] button[data-paso="qbo"].sin-num`);
log('PRUEBA-4 con "?"', !!tieneQ);
if (tieneQ) {
  await s.clic(`[data-row="${id4}"] button[data-paso="qbo"]`); pasos++;
  await s.captura('85-recepcion-escritorio-anotar-numero');
  await s.page.type(`.fb-pop[data-pop="${id4}"] [data-f="factura"]`, '11004'); pasos++;
  ms = await s.medir(() => s.page.click(`[data-act="pop-factura"][data-id="${id4}"]`)); pasos++;
  log('anotar factura: pasos', pasos, 'ms', ms, 'toasts', j((await s.toasts()).slice(-1)));
}

// C. Paso QBO del contrato de prueba (fecha prellenada + número) → cierra la fila
const id1 = `contrato_activo__${PREF}-1`;
await s.ir('/facturacion/bandeja.html');
pasos = 0; const t0 = Date.now();
await s.clic(`[data-row="${id1}"] button[data-paso="qbo"]`); pasos++;
await s.page.type(`.fb-pop[data-pop="${id1}"] [data-f="factura"]`, '11011'); pasos++;
await s.page.evaluate((id) => document.querySelector(`.fb-pop[data-pop="${id}"] [data-act="pop-ok"]`)?.scrollIntoView({ block: 'center' }), id1);
ms = await s.medir(() => s.page.evaluate((id) => document.querySelector(`.fb-pop[data-pop="${id}"] [data-act="pop-ok"]`)?.click(), id1)); pasos++;
log('QBO contrato: pasos', pasos, 'ms', ms, 'total ms', Date.now() - t0, 'toasts', j((await s.toasts()).slice(-1)), 'err', await s.texto(`.fb-pop[data-pop="${id1}"] .err`).catch(() => ''));
log('¿sigue en la bandeja?', !!(await s.page.$(`[data-row="${id1}"]`)));
await s.captura('86-recepcion-escritorio-contrato-cerrado');

// D. Ver hechos DESPUÉS de cerrar algo en la sesión: ¿trae la lista del servidor?
ms = await s.medir(() => s.page.click('#fbVerHechos'));
log('Ver hechos (tras cerrar en sesión) ms', ms, '|', await s.texto('.fb-sep').catch(() => ''));
await s.captura('87-recepcion-escritorio-ver-hechos-tras-cerrar');
log('ERRORES', j(s.errores.slice(0, 4)));
await s.cerrar();
