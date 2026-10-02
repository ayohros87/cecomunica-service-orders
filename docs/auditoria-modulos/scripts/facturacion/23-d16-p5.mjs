// Ejecución 2026-10-02 · P5 + D16/P9.
//  P5  (recepción): marcar QBO sin número pide confirmación; cancelar deja el paso
//      sin marcar; aceptar lo marca y la fila entra al chip "Sin número"; desde ese
//      chip la pastilla con "?" anota el número y la fila sale del chip.
//  D16 (gerencia): chip "Falta el pago" → "Seleccionar sus N" → "Confirmar N pagos…"
//      → la hoja trae el número que Recepción anotó en la bandeja → confirmar →
//      la comisión queda LISTA. Contabilidad ve el mismo chip y la misma barra.
// Requiere 02-seed-prueba.js recién corrido (reinicia la prueba 1).
import { abrir, USUARIOS, j } from './_lib.mjs';
const log = (...a) => console.log(...a);
const PREF = 'PRUEBA-AUDIT-facturacion';
const idCon = `contrato_activo__${PREF}-1`;

// ── P5 como recepción ───────────────────────────────────────────────────────
let s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio' });
let info = await s.ir('/facturacion/bandeja.html'); log('BANDEJA recepcion', j(info));
const cnt = async () => Number(await s.page.evaluate(() => document.querySelector('#fbChips [data-cnt="sinnum"]')?.textContent || '0'));
const antes = await cnt(); log('chip Sin número antes:', antes);
await s.clic(`[data-row="${idCon}"] button[data-paso="qbo"]`);
// 1) Sin número → confirmación. Cancelar: nada se marca.
// Modal.confirm pinta `.modal` con botones [data-action="confirm"|"cancel"].
await s.page.click(`.fb-pop[data-pop="${idCon}"] [data-act="pop-ok"]`); await s.espera(500);
let modal = await s.texto('.modal').catch(() => '');
log('CONFIRM', modal.replace(/\n/g, ' ').slice(0, 160));
log(/sin número de factura/i.test(modal) ? 'P5-A OK: pide confirmación' : 'P5-A FALLA: no preguntó');
await s.hacer(() => document.querySelector('[data-action="cancel"]')?.click());
let marcado = await s.page.evaluate((id) => !!document.querySelector(`[data-row="${id}"] button[data-paso="qbo"].done`), idCon);
log(!marcado ? 'P5-B OK: cancelar no marca nada' : 'P5-B FALLA: se marcó igual');
// 2) Aceptar sin número → marcado, "?" y entra al chip.
if (!(await s.page.$(`.fb-pop[data-pop="${idCon}"].show`))) await s.clic(`[data-row="${idCon}"] button[data-paso="qbo"]`);
await s.page.click(`.fb-pop[data-pop="${idCon}"] [data-act="pop-ok"]`); await s.espera(500);
await s.medir(() => s.page.evaluate(() => document.querySelector('[data-action="confirm"]')?.click()));
log('toast', j((await s.toasts()).slice(-1)));
marcado = await s.page.evaluate((id) => !!document.querySelector(`[data-row="${id}"] button[data-paso="qbo"].done.sin-num`), idCon);
const despues = await cnt();
log('chip Sin número después:', despues, marcado ? '· pastilla con ?' : '· SIN pastilla ?');
log(marcado && despues === antes + 1 ? 'P5-C OK: marcado sin número y contado en el chip' : 'P5-C FALLA');
// 3) Chip "Sin número" → anotar desde la pastilla "?".
await s.clic('#fbChips [data-f="sinnum"]');
const enChip = !!(await s.page.$(`#fbRows [data-row="${idCon}"]`));
log(enChip ? 'P5-D OK: la fila aparece en "Sin número"' : 'P5-D FALLA: la fila no está en el chip');
await s.clic(`[data-row="${idCon}"] button[data-paso="qbo"]`);
await s.page.type(`.fb-pop[data-pop="${idCon}"] [data-f="factura"]`, '11011');
await s.medir(() => s.page.click(`.fb-pop[data-pop="${idCon}"] [data-act="pop-factura"]`));
log('toast', j((await s.toasts()).slice(-1)));
const quedo = !!(await s.page.$(`#fbRows [data-row="${idCon}"]`));
log(!quedo && (await cnt()) === antes ? 'P5-E OK: anotado y fuera del chip' : 'P5-E FALLA');
// Deja la PoC hecha para que la comisión solo espere el pago (la seed ya trae firma+entrega).
await s.clic('#fbChips [data-f="all"]');
await s.clic(`[data-row="${idCon}"] button[data-paso="poc"]`);
await s.medir(() => s.page.click(`.fb-pop[data-pop="${idCon}"] [data-act="pop-ok"]`));
log('ERRORES', j(s.errores.slice(0, 4)));
await s.captura('p5-recepcion-sin-numero');
await s.cerrar();

// ── D16 como gerencia y contabilidad ────────────────────────────────────────
for (const [rol, email, ejecuta] of [['contabilidad', USUARIOS.contabilidad, false], ['gerencia', USUARIOS.gerencia, true]]) {
  s = await abrir({ email, viewport: 'escritorio' });
  info = await s.ir('/facturacion/comisiones.html'); log(rol.toUpperCase(), 'COMISIONES', j(info));
  log('CHIPS', j(await s.textos('#cmChips .cm-chip')));
  await s.clic('#cmChips [data-f="pago"]');
  const grupos = await s.textos('#cmRows .cm-gh');
  log('GRUPOS', j(grupos.slice(0, 4)));
  log('LOTE', (await s.texto('#cmLote')).replace(/\n/g, ' '));
  const nSel = await s.hacer(() => { const b = [...document.querySelectorAll('[data-sel-vendedor]')].find(x => x.getAttribute('data-sel-vendedor').includes('karla')); if (b) b.click(); return document.querySelectorAll('input[data-sel]:checked').length; });
  log('seleccionadas de karla', nSel, '| LOTE', (await s.texto('#cmLote')).replace(/\n/g, ' '));
  log(nSel >= 1 ? `D16-A OK (${rol}): barra de pago en lote con selección` : `D16-A FALLA (${rol})`);
  if (ejecuta && nSel) {
    await s.page.click('#cmLotePagoBtn'); await s.espera(600);
    const hoja = await s.texto('.modal-backdrop.open .modal, .modal');
    log('HOJA', hoja.replace(/\n/g, ' ').slice(0, 300));
    const prefill = await s.page.evaluate((id) => document.querySelector(`[data-lf="${id}"]`)?.value, idCon);
    log('factura prellenada para prueba-1:', prefill);
    log(prefill === '11011' ? 'D16-B OK: la hoja trae el número de la bandeja' : 'D16-B FALLA: no se heredó el número');
    await s.captura('d16-gerencia-pagos-lote-hoja');
    const ms = await s.medir(() => s.page.evaluate(() => document.querySelector('.modal-backdrop.open .btn-primary, .modal-backdrop.open button.primary')?.click()));
    log('confirmar ms', ms, 'toasts', j((await s.toasts()).slice(-2)));
    await s.clic('#cmChips [data-f="listo"]');
    const lista = await s.page.evaluate((id) => document.querySelector(`[data-row="${id}"] .cm-est`)?.textContent, idCon);
    log(lista === 'Listo' ? 'D16-C OK: la comisión quedó LISTA para pago' : `D16-C FALLA: estado ${lista}`);
    // Formulario individual también prellena.
    await s.clic('#cmChips [data-f="pago"]');
    const otra = await s.page.evaluate(() => document.querySelector('#cmRows .cm-row')?.getAttribute('data-row'));
    if (otra) {
      await s.hacer((id) => FacturacionComisiones.toggle(id), otra);
      await s.hacer((id) => FacturacionComisiones.formPago(id), otra);
      log('formPago individual value:', await s.page.evaluate((id) => document.getElementById(`pgF-${id}`)?.value, otra), '(vacío si la bandeja no tiene número)');
    }
  }
  log('ERRORES', j(s.errores.slice(0, 4)));
  await s.cerrar();
}
