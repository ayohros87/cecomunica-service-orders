// Inicio del Centro v2 (2026-10-09) contra el emulador con datos reales:
// buscador con resultados agrupados, señales que filtran, Recientes, lista por
// letra con índice A–Z, cartera chica en tarjetas, deep-links y teléfono.
// Solo abre y lee: no crea ni aprueba nada.
//   node emu-test-inicio.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const J = (x) => JSON.stringify(x).slice(0, 420);
const AGENCIA = 'gFs21DErNjbZFbkGrdAH';

async function esperarInicio(s) {
  await s.page.waitForFunction(() => document.querySelector('#cgLista .cg-fila, #cgLista .cg-tarjeta, #cgLista .cg-empty') && document.querySelectorAll('#cgSenales .cg-senal').length > 0, { timeout: 25000 }).catch(() => {});
  // Señales: esperar a que los números dejen de ser "…"
  await s.page.waitForFunction(() => ![...document.querySelectorAll('#cgSenales .cg-senal .v')].some(e => e.textContent.trim() === '…'), { timeout: 20000 }).catch(() => {});
  await espera(500);
}
async function leerInicio(s) {
  return s.page.evaluate(() => {
    const t = (q) => document.querySelector(q)?.textContent.replace(/\s+/g, ' ').trim() || '';
    const ts = (q) => [...document.querySelectorAll(q)].map(e => e.textContent.replace(/\s+/g, ' ').trim());
    return {
      saludo: t('#cgSaludo'), fecha: t('#cgFecha'), botones: ts('#cgHeroBtns .btn'),
      senales: [...document.querySelectorAll('#cgSenales .cg-senal')].map(e => `${e.querySelector('.t')?.textContent.trim()} = ${e.querySelector('.v')?.textContent.trim()} (${e.querySelector('.s')?.textContent.trim()})${e.classList.contains('is-on') ? ' [ON]' : ''}`),
      recientes: ts('#cgRecientes .cg-rec .n'),
      filtros: ts('#cgFiltros .bj-filtro'), resumen: t('#cgResumen'),
      letras: ts('#cgLista .cg-letra b'), filas: document.querySelectorAll('#cgLista .cg-fila').length,
      tarjetas: document.querySelectorAll('#cgLista .cg-tarjeta:not(.cg-tarjeta--nueva)').length,
      az: ts('#cgAZ a'), azMute: document.querySelectorAll('#cgAZ span.mute').length,
      chips: [...new Set(ts('#cgLista .cg-fila .cg-chip').map(x => x.replace(/\d+/g, 'n')))],
      aprobVisible: !document.getElementById('cgAprobaciones').classList.contains('hidden'),
      viejos: !!document.querySelector('#cgTools, #segMios, #btnMas, .cg-row--cli'),
    };
  });
}

// ═══ A · Admin: inicio completo ═══
{
  const s = await abrir({ email: USUARIOS.admin, viewport: { width: 1536, height: 864 }, carpeta: 'centro-home-v2' });
  const info = await s.ir('/clientes/centro.html', { esperar: 2500 });
  await esperarInicio(s);
  const f = await leerInicio(s);
  console.log(`\n── A · admin · inicio (${info.msTotal} ms · ${info.fsReqs} req)`);
  console.log('    saludo:', f.saludo, '|', f.fecha, J(f.botones));
  console.log('    señales:', J(f.senales));
  console.log('    filtros:', J(f.filtros), '|', f.resumen);
  console.log('    letras:', J(f.letras), 'filas:', f.filas, 'az:', f.az.length, 'mute:', f.azMute);
  console.log('    chips:', J(f.chips));
  ok(!f.viejos, 'ya no existen la barra vieja, el segmento ni "Cargar más"');
  ok(/^Buen(os|as) /.test(f.saludo) && /Alberto/.test(f.saludo), 'saludo con nombre');
  ok(/cuentas activas/.test(f.fecha), 'línea de fecha con el conteo de cuentas');
  ok(f.botones.some(b => /Nuevo cliente/.test(b)), 'Nuevo cliente en la cabecera');
  ok(f.senales.length === 4 && f.senales.every(x => !/= …/.test(x)), 'cuatro señales con número');
  ok(f.senales[0].startsWith('Pendientes por aprobar'), 'la primera señal es Pendientes por aprobar (admin)');
  ok(f.letras.length >= 15 && f.filas >= 200, 'directorio completo por letra: ' + f.filas + ' filas en ' + f.letras.length + ' letras');
  ok(f.az.length === f.letras.length && f.az.length + f.azMute === 27, 'índice A–Z con las letras presentes activas');
  ok(f.filtros.some(x => /Por regularizar \d+/.test(x)) && f.filtros.some(x => /Sin vendedor/.test(x)), 'filtros con conteo');
  ok(!f.aprobVisible, 'la bandeja de aprobaciones está plegada hasta tocar su señal');
  const g = await s.geometria();
  console.log('    geometría:', J(g));
  ok(!g.scrollHorizontal, 'sin scroll horizontal');
  await s.captura('A01-admin-inicio', { full: false });
  await s.captura('A02-admin-inicio-completo', { full: true });

  // Índice A–Z: ir a la S
  const antes = await s.page.evaluate(() => scrollY);
  await s.page.evaluate(() => [...document.querySelectorAll('#cgAZ a')].find(a => a.textContent === 'S')?.click());
  await espera(700);
  const tras = await s.page.evaluate(() => ({ y: scrollY, on: document.querySelector('#cgAZ a.is-on')?.textContent, visible: (() => { const r = document.getElementById('cgL-S')?.getBoundingClientRect(); return r && r.top >= -5 && r.top < innerHeight; })() }));
  ok(tras.y > antes && tras.on === 'S' && tras.visible, 'el índice A–Z lleva a la letra: ' + J(tras));

  // Señal "Pendientes por aprobar" → bandeja visible y lista filtrada
  await s.page.evaluate(() => window.scrollTo(0, 0));
  await s.page.evaluate(() => document.querySelector('#cgSenales .cg-senal').click());
  await espera(600);
  const ap = await s.page.evaluate(() => ({ visible: !document.getElementById('cgAprobaciones').classList.contains('hidden'), filas: document.querySelectorAll('#cgAprobaciones .bj-row').length, dir: document.querySelectorAll('#cgLista .cg-fila').length, on: document.querySelector('#cgSenales .cg-senal.is-on .t')?.textContent.trim(), url: location.search }));
  console.log('    aprobar:', J(ap));
  ok(ap.visible && ap.filas >= 1 && ap.on === 'Pendientes por aprobar', 'la señal abre la bandeja de aprobaciones');
  ok(ap.dir >= 1 && ap.dir < 20, 'y la lista queda filtrada a las cuentas con pendientes: ' + ap.dir);
  await s.captura('A03-admin-aprobar', { full: false });
  await s.page.evaluate(() => document.querySelector('#cgSenales .cg-senal.is-on').click()); await espera(400);
  ok(await s.page.evaluate(() => document.getElementById('cgAprobaciones').classList.contains('hidden') && document.querySelectorAll('#cgLista .cg-fila').length > 100), 'volver a tocar la señal la apaga');

  // Señal "Contratos por vencer" + filtro "Sin vendedor"
  await s.page.evaluate(() => [...document.querySelectorAll('#cgSenales .cg-senal')].find(e => /por vencer/.test(e.textContent)).click()); await espera(400);
  const venc = await s.page.evaluate(() => ({ dir: document.querySelectorAll('#cgLista .cg-fila').length, chips: [...document.querySelectorAll('#cgLista .cg-chip')].map(e => e.textContent.trim()).slice(0, 5) }));
  console.log('    vencen:', J(venc));
  ok(venc.dir >= 1 && venc.chips.some(c => /Vence en \d+ d|Firma pendiente|Sin regularizar/.test(c)), 'la señal "por vencer" filtra y las filas dicen cuándo');
  await s.page.evaluate(() => [...document.querySelectorAll('#cgFiltros .bj-filtro')].find(e => /Sin vendedor/.test(e.textContent)).click()); await espera(400);
  const sv = await s.page.evaluate(() => ({ dir: document.querySelectorAll('#cgLista .cg-fila').length, todosSin: [...document.querySelectorAll('#cgLista .cg-fila .v')].every(e => /Sin vendedor/.test(e.textContent)) }));
  ok(sv.dir >= 1 && sv.todosSin, 'el chip "Sin vendedor" deja solo las cuentas sin vendedor: ' + sv.dir);
  await s.page.evaluate(() => Centro.setFiltro(null)); await espera(300);

  // Filtro por vendedor
  const vend = await s.page.evaluate(() => { const sel = document.querySelector('#cgFiltros select'); if (!sel || sel.options.length < 2) return null; sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change')); return sel.options[1].textContent; });
  await espera(400);
  const porV = await s.page.evaluate(() => ({ dir: document.querySelectorAll('#cgLista .cg-fila').length, total: Centro._dir.docs.length }));
  console.log('    vendedor:', vend, J(porV));
  ok(vend && porV.dir > 0 && porV.dir < porV.total, 'el selector de vendedor filtra la lista');
  await s.page.evaluate(() => Centro.setVendedorFiltro(null)); await espera(300);

  // Buscador: resultados agrupados, guiones indiferentes, teclado
  await s.page.click('#cgBuscar');
  await s.page.type('#cgBuscar', 'seg');
  await espera(900);
  const b1 = await s.page.evaluate(() => ({ abierto: !document.getElementById('cgBusqRes').classList.contains('hidden'), grupos: [...document.querySelectorAll('#cgBusqRes .grp h3')].map(e => e.textContent), items: document.querySelectorAll('#cgBusqRes .cg-res').length, marcado: !!document.querySelector('#cgBusqRes mark'), lista: document.querySelectorAll('#cgLista .cg-fila').length, on: document.querySelector('#cgBusqRes .cg-res.on .t')?.textContent.trim() }));
  console.log('    buscar "seg":', J(b1));
  ok(b1.abierto && b1.grupos.includes('Clientes') && b1.items >= 1 && b1.marcado, 'al teclear salen resultados agrupados con la coincidencia marcada');
  ok(b1.lista >= 1 && b1.lista < 100, 'y la lista de abajo se filtra a la vez: ' + b1.lista);
  await s.captura('A04-admin-buscar', { full: false });
  // RUC con guiones (R1 de la auditoría)
  const ruc = await s.page.evaluate(() => { const c = Centro._dir.docs.find(x => /\d-\d/.test(x.ruc || '')); return c ? { ruc: c.ruc, nombre: c.nombre } : null; });
  if (ruc) {
    await s.page.evaluate(() => { const i = document.getElementById('cgBuscar'); i.value = ''; });
    await s.page.type('#cgBuscar', ruc.ruc); await espera(600);
    const b2 = await s.page.evaluate(() => [...document.querySelectorAll('#cgBusqRes .cg-res .t')].map(e => e.textContent.trim()));
    ok(b2.some(x => x.toUpperCase().includes(ruc.nombre.slice(0, 10).toUpperCase())), `el RUC con guiones (${ruc.ruc}) encuentra a ${ruc.nombre.slice(0, 30)}: ` + J(b2));
    await s.page.evaluate(() => { const i = document.getElementById('cgBuscar'); i.value = ''; });
    await s.page.type('#cgBuscar', ruc.ruc.replace(/-/g, '')); await espera(600);
    const b3 = await s.page.evaluate(() => document.querySelectorAll('#cgBusqRes .cg-res').length);
    ok(b3 >= 1, 'y sin guiones también');
  }
  // Serial → ficha en Equipos con la fila filtrada
  const serial = await s.page.evaluate(async () => {
    const s = await firebase.firestore().collection('equipos_pool').where('asignacion.cliente_id', '==', 'gFs21DErNjbZFbkGrdAH').limit(1).get();
    return s.docs[0] ? (s.docs[0].data().serial || s.docs[0].id) : null;
  });
  if (serial) {
    await s.page.evaluate(() => { const i = document.getElementById('cgBuscar'); i.value = ''; });
    await s.page.type('#cgBuscar', serial.slice(0, 6)); await espera(1200);
    const bs = await s.page.evaluate(() => ({ grupos: [...document.querySelectorAll('#cgBusqRes .grp h3')].map(e => e.textContent), seriales: [...document.querySelectorAll('#cgBusqRes .cg-res')].filter(e => /Ver en Equipos/.test(e.textContent)).length }));
    console.log('    buscar serial', serial, J(bs));
    ok(bs.grupos.includes('Seriales') && bs.seriales >= 1, 'un serial aparece en su grupo con "Ver en Equipos"');
    await s.page.evaluate(() => [...document.querySelectorAll('#cgBusqRes .cg-res')].find(e => /Ver en Equipos/.test(e.textContent)).click());
    await s.page.waitForFunction(() => !document.getElementById('vistaFicha').classList.contains('hidden') && document.querySelector('#cgTabs .cg-tab.is-on')?.dataset.tab === 'blkEquipos', { timeout: 25000 }).catch(() => {});
    await espera(800);
    const eq = await s.page.evaluate(() => ({ tab: document.querySelector('#cgTabs .cg-tab.is-on')?.dataset.tab, filtro: document.getElementById('fEqFiltro')?.value, filas: document.querySelectorAll('#fEquipos tr[data-eq]').length }));
    console.log('    ficha desde serial:', J(eq));
    ok(eq.tab === 'blkEquipos' && eq.filtro && eq.filas >= 1 && eq.filas <= 5, 'el serial abre la ficha en Equipos con la fila filtrada');
    await s.captura('A05-serial-a-equipos', { full: false });
    // Volver: Recientes trae esta cuenta
    await s.page.evaluate(() => Centro.volver()); await espera(800);
    const rec = await leerInicio(s);
    ok(rec.recientes.length >= 1 && /AGENCIA/.test(rec.recientes[0]), 'al volver, Recientes muestra la cuenta recién abierta: ' + J(rec.recientes));
    ok(rec.filas >= 200, 'y el directorio sigue completo sin recargar');
  }
  // Atajo "/" enfoca el buscador
  await s.page.evaluate(() => document.activeElement?.blur());
  await s.page.keyboard.press('/'); await espera(200);
  ok(await s.page.evaluate(() => document.activeElement?.id === 'cgBuscar'), 'la tecla "/" enfoca el buscador');
  await s.page.keyboard.press('Escape'); await espera(200);
  ok(await s.page.evaluate(() => document.getElementById('cgBusqRes').classList.contains('hidden') && document.getElementById('cgBuscar').value === ''), 'Escape limpia y cierra');
  console.log('    consultas:', J((await s.consultas()).filter(x => !/Sesion/.test(x))));
  ok(!s.errores.some(e => /PRODUCCIÓN/.test(e)), 'ninguna llamada a producción');
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ B · Deep-links: ?aprobaciones=contratos y ?filtro=regularizacion ═══
{
  const s = await abrir({ email: USUARIOS.gerencia, viewport: { width: 1536, height: 864 }, carpeta: 'centro-home-v2' });
  await s.ir('/clientes/centro.html?aprobaciones=contratos', { esperar: 2500 }); await esperarInicio(s);
  const a = await leerInicio(s);
  console.log('\n── B · gerencia · deep-links');
  ok(a.aprobVisible && a.senales[0].includes('[ON]'), '?aprobaciones= aterriza con la bandeja abierta y la señal encendida');
  await s.ir('/clientes/centro.html?filtro=regularizacion', { esperar: 2500 }); await esperarInicio(s);
  const r = await leerInicio(s);
  console.log('    regularizar:', r.resumen, 'filas', r.filas, J(r.senales.filter(x => /regularizar/.test(x))));
  ok(r.senales.some(x => /por regularizar.*\[ON\]/.test(x)) && r.filas > 0 && r.filas < 240 && /bandeja completa/.test(r.resumen), '?filtro=regularizacion filtra y enlaza a la bandeja completa');
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ C · Vendedora: cartera chica en tarjetas ═══
{
  const s = await abrir({ email: USUARIOS.vendedor, viewport: { width: 1536, height: 864 }, carpeta: 'centro-home-v2' });
  const info = await s.ir('/clientes/centro.html', { esperar: 2500 }); await esperarInicio(s);
  await s.page.waitForFunction(() => !document.querySelector('#cgLista .cg-tarjeta .cg-skel'), { timeout: 20000 }).catch(() => {});
  await espera(500);
  const f = await leerInicio(s);
  const tj = await s.page.evaluate(() => ({ est: [...document.querySelectorAll('#cgLista .cg-tarjeta .est')].map(e => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 90)), acts: [...document.querySelectorAll('#cgLista .cg-tarjeta .acts')].map(e => [...e.querySelectorAll('.btn')].map(b => b.textContent.trim())), semana: [...document.querySelectorAll('.cg-semana .cg-sem .t')].map(e => e.textContent.trim()), cots: document.querySelectorAll('.cg-semana .cg-card').length }));
  console.log(`\n── C · vendedora · cartera (${info.msTotal} ms)`);
  console.log('    saludo:', f.saludo, '|', f.fecha); console.log('    señales:', J(f.senales)); console.log('    tarjetas:', f.tarjetas, J(tj.est)); console.log('    acciones:', J(tj.acts)); console.log('    semana:', J(tj.semana), 'cards', tj.cots);
  ok(/Karla/.test(f.saludo) && /tu cartera/.test(f.fecha), 'saludo y resumen de la vendedora');
  // Home por rol (2026-10-09): su inicio es el Centro, así que suma "Mis cotizaciones".
  ok(f.senales.length === 4 && !f.senales.some(x => /aprobar/.test(x)) && f.senales.some(x => /otizaciones activas/.test(x)), 'la vendedora ve cuatro señales (sin "por aprobar", con "Mis cotizaciones")');
  ok(f.tarjetas >= 1 && f.filas === 0, 'la cartera chica sale en tarjetas: ' + f.tarjetas);
  ok(tj.est.length === f.tarjetas && tj.est.every(x => /Pide atención|Al día|Cuenta nueva/.test(x)), 'cada tarjeta dice su estado en una frase');
  ok(tj.acts.every(a => a.some(b => /Cotizar/.test(b)) && a.some(b => /Nueva gestión/.test(b)) && a.some(b => /Abrir ficha/.test(b))), 'cada tarjeta trae Cotizar · Nueva gestión · Abrir ficha');
  ok(tj.cots >= 1, '"Tu semana" está a la derecha');
  ok(!f.filtros.some(x => /Mi cartera|Todos/.test(x)) && !f.filtros.some(x => /Sin vendedor/.test(x)), 'sin segmento Mi cartera/Todos ni "Sin vendedor" para la vendedora');
  await s.captura('C01-vendedora-cartera', { full: true });
  // "Nueva gestión" desde la tarjeta abre la ficha con el panel de acciones
  await s.page.evaluate(() => [...document.querySelectorAll('#cgLista .cg-tarjeta .acts .btn')].find(b => /Nueva gestión/.test(b.textContent)).click());
  await s.page.waitForFunction(() => !document.getElementById('cgMenu').classList.contains('hidden'), { timeout: 25000 }).catch(() => {});
  ok(await s.page.evaluate(() => !document.getElementById('cgMenu').classList.contains('hidden')), '"Nueva gestión" abre la ficha con el panel de acciones');
  await s.page.evaluate(() => { Centro.cerrarMenu(); Centro.volver(); }); await espera(600);
  // Buscar en la cartera filtra las tarjetas → lista
  await s.page.type('#cgBuscar', 'zz'); await espera(500);
  ok(await s.page.evaluate(() => /Ninguna cuenta coincide/.test(document.getElementById('cgLista').textContent)), 'una búsqueda sin coincidencias lo dice');
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ D · Teléfono (admin) ═══
{
  const s = await abrir({ email: USUARIOS.admin, viewport: 'telefono', carpeta: 'centro-home-v2' });
  await s.ir('/clientes/centro.html', { esperar: 2500 }); await esperarInicio(s);
  const m = await s.page.evaluate(() => ({
    iw: innerWidth, sw: document.documentElement.scrollWidth,
    senalesScroll: document.getElementById('cgSenales').scrollWidth > document.getElementById('cgSenales').clientWidth,
    filtrosScroll: document.getElementById('cgFiltros').scrollWidth > document.getElementById('cgFiltros').clientWidth,
    dock: [...document.querySelectorAll('#cgDockLista .btn')].map(e => e.textContent.trim()), dockVisible: getComputedStyle(document.getElementById('cgDockLista')).display !== 'none',
    az: getComputedStyle(document.getElementById('cgAZ')).display !== 'none', filas: document.querySelectorAll('#cgLista .cg-fila').length,
    filaAlto: document.querySelector('#cgLista .cg-fila')?.getBoundingClientRect().height,
  }));
  const g = await s.geometria();
  console.log('\n── D · teléfono', J(m), J(g));
  ok(m.iw === 390 && m.sw === 390 && !g.scrollHorizontal, 'cabe en los 390 px');
  // Los chips del kit (30 px) caben en 390 px sin deslizar: solo las señales deslizan.
  ok(m.senalesScroll, 'las señales se deslizan en una fila');
  ok(m.dockVisible && m.dock.some(x => /Nuevo cliente/.test(x)), 'dock con Nuevo cliente');
  ok(m.az && m.filas > 100 && m.filaAlto >= 44, 'lista densa con índice A–Z y filas tocables');
  await s.captura('D01-telefono', { full: false });
  await s.page.evaluate(() => [...document.querySelectorAll('#cgAZ a')].find(a => a.textContent === 'M')?.click()); await espera(700);
  ok(await s.page.evaluate(() => { const r = document.getElementById('cgL-M')?.getBoundingClientRect(); return r && r.top >= -5 && r.top < innerHeight; }), 'el índice A–Z funciona con el pulgar');
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
