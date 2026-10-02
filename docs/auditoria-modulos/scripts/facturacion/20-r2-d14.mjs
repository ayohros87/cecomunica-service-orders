// Ejecución 2026-10-01 · R2 + D14: "Ver hechos" trae la lista del servidor aun
// después de cerrar algo en la sesión; la barra de Finanzas ya no muestra
// "Facturará la app", "Emisión" ni "Panorama" (gerencia y contabilidad), y
// recepción sigue sin barra. Requiere 02-seed-prueba.js.
import { abrir, USUARIOS, j } from './_lib.mjs';
const log = (...a) => console.log(...a);
const PREF = 'PRUEBA-AUDIT-facturacion';

// ── R2 como recepción ───────────────────────────────────────────────────────
let s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio' });
let info = await s.ir('/facturacion/bandeja.html'); log('BANDEJA recepcion', j(info));
log('TABS (debe ser vacío)', j(await s.textos('#wsTabs-mount a')));
// Cierra la cotización de prueba (solo QBO aplica) → entra a `cerrados` local
const idCot = `cotizacion_servicio__${PREF}-2`;
await s.clic(`[data-row="${idCot}"] button[data-paso="qbo"]`);
await s.page.type(`.fb-pop[data-pop="${idCot}"] [data-f="factura"]`, '11010');
await s.medir(() => s.page.click(`.fb-pop[data-pop="${idCot}"] [data-act="pop-ok"]`));
log('toast', j((await s.toasts()).slice(-1)));
// Ahora "Ver hechos": antes decía (1); debe traer los del servidor (45+)
await s.medir(() => s.page.click('#fbVerHechos'));
const sep = await s.texto('.fb-sep').catch(() => '');
log('R2 sep tras cerrar en sesión →', sep.replace(/\n/g, ' '));
const n = Number((sep.match(/\((\d+)\)/) || [])[1] || 0);
log(n >= 40 ? 'R2 OK: la lista viene del servidor' : 'R2 FALLA: lista local');
log('ERRORES', j(s.errores.slice(0, 4)));
await s.cerrar();

// ── D14 como gerencia y contabilidad ────────────────────────────────────────
for (const [rol, email] of [['gerencia', USUARIOS.gerencia], ['contabilidad', USUARIOS.contabilidad]]) {
  s = await abrir({ email, viewport: 'escritorio' });
  info = await s.ir('/facturacion/bandeja.html'); log(rol.toUpperCase(), j(info));
  const tabs = await s.textos('#wsTabs-mount a');
  log('TABS', j(tabs));
  const malas = tabs.filter(t => /Facturará|Emisión|Panorama/.test(t));
  log(malas.length ? 'D14 FALLA: ' + malas.join(',') : 'D14 OK: 4 pestañas');
  // Por URL la página escondida sigue viva y pinta su pestaña al final
  info = await s.ir('/facturacion/activacion.html'); log('activacion por URL', j(info));
  log('TABS en activacion', j(await s.textos('#wsTabs-mount a')));
  log('ERRORES', j(s.errores.slice(0, 4)));
  await s.cerrar();
}
