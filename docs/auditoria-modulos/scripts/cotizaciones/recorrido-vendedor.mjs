// Auditoría de módulos 2026-09-30 · Cotizaciones · recorrido de la VENDEDORA en escritorio.
// Elvia (vendedor puro) crea una comercial de 3 líneas para un cliente existente,
// la guarda y la envía (dentro de política), la duplica y la saca de política
// (25% en un renglón), pide aprobación, la elimina, la restaura y la cierra.
// Karla (vendedora + supervisora por allowlist) solo mira la lista.
//   node recorrido-vendedor.mjs   → capturas en docs/auditoria-modulos/capturas/cotizaciones/
//   Deja los ids creados en $SALIDA (JSON) para los recorridos de admin y público.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
import fs from 'node:fs';
const OUT = process.env.SALIDA || 'C:/Users/ayohr/AppData/Local/Temp/claude/c--Projects-cecomunica-service-orders/60b5518e-dd51-4291-ac4d-c4f75cea0c5b/scratchpad/cot-vendedor.json';
const VENDEDOR = process.env.EMAIL || 'elvia.onodera@cecomunica.com';
const CLIENTE = '0kox44F4HSBvutZzeIfa'; // WONG HOLDING CORPORATION (existente, con email y representante)
const log = (...a) => console.log(...a);
const pasos = [];
const paso = (d) => { pasos.push(d); log(`  [${pasos.length}] ${d}`); };
const res = { creadas: [], tiempos: {} };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const s = await abrir({ email: VENDEDOR, viewport: 'escritorio', carpeta: 'cotizaciones' });
const P = s.page;
const esperarNav = async (fn) => { const nav = P.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null); await fn(); await nav; await s.quieto(1200); };
const modalTexto = () => s.texto('.modal-backdrop.open');
const clicModal = async (sel) => { await P.click('.modal-backdrop.open ' + sel); await s.quieto(800, 15000); };
// Modal.confirm / Modal.prompt del kit viven en .overlay (no en .modal-backdrop)
const CONF = '.overlay[style*="flex"]';
const confirmTexto = () => s.texto(CONF);
const clicConfirm = async (sel) => { await P.click(CONF + ' ' + sel); await s.quieto(800, 15000); };

// ── 1. Lista ────────────────────────────────────────────────────────────────
let r = await s.ir('/cotizaciones/index.html');
res.tiempos.lista = r; log('LISTA', r); log('consultas', await s.consultas());
await s.captura('01-vendedor-escritorio-lista');
log('tipoSeg:', await s.texto('#tipoSeg')); log('segments:', await s.texto('#segments'));
log('stats:', await s.texto('#statsRegion')); log('footer:', await s.texto('#footerResumen'), '·', await s.texto('#headerSubtitle'));
log('toggleMias visible:', await P.evaluate(() => getComputedStyle(document.getElementById('wrapToggleMias')).display));
log('geom', await s.geometria()); log('errores', s.errores);

// ── 2. Nueva cotización de 3 líneas ──────────────────────────────────────────
r = await s.ir('/cotizaciones/nueva-cotizacion.html');
res.tiempos.nueva = r; log('NUEVA', r); log('consultas', await s.consultas());
await s.captura('02-vendedor-escritorio-nueva-vacia', { full: true });
log('subtitulo:', await s.texto('#cotSubtitulo'));
log('campos editables en pantalla:', await P.evaluate(() => document.querySelectorAll('#editorMount input:not([type=hidden]):not([disabled]), #editorMount select, #editorMount textarea').length));
paso('clic en el buscador de cliente'); await P.click('#comboCliente input[data-combo-busqueda]');
paso('teclear "wong"'); await P.type('#comboCliente input[data-combo-busqueda]', 'wong'); await s.quieto(600);
await s.captura('03-vendedor-escritorio-buscador-cliente');
log('combo lista:', (await s.texto('#comboCliente .combo-list')).replace(/\n/g, ' | '));
paso('elegir el cliente');
await P.evaluate((id) => { document.querySelector(`#comboCliente .combo-item[data-id="${id}"]`).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }, CLIENTE);
await s.quieto(800);
log('panel cliente:', (await s.texto('#panelCliente')).replace(/\n/g, ' | ').slice(0, 400));

async function linea(i, texto, cant) {
  const rows = await P.$$('.cc-item-row');
  const row = rows[i];
  const inp = await row.$('.cc-item-nombre');
  paso(`renglón ${i + 1}: clic en descripción`); await inp.click();
  paso(`renglón ${i + 1}: teclear "${texto}"`); await inp.type(texto); await wait(300);
  const pop = await row.$eval('.cc-cat-pop', el => el.hidden ? '' : el.innerText).catch(() => '');
  log(`  autocompletar "${texto}":`, pop.replace(/\n/g, ' | ').slice(0, 220));
  paso(`renglón ${i + 1}: Enter (elige la sugerencia)`); await inp.press('Enter'); await wait(300);
  if (cant && cant !== 1) { const c = await row.$('.cc-item-cant'); paso(`renglón ${i + 1}: cantidad ${cant}`); await c.click({ clickCount: 3 }); await c.type(String(cant)); }
  log(`  fila ${i + 1}:`, await row.evaluate(el => [...el.querySelectorAll('input')].map(x => x.value).join(' | ') + ' → ' + el.querySelector('.cc-item-total').innerText));
}
await linea(0, 'PDC550', 1);
paso('clic "Agregar renglón"'); await P.click('#btnAddItem'); await wait(200);
await linea(1, 'NX-420', 2);
paso('clic "Agregar renglón"'); await P.click('#btnAddItem'); await wait(200);
await linea(2, 'AP32X', 1);
paso('intro: prefijo de prueba');
await P.evaluate(() => { const t = document.getElementById('inpIntro'); t.value = 'PRUEBA-AUDIT-cotizaciones · ' + t.value; t.dispatchEvent(new Event('input', { bubbles: true })); });
await s.quieto(600);
log('resumen:', (await s.texto('#panelResumen')).replace(/\n/g, ' | ')); log('subtitulo:', await s.texto('#cotSubtitulo'));
await s.captura('04-vendedor-escritorio-editor-3-lineas', { full: true });
log('toasts', await s.toasts());
paso('clic Guardar (con el NX-420 en $0)'); await P.click('#btnGuardar'); await s.quieto(800);
log('confirm renglones en cero:', (await confirmTexto()).replace(/\n/g, ' | '));
await s.captura('04b-vendedor-escritorio-renglon-en-cero');
paso('Cancelar'); await clicConfirm('[data-action="cancel"]');
paso('renglón 2: precio a mano 375'); { const pr = (await P.$$('.cc-item-row .cc-item-precio'))[1]; await pr.click({ clickCount: 3 }); await pr.type('375'); }
await s.quieto(600);
paso('clic Guardar'); const t0 = Date.now();
await esperarNav(() => P.click('#btnGuardar'));
log('tras guardar:', P.url(), 'ms', Date.now() - t0, 'toasts', await s.toasts());
const doc1 = new URL(P.url()).searchParams.get('id');
res.creadas.push({ doc: doc1, por: VENDEDOR, tipo: 'dentro-politica' });
await wait(800); await s.quieto(1200);
log('modal de envío abierto solo:', !!(await P.$('.modal-backdrop.open')));
await s.captura('05-vendedor-escritorio-detalle-modal-envio');
log('modal:', (await modalTexto()).replace(/\n/g, ' | ').slice(0, 700));
paso('clic Enviar en el panel'); await clicModal('[data-sheet-action="send"]'); await wait(500); await s.quieto(1200);
log('toasts', await s.toasts()); log('errores', s.errores);
await s.captura('06-vendedor-escritorio-detalle-enviada', { full: true });
log('header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 300));
log('transiciones:', await s.texto('#panelTransiciones')); log('historial:', (await s.texto('.cc-timeline')).replace(/\n/g, ' | '));
log('consultas detalle', await s.consultas());
res.pasos_envio_directo = pasos.slice(); log('PASOS envío directo:', pasos.length);

// ── 3. Duplicar → fuera de política → solicitar aprobación ──────────────────
pasos.length = 0;
paso('clic Duplicar'); await P.click('#btnDuplicar'); await s.quieto(600);
log('confirm:', (await confirmTexto()).replace(/\n/g, ' | '));
paso('confirmar'); await esperarNav(() => P.click(CONF + ' [data-action="confirm"]'));
log('tras duplicar:', P.url(), await s.toasts());
const doc2 = new URL(P.url()).searchParams.get('id');
res.creadas.push({ doc: doc2, por: VENDEDOR, tipo: 'fuera-politica' });
log('subtitulo edit:', await s.texto('#cotSubtitulo'));
paso('descuento 25% en renglón 1'); const d = await P.$('.cc-item-row .cc-item-descpct'); await d.click({ clickCount: 3 }); await d.type('25'); await s.quieto(600);
log('resumen edit:', (await s.texto('#panelResumen')).replace(/\n/g, ' | '));
log('subtitulo edit tras 25%:', await s.texto('#cotSubtitulo'));
await s.captura('07-vendedor-escritorio-editar-descuento-25');
paso('clic Guardar'); await esperarNav(() => P.click('#btnGuardar'));
log('tras guardar edit:', P.url(), await s.toasts());
await s.captura('08-vendedor-escritorio-detalle-fuera-politica', { full: true });
log('header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 300)); log('transiciones:', await s.texto('#panelTransiciones'));
paso('clic Solicitar aprobación'); await P.click('#btnSolicitar'); await s.quieto(600); log('confirm:', (await confirmTexto()).replace(/\n/g, ' | '));
await s.captura('08b-vendedor-escritorio-solicitar-aprobacion-confirm');
paso('confirmar'); await clicConfirm('[data-action="confirm"]'); log('toasts', await s.toasts());
res.pasos_fuera_politica = pasos.slice(); log('PASOS duplicar+fuera de política:', pasos.length);

// ── 4. Lista: eliminar la enviada, mirar el enlace público, restaurar, cerrar ─
pasos.length = 0;
r = await s.ir('/cotizaciones/index.html'); log('LISTA2', r);
log('fila doc1:', await P.evaluate((id) => document.querySelector(`tr[data-id="${id}"]`)?.innerText.replace(/\n/g, ' | '), doc1));
log('acciones fila doc1:', await P.evaluate((id) => [...document.querySelectorAll(`tr[data-id="${id}"] [data-action]`)].map(b => b.dataset.action + ':' + b.title).join(', '), doc1));
paso('clic Eliminar'); await P.click(`tr[data-id="${doc1}"] [data-action="eliminar"]`); await s.quieto(600); log('confirm:', (await confirmTexto()).replace(/\n/g, ' | '));
await s.captura('09-vendedor-escritorio-eliminar-confirm');
paso('confirmar'); await clicConfirm('[data-action="confirm"]'); log('toasts', await s.toasts());
log('fila doc1 sigue visible:', await P.evaluate((id) => !!document.querySelector(`tr[data-id="${id}"]`), doc1));
// El espejo público de la enviada que se acaba de eliminar (código del enlace)
const espejo = await P.evaluate(async (id) => { const d = await firebase.firestore().collection('cotizacion_verificaciones').doc(id).get(); const v = d.data() || {}; return { code: v.code, estado: v.estado || null, cotizacion_id: v.cotizacion_id }; }, doc1);
res.eliminada_enviada = { doc: doc1, ...espejo };
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
log('espejo de la eliminada:', espejo);
// Cliente externo (sin sesión) abre el enlace de la cotización ELIMINADA
{
  const ext = await abrir({ email: 'cliente.externo@prueba-audit.test', viewport: 'escritorio', carpeta: 'cotizaciones' });
  const rr = await ext.ir(`/verify/cotizacion.html?id=${doc1}&v=${espejo.code}`, { esperar: 2500 });
  log('PÚBLICO eliminada:', rr, 'situación:', await ext.texto('#cqSituacion'), '| meta:', await ext.texto('#ptMeta'));
  log('panel respuesta:', (await ext.texto('#cqRespuesta')).replace(/\n/g, ' | ').slice(0, 200));
  await ext.captura('16-cliente-sin-sesion-enlace-de-cotizacion-eliminada', { full: true });
  await ext.cerrar();
}
paso('toggle Mostrar eliminadas'); await P.click('#toggleEliminadas'); await s.quieto(600);
await s.captura('10-vendedor-escritorio-lista-eliminadas');
log('fila doc1 eliminada:', await P.evaluate((id) => document.querySelector(`tr[data-id="${id}"]`)?.innerText.replace(/\n/g, ' | '), doc1));
paso('clic Restaurar'); await P.click(`tr[data-id="${doc1}"] [data-action="restaurar"]`); await s.quieto(800); log('toasts', await s.toasts());
await P.click('#toggleEliminadas'); await s.quieto(400);
paso('clic Cerrar cotización (bandera)'); await P.click(`tr[data-id="${doc1}"] [data-action="cerrar"]`); await s.quieto(600);
await s.captura('11-vendedor-escritorio-cerrar-prompt'); log('cerrar prompt:', (await modalTexto()).replace(/\n/g, ' | '));
paso('Otro motivo'); await clicModal('[data-act="otros"]');
paso('escribir motivo'); await P.type('.modal-backdrop.open #cpMotivo', 'PRUEBA-AUDIT-cotizaciones: se rehace con 5 radios');
paso('Cerrar con este motivo'); await clicModal('[data-act="guardar-otros"]'); log('toasts', await s.toasts());
log('fila doc1 tras cerrar:', await P.evaluate((id) => document.querySelector(`tr[data-id="${id}"]`)?.innerText.replace(/\n/g, ' | '), doc1));
await s.captura('12-vendedor-escritorio-lista-descartada');
paso('buscar "wong"'); await P.type('#filtroTexto', 'wong'); await s.quieto(800); log('búsqueda wong:', await s.texto('#footerResumen'));
await P.evaluate(() => { const i = document.getElementById('filtroTexto'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
log('segments final:', await s.texto('#segments')); log('stats final:', (await s.texto('#statsRegion')).replace(/\n/g, ' | '));
log('errores', s.errores);
res.pasos_eliminar_restaurar_cerrar = pasos.slice();
await s.ir(`/cotizaciones/detalle-cotizacion.html?id=${doc1}`);
await s.captura('13-vendedor-escritorio-detalle-descartada', { full: true });
log('transiciones descartada:', await s.texto('#panelTransiciones'), '| historial:', (await s.texto('.cc-timeline')).replace(/\n/g, ' | '));
// Impresión (nueva pestaña en el app: se abre directo)
r = await s.ir(`/cotizaciones/imprimir-cotizacion.html?id=${doc2}`); log('IMPRIMIR', r, s.errores.slice(0, 3));
await s.captura('17-vendedor-escritorio-imprimir', { full: true });
await s.cerrar();

// ── 5. Karla: vendedora + supervisora (allowlist) ────────────────────────────
const k = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'cotizaciones' });
r = await k.ir('/cotizaciones/index.html'); log('KARLA lista', r);
log('karla tipoSeg:', await k.texto('#tipoSeg'), '| segments:', await k.texto('#segments'), '| toggleMias:', await k.page.evaluate(() => getComputedStyle(document.getElementById('wrapToggleMias')).display), '| footer:', await k.texto('#footerResumen'));
await k.captura('14-karla-supervisora-escritorio-lista');
log('fila ajena acciones:', await k.page.evaluate(() => { const tr = [...document.querySelectorAll('tr[data-id]')].find(t => !/Karla/.test(t.innerText)); return tr && tr.innerText.replace(/\n/g, ' | ').slice(0, 90) + ' → ' + [...tr.querySelectorAll('[data-action]')].map(b => b.dataset.action).join(','); }));
await k.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await k.ir('/cotizaciones/index.html'); await k.captura('15-karla-telefono-lista', { full: true }); log('geom teléfono', await k.geometria());
await k.cerrar();
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
log('RES', JSON.stringify(res));
