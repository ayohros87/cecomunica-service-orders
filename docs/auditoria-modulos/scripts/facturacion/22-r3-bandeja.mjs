// Ejecución 2026-10-02 · R3 en el navegador: el chip "Pendientes" lleva un punto
// rojo con el conteo de correos en error, la fila trae "Reenviar" sin abrir el
// detalle, y el aviso que el servidor cerró por contrato vencido se lee
// "No aplica: Contrato vencido". Requiere 02-seed-prueba.js + 21-r3-cierre-avisos.js.
import { abrir, USUARIOS, j } from './_lib.mjs';
const log = (...a) => console.log(...a);
const PREF = 'PRUEBA-AUDIT-facturacion';
const idPend = `contrato_activo__${PREF}-contrato-6`;
const idEsp = `contrato_activo__${PREF}-contrato-6__esp`;

for (const [rol, email] of [['recepcion', USUARIOS.recepcion], ['contabilidad', USUARIOS.contabilidad]]) {
  const s = await abrir({ email, viewport: 'escritorio' });
  const info = await s.ir('/facturacion/bandeja.html'); log(rol.toUpperCase(), j(info));
  const dot = await s.page.evaluate(() => { const d = document.querySelector('#fbChips [data-err="all"]'); return d ? { hidden: d.hidden, title: d.title } : null; });
  log('PUNTO ROJO chip Pendientes', j(dot));
  log(dot && !dot.hidden && /\d+ con el correo sin salir/.test(dot.title) ? 'R3-D OK: el chip acusa el correo en error' : 'R3-D FALLA');
  const fila = await s.texto(`[data-row="${idPend}"] .fb-t2`).catch(() => '');
  log('FILA', fila.replace(/\n/g, ' '));
  const btn = await s.page.$(`[data-row="${idPend}"] .fb-t2 button.fb-reenviar`);
  log(btn ? 'R3-E OK: "Reenviar" visible en la fila' : 'R3-E FALLA: sin botón en la fila');
  if (btn && rol === 'recepcion') {
    await s.medir(() => btn.click());
    log('toast', j((await s.toasts()).slice(-1)));
    const abierta = await s.page.evaluate((id) => !!document.querySelector(`[data-row="${id}"].is-open`), idPend);
    log(abierta ? 'R3-F FALLA: el clic en Reenviar abrió la fila' : 'R3-F OK: el clic no abre el detalle');
  }
  await s.medir(() => s.page.click('#fbVerHechos'));
  const cerrada = await s.page.evaluate((id) => document.querySelector(`[data-row="${id}"]`)?.innerText.replace(/\s+/g, ' ') || '', idEsp);
  log('CERRADA', cerrada.slice(0, 160));
  await s.clic(`[data-row="${idEsp}"] .fb-main`).catch(() => {});
  const pie = await s.texto(`[data-row="${idEsp}"] .fb-detfoot`).catch(() => '');
  log('PIE', pie.replace(/\n/g, ' '));
  log(/No aplica: Contrato vencido/.test(pie) ? 'R3-G OK: motivo automático legible' : 'R3-G FALLA');
  log('ERRORES', j(s.errores.slice(0, 4)));
  if (rol === 'recepcion') await s.captura('r3-recepcion-bandeja-correo-error');
  await s.cerrar();
}
