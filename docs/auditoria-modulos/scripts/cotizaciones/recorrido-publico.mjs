// Auditoría de módulos 2026-09-30 · Cotizaciones · lo que ve el CLIENTE en el
// enlace público (verify/cotizacion.html) SIN sesión, en escritorio y teléfono,
// y lo que ve un interno (Karla, en BCC) al abrir el mismo enlace.
// La sesión "externa" usa un correo que no existe en Auth: el login automático
// del harness falla y la página queda como la ve un cliente.
//   node recorrido-publico.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
import fs from 'node:fs';
const SCRATCH = 'C:/Users/ayohr/AppData/Local/Temp/claude/c--Projects-cecomunica-service-orders/60b5518e-dd51-4291-ac4d-c4f75cea0c5b/scratchpad';
const T = JSON.parse(fs.readFileSync(SCRATCH + '/cot-taller.json', 'utf8'));
const log = (...a) => console.log(...a);
const ENVIADA = { id: 'g8LlCgbzAU0Dm0OkvjJb', v: '6m7ly9qux5lb', n: 'COT-2026-0138' };   // comercial enviada con carta
const ACEPTADA = { id: 'OxNUdeHuXnnPPKEyQb4x', v: 'syoisonp0lpm', n: 'COT-2026-0137' };  // aceptada desde el enlace el 30-sep
const VIEJA = { id: 'HiaVmlNcn3rYSBdVfyM9', v: 'jbau8grczir4', n: 'COT-2026-0109' };     // enviada antes del espejo de estado

const ext = await abrir({ email: 'cliente.externo@prueba-audit.test', viewport: 'escritorio', carpeta: 'cotizaciones' });
const P = ext.page;
const situ = async () => ({ situacion: (await ext.texto('#cqSituacion')).replace(/\n/g, ' | '), meta: await ext.texto('#ptMeta'), respuesta: (await ext.texto('#cqRespuesta')).replace(/\n/g, ' | ').slice(0, 160), titulo: await ext.texto('.cq-doctype'), paginas: await P.evaluate(() => document.querySelectorAll('.cq-page, .carta-page, [class*="carta"]').length) });

let r = await ext.ir(`/verify/cotizacion.html?id=${ENVIADA.id}&v=${ENVIADA.v}`, { esperar: 2500 }); log('ENVIADA', ENVIADA.n, r, await situ());
log('geom:', await ext.geometria());
await ext.captura('50-cliente-sin-sesion-escritorio-enviada', { full: true });
// Aceptar: hasta el paso de confirmación (el callable necesita el emulador de Functions, que no está levantado)
await P.type('#cqRespNombre', 'PRUEBA-AUDIT-cotizaciones Cliente'); await P.click('#cqRespActs [data-resp="aceptada"]'); await ext.quieto(600);
log('confirmación:', (await ext.texto('#cqRespActs')).replace(/\n/g, ' | '));
await ext.captura('51-cliente-sin-sesion-escritorio-confirmar-aceptar', { el: '#cqRespuesta' });
r = await ext.ir(`/verify/cotizacion.html?id=${ACEPTADA.id}&v=${ACEPTADA.v}`, { esperar: 2500 }); log('ACEPTADA', ACEPTADA.n, r, await situ());
await ext.captura('52-cliente-sin-sesion-escritorio-aceptada');
r = await ext.ir(`/verify/cotizacion.html?id=${VIEJA.id}&v=${VIEJA.v}`, { esperar: 2500 }); log('VIEJA sin estado espejado', VIEJA.n, r, await situ());
// La de taller que acaba de enviar Solangel (código desde el espejo, legible sin sesión como lo hace la página)
const codT = await P.evaluate(async (id) => { const d = await firebase.firestore().collection('cotizacion_verificaciones').doc(id).get(); return d.exists ? d.data().code : null; }, T.doc);
r = await ext.ir(`/verify/cotizacion.html?id=${T.doc}&v=${codT}`, { esperar: 2500 }); log('TALLER', T.doc, r, await situ());
await ext.captura('53-cliente-sin-sesion-escritorio-taller-aceptada', { full: true });
log('errores externo:', ext.errores.filter(e => !/login|auth/.test(e)).slice(0, 5));
// Teléfono
await P.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
r = await ext.ir(`/verify/cotizacion.html?id=${ENVIADA.id}&v=${ENVIADA.v}`, { esperar: 2500 }); log('TELÉFONO', r, await situ());
log('geom teléfono:', await ext.geometria());
await ext.captura('54-cliente-sin-sesion-telefono-enviada', { full: true });
await ext.captura('54b-cliente-sin-sesion-telefono-arriba');
await ext.cerrar();

// Interna (Karla va en BCC de todas): su visita no cuenta como apertura
const k = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'cotizaciones' });
r = await k.ir(`/verify/cotizacion.html?id=${ENVIADA.id}&v=${ENVIADA.v}`, { esperar: 3000 }); log('KARLA interna', r, '| meta:', await k.texto('#ptMeta'));
await k.captura('55-karla-escritorio-enlace-vista-interna');
await k.cerrar();
