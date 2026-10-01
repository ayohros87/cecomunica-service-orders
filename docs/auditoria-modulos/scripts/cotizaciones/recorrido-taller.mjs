// Auditoría de módulos 2026-09-30 · Cotizaciones · recorrido de la JEFA DE TALLER en escritorio.
// Solangel cotiza una orden COMPLETADA con piezas registradas por el técnico
// (precarga), agrega piezas por autocompletar y por el catálogo, mide cuántas
// veces se autoguarda el borrador, lo restaura al recargar, genera la
// cotización, la aprueba y envía, y registra la respuesta del cliente.
//   node recorrido-taller.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
import fs from 'node:fs';
const OUT = process.env.SALIDA || 'C:/Users/ayohr/AppData/Local/Temp/claude/c--Projects-cecomunica-service-orders/60b5518e-dd51-4291-ac4d-c4f75cea0c5b/scratchpad/cot-taller.json';
const ORDEN = process.env.ORDEN || '2026092905';   // COMPLETADO (EN OFICINA), 1 equipo, 4 piezas del técnico
const ORDEN2 = process.env.ORDEN2 || '2025082901'; // ASIGNADO, 7 equipos, 5 con intervención
const log = (...a) => console.log(...a);
const pasos = []; const paso = (d) => { pasos.push(d); log(`  [${pasos.length}] ${d}`); };
const res = { tiempos: {} };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'cotizaciones' });
const P = s.page;
const esperarNav = async (fn) => { const nav = P.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null); await fn(); await nav; await s.quieto(1200); };
const modalTexto = () => s.texto('.modal-backdrop.open');
const clicModal = async (sel) => { await P.click('.modal-backdrop.open ' + sel); await s.quieto(800, 15000); };
// Modal.confirm / Modal.prompt del kit viven en .overlay (no en .modal-backdrop)
const CONF = '.overlay[style*="flex"]';
const confirmTexto = () => s.texto(CONF);
const clicConfirm = async (sel) => { await P.click(CONF + ' ' + sel); await s.quieto(800, 15000); };
const autosaves = async () => (await s.consultas()).filter(q => /setBorradorCotizacion/.test(q)).length;

// ── 0. Cómo se llega: desde la bandeja de órdenes ────────────────────────────
let r = await s.ir(`/ordenes/index.html?orden=${ORDEN}`); res.tiempos.bandeja = r; log('BANDEJA', r);
await s.captura('20-taller-escritorio-bandeja-orden');
const menu = await P.evaluate((id) => {
  const el = document.querySelector(`[data-orden-id="${id}"]`);
  const fila = el && (el.closest('tr, .orden-card, [data-id]') || el.parentElement);
  const triggers = fila ? [...fila.querySelectorAll('button, [role=button]')].map(b => (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 30)) : [];
  return { hayFila: !!fila, botones: triggers, cotizarVisible: !!document.querySelector(`[data-action="cotizar-orden"][data-orden-id="${id}"]`) };
}, ORDEN);
log('fila de la orden en la bandeja:', menu);
const abierto = await P.evaluate((id) => {
  const el = document.querySelector(`[data-orden-id="${id}"]`);
  const fila = el && (el.closest('tr, .orden-card, [data-id]') || el.parentElement);
  const b = fila && [...fila.querySelectorAll('button')].find(x => /más|menu|acciones|⋯|…/i.test((x.getAttribute('title') || '') + (x.getAttribute('aria-label') || '') + x.textContent));
  if (b) { b.click(); return (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent).trim(); }
  return null;
}, ORDEN);
await wait(500);
log('menú ⋯ abierto con:', abierto, '| items:', await P.evaluate(() => [...document.querySelectorAll('.dropdown-menu, .menu, [role=menu]')].filter(m => m.offsetParent).map(m => m.innerText.replace(/\n/g, ' · ')).join(' || ').slice(0, 300)));
await s.captura('20b-taller-escritorio-menu-orden');
log('¿Cotizar en el menú?', await P.evaluate((id) => !!document.querySelector(`[data-action="cotizar-orden"][data-orden-id="${id}"]`), ORDEN));

// ── 1. Cotizar orden con precarga ────────────────────────────────────────────
r = await s.ir(`/ordenes/cotizar-orden.html?id=${ORDEN}`, { esperar: 1500 }); res.tiempos.cotizar = r; log('COTIZAR', r);
if (await P.$(CONF)) { log('borrador previo (de otra corrida):', (await confirmTexto()).replace(/\n/g, ' | ')); await clicConfirm('[data-action="cancel"]'); await s.quieto(1200); }
log('consultas:', await s.consultas()); log('toasts:', await s.toasts()); log('errores:', s.errores);
await s.captura('21-taller-escritorio-cotizar-orden-precarga', { full: true });
log('campos editables:', await P.evaluate(() => document.querySelectorAll('#cotizarMount input:not([type=hidden]):not([disabled]), #cotizarMount select, #cotizarMount textarea').length));
log('equipos:', (await s.texto('#panelEquipos')).replace(/\n/g, ' | ').slice(0, 700));
log('resumen:', (await s.texto('#panelResumen')).replace(/\n/g, ' | '));
log('cliente:', (await s.texto('#panelCliente')).replace(/\n/g, ' | ').slice(0, 300));
log('autosaves tras precarga:', await autosaves());

// Agregar pieza por autocompletar
paso('clic "Agregar pieza"'); await P.click('[data-add]'); await wait(300);
paso('teclear "antena" en Nº pieza'); await P.keyboard.type('antena', { delay: 80 }); await wait(400);
log('popover:', await P.evaluate(() => { const p = [...document.querySelectorAll('.co-pza-pop')].find(x => !x.hidden); return p ? p.innerText.replace(/\n/g, ' | ').slice(0, 200) : '(oculto)'; }));
await s.captura('22-taller-escritorio-autocompletar-pieza');
paso('Escape (sin coincidencia) y escribir a mano'); await P.keyboard.press('Escape');
const fila = (await P.$$('tr[data-line]')).pop();
paso('descripción a mano'); const desc = await fila.$('.co-desc'); await desc.click(); await desc.type('PRUEBA-AUDIT-cotizaciones antena corta', { delay: 40 });
paso('precio'); const pre = await fila.$('.co-precio'); await pre.click({ clickCount: 3 }); await pre.type('18.5', { delay: 80 });
await s.quieto(1200);
log('autosaves tras 1 pieza a mano (3 campos):', await autosaves());

// Catálogo lateral
paso('clic "Catálogo de piezas"'); await P.click('.co-cat-btn'); await s.quieto(800);
log('catálogo:', (await s.texto('.co-cat-panel')).replace(/\n/g, ' | ').slice(0, 500));
await s.captura('23-taller-escritorio-catalogo-drawer');
paso('clic + en la primera pieza del catálogo'); await P.click('.co-cat-list [data-add-pid]'); await s.quieto(800);
log('toasts:', await s.toasts());
paso('cerrar catálogo'); await P.keyboard.press('Escape'); await wait(300);
// Descuento global y validez
paso('descuento global 5%'); await P.click('#inpDesc', { clickCount: 3 }); await P.keyboard.type('5'); await s.quieto(1200);
log('autosaves acumulados:', await autosaves(), '| líneas:', await P.evaluate(() => document.querySelectorAll('tr[data-line]').length));
log('resumen:', (await s.texto('#panelResumen')).replace(/\n/g, ' | '));
await s.captura('24-taller-escritorio-cotizar-orden-lleno', { full: true });

// Vista previa
paso('clic Vista previa'); await P.click('#btnPreview'); await s.quieto(800);
await s.captura('25-taller-escritorio-vista-previa');
log('preview:', (await modalTexto()).replace(/\n/g, ' | ').slice(0, 500));
paso('cerrar vista previa'); await clicModal('[data-sheet-action="cerrar"]');

// Recargar → borrador encontrado
res.autosaves_antes_recarga = await autosaves();
r = await s.ir(`/ordenes/cotizar-orden.html?id=${ORDEN}`, { esperar: 1500 }); log('RECARGA', r);
await P.waitForSelector(CONF, { timeout: 8000 }).catch(() => null);
log('modal:', (await confirmTexto()).replace(/\n/g, ' | '));
await s.captura('26-taller-escritorio-borrador-encontrado');
paso('Restaurar borrador'); await clicConfirm('[data-action="confirm"]'); await s.quieto(1200);
log('toasts:', await s.toasts(), '| líneas restauradas:', await P.evaluate(() => document.querySelectorAll('tr[data-line]').length), '| desc:', await P.$eval('#inpDesc', e => e.value));
log('consultas recarga:', await s.consultas());

// Generar
paso('clic Preparar cotización'); const t0 = Date.now();
await esperarNav(() => P.click('#btnGenerar'));
log('tras generar:', P.url(), 'ms', Date.now() - t0, '| toasts:', await s.toasts(), '| errores', s.errores.slice(0, 3));
const doc = new URL(P.url()).searchParams.get('id'); res.doc = doc;
await wait(500); await s.quieto(1200);
await s.captura('27-taller-escritorio-detalle-borrador', { full: true });
log('header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 300));
log('pasos taller:', (await s.texto('#detalleMount .cc-panel')).replace(/\n/g, ' | ').slice(0, 300));
log('transiciones:', await s.texto('#panelTransiciones'));
res.pasos_hasta_borrador = pasos.slice(); log('PASOS hasta borrador:', pasos.length);

// Aprobar y enviar
pasos.length = 0;
paso('clic Aprobar y enviar'); await P.click('#btnAprobar'); await s.quieto(1000);
await s.captura('28-taller-escritorio-aprobacion-modal', { full: true });
log('modal aprobación:', (await modalTexto()).replace(/\n/g, ' | ').slice(0, 900));
paso('clic Aprobar y enviar (panel)'); await P.click('.modal-backdrop.open [data-sheet-action="aprobar"]'); await wait(1500); await s.quieto(1200);
const prompt = await P.$(CONF + ' [data-role="prompt-input"]');
if (prompt) {
  log('PIDE EMAIL:', (await confirmTexto()).replace(/\n/g, ' | '));
  await s.captura('28b-taller-escritorio-falta-email');
  paso('escribir email'); await prompt.type('prueba-audit-cotizaciones@ejemplo.test');
  paso('Aceptar'); await clicConfirm('[data-action="confirm"]'); await wait(1000); await s.quieto(1200);
}
log('toasts:', await s.toasts(), '| errores:', s.errores.slice(0, 3));
await s.captura('29-taller-escritorio-detalle-enviada', { full: true });
log('header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 300));
log('pasos taller:', (await s.texto('#detalleMount .cc-panel')).replace(/\n/g, ' | ').slice(0, 300));
log('historial:', (await s.texto('.cc-timeline')).replace(/\n/g, ' | '));
res.pasos_aprobar_enviar = pasos.slice();

// Respuesta del cliente
pasos.length = 0;
paso('clic Respuesta del cliente'); await P.click('#btnCerrar'); await s.quieto(800);
await s.captura('30-taller-escritorio-respuesta-cliente');
log('respuesta prompt:', (await modalTexto()).replace(/\n/g, ' | ').slice(0, 600));
paso('El cliente aceptó'); await clicModal('[data-act="acepto"]');
paso('medio: correo'); await P.select('.modal-backdrop.open #ctMedio', 'correo');
paso('detalle'); await P.type('.modal-backdrop.open #ctNota', 'PRUEBA-AUDIT-cotizaciones · respondió el correo');
await s.captura('30b-taller-escritorio-respuesta-como-acepto');
paso('Pasar a facturar'); await clicModal('[data-act="confirmar-acepto"]'); await wait(800); await s.quieto(1200);
log('toasts:', await s.toasts());
await s.captura('31-taller-escritorio-detalle-aceptada', { full: true });
log('pasos taller:', (await s.texto('#detalleMount .cc-panel')).replace(/\n/g, ' | ').slice(0, 300));
log('historial:', (await s.texto('.cc-timeline')).replace(/\n/g, ' | '));
res.pasos_respuesta_cliente = pasos.slice();

// Volver a cotizar la misma orden → "ya tiene cotización"
r = await s.ir(`/ordenes/cotizar-orden.html?id=${ORDEN}`, { esperar: 1500 });
log('ya tiene:', (await modalTexto()).replace(/\n/g, ' | '));
await s.captura('32-taller-escritorio-orden-ya-tiene-cotizacion');

// Orden de 7 equipos (escritorio y tablet)
r = await s.ir(`/ordenes/cotizar-orden.html?id=${ORDEN2}`, { esperar: 1500 }); res.tiempos.cotizar7 = r; log('COTIZAR 7 EQUIPOS', r, '| toasts', await s.toasts());
if (await P.$(CONF)) await clicConfirm('[data-action="cancel"]');
if (await P.$('.modal-backdrop.open')) { log('modal:', await modalTexto()); await clicModal('[data-sheet-action="otra"]').catch(() => {}); }
await s.captura('33-taller-escritorio-cotizar-7-equipos', { full: true });
log('geom:', await s.geometria(), '| campos:', await P.evaluate(() => document.querySelectorAll('#cotizarMount input:not([disabled]), #cotizarMount select, #cotizarMount textarea').length));
await P.setViewport({ width: 1024, height: 768, hasTouch: true });
r = await s.ir(`/ordenes/cotizar-orden.html?id=${ORDEN2}`, { esperar: 1500 });
if (await P.$('.modal-backdrop.open')) await clicModal('[data-sheet-action="otra"]').catch(() => {});
await s.captura('34-taller-tablet-cotizar-7-equipos');
await P.click('.co-cat-btn').catch(() => {}); await s.quieto(800);
await s.captura('35-taller-tablet-catalogo');
log('geom tablet:', await s.geometria());

// Lista de taller
await P.setViewport({ width: 1280, height: 800 });
r = await s.ir('/cotizaciones/index.html'); log('LISTA TALLER', r);
log('tipoSeg:', await s.texto('#tipoSeg'), '| segments:', await s.texto('#segments'));
log('stats:', (await s.texto('#statsRegion')).replace(/\n/g, ' | '));
await s.captura('36-taller-escritorio-lista-taller');
log('errores:', s.errores);
res.autosaves_total = await autosaves();
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
await s.cerrar();
log('RES', JSON.stringify(res));
