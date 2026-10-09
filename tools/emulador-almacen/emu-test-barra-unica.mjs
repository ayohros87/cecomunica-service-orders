// Barra única de bandeja (2026-10-09) contra el emulador: en Órdenes,
// Cotizaciones, Contratos, Facturación, Comisiones, Regularización y Centro
// los chips son .bj-filtro del kit (mismo alto, misma forma), no queda ninguna
// de las siete copias viejas, y el interruptor "Mías" es el mismo en las tres
// bandejas con dueño. Solo abre y lee: no crea ni cambia nada.
//   node emu-test-barra-unica.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const VIEJAS = '.estado-chip, .fb-chip, .cm-chip, .rg-chip, .cg-filtro, .filter-chip, .cc-seg';

async function leer(s) {
  return s.page.evaluate((VIEJAS) => {
    const chips = [...document.querySelectorAll('.bj-filtro:not(.bj-mias):not(.bj-filtro--sel)')].filter(e => e.offsetParent !== null);
    const alturas = [...new Set(chips.map(e => Math.round(e.getBoundingClientRect().height)))];
    const radios = [...new Set(chips.map(e => getComputedStyle(e).borderRadius))];
    const activos = chips.filter(e => e.classList.contains('active')).map(e => e.textContent.replace(/\s+/g, ' ').trim());
    const mias = document.querySelector('.bj-mias');
    return {
      chips: chips.length, alturas, radios, activos: activos.slice(0, 4),
      viejas: document.querySelectorAll(VIEJAS).length,
      mias: mias ? { visible: mias.offsetParent !== null, texto: mias.textContent.trim(), on: !!mias.querySelector('input')?.checked } : null,
      cnt: document.querySelectorAll('.bj-filtro .cnt').length,
    };
  }, VIEJAS);
}

const BANDEJAS = [
  ['/ordenes/index.html', 'ordenes', '#estadoChipsBar .bj-filtro'],
  ['/cotizaciones/index.html', 'cotizaciones', '#segments .bj-filtro'],
  ['/contratos/index.html', 'contratos', '#filtroEstadoChips .bj-filtro'],
  ['/facturacion/bandeja.html', 'facturacion', '#fbChips .bj-filtro'],
  ['/facturacion/comisiones.html', 'comisiones', '#cmChips .bj-filtro'],
  ['/clientes/regularizacion.html', 'regularizacion', '#rgChips .bj-filtro'],
  ['/clientes/centro.html', 'centro', '#cgFiltros .bj-filtro'],
];

// ═══ A · Admin en escritorio: todas las bandejas ═══
{
  const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'barra-unica' });
  for (const [url, nombre, sel] of BANDEJAS) {
    const info = await s.ir(url, { esperar: 2000 });
    await s.page.waitForSelector(sel, { timeout: 20000 }).catch(() => {});
    const r = await leer(s);
    console.log(`\n── admin · ${nombre} (${info.msTotal} ms) ${JSON.stringify(r)}`);
    ok(r.chips >= 2, `${nombre}: hay chips del kit (${r.chips})`);
    ok(r.viejas === 0, `${nombre}: ninguna clase vieja (${r.viejas})`);
    ok(r.alturas.length === 1 && r.alturas[0] === 30, `${nombre}: todos los chips miden 30px (${r.alturas})`);
    ok(r.radios.length === 1, `${nombre}: un solo radio (${r.radios})`);
    ok(s.errores.length === 0, `${nombre}: sin errores de consola/producción ${s.errores.length ? JSON.stringify(s.errores).slice(0, 200) : ''}`);
    await s.captura(`admin-${nombre}`);
  }
  // Mías: admin lo ve en Órdenes, Cotizaciones y Centro, apagado.
  for (const [url, nombre] of [['/ordenes/index.html', 'ordenes'], ['/cotizaciones/index.html', 'cotizaciones'], ['/clientes/centro.html', 'centro']]) {
    await s.ir(url, { esperar: 1500 });
    await s.page.waitForSelector('.bj-mias', { timeout: 15000 }).catch(() => {});
    const r = await leer(s);
    ok(r.mias && r.mias.visible && /^Mías/.test(r.mias.texto) && !r.mias.on, `${nombre}: "Mías" visible, mismo rótulo, apagado para admin (${JSON.stringify(r.mias)})`);
  }
  await s.cerrar();
}

// ═══ B · Vendedor: Mías forzado y oculto en Centro y Cotizaciones; visible en Órdenes ═══
{
  const s = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'barra-unica' });
  await s.ir('/clientes/centro.html', { esperar: 2000 });
  let r = await leer(s);
  ok(!r.mias, `vendedor · centro: sin interruptor (la cartera es un candado) ${JSON.stringify(r.mias)}`);
  await s.captura('vendedor-centro');
  await s.ir('/cotizaciones/index.html', { esperar: 2000 });
  r = await leer(s);
  // Karla es supervisora de cotizaciones en los datos (empresa/config): ve el
  // interruptor como admin. Un vendedor sin ese permiso lo tiene oculto y forzado.
  ok(r.mias && r.mias.visible && /^Mías/.test(r.mias.texto), `vendedor supervisor · cotizaciones: "Mías" visible, mismo rótulo ${JSON.stringify(r.mias)}`);
  await s.ir('/ordenes/index.html', { esperar: 2000 });
  r = await leer(s);
  ok(r.mias && r.mias.visible && !r.mias.on, `vendedor · órdenes: "Mías" visible y apagado ${JSON.stringify(r.mias)}`);
  await s.cerrar();
}

// ═══ C · Técnico: Mías encendido por defecto en Órdenes ═══
{
  const s = await abrir({ email: USUARIOS.tecnico, viewport: 'escritorio', carpeta: 'barra-unica' });
  await s.ir('/ordenes/index.html', { esperar: 2000 });
  const r = await leer(s);
  ok(r.mias && r.mias.visible && r.mias.on, `tecnico · órdenes: "Mías" encendido por defecto ${JSON.stringify(r.mias)}`);
  await s.captura('tecnico-ordenes');
  await s.cerrar();
}

// ═══ D · Teléfono: Órdenes y Centro sin scroll horizontal ═══
{
  const s = await abrir({ email: USUARIOS.recepcion, viewport: 'telefono', carpeta: 'barra-unica' });
  for (const [url, nombre] of [['/ordenes/index.html', 'ordenes'], ['/clientes/centro.html', 'centro'], ['/facturacion/bandeja.html', 'facturacion']]) {
    await s.ir(url, { esperar: 2000 });
    const g = await s.geometria();
    const r = await leer(s);
    ok(!g.scrollHorizontal, `telefono · ${nombre}: sin scroll horizontal (chips ${r.chips}, viejas ${r.viejas})`);
    await s.captura(`telefono-${nombre}`);
  }
  await s.cerrar();
}

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
