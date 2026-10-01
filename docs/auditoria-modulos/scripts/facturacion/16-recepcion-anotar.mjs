// Recorrido 16 (recepción): anotar el número de factura en un QBO hecho sin número ("?"), con el error del popover a la vista.
import { abrir, USUARIOS, j } from './_lib.mjs';
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio' });
const id4 = `contrato_activo__PRUEBA-AUDIT-facturacion-4`;
await s.ir('/facturacion/bandeja.html');
await s.page.click('#fbVerHechos');
await s.page.waitForSelector('.fb-sep', { timeout: 15000 });   // listCerrados no está envuelto por emu-lib: esperar la lista, no el silencio del DOM
await s.espera(300);
const fila = await s.textos(`[data-row="${id4}"] .fb-main`);
console.log('FILA 4', fila[0]?.slice(0, 160));
await s.clic(`[data-row="${id4}"] button[data-paso="qbo"]`);
console.log('POP', (await s.texto(`.fb-pop[data-pop="${id4}"]`)).replace(/\n/g, ' | ').slice(0, 200));
await s.page.type(`.fb-pop[data-pop="${id4}"] [data-f="factura"]`, '11004');
await s.page.evaluate((id) => document.querySelector(`[data-act="pop-factura"][data-id="${id}"]`)?.scrollIntoView({ block: 'center' }), id4);
const ms = await s.medir(() => s.page.evaluate((id) => document.querySelector(`[data-act="pop-factura"][data-id="${id}"]`)?.click(), id4));
console.log('anotar ms', ms, 'err:', await s.texto(`.fb-pop[data-pop="${id4}"] .err`).catch(() => '(pop cerrado)'), 'toasts', j(await s.toasts()), 'errores', j(s.errores.slice(0, 3)));
console.log('FILA 4 después', (await s.textos(`[data-row="${id4}"] .fb-main`))[0]?.slice(0, 160), '| ¿sigue el "?"', !!(await s.page.$(`[data-row="${id4}"] button.sin-num`)));
await s.captura('88-recepcion-escritorio-anotar-numero-resultado');
await s.cerrar();
