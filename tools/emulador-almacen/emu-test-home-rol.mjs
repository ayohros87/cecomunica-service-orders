// Home por rol (2026-10-09) contra el emulador: el inicio del vendedor es el
// Centro (redirección + rail), el técnico ve su lista de órdenes abierta
// sola, el administrador ve sus señales en tres bloques con rótulo, y
// recepción sigue igual. Solo abre y lee.
//   node emu-test-home-rol.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };

// ═══ A · Vendedor: inicio = Centro ═══
{
  const s = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'home-rol' });
  await s.ir('/index.html', { esperar: 1500 });
  const llego = await s.page.waitForFunction(() => location.pathname.includes('/clientes/centro'), { timeout: 15000 }).then(() => true).catch(() => false);
  ok(llego, `el vendedor que entra al home aterriza en el Centro (${await s.page.evaluate(() => location.pathname)})`);
  await s.quieto(1500, 15000);
  const rail = await s.page.evaluate(() => ({
    inicio: document.querySelector('#ccRail a[title="Inicio"]')?.getAttribute('href'),
    inicioActivo: document.querySelector('#ccRail a[title="Inicio"]')?.classList.contains('is-active'),
    centroLink: !!document.querySelector('#ccRail a[title="Centro de gestión"]'),
    tiles: [...document.querySelectorAll('#cgSenales .cg-senal .lbl')].map(e => e.textContent.trim()),
    cotiz: document.querySelector('#cgSenales a.cg-senal[href*="cotizaciones"]')?.textContent.replace(/\s+/g, ' ').trim() || '',
  }));
  console.log('\n── vendedor · Centro como inicio', JSON.stringify(rail));
  ok(rail.inicio === '/clientes/centro.html', `"Inicio" del rail apunta al Centro (${rail.inicio})`);
  ok(rail.inicioActivo, '"Inicio" sale activo estando en el Centro');
  ok(!rail.centroLink, 'no hay entrada duplicada "Centro de gestión" en el rail');
  ok(rail.tiles.includes('Mis cotizaciones'), `tile "Mis cotizaciones" en las señales del Centro (${rail.tiles.join(' · ')})`);
  await s.page.waitForFunction(() => !/…/.test(document.querySelector('#cgSenales a.cg-senal[href*="cotizaciones"]')?.textContent || '…'), { timeout: 15000 }).catch(() => {});
  const cotiz = await s.page.evaluate(() => document.querySelector('#cgSenales a.cg-senal[href*="cotizaciones"] .v')?.textContent.trim());
  ok(/^\d+$/.test(cotiz || ''), `el conteo de cotizaciones llegó (${cotiz})`);
  await s.captura('vendedor-centro-inicio');
  ok(s.errores.length === 0, `sin errores ${s.errores.length ? JSON.stringify(s.errores).slice(0, 200) : ''}`);
  await s.cerrar();
}

// ═══ B · Técnico: su lista abierta sola ═══
{
  const s = await abrir({ email: USUARIOS.tecnico, viewport: 'escritorio', carpeta: 'home-rol' });
  await s.ir('/index.html', { esperar: 2000 });
  const hayPanel = await s.page.waitForSelector('[data-signal-panel="S5"] .bj-row, [data-signal-panel="S5"] .bj-lista-vacia', { timeout: 20000 }).then(() => true).catch(() => false);
  const r = await s.page.evaluate(() => ({
    tiles: document.querySelectorAll('#signalsRow .kpi').length,
    abierto: document.querySelector('#signalsRow [data-signal="S5"]')?.getAttribute('aria-expanded'),
    titulo: document.querySelector('[data-signal-panel="S5"] .bj-panel-h')?.textContent.replace(/\s+/g, ' ').trim() || '',
    filas: document.querySelectorAll('[data-signal-panel="S5"] .bj-row').length,
    ctas: [...document.querySelectorAll('[data-signal-panel="S5"] .bj-row a.bj-cta')].map(a => a.getAttribute('href')).slice(0, 3),
  }));
  console.log('\n── técnico · inicio', JSON.stringify(r));
  ok(hayPanel && r.abierto === 'true', 'la señal "Mis órdenes asignadas" se abre sola como lista');
  ok(/Mis órdenes asignadas/.test(r.titulo), `panel con su título (${r.titulo})`);
  ok(r.filas === 0 || r.ctas.every(h => /\?ficha=/.test(h)), `cada fila abre la ficha de la orden (${r.ctas.join(' · ') || 'sin filas'})`);
  await s.captura('tecnico-inicio');
  ok(s.errores.length === 0, `sin errores ${s.errores.length ? JSON.stringify(s.errores).slice(0, 200) : ''}`);
  await s.cerrar();
}

// ═══ C · Administrador: tres bloques ═══
{
  const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'home-rol' });
  await s.ir('/index.html', { esperar: 2500 });
  await s.page.waitForFunction(() => document.querySelectorAll('#signalsRow .kpi:not(.is-loading)').length > 0, { timeout: 20000 }).catch(() => {});
  const r = await s.page.evaluate(() => ({
    grupos: [...document.querySelectorAll('#signalsRow .kpis-grupo:not([hidden])')].map(g => `${g.querySelector('.kpis-grupo__label').textContent.trim()}: ${g.querySelectorAll('.kpi').length}`),
    sueltas: document.querySelectorAll('#signalsRow .kpis > .kpi').length,
    total: document.querySelectorAll('#signalsRow .kpi').length,
    cero: document.querySelectorAll('#signalsRow .kpis-zero .kpi').length,
  }));
  console.log('\n── admin · inicio', JSON.stringify(r));
  ok(r.grupos.length >= 2, `señales en bloques con rótulo (${r.grupos.join(' · ')})`);
  ok(r.sueltas === 0, `ninguna tarjeta suelta fuera de su bloque (${r.sueltas})`);
  ok(r.total >= 6, `las señales siguen todas (${r.total}, ${r.cero} en cero)`);
  await s.captura('admin-inicio');
  ok(s.errores.length === 0, `sin errores ${s.errores.length ? JSON.stringify(s.errores).slice(0, 200) : ''}`);
  // "Ver como vendedor" se queda en el home
  await s.ir('/index.html?as=vendedor', { esperar: 2000 });
  const quedo = await s.page.evaluate(() => location.pathname);
  ok(/index\.html|^\/$/.test(quedo), `"Ver como vendedor" no redirige (${quedo})`);
  await s.cerrar();
}

// ═══ D · Recepción: como antes ═══
{
  const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'home-rol' });
  await s.ir('/index.html', { esperar: 2500 });
  const r = await s.page.evaluate(() => ({ grupos: document.querySelectorAll('#signalsRow .kpis-grupo').length, total: document.querySelectorAll('#signalsRow .kpi').length, path: location.pathname }));
  ok(r.grupos === 0 && r.total >= 4 && /index/.test(r.path), `recepción: sin bloques, ${r.total} señales, se queda en el home`);
  ok(s.errores.length === 0, `sin errores ${s.errores.length ? JSON.stringify(s.errores).slice(0, 200) : ''}`);
  await s.cerrar();
}

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
