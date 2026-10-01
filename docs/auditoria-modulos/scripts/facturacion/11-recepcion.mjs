// Recorrido 11: bandeja "Facturación pendiente" como RECEPCIÓN (Brenda), escritorio + tablet + teléfono.
// Trabaja los avisos PRUEBA-AUDIT-facturacion (02-seed-prueba.js) y cuenta interacciones.
import { abrir, USUARIOS, j } from './_lib.mjs';
const log = (...a) => console.log(...a);
const PREF = 'PRUEBA-AUDIT-facturacion';

// ── Escritorio: el flujo completo ──────────────────────────────────────────
let s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio' });
let info = await s.ir('/index.html'); log('HOME', j(info));
log('TARJETAS', j(await s.textos('.mod-card, [data-modulo], .home-card, a.card')));
await s.captura('70-recepcion-escritorio-home');
info = await s.ir('/facturacion/bandeja.html'); log('BANDEJA', j(info));
log('TABS FINANZAS (debe ser vacío)', j(await s.textos('#wsTabs-mount a, #wsTabs-mount button')));
log('TOPBAR', j(await s.textos('#topbar-mount a, #topbar-mount button')));
log('CHIPS', j(await s.textos('#fbChips .fb-chip')));
await s.captura('71-recepcion-escritorio-bandeja');

// Flujo A: cotización de taller (cobro único) → solo QBO con número
const idCot = `cotizacion_servicio__${PREF}-2`;
let pasos = 0, t0 = Date.now();
await s.clic(`[data-row="${idCot}"] button[data-paso="qbo"]`); pasos++;           // 1 clic pastilla
log('POP COT', (await s.texto(`.fb-pop[data-pop="${idCot}"]`)).replace(/\n/g, ' | ').slice(0, 300));
await s.captura('72-recepcion-escritorio-popover-cotizacion');
await s.page.type(`.fb-pop[data-pop="${idCot}"] [data-f="factura"]`, '11010'); pasos++;  // 2 teclear número
const msA = await s.medir(() => s.page.click(`.fb-pop[data-pop="${idCot}"] [data-act="pop-ok"]`)); pasos++; // 3 Marcar facturada
log('FLUJO A cotización: pasos', pasos, 'ms último', msA, 'total ms', Date.now() - t0, 'toasts', j(await s.toasts()));

// Flujo B: contrato activo → QBO (fecha prellenada + número) y Plataforma PoC
const idCon = `contrato_activo__${PREF}-1`;
pasos = 0; t0 = Date.now();
await s.clic(`[data-row="${idCon}"] button[data-paso="qbo"]`); pasos++;
log('POP CONTRATO', (await s.texto(`.fb-pop[data-pop="${idCon}"]`)).replace(/\n/g, ' | ').slice(0, 300));
await s.captura('73-recepcion-escritorio-popover-contrato');
await s.page.type(`.fb-pop[data-pop="${idCon}"] [data-f="factura"]`, '11011'); pasos++;
const msB1 = await s.medir(() => s.page.click(`.fb-pop[data-pop="${idCon}"] [data-act="pop-ok"]`)); pasos++;
await s.clic(`[data-row="${idCon}"] button[data-paso="poc"]`); pasos++;
await s.captura('74-recepcion-escritorio-popover-poc');
const msB2 = await s.medir(() => s.page.click(`.fb-pop[data-pop="${idCon}"] [data-act="pop-ok"]`)); pasos++;
log('FLUJO B contrato: pasos', pasos, 'ms QBO', msB1, 'ms PoC', msB2, 'total ms', Date.now() - t0, 'toasts', j((await s.toasts()).slice(-2)));
log('¿sigue en la bandeja?', !!(await s.page.$(`[data-row="${idCon}"]`)));
await s.captura('75-recepcion-escritorio-bandeja-tras-marcar');

// Flujo C: "No aplica…" en la baja de prueba
const idBaja = `baja_aprobada__${PREF}-5`;
pasos = 0;
await s.clic(`[data-row="${idBaja}"] .fb-main`); pasos++;                       // abrir la fila
await s.clic(`[data-act="descartar"][data-id="${idBaja}"]`); pasos++;           // No aplica…
await s.captura('76-recepcion-escritorio-no-aplica-form');
await s.page.select(`.fb-desc[data-desc="${idBaja}"] [data-f="motivo"]`, 'ya_en_qbo'); pasos++;
const msC = await s.medir(() => s.page.click(`[data-act="desc-ok"][data-id="${idBaja}"]`)); pasos++;
log('FLUJO C no aplica: pasos', pasos, 'ms', msC, 'toasts', j((await s.toasts()).slice(-1)));

// Ver hechos: ¿aparecen los cerrados? ¿cuánto tarda listCerrados?
const msH = await s.medir(() => s.page.click('#fbVerHechos'));
log('Ver hechos ms', msH, 'sep', await s.texto('.fb-sep').catch(() => ''));
log('CONSULTAS', (await s.consultas()).join(' ; '));
await s.captura('77-recepcion-escritorio-ver-hechos');
// Deep-link a un aviso hecho
info = await s.ir(`/facturacion/bandeja.html?aviso=${idCon}`); log('DEEPLINK', j(info), 'abierto?', !!(await s.page.$(`[data-row="${idCon}"].is-open`)));
log('ERRORES', j(s.errores.slice(0, 6)));

// Qué pasa si recepción entra a lo demás del espacio
for (const p of ['/facturacion/comisiones.html', '/facturacion/activacion.html', '/facturacion/clientes-qbo.html', '/facturacion/emision.html', '/inventario/cargos.html', '/admin/financiero.html']) {
  info = await s.ir(p); log('RECEPCION EN', p, '→', (await s.texto('body')).slice(0, 60).replace(/\n/g, ' '), info.url);
}
await s.captura('78-recepcion-escritorio-acceso-restringido');
await s.cerrar();

// ── Tablet y teléfono: solo mirar ────────────────────────────────────────────
for (const vp of ['tablet', 'telefono']) {
  s = await abrir({ email: USUARIOS.recepcion, viewport: vp });
  info = await s.ir('/facturacion/bandeja.html'); log(vp.toUpperCase(), j(info));
  log('GEO', j(await s.geometria()));
  await s.captura(`79-recepcion-${vp}-bandeja`);
  const idOtro = `renovacion_activa__${PREF}-3`;
  // abrir un popover para ver si cabe
  const primera = await s.page.$('#fbRows .fb-row button[data-paso="qbo"]:not(.done)');
  if (primera) { await primera.click(); await s.espera(500); await s.captura(`80-recepcion-${vp}-popover`); log('POP visible?', await s.page.evaluate(() => { const p = document.querySelector('.fb-pop.show'); if (!p) return null; const r = p.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), dentro: r.x >= 0 && r.right <= innerWidth }; })); }
  log('ERRORES', j(s.errores.slice(0, 4)));
  await s.cerrar();
}
