// Ficha lateral de la orden (2026-10-09) contra el emulador: el número de la
// fila abre una hoja a la derecha con cabecera, los MISMOS verbos que la fila
// (flujo + menú ⋯), equipos e historial; ?ficha=<id> la abre al cargar; en el
// teléfono entra por el número de la tarjeta. Solo abre y lee.
//   node emu-test-ficha-orden.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };

async function leerFicha(s) {
  return s.page.evaluate(() => {
    const d = document.querySelector('.modal-backdrop.of-drawer');
    if (!d) return null;
    const t = (q) => d.querySelector(q)?.textContent.replace(/\s+/g, ' ').trim() || '';
    return {
      titulo: t('.modal-title'), cliente: t('.of-cliente'), estado: t('.chip-estado'),
      verbos: [...d.querySelectorAll('.of-verbos [data-action]')].map(b => b.dataset.action),
      equipos: d.querySelectorAll('.of-eq').length, historial: d.querySelectorAll('.timeline-entry').length,
      bloques: [...d.querySelectorAll('.of-bloque h4')].map(h => h.textContent.trim()),
      ancho: Math.round(d.querySelector('.modal').getBoundingClientRect().width),
      derecha: Math.round(innerWidth - d.querySelector('.modal').getBoundingClientRect().right),
    };
  });
}
async function verbosDeLaFila(s, ordenId) {
  return s.page.evaluate((id) => {
    const fila = document.querySelector(`tr[data-orden-id="${CSS.escape(id)}"]`);
    if (!fila) return null;
    const acc = [...fila.querySelectorAll('.acciones [data-action]')].map(b => b.dataset.action)
      .filter(a => !['toggle-overflow-menu', 'eliminar-orden'].includes(a));
    const deshab = [...fila.querySelectorAll('.acciones .overflow-menu-item[disabled]')].length;
    return { acc: [...new Set(acc)], deshab };
  }, ordenId);
}

// ═══ A · Recepción en escritorio ═══
{
  const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ficha-orden' });
  await s.ir('/ordenes/index.html', { esperar: 2000 });
  await s.page.waitForSelector('tr[data-orden-id] .orden-id--btn', { timeout: 20000 });
  const ordenId = await s.page.evaluate(() => document.querySelector('tr[data-orden-id] .orden-id--btn')?.dataset.ordenId);
  ok(!!ordenId, `hay una orden en la bandeja (${ordenId})`);
  const expandidoAntes = await s.page.evaluate(() => document.querySelectorAll('tr.filaDetalle[style*="table-row"]').length);
  await s.clic('tr[data-orden-id] .orden-id--btn', { esperar: 800 });
  await s.page.waitForSelector('.modal-backdrop.of-drawer', { timeout: 10000 }).catch(() => {});
  const f = await leerFicha(s);
  console.log('\n── recepción · ficha', JSON.stringify(f));
  ok(!!f, 'el número abre la ficha lateral');
  if (f) {
    ok(f.titulo.includes(ordenId), `título con el número (${f.titulo})`);
    ok(f.cliente.length > 2, `cliente en la cabecera (${f.cliente})`);
    ok(f.estado.length > 2, `estado en la cabecera (${f.estado})`);
    ok(f.derecha <= 2 && f.ancho >= 500, `hoja pegada a la derecha (${f.ancho}px, a ${f.derecha}px del borde)`);
    ok(f.bloques.some(b => /Equipos/.test(b)), `bloque de equipos (${f.bloques.join(' · ')})`);
    const fila = await verbosDeLaFila(s, ordenId);
    const faltan = (fila?.acc || []).filter(a => !f.verbos.includes(a));
    ok(fila && faltan.length === 0, `los verbos de la ficha son los de la fila (fila ${JSON.stringify(fila?.acc)} · ficha ${JSON.stringify(f.verbos)}${faltan.length ? ' · faltan ' + faltan : ''})`);
    ok(f.verbos.includes('imprimir-orden-doc') || f.verbos.includes('imprimir-orden'), 'imprimir es un verbo de la ficha');
  }
  const expandidoDespues = await s.page.evaluate(() => document.querySelectorAll('tr.filaDetalle[style*="table-row"]').length);
  ok(expandidoAntes === expandidoDespues, 'el clic en el número NO expande la fila (stopPropagation)');
  await s.captura('recepcion-ficha');
  ok(s.errores.length === 0, `sin errores ${s.errores.length ? JSON.stringify(s.errores).slice(0, 200) : ''}`);
  // Escape cierra
  await s.page.keyboard.press('Escape'); await s.quieto(500, 5000);
  ok(!(await leerFicha(s)), 'Escape cierra la ficha');

  // Deep-link ?ficha=<id>
  await s.ir(`/ordenes/index.html?ficha=${encodeURIComponent(ordenId)}`, { esperar: 2500 });
  await s.page.waitForSelector('.modal-backdrop.of-drawer', { timeout: 15000 }).catch(() => {});
  const f2 = await leerFicha(s);
  ok(f2 && f2.titulo.includes(ordenId), `?ficha=<id> abre la ficha al cargar (${f2?.titulo})`);
  ok(s.errores.length === 0, `deep-link sin errores ${s.errores.length ? JSON.stringify(s.errores).slice(0, 200) : ''}`);
  await s.cerrar();
}

// ═══ B · Técnico en teléfono: la tarjeta abre la ficha ═══
{
  const s = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ficha-orden' });
  await s.ir('/ordenes/index.html', { esperar: 2500 });
  const hay = await s.page.waitForSelector('.card-contrato__ord', { timeout: 20000 }).then(() => true).catch(() => false);
  ok(hay, 'hay tarjetas en el teléfono');
  if (hay) {
    await s.clic('.card-contrato__ord', { esperar: 800 });
    await s.page.waitForSelector('.modal-backdrop.of-drawer', { timeout: 10000 }).catch(() => {});
    const f = await leerFicha(s);
    console.log('\n── técnico · teléfono', JSON.stringify(f));
    ok(!!f, 'el número de la tarjeta abre la ficha');
    const g = await s.geometria();
    ok(!g.scrollHorizontal, 'sin scroll horizontal con la ficha abierta');
    await s.captura('tecnico-telefono-ficha');
  }
  ok(s.errores.length === 0, `sin errores ${s.errores.length ? JSON.stringify(s.errores).slice(0, 200) : ''}`);
  await s.cerrar();
}

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
