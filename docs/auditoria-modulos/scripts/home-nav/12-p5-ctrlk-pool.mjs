// Verificación P5 (08-home-navegacion-admin): Ctrl+K encuentra un serial que
// SOLO está en el pool (bodega), el cliente abre el Centro directo y, cuando
// las reglas niegan una colección, el palette lo dice.
// Antes: "014290000053877" → Sin resultados; cliente → clientes/editar.html →
// redirección → ficha de solo lectura; "COT-…" como bodega → silencio.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

async function buscar(s, q) {
  const t0 = Date.now();
  await s.page.evaluate((q) => Layout.abrirBusqueda(q), q);
  await s.page.waitForFunction(() => { const r = document.getElementById('sp-results'); return r && !/Buscando|al menos 2/.test(r.innerText); }, { timeout: 15000 }).catch(() => {});
  const ms = Date.now() - t0;
  const d = await s.page.evaluate(() => ({
    groups: [...document.querySelectorAll('#sp-results .sp-group')].map(g => ({ g: g.querySelector('.sp-group-head')?.innerText.replace(/\s+/g, ' ').trim(), rows: [...g.querySelectorAll('.sp-row')].map(r => ({ t: r.querySelector('.sp-row-title')?.innerText.trim(), s: r.querySelector('.sp-row-sub')?.innerText.trim(), h: r.getAttribute('href') })) })),
    hint: [...document.querySelectorAll('#sp-results .sp-hint')].map(h => h.innerText.trim()).join(' | '),
  }));
  await s.page.evaluate(() => window.SearchPalette && SearchPalette.close());
  return { ms, ...d };
}
const resumen = (r) => r.groups.map(g => `${g.g}: ${g.rows.map(x => `${x.t}${x.s ? ' (' + x.s.slice(0, 50) + ')' : ''} → ${x.h}`).join(' / ')}`).join(' || ') || r.hint;

for (const [rol, pag, consultas] of [
  ['inventario', '/almacen/index.html', [['serial SOLO en el pool', '014290000053877'], ['serial a medias', '0142900000538'], ['cotización (sin permiso)', 'COT-2026-0138'], ['cliente', 'C COMUNICA']]],
  ['recepcion', '/ordenes/index.html', [['cliente', 'C COMUNICA'], ['serial en pool y PoC', '23706A0608']]],
  ['tecnico', '/ordenes/index.html', [['serial SOLO en el pool (sin Almacén)', '014290000053877'], ['cliente (sin Centro)', 'C COMUNICA']]],
]) {
  const s = await abrir({ email: USUARIOS[rol], viewport: 'escritorio', carpeta: 'home-nav' });
  await s.ir(pag, { esperar: 1000 });
  console.log(`\n=== ${rol} desde ${pag} ===`);
  for (const [que, q] of consultas) {
    const r = await buscar(s, q);
    console.log(`[${que}] "${q}" → ${r.ms} ms · ${resumen(r)}${r.groups.length && r.hint ? ' | ' + r.hint : ''}`);
  }
  if (rol === 'inventario') {
    // Enter en el serial del pool: ¿aterriza con la ficha abierta?
    await s.page.evaluate(() => Layout.abrirBusqueda('014290000053877'));
    await s.page.waitForFunction(() => document.querySelector('#sp-results .sp-row'), { timeout: 15000 }).catch(() => {});
    const t1 = Date.now();
    await s.page.keyboard.press('Enter');
    await s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await s.quieto(1500, 20000);
    const r = await s.page.evaluate(() => ({ url: location.pathname + location.search, ficha: !!document.querySelector('.eqficha-overlay, .eqpool-ficha, [data-eqficha]') || document.body.innerText.includes('014290000053877'), titulo: document.querySelector('.eqficha h3, .eqficha-title')?.innerText }));
    console.log(`Enter en el serial del pool → ${Date.now() - t1} ms →`, JSON.stringify(r));
    await s.captura('92-inventario-escritorio-ctrlk-pool-enter');
  }
  if (rol === 'recepcion') {
    await s.page.evaluate(() => Layout.abrirBusqueda('C COMUNICA'));
    await s.page.waitForFunction(() => document.querySelector('#sp-results .sp-row'), { timeout: 15000 }).catch(() => {});
    const t1 = Date.now();
    await s.page.keyboard.press('Enter');
    await s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await s.quieto(1500, 20000);
    console.log(`Enter en el cliente → ${Date.now() - t1} ms →`, JSON.stringify(await s.page.evaluate(() => ({ url: location.pathname + location.search, ficha: !document.getElementById('vistaFicha')?.classList.contains('hidden'), titulo: document.querySelector('#vistaFicha h2, .cg-ficha-head h2, #cgNombre')?.innerText?.slice(0, 50) }))));
    await s.captura('93-recepcion-escritorio-ctrlk-cliente-centro');
  }
  await s.cerrar();
}
