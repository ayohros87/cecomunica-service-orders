// Páginas satélite del espacio y catálogos de administración, por rol:
// Piezas, Descartados, Con condición, No devueltos, Importar hoja (asistente),
// Modelos, Piezas y tarifas; y qué ve cada rol al abrir /almacen/.
//   node 04-admin-y-satelites.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

const log = (...a) => console.log(...a);
async function visita(s, nombre, url, captura, sel = 'body') {
  const i = await s.ir(url, { esperar: 1200 });
  log(`${nombre.padEnd(30)} ${String(i.msTotal).padStart(5)} ms · 1ª Firestore ${i.primeraFs ?? '—'} · ${i.fsReqs} peticiones · ${i.url}${i.quieto ? '' : ' (no se aquietó)'}`);
  await s.captura(captura);
  const g = await s.geometria();
  log(`   geometria alto=${g.altoTotal} scrollH=${g.scrollHorizontal} objetivos=${g.objetivos} chicos=${g.objetivosChicos}`);
  const txt = (await s.texto(sel)).replace(/\n{2,}/g, '\n');
  log('   texto: ' + txt.slice(0, 600).replace(/\n/g, ' / '));
  if (s.errores.length) log('   errores: ' + [...new Set(s.errores)].slice(0, 4).join(' | '));
  return txt;
}

// ── Bodega en las satélites ────────────────────────────────────────────
{
  const s = await abrir({ email: USUARIOS.inventario, viewport: 'escritorio', carpeta: 'almacen' });
  log('\n=== inventario · satélites (escritorio) ===');
  await visita(s, 'Piezas', '/inventario/piezas.html', '30-inventario-escritorio-piezas');
  await visita(s, 'Descartados', '/inventario/descartados.html', '31-inventario-escritorio-descartados');
  await visita(s, 'Con condición', '/inventario/condiciones.html', '32-inventario-escritorio-condiciones');
  await visita(s, 'No devueltos', '/inventario/no-devueltos.html', '33-inventario-escritorio-no-devueltos');
  await visita(s, 'Modelos (rol inventario)', '/inventario/modelos.html', '34-inventario-escritorio-modelos-gate');
  await visita(s, 'equipos.html (redirect)', '/inventario/equipos.html', '35-inventario-escritorio-equipos-redirect');
  await visita(s, 'pendientes.html (redirect)', '/inventario/pendientes.html', '36-inventario-escritorio-pendientes-redirect');
  // Importar hoja: el asistente
  await s.ir('/almacen/index.html');
  await s.hacer(() => AlmacenPage.abrirImportar());
  await s.page.waitForSelector('.modal-backdrop.open', { timeout: 10000 }).catch(() => {});
  await s.quieto(800, 8000);
  await s.captura('37-inventario-escritorio-importar-hoja');
  log('Importar hoja: ' + (await s.page.evaluate(() => { const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; return m ? m.innerText.replace(/\n{2,}/g, '\n').slice(0, 900) : '(sin modal)'; })).replace(/\n/g, ' / '));
  // Topbar de Almacén: qué acciones ve bodega
  log('topbar: ' + (await s.texto('.topbar-actions')).replace(/\n/g, ' · '));
  await s.cerrar();
}

// ── Administración: catálogos ──────────────────────────────────────────
{
  const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'almacen' });
  log('\n=== admin · catálogos (escritorio) ===');
  const tm = await visita(s, 'Modelos', '/inventario/modelos.html', '40-admin-escritorio-modelos');
  log('   resumen: ' + (await s.texto('#resumenModelos')) + ' · salud: ' + (await s.texto('#saludCatalogo')).slice(0, 300).replace(/\n/g, ' / '));
  log('   columnas: ' + await s.page.evaluate(() => [...document.querySelectorAll('#tabla thead th')].map(th => th.innerText.trim()).join(' | ')));
  log('   filas: ' + await s.page.evaluate(() => document.querySelectorAll('#tablaModelos tr').length));
  await visita(s, 'Piezas y tarifas', '/inventario/piezas-tarifas.html', '41-admin-escritorio-piezas-tarifas');
  await visita(s, 'Piezas (admin)', '/inventario/piezas.html', '42-admin-escritorio-piezas');
  await visita(s, 'Cargos', '/inventario/cargos.html', '43-admin-escritorio-cargos');
  await visita(s, 'Almacén Hoy (admin)', '/almacen/index.html', '44-admin-escritorio-hoy', '#tab-hoy');
  await s.cerrar();
}

// ── Otros roles al abrir /almacen/ ─────────────────────────────────────
for (const [rol, email] of [['tecnico', USUARIOS.tecnico], ['recepcion', USUARIOS.recepcion], ['vendedor', USUARIOS.vendedor], ['contabilidad', USUARIOS.contabilidad], ['gerencia', USUARIOS.gerencia]]) {
  const s = await abrir({ email, viewport: 'escritorio', carpeta: 'almacen' });
  log(`\n=== ${rol} abre /almacen/ ===`);
  const i = await s.ir('/almacen/index.html?tab=asignar', { esperar: 1000 });
  log(`   ${i.msTotal} ms · url ${i.url} · texto: ` + (await s.texto('#bodyAlmacen')).slice(0, 260).replace(/\n/g, ' / '));
  log('   pestañas: ' + await s.page.evaluate(() => [...document.querySelectorAll('.ws-tab')].map(t => t.innerText.trim()).join(' | ')) + ' · topbar: ' + (await s.texto('.topbar-actions')).replace(/\n/g, ' · '));
  await s.captura(`50-${rol}-escritorio-almacen-asignar`);
  if (rol === 'contabilidad') { await s.ir('/inventario/modelos.html'); await s.captura('51-contabilidad-escritorio-modelos'); log('   modelos (contabilidad): ' + (await s.texto('#resumenModelos'))); }
  await s.cerrar();
}
