// Flujos que ahorran tiempo (2026-10-12, del log de uso):
//   1. vendedora: index.html (frío y tibio) y login.html aterrizan en el Centro;
//   2. recepción y admin: el inicio sigue siendo el inicio;
//   3. recepción: al guardar un lote PoC sale "Lote guardado" con "Imprimir la
//      hoja", que abre imprimir-equipos con SOLO los equipos del lote.
// Corre contra el emulador (export del 30-sep) con `npm run build` hecho:
//   node tools/emulador-almacen/emu-test-flujos-ahorro.mjs
import { abrir, USUARIOS, BASE } from './emu-lib.mjs';

const fallos = [];
const ok = (cond, msg) => { console.log((cond ? 'OK     ' : 'FALLA  ') + msg); if (!cond) fallos.push(msg); };
const sinRebote = (s) => s.errores.filter(e => !/rebotó a login\.html|favicon/.test(e));

// ── 1. Vendedora ───────────────────────────────────────────────────────────
{
  const s = await abrir({ email: USUARIOS.vendedor, carpeta: 'flujos-ahorro' });
  const frio = await s.ir('/index.html');
  ok(frio.url.startsWith('/clientes/centro.html'), `vendedora: index frío → Centro (${frio.msTotal} ms)`);
  ok(!sinRebote(s).length, 'vendedora: sin errores en el camino frío ' + JSON.stringify(sinRebote(s)));

  // Tibio: el rol ya está en sessionStorage; el salto debe ocurrir antes de Auth.
  const t0 = Date.now();
  await s.page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await s.page.waitForFunction(() => location.pathname.includes('/clientes/centro.html'), { timeout: 10000 });
  const msTibio = Date.now() - t0;
  ok(msTibio < 1500, `vendedora: index tibio → Centro en ${msTibio} ms (antes esperaba Auth + Firestore)`);
  await s.quieto(1200);

  const login = await s.ir('/login.html');
  ok(login.url.startsWith('/clientes/centro.html'), `vendedora: login → Centro directo (${login.msTotal} ms)`);
  ok(!sinRebote(s).length, 'vendedora: sin errores desde el login ' + JSON.stringify(sinRebote(s)));
  await s.captura('vendedora-centro-desde-login');
  await s.browser.close();
}

// ── 2. Recepción y admin: el inicio sigue siendo el inicio ────────────────
for (const [rol, email] of [['recepcion', USUARIOS.recepcion], ['admin', USUARIOS.admin]]) {
  const s = await abrir({ email, carpeta: 'flujos-ahorro' });
  const i = await s.ir('/index.html');
  ok(i.url.startsWith('/index.html'), `${rol}: index se queda en index`);
  const l = await s.ir('/login.html');
  ok(l.url.startsWith('/index.html'), `${rol}: login → index`);
  ok(!sinRebote(s).length, `${rol}: sin errores ` + JSON.stringify(sinRebote(s)));
  await s.browser.close();
}

// ── 3. Recepción: lote PoC → "Imprimir la hoja" ───────────────────────────
{
  const s = await abrir({ email: USUARIOS.recepcion, carpeta: 'flujos-ahorro' });
  const p = s.page;
  const i = await s.ir('/POC/nuevo-batch.html', { esperar: 1500 });
  ok(i.url.startsWith('/POC/nuevo-batch.html'), 'recepción: abre Nuevo lote');

  const cliente = await p.evaluate(() => {
    const sel = document.getElementById('cliente');
    const op = [...sel.options].find(o => o.value && /emulador|prueba/i.test(o.textContent)) || [...sel.options].find(o => o.value);
    sel.value = op.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return op.textContent;
  });
  await s.quieto(1200);
  await p.evaluate(() => {
    const ip = document.getElementById('ip');
    const op = [...ip.options].find(o => o.value);
    if (op) { ip.value = op.value; ip.dispatchEvent(new Event('change', { bubbles: true })); }
    // Serial y Unit ID únicos por corrida: el emulador conserva los lotes de
    // corridas anteriores y el validador de duplicados los frenaría.
    const sufijo = Date.now().toString().slice(-6);
    document.getElementById('unit_id_inicial').value = '9' + sufijo.slice(0, 4);
    document.getElementById('seriales').value = `EMUAHORRO${sufijo}A\nEMUAHORRO${sufijo}B`;
    document.getElementById('seriales').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await s.quieto(1200);
  console.log('       cliente del lote:', cliente);

  await p.click('#batchForm [type="submit"]');
  // Cualquier confirmación intermedia (lote parcial, seriales ajenos…) se acepta.
  const fin = Date.now() + 25000;
  let hoja = null;
  while (Date.now() < fin && !hoja) {
    await new Promise(r => setTimeout(r, 300));
    hoja = await p.$('[data-sheet-action="imprimir"]');
    if (hoja) break;
    const confirmar = await p.$('.modal-backdrop.open [data-action="confirm"], .modal-backdrop.open [data-sheet-action="seguir"]');
    if (confirmar) await confirmar.click();
  }
  ok(!!hoja, 'recepción: tras guardar aparece "Lote guardado" con "Imprimir la hoja"');
  const texto = hoja ? await p.evaluate(() => document.querySelector('.modal-backdrop.open .modal')?.innerText || '') : '';
  ok(/2.*equipo/.test(texto), 'recepción: la hoja dice cuántos equipos (' + texto.replace(/\s+/g, ' ').slice(0, 90) + ')');
  await s.captura('lote-guardado-sheet');

  // La pestaña nueva no pasa por el parche del emulador (la intercepción es
  // de ESTA página), así que se captura la URL que abriría window.open y se
  // visita después desde la misma pestaña parchada.
  // Se registra desde Node (exposeFunction) porque la página navega a la Base
  // PoC justo después y un window.__abierto se perdería con ella.
  let abierto = null;
  await p.exposeFunction('__regOpen', (u, t) => { abierto = { u, t }; });
  await p.evaluate(() => { window.open = (u, t) => { window.__regOpen(u, t); return null; }; });
  if (hoja) await hoja.click();
  await new Promise(r => setTimeout(r, 500));
  ok(abierto && /imprimir-equipos\.html\?ids=/.test(abierto.u) && abierto.t === '_blank', 'recepción: "Imprimir la hoja" abre imprimir-equipos en otra pestaña ' + JSON.stringify(abierto));
  const ids = abierto ? JSON.parse(new URL(abierto.u, BASE + '/POC/').searchParams.get('ids') || '[]') : [];
  ok(ids.length === 2, 'recepción: la URL lleva los 2 ids del lote');
  await p.waitForFunction(() => location.pathname.endsWith('/POC/index.html'), { timeout: 10000 }).catch(() => {});
  ok((await p.evaluate(() => location.pathname)).endsWith('/POC/index.html'), 'recepción: la pestaña original sigue a la Base PoC');
  if (abierto) {
    await s.ir('/POC/' + abierto.u, { esperar: 1500 });
    await p.waitForFunction(() => document.querySelectorAll('#cuerpoTabla tr').length >= 2, { timeout: 15000 }).catch(() => {});
    const filas = await p.evaluate(() => [...document.querySelectorAll('#cuerpoTabla tr')].map(tr => tr.children[1]?.textContent.trim()));
    ok(filas.length === 2 && filas.every(f => f.startsWith('EMUAHORRO')), 'recepción: la hoja trae SOLO los 2 del lote ' + JSON.stringify(filas));
    await s.captura('hoja-programacion-lote');
  }
  const errs = sinRebote(s).filter(e => !/Uso|uso_diario/.test(e));
  ok(!errs.length, 'recepción: sin errores ' + JSON.stringify(errs));
  await s.browser.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLA(S)` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
