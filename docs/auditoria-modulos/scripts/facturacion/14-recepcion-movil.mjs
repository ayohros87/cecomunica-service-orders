// Recorrido 14: la bandeja en teléfono y tablet, esperando a que pinten las filas (el 11 capturó antes).
import { abrir, USUARIOS, j } from './_lib.mjs';
for (const vp of ['telefono', 'tablet']) {
  const s = await abrir({ email: USUARIOS.recepcion, viewport: vp });
  const t0 = Date.now();
  const info = await s.ir('/facturacion/bandeja.html');
  await s.page.waitForFunction(() => document.querySelectorAll('#fbRows .fb-row').length > 0, { timeout: 20000 }).catch(() => null);
  console.log(vp.toUpperCase(), j(info), 'filas', (await s.textos('#fbRows .fb-row')).length, 'ms hasta filas', Date.now() - t0);
  console.log('GEO', j(await s.geometria()));
  await s.captura(`81-recepcion-${vp}-bandeja`);
  const b = await s.page.$('#fbRows .fb-row button[data-paso="qbo"]:not(.done)');
  if (b) {
    await b.click(); await s.espera(500);
    console.log('POP', await s.page.evaluate(() => { const p = document.querySelector('.fb-pop.show'); if (!p) return null; const r = p.getBoundingClientRect(); return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), vw: innerWidth, dentro: r.x >= 0 && r.right <= innerWidth }; }));
    await s.captura(`82-recepcion-${vp}-popover`);
  }
  // Fila abierta: ¿se lee el detalle?
  await s.page.evaluate(() => { document.querySelector('.fb-pop.show') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  await s.espera(400);   // render() repinta las filas: el handle anterior queda suelto
  const f = await s.page.$('#fbRows .fb-row .fb-main');
  if (f) { await f.click(); await s.espera(600); await s.captura(`83-recepcion-${vp}-detalle`); }
  console.log('ERRORES', j(s.errores.slice(0, 4)));
  await s.cerrar();
}
