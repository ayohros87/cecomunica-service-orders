// Imprimir la orden a un clic (2026-10-13, del log de uso: Brenda imprime el
// papel Y lo abre para ver la orden, ~14 veces al día):
//   1. bandeja: cada fila trae el icono de imprimir fuera del ⋯ (y el ⋯ lo
//      conserva); la ficha lateral también lo lista entre sus verbos;
//   2. nuevo-batch: "Guardar e imprimir" guarda los equipos, manda la hoja a
//      la pestaña abierta en el clic y aterriza en la bandeja con la orden.
// Corre contra el emulador (export del 30-sep) con `npm run build` hecho:
//   node tools/emulador-almacen/emu-test-imprimir-orden.mjs
import { abrir, USUARIOS, BASE } from './emu-lib.mjs';

const fallos = [];
const ok = (cond, msg) => { console.log((cond ? 'OK     ' : 'FALLA  ') + msg); if (!cond) fallos.push(msg); };
const limpio = (s) => s.errores.filter(e => !/favicon|Uso|uso_diario/.test(e));

const s = await abrir({ email: USUARIOS.recepcion, carpeta: 'imprimir-orden' });
const p = s.page;
let abierto = null;
await p.exposeFunction('__regOpen', (u) => { abierto = u; });

// ── 1. Bandeja ────────────────────────────────────────────────────────────
const i = await s.ir('/ordenes/index.html', { esperar: 1500 });
ok(i.url.startsWith('/ordenes/index.html'), 'recepción: abre la bandeja');
const n = await p.evaluate(() => ({
  filas: document.querySelectorAll('tr[data-orden-row]').length,
  iconos: document.querySelectorAll('tr[data-orden-row] .btn-fila-icono[data-action="imprimir-orden-doc"]').length,
  enMenu: document.querySelectorAll('tr[data-orden-row] .overflow-menu-item[data-action="imprimir-orden-doc"]').length,
}));
ok(n.filas > 0 && n.iconos === n.filas, `bandeja: icono de imprimir en TODAS las filas (${n.iconos}/${n.filas})`);
ok(n.enMenu === n.filas, `bandeja: el ⋯ conserva "Imprimir orden" (${n.enMenu}/${n.filas})`);
await s.captura('fila-con-imprimir', { el: 'tr[data-orden-row] td.acciones' });

await p.evaluate(() => { window.open = (u) => { window.__regOpen(String(u)); return null; }; });
const primeraId = await p.evaluate(() => document.querySelector('tr[data-orden-row] .btn-fila-icono')?.dataset.ordenId || '');
await p.click('tr[data-orden-row] .btn-fila-icono');
await new Promise(r => setTimeout(r, 400));
ok(abierto && abierto.includes('imprimir-orden.html?id=' + primeraId), `bandeja: el icono abre la hoja de ${primeraId} (${abierto})`);
ok(!(await p.$('.overflow-menu-dropdown.open, .overflow-menu-dropdown.show')), 'bandeja: el clic no abre el ⋯ ni expande la fila');

// La ficha lateral lista Imprimir entre sus verbos.
await s.clic('tr[data-orden-row] .orden-id--btn');
const enFicha = await p.$('.of-drawer [data-action="imprimir-orden-doc"]');
ok(!!enFicha, 'ficha lateral: trae el verbo "Imprimir orden"');
await p.keyboard.press('Escape');
await s.quieto(600);

// ── 2. Nuevo lote → Guardar e imprimir ────────────────────────────────────
const orden = await p.evaluate(() => {
  const o = (window.APP?.state?.orders || []).find(x => (x.estado_reparacion || 'POR ASIGNAR').toUpperCase() === 'POR ASIGNAR'
    && !/VISITA|DEVOLUCI/i.test(x.tipo_de_servicio || ''));
  return o ? o.ordenId : '';
});
ok(!!orden, 'hay una orden POR ASIGNAR para el lote: ' + orden);
abierto = null;
let hoja = null;
await p.exposeFunction('__regHoja', (u) => { hoja = u; });
const b = await s.ir('/ordenes/nuevo-batch.html?orden_id=' + encodeURIComponent(orden), { esperar: 1500 });
ok(b.url.startsWith('/ordenes/nuevo-batch.html'), 'recepción: abre Nuevo lote de la orden');
ok(!!(await p.$('#btnGuardarImprimir')), 'nuevo-batch: existe "Guardar e imprimir"');
await s.captura('batch-botones', { el: '.form-actions' });

await p.evaluate(() => {
  // La pestaña de la hoja se simula: se registra lo que se le escribe y la URL que recibe.
  window.open = (u) => {
    window.__regOpen(String(u));
    const w = { closed: false, document: { write() {} }, close() { this.closed = true; }, location: {} };
    Object.defineProperty(w.location, 'href', { set(v) { window.__regHoja(String(v)); }, get() { return ''; } });
    return w;
  };
  if (!document.querySelector('#filasBatch tr')) window.agregarFila();
  const tr = document.querySelector('#filasBatch tr');
  tr.querySelector('.serie').value = 'EMUIMP' + Date.now().toString().slice(-6);
  tr.querySelector('.serie').dispatchEvent(new Event('input', { bubbles: true }));
  const m = tr.querySelector('.modelo'); const op = [...m.options].find(o => o.value);
  if (op) { m.value = op.value; m.dispatchEvent(new Event('change', { bubbles: true })); }
});
await s.quieto(800);
const serial = await p.evaluate(() => document.querySelector('#filasBatch tr .serie').value);
await p.click('#btnGuardarImprimir');
const fin = Date.now() + 20000;
while (Date.now() < fin) {
  await new Promise(r => setTimeout(r, 300));
  if ((await p.evaluate(() => location.pathname + location.search).catch(() => '')).includes('/ordenes/index.html?orden=')) break;
  const c = await p.$('.modal-backdrop.open [data-action="confirm"]');
  if (c) await c.click();
}
const landed = await p.evaluate(() => location.pathname + location.search);
ok(abierto === '', 'guardar e imprimir: la pestaña se abre en blanco DENTRO del clic (' + JSON.stringify(abierto) + ')');
ok(hoja && hoja.includes('/ordenes/imprimir-orden.html?id=' + encodeURIComponent(orden)), 'guardar e imprimir: la pestaña recibe la hoja de la orden (' + hoja + ')');
ok(landed === '/ordenes/index.html?orden=' + encodeURIComponent(orden), 'guardar e imprimir: aterriza en la bandeja con la orden (' + landed + ')');

// La hoja, vista desde la pestaña parchada, trae el equipo recién guardado.
if (hoja) {
  await s.ir(new URL(hoja).pathname + new URL(hoja).search, { esperar: 1500 });
  const txt = await p.evaluate(() => (document.getElementById('infoContainer')?.innerText || '') + '\n' + (document.getElementById('tablaContainer')?.innerText || ''));
  ok(txt.includes(orden) && txt.includes(serial), `hoja: muestra la orden ${orden} y el serial ${serial}`);
  await s.captura('hoja-orden');
}
const errs = limpio(s);
ok(!errs.length, 'sin errores ' + JSON.stringify(errs));
await s.browser.close();

console.log(fallos.length ? `\n${fallos.length} FALLA(S)` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
