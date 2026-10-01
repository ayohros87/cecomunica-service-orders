// Auditoría de módulos 2026-09-30 · Cotizaciones · recorrido del ADMIN (aprobación)
// y dos pruebas extra con la vendedora (respaldo local + señales del home).
// Depende de los ids que dejó recorrido-vendedor.mjs en $SALIDA_VENDEDOR.
//   node recorrido-admin.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
import fs from 'node:fs';
const SCRATCH = 'C:/Users/ayohr/AppData/Local/Temp/claude/c--Projects-cecomunica-service-orders/60b5518e-dd51-4291-ac4d-c4f75cea0c5b/scratchpad';
const V = JSON.parse(fs.readFileSync(process.env.SALIDA_VENDEDOR || SCRATCH + '/cot-vendedor.json', 'utf8'));
const OUT = process.env.SALIDA || SCRATCH + '/cot-admin.json';
const doc2 = V.creadas.find(c => c.tipo === 'fuera-politica').doc;
const ELVIA_UID = 'kKE5L3ajaJcC5MQbg5s0NrfrOKP2';
const CLIENTE = '0kox44F4HSBvutZzeIfa';
const log = (...a) => console.log(...a);
const pasos = []; const paso = (d) => { pasos.push(d); log(`  [${pasos.length}] ${d}`); };
const res = {};
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const CONF = '.overlay[style*="flex"]';

const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'cotizaciones' });
const P = s.page;
const modalTexto = () => s.texto('.modal-backdrop.open');
const confirmTexto = () => s.texto(CONF);
const clicModal = async (sel) => { await P.click('.modal-backdrop.open ' + sel); await s.quieto(800, 15000); };
const clicConfirm = async (sel) => { await P.click(CONF + ' ' + sel); await s.quieto(800, 15000); };
const fila = (id) => P.evaluate((i) => document.querySelector(`tr[data-id="${i}"]`)?.innerText.replace(/\n/g, ' | '), id);

let r = await s.ir('/cotizaciones/index.html?aprobar=1'); log('POR APROBAR', r);
log('aviso:', await s.texto('#avisoPorAprobar'), '| footer:', await s.texto('#footerResumen'), '| segments:', (await s.texto('#segments')).replace(/\n/g, ' '));
await s.captura('40-admin-escritorio-lista-por-aprobar');
r = await s.ir('/cotizaciones/index.html'); log('TODAS', r);
log('tipoSeg:', (await s.texto('#tipoSeg')).replace(/\n/g, ' '), '| segments:', (await s.texto('#segments')).replace(/\n/g, ' '));
log('stats:', (await s.texto('#statsRegion')).replace(/\n/g, ' | '));
await s.captura('41-admin-escritorio-lista-todas');
log('fila doc2:', await fila(doc2));

// Rechazo del aprobador desde la fila
paso('clic Aprobar y enviar (fila)'); await P.click(`tr[data-id="${doc2}"] [data-action="aprobar"]`); await s.quieto(1000);
await s.captura('42-admin-escritorio-aprobacion-modal', { full: true });
log('modal:', (await modalTexto()).replace(/\n/g, ' | ').slice(0, 900));
paso('clic Rechazar'); await P.click('.modal-backdrop.open [data-sheet-action="rechazar"]'); await s.quieto(800);
log('prompt:', (await confirmTexto()).replace(/\n/g, ' | '));
await s.captura('43-admin-escritorio-rechazo-motivo');
paso('escribir motivo'); await P.type(CONF + ' [data-role="prompt-input"]', 'PRUEBA-AUDIT-cotizaciones: 25% no se justifica, máximo 20%');
paso('Rechazar'); await clicConfirm('[data-action="confirm"]'); await wait(800); await s.quieto(1200);
log('toasts:', await s.toasts(), '| errores:', s.errores.slice(0, 3));
log('fila doc2 tras rechazo:', await fila(doc2));
await s.captura('44-admin-escritorio-lista-rechazada');
res.pasos_rechazo = pasos.slice();

// Detalle de la rechazada por el aprobador
r = await s.ir(`/cotizaciones/detalle-cotizacion.html?id=${doc2}`); log('DETALLE rechazada', r);
await s.captura('45-admin-escritorio-detalle-rechazada-aprobador', { full: true });
log('header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 300));
log('historial:', (await s.texto('.cc-timeline')).replace(/\n/g, ' | '));
log('transiciones:', await s.texto('#panelTransiciones'));
log('raw rechazo:', await P.evaluate(async (id) => { const d = await firebase.firestore().collection('cotizaciones').doc(id).get(); const v = d.data(); return { estado: v.estado, rechazo_origen: v.rechazo_origen, rechazo_motivo: v.rechazo_motivo, rechazado_por_email: v.rechazado_por_email }; }, doc2));

// Reabrir a borrador y aprobar+enviar como admin
pasos.length = 0;
paso('Marcar Borrador'); await P.click('#panelTransiciones button[data-estado="borrador"]'); await s.quieto(600);
log('confirm:', (await confirmTexto()).replace(/\n/g, ' | '));
paso('confirmar'); await clicConfirm('[data-action="confirm"]'); await s.quieto(1000);
log('toasts:', await s.toasts(), '| header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 200));
paso('clic Aprobar y enviar'); await P.click('#btnAprobar'); await s.quieto(1000);
paso('clic Aprobar y enviar (panel)'); await P.click('.modal-backdrop.open [data-sheet-action="aprobar"]'); await wait(1500); await s.quieto(1200);
if (await P.$(CONF + ' [data-role="prompt-input"]')) { log('PIDE EMAIL:', await confirmTexto()); await P.type(CONF + ' [data-role="prompt-input"]', 'prueba-audit-cotizaciones@ejemplo.test'); await clicConfirm('[data-action="confirm"]'); await wait(1000); await s.quieto(1200); }
log('toasts:', await s.toasts(), '| errores:', s.errores.slice(0, 3));
await s.captura('46-admin-escritorio-detalle-aprobada-enviada', { full: true });
log('header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 300));
log('historial:', (await s.texto('.cc-timeline')).replace(/\n/g, ' | '));
res.pasos_reabrir_aprobar = pasos.slice();

// Cerrar como Aceptada
pasos.length = 0;
paso('clic Cerrar cotización'); await P.click('#btnCerrar'); await s.quieto(800);
paso('Aceptada por el cliente'); await clicModal('[data-act="convertida"]'); await wait(600); await s.quieto(1000);
log('toasts:', await s.toasts());
await s.captura('47-admin-escritorio-detalle-aceptada', { full: true });
log('header:', (await s.texto('.app-page-header')).replace(/\n/g, ' | ').slice(0, 300));
log('historial:', (await s.texto('.cc-timeline')).replace(/\n/g, ' | '), '| transiciones:', await s.texto('#panelTransiciones'));
res.pasos_cerrar_aceptada = pasos.slice();
res.espejo_doc2 = await P.evaluate(async (id) => { const d = await firebase.firestore().collection('cotizacion_verificaciones').doc(id).get(); const v = d.data() || {}; return { doc: id, code: v.code, estado: v.estado || null }; }, doc2);
log('errores admin:', s.errores);
await s.cerrar();

// ── Elvia: respaldo local + cliente nuevo (P0 #19) y señales del home ───────
const e = await abrir({ email: 'elvia.onodera@cecomunica.com', viewport: 'escritorio', carpeta: 'cotizaciones' });
await e.ir('/cotizaciones/nueva-cotizacion.html');
// Simula el respaldo que queda al salir a crear el cliente: 2 renglones escritos, sin cliente
await e.page.evaluate((uid) => {
  const draft = { _docId: null, id: '', estado: 'borrador', clienteId: '', ejecutivoId: uid, fecha: new Date().toISOString().slice(0, 10), validezDias: 15, moneda: 'USD', descuentoPct: 0, itbmsPct: 7,
    intro: 'PRUEBA-AUDIT-cotizaciones respaldo', items: [{ id: 'iA', modelo: 'AP32X', nombre: 'HYTERA AP32X', spec: '', cant: 3, precio: 100, desc: 0, modalidad: 'venta' }, { id: 'iB', modelo: '', nombre: 'Instalación', spec: '', cant: 1, precio: 50, desc: 0, modalidad: 'venta' }],
    plazoMeses: 0, condiciones: [], dirigido_a: '', dirigido_email: '', adjuntos: [], incluye_carta: true };
  localStorage.setItem('cot_respaldo_' + uid + '_nueva', JSON.stringify({ ts: Date.now() - 120000, draft }));
}, ELVIA_UID);
r = await e.ir(`/cotizaciones/nueva-cotizacion.html?cliente_id=${CLIENTE}`);
await e.page.waitForSelector(CONF, { timeout: 8000 }).catch(() => null);
log('RESPALDO confirm:', (await e.texto(CONF)).replace(/\n/g, ' | '));
await e.captura('48-vendedor-escritorio-recuperar-respaldo');
await e.page.click(CONF + ' [data-action="confirm"]'); await e.quieto(1000);
log('cliente en el combo:', await e.page.$eval('#comboCliente input[data-combo-busqueda]', i => i.value), '| renglones:', await e.page.evaluate(() => document.querySelectorAll('.cc-item-row').length), '| intro:', await e.page.$eval('#inpIntro', t => t.value.slice(0, 40)));
await e.page.evaluate((uid) => localStorage.removeItem('cot_respaldo_' + uid + '_nueva'), ELVIA_UID);
r = await e.ir('/index.html'); log('HOME vendedora', r);
await e.captura('49-vendedor-escritorio-home-senales', { full: true });
log('señales con "cotiz":', await e.page.evaluate(() => [...document.querySelectorAll('a, .signal, .senal, .card, [class*="senal"], [class*="signal"]')].map(x => x.innerText || '').filter(t => /cotiz/i.test(t)).map(t => t.replace(/\n/g, ' · ').slice(0, 120)).slice(0, 8)));
log('errores elvia:', e.errores.slice(0, 5));
await e.cerrar();
fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
log('RES', JSON.stringify(res));
