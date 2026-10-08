// Ficha del cliente v3 (2026-10-08) contra el emulador con datos reales:
// cabecera sin badges, barra de verbos, pestañas, "Qué está esperando",
// selección en Equipos → wizard pre-marcado, panel "Más acciones", móvil,
// y las vistas por rol (admin, vendedora, bodega). Solo abre y lee: no envía
// gestiones ni aprueba nada.
//   node emu-test-ficha-v3.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

const CASOS = {
  agencia: 'gFs21DErNjbZFbkGrdAH',   // 19 contratos · 273 radios (equipos agrupados)
  seprosa: 'jT6FlI02u2L52On6zsaj',   // contrato aprobado esperando firma + gestiones
  karla: 'mLGNnICmLfngqdVhDnNq',     // cartera de Karla
  nuevo: '04wGrgd903C3ADk49HkJ',     // sin contratos (cuenta nueva)
  pendiente: 'dPvxyYZRQsz9oSm7k8LR', // contrato pendiente de aprobación
};
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const J = (x) => JSON.stringify(x).slice(0, 400);

async function leerFicha(s) {
  return s.page.evaluate(() => {
    const t = (q) => document.querySelector(q)?.textContent.replace(/\s+/g, ' ').trim() || '';
    const ts = (q) => [...document.querySelectorAll(q)].map(e => e.textContent.replace(/\s+/g, ' ').trim());
    return {
      nombre: t('#fNombre'), meta: t('#fMeta'), estado: t('#fEstado'), estadoClase: document.querySelector('#fEstado')?.className,
      editar: t('#fEditar'),
      verbos: [...document.querySelectorAll('#cgVerbos .cg-verbo')].map(e => `${e.textContent.replace(/\s+/g, ' ').trim()}${e.classList.contains('off') ? ' [off: ' + e.title + ']' : ''}${e.classList.contains('is-sug') ? ' [SUG]' : ''}`),
      tabs: ts('#cgTabs .cg-tab:not(.hidden)'),
      tabActiva: document.querySelector('#cgTabs .cg-tab.is-on')?.dataset.tab,
      esperando: ts('#fAhora .row .t'), esperandoBtns: ts('#fAhora .row .btns'),
      tiles: ts('#fResumen .cg-tile'), extras: ts('#fResumen > div:last-child button, #fResumen > div:last-child a'),
      contacto: ts('#fContacto dd'),
      resumenFilas: ts('#fResumenTab tbody tr'), movimientos: ts('#fResumenTab .cg-tl li'),
      skeletons: document.querySelectorAll('#vistaFicha .cg-skel').length,
      chipsViejos: !!document.querySelector('#fRegChip, #btnPrimario, #btnGestion, #cgMasMenu'),
    };
  });
}
async function abrirFicha(s, id, extra = '') {
  const info = await s.ir(`/clientes/centro.html?id=${id}${extra}`, { esperar: 2500 });
  await s.page.waitForFunction(() => document.querySelector('#cgVerbos .cg-verbo') && !document.querySelector('#fResumenTab .cg-skel'), { timeout: 25000 }).catch(() => {});
  await espera(800);
  return info;
}

// ═══ A · Admin en AGENCIA (cuenta grande) ═══
{
  const s = await abrir({ email: USUARIOS.admin, carpeta: 'ficha-v3' });
  const info = await abrirFicha(s, CASOS.agencia);
  const f = await leerFicha(s);
  console.log(`\n── A · admin · AGENCIA (${info.msTotal} ms · ${info.fsReqs} req)`);
  console.log('    estado:', f.estado, '|', f.estadoClase);
  console.log('    verbos:', J(f.verbos));
  console.log('    tabs:', J(f.tabs), '| activa:', f.tabActiva);
  console.log('    esperando:', J(f.esperando));
  console.log('    tiles:', J(f.tiles), J(f.extras));
  console.log('    resumen:', J(f.resumenFilas));
  console.log('    movimientos:', J(f.movimientos));
  ok(!f.chipsViejos, 'ya no existen los chips, el primario ni el ⋯ viejos');
  ok(f.nombre.includes('AGENCIA'), 'nombre en la cabecera');
  ok(/RUC/.test(f.meta), 'meta = identidad (RUC): ' + f.meta);
  ok(f.estado.length > 10 && /cg-estado (ok|warn|bad|info)/.test(f.estadoClase), 'estado en palabras con tono');
  ok(f.verbos.length === 6 && /^Cotizar/.test(f.verbos[0]) && /Más acciones/.test(f.verbos[5]), 'seis verbos en orden fijo');
  ok(f.tabs.length === 6 && f.tabActiva === 'blkResumen', 'seis pestañas (admin ve Documentos) y Resumen activa');
  ok(f.esperando.length >= 1, '"Qué está esperando" trae filas');
  ok(f.tiles.length === 4 && /Mensual/.test(f.tiles[3]), 'cuatro tiles con Mensual (admin)');
  ok(f.resumenFilas.length >= 5 && f.resumenFilas.some(x => /Sin contrato|Por clasificar/.test(x)), 'equipos por contrato con sus grupos especiales');
  ok(f.movimientos.length >= 3, 'línea de tiempo con movimientos');
  ok(f.skeletons === 0, 'sin esqueletos colgados');
  const g = await s.geometria();
  console.log('    geometría:', J(g));
  await s.captura('A01-agencia-resumen', { full: true });

  // Equipos agrupados + selección
  await s.clic('#cgTabs [data-tab="blkEquipos"]');
  await espera(600);
  const eq = await s.page.evaluate(() => ({ grupos: document.querySelectorAll('#fEquipos .cg-eqgrp').length, resumen: document.getElementById('fEqResumen')?.textContent.trim(), chks: document.querySelectorAll('#fEquipos input.cg-chk').length }));
  console.log('    equipos:', J(eq));
  ok(eq.grupos >= 5, 'la flota grande se agrupa por contrato');
  await s.page.evaluate(() => { const d = document.querySelector('#fEquipos .cg-eqgrp'); if (d) d.open = true; });
  await espera(300);
  const filas = await s.page.$$('#fEquipos .cg-eqgrp[open] tr[data-eq] input.cg-chk');
  ok(filas.length >= 2, 'el primer grupo trae checkboxes por radio: ' + filas.length);
  await filas[0].click(); await filas[1].click(); await espera(300);
  const sel1 = await s.page.evaluate(() => ({ bar: document.getElementById('cgSelBar')?.textContent.replace(/\s+/g, ' ').trim(), sel: document.querySelectorAll('#fEquipos tr.is-sel').length, btns: [...document.querySelectorAll('#cgSelBar button')].map(b => b.textContent.trim() + (b.disabled ? ' [disabled]' : '')) }));
  console.log('    selección:', J(sel1));
  ok(/2 seleccionados/.test(sel1.bar) && sel1.sel === 2, 'barra de selección con 2 marcados');
  await s.captura('A02-agencia-equipos-seleccion', { full: false });
  // Checkbox del grupo
  const grpN = await s.page.evaluate(() => { const i = document.querySelector('#fEquipos .cg-eqgrp > summary input.cg-chk'); if (!i) return null; i.click(); return i.getAttribute('aria-label'); });
  await espera(500);
  const sel2 = await s.page.evaluate(() => ({ n: document.querySelector('#cgSelBar .n')?.textContent, abierto: document.querySelector('#fEquipos .cg-eqgrp')?.open }));
  console.log('    grupo:', grpN, J(sel2));
  ok(/\d+ seleccionados/.test(sel2.n || '') && sel2.abierto, 'el checkbox del grupo marca todo el contrato y no lo pliega');
  // Reemplazar desde la selección → wizard pre-marcado
  await s.page.click('#cgSelBar .btn-primary');
  await s.page.waitForSelector('#cgModal input[data-wsel]', { timeout: 20000 });
  await espera(800);
  const wiz = await s.page.evaluate(() => ({ marcados: document.querySelectorAll('#cgModal input[data-wsel]:checked').length, cfg: document.querySelectorAll('#cgModal tr[id^="wcfg-"]:not(.hidden)').length, visibles: document.querySelectorAll('#cgModal tr[data-ssg]:not([hidden]):not([data-sscfg])').length, titulo: document.querySelector('#cgModal h3')?.textContent.trim() }));
  console.log('    wizard:', J(wiz));
  ok(wiz.marcados >= 2 && wiz.cfg === wiz.marcados && wiz.visibles >= wiz.marcados, 'el wizard de reemplazo abre con las filas marcadas y visibles');
  await s.captura('A03-agencia-wizard-premarcado', { full: false });
  await s.hacer(() => Centro._cerrarModal());
  ok(!(await s.page.$('#cgModal')), 'el wizard se cierra sin enviar nada');
  // Panel "Más acciones"
  await s.clic('#cgVerbos .cg-verbo--mas');
  await espera(400);
  const panel = await s.page.evaluate(() => ({ visible: !document.getElementById('cgMenu').classList.contains('hidden'), grupos: [...document.querySelectorAll('#cgMenu .grp h3')].map(e => e.textContent.trim()),
    items: [...document.querySelectorAll('#cgMenu .cg-acc')].map(e => `${e.querySelector('.t')?.textContent.trim()}${e.classList.contains('off') ? ' [off]' : ''}${e.classList.contains('top') ? ' [TOP]' : ''}`), foco: document.activeElement?.getAttribute('data-accq') != null }));
  console.log('    panel:', J(panel.grupos), J(panel.items));
  ok(panel.visible && panel.grupos.length >= 6 && panel.items.length >= 15, 'el panel abre con todos los grupos');
  ok(panel.foco, 'el foco cae en el buscador del panel');
  await s.captura('A04-agencia-panel', { full: false });
  await s.page.type('#cgMenu [data-accq]', 'baja');
  await espera(200);
  const filtrado = await s.page.evaluate(() => [...document.querySelectorAll('#cgMenu .cg-acc:not(.is-oculto)')].map(e => e.querySelector('.t')?.textContent.trim()));
  ok(filtrado.length >= 1 && filtrado.every(x => /baja/i.test(x)), 'el buscador filtra: ' + J(filtrado));
  await s.page.keyboard.press('Escape'); await espera(300);
  ok(await s.page.evaluate(() => document.getElementById('cgMenu').classList.contains('hidden') && document.body.style.overflow === ''), 'Escape cierra el panel y suelta el scroll');
  // Otras pestañas
  await s.clic('#cgTabs [data-tab="blkContratos"]'); await espera(300);
  const nCon = await s.page.evaluate(() => document.querySelectorAll('#fContratos tbody tr').length);
  ok(nCon >= 5, 'Contratos pinta su tabla: ' + nCon);
  await s.captura('A05-agencia-contratos', { full: false });
  await s.clic('#cgTabs [data-tab="blkDocumentos"]'); await espera(1500);
  const docs = await s.page.evaluate(() => document.getElementById('fDocumentos')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 160));
  ok(/Expediente legal/.test(docs || ''), 'Documentos carga en la pestaña: ' + docs);
  await s.clic('#cgTabs [data-tab="blkActividad"]'); await espera(2000);
  const act = await s.page.evaluate(() => document.getElementById('fActividad')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 120));
  ok(act && !/Cargando/.test(act), 'Actividad carga el historial: ' + act);
  // Clic en una tile → cambia la pestaña
  await s.page.evaluate(() => document.querySelector('#fResumen .cg-tile button')?.click()); await espera(200);
  ok((await s.page.evaluate(() => document.querySelector('#cgTabs .cg-tab.is-on')?.dataset.tab)) === 'blkContratos', 'la tile "Contratos vigentes" abre la pestaña Contratos');
  console.log('    consultas:', J(await s.consultas()));
  ok(!s.errores.some(e => /PRODUCCIÓN/.test(e)), 'ninguna llamada a producción');
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ B · Admin en SEPROSA (trámite esperando firma) + deep-link ?g= ═══
{
  const s = await abrir({ email: USUARIOS.admin, carpeta: 'ficha-v3' });
  const info = await abrirFicha(s, CASOS.seprosa);
  const f = await leerFicha(s);
  console.log(`\n── B · admin · SEPROSA (${info.msTotal} ms)`);
  console.log('    estado:', f.estado); console.log('    verbos:', J(f.verbos)); console.log('    esperando:', J(f.esperando)); console.log('    btns:', J(f.esperandoBtns));
  ok(f.esperando.some(x => /firma|trámite|vence|regularizar/i.test(x)), 'las filas de espera hablan del trámite');
  const top = await s.hacer(() => { Centro.abrirMenu(); return document.querySelector('#cgMenu .cg-acc.top .t')?.textContent.trim(); });
  console.log('    panel top:', top);
  ok(!!top, 'el panel encabeza con lo que la cuenta pide primero');
  await s.hacer(() => Centro.cerrarMenu());
  await s.captura('B01-seprosa-resumen', { full: true });
  const gid = await s.page.evaluate(() => (Centro.gestiones || [])[0]?.id || null);
  if (gid) {
    await abrirFicha(s, CASOS.seprosa, `&g=${encodeURIComponent(gid)}`);
    const dl = await s.page.evaluate((id) => ({ tab: document.querySelector('#cgTabs .cg-tab.is-on')?.dataset.tab, fila: !!document.getElementById('grow-' + id), abierta: !!document.querySelector('#blkGestiones .cg-row[style*="accent"]') }), gid);
    console.log('    deep-link:', gid, J(dl));
    ok(dl.tab === 'blkGestiones' && dl.fila, 'el deep-link ?g= aterriza en la pestaña Gestiones con la fila');
    await s.captura('B02-seprosa-gestiones-deeplink', { full: false });
  }
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ C · Admin en cuenta con contrato pendiente de aprobación ═══
{
  const s = await abrir({ email: USUARIOS.admin, carpeta: 'ficha-v3' });
  await abrirFicha(s, CASOS.pendiente);
  const f = await leerFicha(s);
  console.log('\n── C · admin · contrato pendiente de aprobación');
  console.log('    estado:', f.estado); console.log('    esperando:', J(f.esperando)); console.log('    btns:', J(f.esperandoBtns)); console.log('    verbos:', J(f.verbos));
  ok(f.esperando.some(x => /Aprobar el contrato/.test(x)) && f.esperandoBtns.some(x => /Aprobar/.test(x)), 'Aprobar aparece como fila con su botón (sin aprobar nada)');
  ok(!f.verbos.some(v => /\[SUG\]/.test(v)), 'ningún verbo se marca Sugerido cuando lo primero es aprobar (no es un verbo)');
  await s.captura('C01-pendiente-aprobacion', { full: false });
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ D · Vendedora (Karla) en su cliente, y rebote en uno ajeno ═══
{
  const s = await abrir({ email: USUARIOS.vendedor, carpeta: 'ficha-v3' });
  const info = await abrirFicha(s, CASOS.karla);
  const f = await leerFicha(s);
  console.log(`\n── D · vendedora · COPASECUVA (${info.msTotal} ms)`);
  console.log('    estado:', f.estado); console.log('    verbos:', J(f.verbos)); console.log('    tabs:', J(f.tabs)); console.log('    editar:', f.editar);
  ok(f.verbos.length === 6, 'la vendedora ve los seis verbos');
  ok(!f.tabs.some(t => /Documentos/.test(t)), 'la vendedora no ve la pestaña Documentos');
  ok(/Ver datos/.test(f.editar), 'la vendedora ve "Ver datos" (solo lectura)');
  const panel = await s.hacer(() => { Centro.abrirMenu(); return [...document.querySelectorAll('#cgMenu .cg-acc.off')].map(e => e.querySelector('.t')?.textContent.trim() + ' — ' + e.querySelector('.h')?.textContent.trim()); });
  console.log('    en gris:', J(panel));
  ok(panel.some(x => /Documentos del cliente/.test(x)) && panel.some(x => /traslado/i.test(x)), 'documentos y traslado salen en gris con el motivo');
  await s.captura('D01-vendedora-panel', { full: false });
  await s.hacer(() => Centro.cerrarMenu());
  await s.captura('D02-vendedora-resumen', { full: true });
  const ajeno = await s.ir(`/clientes/centro.html?id=${CASOS.agencia}`, { esperar: 2500 });
  const toasts = await s.toasts();
  ok(toasts.some(t => /no está en tu cartera/.test(t.msg)) && !(await s.page.$('#vistaFicha:not(.hidden)')), 'cliente ajeno: rebota al directorio con aviso');
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ E · Admin en cuenta NUEVA: verbos en gris con motivo y toast ═══
{
  const s = await abrir({ email: USUARIOS.admin, carpeta: 'ficha-v3' });
  await abrirFicha(s, CASOS.nuevo);
  const f = await leerFicha(s);
  console.log('\n── E · admin · cuenta nueva');
  console.log('    estado:', f.estado, '|', f.estadoClase); console.log('    verbos:', J(f.verbos)); console.log('    resumen:', J(f.resumenFilas), (await s.page.evaluate(() => document.getElementById('fResumenTab')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 120))));
  ok(/Cuenta nueva|Nada espera|pide atención|esperan/.test(f.estado), 'estado de cuenta nueva en palabras');
  // APM tiene radios en campo sin contrato: Reemplazar sí aplica; lo que no
  // aplica es colgar un anexo (no hay contrato).
  ok(f.verbos.some(v => /Agregar equipos \[off: .{20,}/.test(v)), 'Agregar equipos en gris con motivo');
  ok(f.verbos.some(v => /Nuevo contrato.*\[SUG\]/.test(v)), 'el verbo de cuenta es "Nuevo contrato" y va como Sugerido');
  await s.page.click('#cgVerbos .cg-verbo.off'); await espera(300);
  const t = await s.toasts();
  ok(t.some(x => x.type === 'warn' && x.msg.length > 20), 'tocar un verbo en gris explica el motivo en un toast: ' + J(t.map(x => x.msg)));
  await s.captura('E01-cuenta-nueva', { full: false });
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ F · Bodega (inventario) en SEPROSA: solo consulta ═══
{
  const s = await abrir({ email: USUARIOS.inventario, carpeta: 'ficha-v3' });
  await abrirFicha(s, CASOS.seprosa);
  const f = await leerFicha(s);
  console.log('\n── F · bodega · SEPROSA');
  console.log('    verbos:', J(f.verbos)); console.log('    tiles:', J(f.tiles));
  ok(f.verbos.length === 1 && /Más acciones/.test(f.verbos[0]), 'bodega solo ve "Más acciones"');
  ok(!f.tiles.some(x => /Mensual/.test(x)), 'bodega no ve el Mensual');
  const off = await s.hacer(() => { Centro.abrirMenu(); return [...document.querySelectorAll('#cgMenu .cg-acc')].filter(e => e.classList.contains('off')).length + '/' + document.querySelectorAll('#cgMenu .cg-acc').length; });
  console.log('    panel en gris:', off);
  await s.captura('F01-bodega', { full: false });
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

// ═══ G · Teléfono (admin) en SEPROSA ═══
{
  const s = await abrir({ email: USUARIOS.admin, viewport: 'telefono', carpeta: 'ficha-v3' });
  const info = await abrirFicha(s, CASOS.seprosa);
  const m = await s.page.evaluate(() => ({
    verbosVisibles: [...document.querySelectorAll('#cgVerbos .cg-verbo')].filter(e => getComputedStyle(e).display !== 'none').length,
    asidePrimero: document.querySelector('.cg-aside').getBoundingClientRect().top < document.querySelector('.cg-main').getBoundingClientRect().top,
    dock: [...document.querySelectorAll('#cgDock .btn')].map(e => e.textContent.trim()),
    dockVisible: getComputedStyle(document.getElementById('cgDock')).display !== 'none',
    verbosScrollX: document.getElementById('cgVerbos').scrollWidth > document.getElementById('cgVerbos').clientWidth,
  }));
  const g = await s.geometria();
  console.log(`\n── G · teléfono · SEPROSA (${info.msTotal} ms)`, J(m), J(g));
  ok(m.verbosVisibles === 5 && m.verbosScrollX, 'cinco verbos en una fila que se desliza ("Más" baja al dock)');
  ok(m.asidePrimero, '"Qué está esperando" va arriba de las pestañas');
  ok(m.dockVisible && m.dock.length >= 1 && /Acciones/.test(m.dock[0]), 'dock con Acciones');
  ok(!g.scrollHorizontal, 'sin scroll horizontal');
  await s.captura('G01-telefono-resumen', { full: true });
  await s.page.evaluate(() => document.querySelector('#cgTabs [data-tab="blkEquipos"]').click()); await espera(600);
  await s.page.evaluate(() => { const d = document.querySelector('#fEquipos .cg-eqgrp'); if (d) d.open = true; });
  await espera(300);
  // El dock fijo tapa el borde inferior: el radio se centra en pantalla antes
  // del toque (como haría el pulgar al desplazarse).
  const ch = await s.page.$('#fEquipos tr[data-eq] input.cg-chk');
  if (ch) { await ch.evaluate(e => e.scrollIntoView({ block: 'center' })); await espera(200); await ch.click(); await espera(300); }
  const bar = await s.page.evaluate(() => { const b = document.getElementById('cgSelBar'); const r = b.getBoundingClientRect(); return { txt: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 40), pos: getComputedStyle(b).position, abajo: Math.abs(r.bottom - innerHeight) < 2, iw: innerWidth, sw: document.documentElement.scrollWidth }; });
  console.log('    selbar móvil:', J(bar));
  // innerWidth > 390 = el layout se ensanchó por algo que no cabe (los toques
  // caen corridos). Lo detectó el emulador con SEPROSA el 2026-10-08.
  ok(bar.iw === 390 && bar.sw === 390, 'la pestaña Equipos cabe en los 390 px del teléfono');
  ok(bar.pos === 'fixed' && bar.abajo, 'la barra de selección queda fija abajo en el teléfono');
  await s.captura('G02-telefono-equipos', { full: false });
  await s.page.evaluate(() => document.querySelector('#cgDock .btn').click()); await espera(400);
  ok(await s.page.evaluate(() => !document.getElementById('cgMenu').classList.contains('hidden') && document.getElementById('cgMenu').getBoundingClientRect().width <= innerWidth + 1), 'el panel ocupa el ancho del teléfono');
  await s.captura('G03-telefono-panel', { full: false });
  ok(!s.errores.length, 'sin errores de página: ' + s.errores.join(' | '));
  await s.cerrar();
}

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
