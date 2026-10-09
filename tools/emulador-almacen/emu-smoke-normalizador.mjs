// Humo tras consolidar el normalizador en FMT (2026-10-09): las páginas que
// dejaron su copia tienen que seguir filtrando con y sin acentos, sin errores.
//   node emu-smoke-normalizador.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// Órdenes: el filtro de cliente usa normTxt (ordenes-state.js).
{
  const s = await abrir({ email: USUARIOS.recepcion, carpeta: 'smoke-norm' });
  await s.ir('/ordenes/index.html', { esperar: 2500 });
  await espera(1500);
  const antes = await s.page.evaluate(() => document.querySelectorAll('tr[data-orden-id], .orden-row').length);
  await s.page.type('#filtroCliente', 'SEGURIDÁD'); await espera(2500);
  const con = await s.page.evaluate(() => ({ n: document.querySelectorAll('tr[data-orden-id], .orden-row').length, txt: document.body.innerText.slice(0, 50) }));
  await s.page.evaluate(() => { const i = document.getElementById('filtroCliente'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await s.page.type('#filtroCliente', 'seguridad'); await espera(2500);
  const sin = await s.page.evaluate(() => document.querySelectorAll('tr[data-orden-id], .orden-row').length);
  console.log('── Órdenes: filas', antes, '→ con acento', con.n, '· sin acento', sin);
  ok(con.n > 0 && con.n === sin, 'el filtro de cliente ignora acentos (mismas filas con y sin tilde)');
  ok(!s.errores.length, 'Órdenes sin errores: ' + s.errores.join(' | '));
  await s.cerrar();
}
// Páginas que solo tienen que cargar sin ReferenceError de FMT.
for (const [rol, url] of [[USUARIOS.recepcion, '/ordenes/admin-equipos-cliente.html'], [USUARIOS.recepcion, '/ordenes/nuevo-batch.html'], [USUARIOS.admin, '/poc/nueva-consola.html'], [USUARIOS.admin, '/admin/clientes-duplicados.html'], [USUARIOS.admin, '/admin/refs-huerfanas.html'], [USUARIOS.inventario, '/almacen/index.html?tab=hoy']]) {
  const s = await abrir({ email: rol, carpeta: 'smoke-norm' });
  const info = await s.ir(url, { esperar: 2000 });
  await espera(800);
  const errs = s.errores.filter(e => /FMT|ReferenceError|is not defined|pageerror/.test(e));
  console.log('──', url, info.msTotal + 'ms', errs.length ? errs.join(' | ') : 'sin errores de FMT');
  ok(!errs.length, `${url} carga sin errores de referencia`);
  await s.cerrar();
}
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
