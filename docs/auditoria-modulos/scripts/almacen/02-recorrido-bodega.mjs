// Recorrido de BODEGA (rol inventario) por el espacio Almacén contra el
// emulador: pestañas, buscar serial, ficha (corregir serial, baja, reactivar,
// corregir a bodega, inspección OK), recibir con lector simulado, conteo,
// venta, editar ficha en Avanzado. Escritorio y teléfono. Requiere
// 00-seed-prueba.js (y AUDALM0006 en por_clasificar).
//   node 02-recorrido-bodega.mjs [escritorio|telefono]
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

const VP = process.argv[2] || 'escritorio';
const SUF = process.argv[3] || '';   // sufijo de los seriales de prueba (2ª corrida)
const s = await abrir({ email: USUARIOS.inventario, viewport: VP, carpeta: 'almacen' });
const p = s.page;
const log = (...a) => console.log(...a);
const R = (n) => `${String(Math.round(n)).padStart(5)} ms`;

// Último modal abierto (los estáticos de la página también tienen la clase)
const enModal = (fn, ...args) => p.evaluate((f, ...a) => {
  const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1];
  return m ? (new Function('m', 'args', `return (${f})(m, ...args)`))(m, a) : null;
}, fn.toString(), ...args);
const clicEnModal = async (sel) => { await enModal((m, sel) => m.querySelector(sel)?.click(), sel); return s.quieto(700, 12000); };
const clicTextoEnModal = async (txt) => {
  const ok = await enModal((m, txt) => { const b = [...m.querySelectorAll('button')].find(b => b.textContent.trim().includes(txt)); if (b) { b.click(); return true; } return false; }, txt);
  await s.quieto(700, 12000); return ok;
};
const textoModal = () => enModal((m) => m.innerText.replace(/\n{2,}/g, '\n').slice(0, 1500));
const escribir = async (sel, txt) => { await p.focus(sel); await p.keyboard.type(txt, { delay: 5 }); };
const enter = async () => { await p.keyboard.press('Enter'); return s.quieto(600, 12000); };
const t0 = () => p.evaluate(() => performance.now());
const desde = async (t) => (await p.evaluate(() => performance.now())) - t;
// Las fichas y los asistentes abren tras 1-3 viajes a Firestore: se espera
// a que el ÚLTIMO modal abierto contenga un texto, o a un selector visible.
const esperarModal = (txt, ms = 12000) => p.waitForFunction((txt) => {
  const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1];
  return !!m && m.innerText.includes(txt);
}, { timeout: ms }, txt).then(() => true).catch(() => false);
const esperarSel = (sel, ms = 12000) => p.waitForSelector(sel, { timeout: ms, visible: true }).then(() => true).catch(() => false);
const PROMPT = '.overlay [data-role="prompt-input"]';   // confirm/prompt del kit son .overlay, no .modal-backdrop
const CONFIRM = '.overlay [data-action="confirm"]';
const ponerPrompt = async (v) => { await esperarSel(PROMPT); await p.evaluate((sel, v) => { const os = document.querySelectorAll(sel); os[os.length - 1].value = v; }, PROMPT, v); };
const confirmar = async () => { await esperarSel(CONFIRM); await p.evaluate((sel) => { const os = document.querySelectorAll(sel); os[os.length - 1].click(); }, CONFIRM); return s.quieto(700, 12000); };
// Texto del diálogo de más arriba: un confirm/prompt (.overlay) si lo hay; si no, la hoja.
const textoOverlay = () => p.evaluate(() => { const os = document.querySelectorAll('.overlay'); const o = os[os.length - 1]; return o ? o.innerText.replace(/\n{2,}/g, '\n').slice(0, 600) : ''; });
const textoDialogo = async () => (await textoOverlay()) || (await textoModal()) || '';
const cerrarFicha = async () => { await p.keyboard.press('Escape'); await s.quieto(400, 3000); await p.evaluate(() => { const b = document.getElementById('exBuscador'); if (b) b.value = ''; }); };
const abrirFicha = async (serial, botonEsperado) => { await escribir('#exBuscador', serial); await enter(); return esperarModal(botonEsperado || serial); };

async function paso(nombre, fn) {
  const t = await t0();
  let r;
  try { r = await fn(); } catch (e) { log(`   ✗ ${nombre}: ${e.message.slice(0, 160)}`); return null; }
  log(`   ${nombre}: ${R(await desde(t))}`);
  return r;
}
const S = (n) => `AUDALM${SUF}${n}`;

// ── 1. Pestañas ────────────────────────────────────────────────────────
log(`\n=== ${VP} · inventario ===`);
const i1 = await s.ir('/almacen/index.html');
log(`Hoy: total ${i1.msTotal} ms · 1ª Firestore ${i1.primeraFs} ms · ${i1.fsReqs} peticiones · quieto=${i1.quieto}`);
await s.captura(`01-inventario-${VP}-hoy`);
await s.captura(`01-inventario-${VP}-hoy-completa`, { full: true });
log('Hoy texto:\n' + (await s.texto('#tab-hoy')).slice(0, 2500));
log('geometria', JSON.stringify(await s.geometria()));
log('consultas: ' + (await s.consultas()).join(' · '));
if (s.errores.length) log('errores: ' + [...new Set(s.errores)].join(' | '));

for (const tab of ['asignar', 'existencias', 'serial']) {
  await paso(`clic pestaña ${tab}`, () => s.clic(`.ws-tab[data-ws-tab="${tab}"]`, { esperar: 1200 }));
  await s.captura(`02-inventario-${VP}-${tab}`);
  log(`${tab} texto:\n` + (await s.texto(`#tab-${tab}`)).slice(0, 700));
  log('geometria', JSON.stringify(await s.geometria()));
}

// KPIs de Existencias (para contrastar con el pool)
await s.clic('.ws-tab[data-ws-tab="existencias"]');
log('KPIs Existencias: ' + await p.evaluate(() => ['exKpiBodega', 'exKpiCliente', 'exKpiTaller', 'exKpiCuarentena', 'exKpiDif'].map(id => id + '=' + document.getElementById(id)?.textContent).join(' ')));
log('fila PNC360S-R: ' + await p.evaluate(() => [...document.querySelectorAll('#exTabla tr.ex-fila')].map(tr => tr.innerText.replace(/\s+/g, ' ')).filter(t => /PNC360S-R/.test(t)).join(' | ')));
log('primeras filas: ' + await p.evaluate(() => [...document.querySelectorAll('#exTabla tr.ex-fila')].slice(0, 3).map(tr => tr.innerText.replace(/\s+/g, ' ')).join(' | ')));

// ── 2. Buscar serial → ficha ───────────────────────────────────────────
await paso(`buscar ${S('0001')} (tipear+Enter)`, () => abrirFicha(S('0001')));
await s.captura(`03-inventario-${VP}-ficha-equipo`);
log('ficha texto:\n' + (await textoModal() || '(sin modal)'));
await cerrarFicha();

// ── 3. Corregir serial desde la ficha ──────────────────────────────────
await paso(`corregir serial ${S('0002')} → ${S('0102')}`, async () => {
  await abrirFicha(S('0002'), 'Corregir serial');
  if (!await clicTextoEnModal('Corregir serial')) throw new Error('sin botón Corregir serial');
  await ponerPrompt(S('0102'));
  await s.captura(`04-inventario-${VP}-corregir-serial-prompt`);
  await confirmar();
  await esperarSel(CONFIRM);
  log('   confirmación: ' + (await textoDialogo()).slice(0, 300).replace(/\n/g, ' / '));
  await confirmar();
});
log('toasts: ' + JSON.stringify((await s.toasts()).slice(-2)));
await cerrarFicha();

// ── 4. Baja y reactivar ────────────────────────────────────────────────
await paso(`dar de baja ${S('0003')}`, async () => {
  await abrirFicha(S('0003'), 'Dar de baja');
  if (!await clicTextoEnModal('Dar de baja')) throw new Error('sin botón Dar de baja');
  await ponerPrompt('PRUEBA-AUDIT-almacen: baja de prueba');
  await confirmar();
  await esperarModal('Reactivar');
});
log('   ficha tras baja: ' + ((await textoModal()) || '').split('\n').slice(0, 3).join(' / '));
await paso(`reactivar ${S('0003')}`, async () => {
  if (!await clicTextoEnModal('Reactivar')) throw new Error('sin botón Reactivar');
  await ponerPrompt('PRUEBA-AUDIT-almacen: reactivar');
  await confirmar();
  await esperarModal('Dar de baja');
});
log('toasts: ' + JSON.stringify((await s.toasts()).slice(-2)));
await cerrarFicha();

// ── 5. Por clasificar → Corregir a bodega (mover) ──────────────────────
await paso(`corregir a bodega ${S('0006')} (por clasificar)`, async () => {
  await abrirFicha(S('0006'), 'Corregir a bodega');
  await s.captura(`05a-inventario-${VP}-ficha-por-clasificar`);
  if (!await clicTextoEnModal('Corregir a bodega')) throw new Error('sin botón Corregir a bodega');
  await ponerPrompt('PRUEBA-AUDIT-almacen: contado en estante');
  await confirmar();
  await esperarModal('Registrar venta');
});
log('toasts: ' + JSON.stringify((await s.toasts()).slice(-1)));
await cerrarFicha();

// ── 6. Cuarentena: Inspección OK ───────────────────────────────────────
await paso(`inspección OK ${S('0008')} (devuelto sin tiquete)`, async () => {
  await abrirFicha(S('0008'), 'Inspección OK');
  await s.captura(`05-inventario-${VP}-ficha-devuelto`);
  if (!await clicTextoEnModal('Inspección OK')) throw new Error('sin botón Inspección OK');
  await esperarSel(CONFIRM);
  log('   confirm: ' + (await textoDialogo()).slice(0, 200).replace(/\n/g, ' / '));
  await confirmar();
  await esperarModal('Registrar venta');
});
log('toasts: ' + JSON.stringify((await s.toasts()).slice(-1)));
await cerrarFicha();

// ── 7. Recibir equipos con lector simulado ─────────────────────────────
await paso('abrir Recibir', async () => { await p.evaluate(() => AlmacenPage.abrirRecibir()); await esperarSel('#asrModeloFiltro'); await s.quieto(600, 8000); });
await s.captura(`06-inventario-${VP}-recibir-vacio`);
await paso('tipear "PNC360S-R" en el filtro de modelo', async () => { await escribir('#asrModeloFiltro', 'PNC360S-R'); await s.quieto(300, 3000); });
log('   foco al terminar de tipear: ' + await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName) + ' · modelo=' + await p.evaluate(() => document.querySelector('#asrModelo')?.selectedOptions[0]?.textContent) + ' · textarea=' + JSON.stringify(await p.evaluate(() => document.querySelector('#asrSeriales')?.value)));
await p.evaluate(() => { document.querySelector('#asrSeriales').value = ''; document.querySelector('#asrSeriales').focus(); });
await paso('3 escaneos (serial+Enter), uno repetido', async () => { await p.keyboard.type(`${S('0009')}\n${S('0010')}\n${S('0010')}\n`, { delay: 5 }); await s.quieto(300, 3000); });
log('   contador: ' + await p.evaluate(() => document.querySelector('#asrContador')?.innerText));
await s.captura(`07-inventario-${VP}-recibir-lleno`);
await paso('clic Recibir', async () => { await p.click('#asrBtnGuardar'); await s.quieto(1200, 15000); });
log('   modal tras recibir: ' + ((await textoModal()) || '(ninguno)').slice(0, 300).replace(/\n/g, ' / '));
log('toasts: ' + JSON.stringify((await s.toasts()).slice(-1)));

// ── 8. Conteo ──────────────────────────────────────────────────────────
await paso('abrir Conteo', async () => { await p.evaluate(() => AlmacenPage.abrirConteo()); await esperarSel('#conteoTbodyCaptura'); await s.quieto(500, 8000); });
await s.captura(`08-inventario-${VP}-conteo`);
log('   modelos en el conteo: ' + await p.evaluate(() => document.querySelectorAll('#conteoTbodyCaptura input').length));
await paso('filtrar PNC360 + Enter + 5 + Enter', async () => {
  await escribir('#asistenteConteoOverlay input[type="search"]', 'PNC360'); await enter();
  log('   foco: ' + await p.evaluate(() => document.activeElement?.getAttribute('data-conteo-modelo') || document.activeElement?.tagName));
  await p.keyboard.type('5'); await enter();
  log('   foco tras Enter: ' + await p.evaluate(() => document.activeElement?.getAttribute('data-conteo-modelo') || document.activeElement?.className));
});
await paso('Revisar diferencias', async () => clicTextoEnModal('Revisar diferencias'));
await s.captura(`09-inventario-${VP}-conteo-diff`);
log('   diff: ' + ((await textoModal()) || '').slice(0, 500).replace(/\n/g, ' / '));
await clicEnModal('[data-action="cerrar"]');

// ── 9. Venta desde la ficha ────────────────────────────────────────────
await paso(`venta ${S('0004')} desde la ficha`, async () => {
  await abrirFicha(S('0004'), 'Registrar venta');
  if (!await clicTextoEnModal('Registrar venta')) throw new Error('sin botón Registrar venta');
  await esperarSel('#asvFactura');
  await s.captura(`10-inventario-${VP}-venta`);
  await escribir('#asvCliente', 'PRUEBA-AUDIT-almacen CLIENTE');
  await escribir('#asvFactura', 'PRUEBA-AUDIT');
  await p.click('#asvBtnGuardar');
  await esperarSel(CONFIRM);
  log('   modal 1: ' + (await textoDialogo()).slice(0, 200).replace(/\n/g, ' / '));
  await confirmar();
  await p.waitForFunction(() => [...document.querySelectorAll('.overlay')].some(o => o.innerText.includes('Salen de bodega')), { timeout: 8000 }).catch(() => {});
  log('   modal 2: ' + (await textoDialogo()).slice(0, 300).replace(/\n/g, ' / '));
  await confirmar();
  await s.quieto(800, 8000);
  log('   modal 3: ' + ((await textoDialogo()) || '(ninguno)').slice(0, 200).replace(/\n/g, ' / '));
});
log('toasts: ' + JSON.stringify((await s.toasts()).slice(-2)));
await cerrarFicha();

// ── 10. Avanzado: editar ficha ─────────────────────────────────────────
await paso(`Avanzado: buscar ${S('0005')}`, async () => {
  await s.clic('.ws-tab[data-ws-tab="serial"]');
  await escribir('#eqBusqueda', S('0005'));
  await p.waitForFunction((x) => document.querySelector('#eqTabla')?.innerText.includes(x), { timeout: 30000 }, S('0005')).catch(() => {});
  await s.quieto(800, 5000);
});
log('   consultas de la búsqueda: ' + (await s.consultas()).slice(-4).join(' · '));
log('   filas: ' + await p.evaluate(() => document.querySelectorAll('#eqTabla tr').length) + ' · ' + (await s.texto('#eqResumen')));
await s.captura(`11-inventario-${VP}-avanzado-busqueda`);
await paso('menú ⋯ → Editar ficha → notas → Guardar', async () => {
  await p.evaluate(() => document.querySelector('#eqTabla .overflow-menu-btn')?.click()); await s.quieto(300, 2000);
  await s.captura(`11-inventario-${VP}-avanzado-menu`);
  log('   menú: ' + await p.evaluate(() => [...document.querySelectorAll('#eqTabla .overflow-menu-dropdown.open .overflow-menu-item')].map(b => b.textContent.trim()).join(' | ')));
  const ok = await p.evaluate(() => { const b = [...document.querySelectorAll('#eqTabla .overflow-menu-item')].find(b => /Editar ficha/.test(b.textContent)); if (b) { b.click(); return true; } return false; });
  if (!ok) throw new Error('sin Editar ficha');
  await esperarSel('#eqEditModal.open');
  await s.captura(`12-inventario-${VP}-avanzado-editar-ficha`);
  await p.evaluate(() => { document.getElementById('editNotas').value = 'PRUEBA-AUDIT-almacen nota editada'; });
  await p.click('#eqEditModal .btn-primary'); await s.quieto(1000, 10000);
});
log('toasts: ' + JSON.stringify((await s.toasts()).slice(-1)));
log('acciones de fila (texto): ' + await p.evaluate(() => document.querySelector('#eqTabla tr td:last-child')?.innerText.replace(/\s+/g, ' ')));

if (VP !== 'escritorio') {
  await s.clic('.ws-tab[data-ws-tab="existencias"]');
  await p.evaluate(() => { const b = document.getElementById('exBuscador'); b.value = ''; AlmacenExistencias.onBuscar('PNC360S-R'); });
  await s.quieto(500, 3000);
  await p.evaluate(() => document.querySelector('#exTabla tr.ex-fila')?.click()); await s.quieto(1500, 10000);
  await s.captura(`13-inventario-${VP}-existencias-fila-abierta`);
  log('geometria existencias: ' + JSON.stringify(await s.geometria()));
}
log('errores finales: ' + [...new Set(s.errores)].slice(0, 6).join(' | '));
await s.cerrar();
