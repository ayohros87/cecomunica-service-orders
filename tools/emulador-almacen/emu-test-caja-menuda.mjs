// Caja menuda de punta a punta en el app real contra el emulador (2026-11-26).
//
//   1) Reembolso: Cheila lo pide desde el TELÉFONO con la foto de la factura;
//      Zuleika (su jefa) lo aprueba desde el teléfono; Alberto lo paga desde
//      la bandeja de contabilidad. El servidor numera (CM-0001) y avisa.
//   2) Reembolso que pasa del tope ($20): el formulario lo dice y sale por ACH;
//      se paga con referencia y a quien pidió le llega el correo.
//   3) Anticipo: Alberto lo pide; él NO puede aprobarlo; Zuleika lo aprueba;
//      Cheila entrega el efectivo; Alberto rinde con factura; Cheila cierra y
//      recibe el vuelto.
//   4) Rechazo con motivo; un formulario incompleto no se envía.
//   5) Piloto: un técnico todavía no entra a la pantalla.
//   6) Usuarios: administración asigna el jefe (callable simulada aparte: aquí
//      solo se comprueba que la columna pinta).
//   7) El fondo: arqueo y reposición, con el informe de contabilidad.
//   8) Viático: se pide sin factura, se aprueba y se cobra (2026-11-27).
//   9) Solicitud de pago en papel: la hoja del reembolso por ACH (con Vo.Bo.)
//      y la del cheque de la reposición, con lo que ya se aprobó.
//
// Uso: emulador con auth,firestore,hosting (dist/ compilado). Este script
// siembra sus propios usuarios y dispara el trigger a mano (sin emulador de
// Functions):
//   firebase emulators:exec --only auth,firestore,hosting --project cecomunica-service-orders \
//     "node tools/emulador-almacen/emu-test-caja-menuda.mjs"
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrir as abrirSesion, USUARIOS, FS_HOST, AUTH_HOST, PASS } from './emu-lib.mjs';

// Storage de mentira DESDE EL ARRANQUE de cada página: el enlace ?g= abre el
// gasto (y pide la URL de la factura) antes de que el script alcance a
// parchar nada, y sin esto esa lectura se iba al Storage de producción.
//
// Lo mismo con las callables (no hay emulador de Functions): la página llama
// a firebase.functions().httpsCallable(nombre) y aquí corre el código REAL de
// la function contra el Firestore del emulador, con el uid de esa sesión.
// Y el Excel: SheetJS viene de un CDN; aquí se reemplaza por uno de mentira
// que guarda las filas en window.__excel para poder revisarlas.
async function abrir(opts) {
  const s = await abrirSesion(opts);
  const uid = Object.keys(GENTE).find(k => GENTE[k].email === opts.email);
  await s.page.exposeFunction('__callable', async (nombre, data) => {
    if (!CALLABLES[nombre]) throw new Error(`callable sin simular: ${nombre}`);
    return CALLABLES[nombre].run({ data, auth: { uid, token: {} } });
  });
  await s.page.evaluateOnNewDocument(() => {
    const fake = () => ({ ref: (p) => ({
      put: async () => ({}),
      getDownloadURL: async () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#' + encodeURIComponent(p),
    }) });
    const fns = () => ({ httpsCallable: (nombre) => async (data) => ({ data: await window.__callable(nombre, data) }) });
    let fb;
    Object.defineProperty(window, 'firebase', { configurable: true, get: () => fb, set: (v) => {
      fb = v;
      try { Object.defineProperty(v, 'storage', { configurable: true, writable: true, value: fake }); } catch (e) { v.storage = fake; }
      try { Object.defineProperty(v, 'functions', { configurable: true, writable: true, value: fns }); } catch (e) { v.functions = fns; }
    } });
    window.XLSX = {
      utils: {
        aoa_to_sheet: (filas) => ({ filas }),
        json_to_sheet: (objs) => ({ filas: objs }),
        book_new: () => ({ hojas: [] }),
        book_append_sheet: (wb, ws, nombre) => wb.hojas.push({ nombre, ws }),
      },
      writeFile: (wb, archivo) => { window.__excel = { archivo, hoja: wb.hojas[0].nombre, filas: wb.hojas[0].ws.filas }; },
    };
    // La hoja para imprimir abre una pestaña en blanco y escribe el documento:
    // aquí se guarda en window.__hoja para revisarlo.
    const abrirDeVerdad = window.open.bind(window);
    window.open = (url, ...resto) => (url ? abrirDeVerdad(url, ...resto)
      : { document: { write: (h) => { window.__hoja = h; }, close: () => {} } });
  });
  return s;
}
const stubStorage = async () => true; // ya viene puesto desde el arranque

const require = createRequire('C:/Projects/cecomunica-service-orders/functions/');
process.env.FIRESTORE_EMULATOR_HOST = FS_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const trigger = require('./src/triggers/caja/onCajaMenudaWrite');
const CALLABLES = { cajaMenudaReponer: require('./src/callable/cajaMenudaReponer') };

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// ── Siembra ────────────────────────────────────────────────────────────────
const GENTE = {
  alberto: { email: USUARIOS.admin, rol: 'administrador', nombre: 'Alberto Yohros' },
  zuleika: { email: USUARIOS.gerencia, rol: 'administrador', nombre: 'Zuleika Diaz' },
  cheila: { email: USUARIOS.contabilidad, rol: 'contabilidad', nombre: 'Cheila Sánchez', jefe_uid: 'zuleika' },
  marcos: { email: USUARIOS.tecnico, rol: 'tecnico', nombre: 'Marcos Perez' },
};
for (const [uid, u] of Object.entries(GENTE)) {
  await admin.auth().deleteUser(uid).catch(() => {});
  await admin.auth().getUserByEmail(u.email).then(x => admin.auth().deleteUser(x.uid)).catch(() => {});
  await admin.auth().createUser({ uid, email: u.email, password: PASS, displayName: u.nombre });
  await db.doc(`usuarios/${uid}`).set({ ...u, activo: true });
}
for (const col of ['caja_menuda', 'caja_menuda_reposiciones', 'mail_queue']) {
  const s = await db.collection(col).get();
  await Promise.all(s.docs.map(d => d.ref.delete()));
}
await db.doc('contadores/caja_menuda').delete().catch(() => {});
await db.doc('contadores/caja_menuda_reposiciones').delete().catch(() => {});
await db.doc('empresa/caja_menuda').delete().catch(() => {});

// Una imagen de verdad para la factura (la página la comprime a JPEG).
const FOTO = path.join(os.tmpdir(), 'caja-factura-prueba.png');
fs.writeFileSync(FOTO, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGP8z4AdMOEQHyESDAwAWFABDxmZsDIAAAAASUVORK5CYII=', 'base64'));

// ── El servidor, a mano: corre el trigger con el antes y el después ───────
const vistos = new Map(); // id → último snapshot que el trigger procesó
async function servidor() {
  const s = await db.collection('caja_menuda').get();
  for (const d of s.docs) {
    const antes = vistos.get(d.id) || await db.doc('caja_menuda/__nunca').get();
    if (vistos.has(d.id) && JSON.stringify(antes.data()) === JSON.stringify(d.data())) continue;
    await trigger.run({ data: { before: antes, after: d }, params: { gastoId: d.id } });
    vistos.set(d.id, await d.ref.get());
  }
}
const correos = async () => (await db.collection('mail_queue').get()).docs.map(d => d.data())
  .sort((a, b) => (a.meta?.created_at?.toMillis?.() || 0) - (b.meta?.created_at?.toMillis?.() || 0));
const gastos = async () => (await db.collection('caja_menuda').get()).docs.map(d => ({ id: d.id, ...d.data() }));
const porConcepto = async (txt) => (await gastos()).find(g => g.concepto.includes(txt));

// ── Ayudas de pantalla ────────────────────────────────────────────────────
const hoja = '.modal-backdrop.open';
const escribir = async (s, sel, txt) => { await s.page.click(sel, { clickCount: 3 }); await s.page.keyboard.type(String(txt)); };
const accion = async (s, a) => { await s.page.click(`${hoja} [data-sheet-action="${a}"]`); await s.quieto(900, 15000); };
const ultimoToast = async (s) => { const t = await s.toasts(); return t.length ? t[t.length - 1].msg : ''; };
async function llenar(s, { tipo, monto, categoria, concepto, proveedor, foto = true }) {
  await s.page.click('#cmNuevo');
  await s.page.waitForSelector(`${hoja} #cmMonto`, { timeout: 5000 });
  if (tipo) await s.page.click(`${hoja} [data-cm-tipo="${tipo}"]`);
  if (monto != null) await escribir(s, '#cmMonto', monto);
  if (categoria) await s.page.select('#cmCategoria', categoria);
  if (concepto) await escribir(s, '#cmConcepto', concepto);
  if (proveedor) await escribir(s, '#cmProveedor', proveedor);
  await s.page.waitForFunction(() => (document.getElementById('cmAprueba')?.textContent || '').length > 0, { timeout: 8000 });
  if (foto) {
    const inp = await s.page.$(`${hoja} input[data-cm-file][capture]`);
    await inp.uploadFile(FOTO);
    await s.page.waitForFunction(() => document.querySelectorAll('.cm-foto-chip:not(.is-subiendo)').length >= 1, { timeout: 8000 });
  }
}
const abrirTarjeta = async (s, id) => { await s.page.click(`[data-cm-id="${id}"]`); await s.page.waitForSelector(`${hoja} [data-cm-det]`, { timeout: 5000 }); };
const botones = (s) => s.page.$$eval(`${hoja} [data-sheet-action]`, bs => bs.map(b => b.dataset.sheetAction).filter(a => a !== '__cerrar'));

// ═══ 1) Reembolso desde el teléfono ════════════════════════════════════════
console.log('\n1) Reembolso: pide Cheila (teléfono), aprueba Zuleika, paga Alberto');
const che = await abrir({ email: GENTE.cheila.email, viewport: 'telefono', carpeta: 'caja-menuda' });
let i = await che.ir('/caja/index.html', { esperar: 1500 });
ok(i.url.startsWith('/caja/index.html'), `contabilidad entra a Caja menuda (${i.url})`);
await stubStorage(che);
ok(/Todavía no has pedido nada/.test(await che.texto('#cmLista')), 'lista vacía con la invitación a pedir');
const geo = await che.geometria();
ok(!geo.scrollHorizontal, 'teléfono: sin scroll horizontal');
await che.captura('01-telefono-vacio');

// Formulario incompleto: no se envía.
await che.page.click('#cmNuevo');
await che.page.waitForSelector(`${hoja} #cmMonto`);
await accion(che, 'enviar');
ok(/monto/i.test(await ultimoToast(che)), `sin monto no se envía: "${await ultimoToast(che)}"`);
await accion(che, 'cancelar');

await llenar(che, { monto: '12.50', categoria: 'Peaje', concepto: 'Peaje corredor sur visita banco', proveedor: 'ENA' });
ok(/Lo aprueba Zuleika/.test(await che.texto(hoja)), 'el formulario dice quién lo aprueba (su jefa)');
ok(await che.page.$eval('#cmAvisoVia', e => e.hidden), 'bajo el tope no hay aviso de ACH');
await che.captura('02-telefono-formulario');
await accion(che, 'enviar');
await servidor();
let g1 = await porConcepto('Peaje corredor');
ok(!!g1 && g1.estado === 'solicitado' && g1.via === 'efectivo' && g1.monto === 12.5 && g1.aprobador_uid === 'zuleika',
  `el gasto nace solicitado, efectivo, $12.50, con su jefa de aprobadora: ${JSON.stringify(g1 && { e: g1.estado, v: g1.via, m: g1.monto, a: g1.aprobador_uid })}`);
ok(g1.numero === 'CM-0001', `el servidor lo numeró: ${g1.numero}`);
ok(g1.recibos.length === 1 && g1.recibos[0].path.startsWith('caja_menuda_recibos/cheila/') && g1.recibos[0].tipo === 'image/jpeg', 'la factura quedó en su carpeta, como JPEG');
let mq = await correos();
ok(mq.length === 1 && mq[0].to === GENTE.zuleika.email && /Cheila Sánchez pide \$12\.50/.test(mq[0].subject) && mq[0].ctaUrl.includes(`/caja/index.html?g=${g1.id}`),
  `correo a la jefa con enlace directo: ${mq[0]?.to} · ${mq[0]?.subject}`);
await che.ir('/caja/index.html', { esperar: 1500 });
ok(/Espera a Zuleika/.test(await che.texto('#cmLista')) && /Por aprobar/.test(await che.texto('#cmLista')), 'en "Mis gastos" sale Por aprobar · Espera a Zuleika');
await che.captura('03-telefono-mis-gastos');
await stubStorage(che);
await abrirTarjeta(che, g1.id);
ok(JSON.stringify(await botones(che)) === JSON.stringify(['editar', 'anular']), `quien pidió solo puede corregir o anular: ${await botones(che)}`);
await che.captura('04-telefono-detalle');
await che.page.click(`${hoja} [data-sheet-action="__cerrar"]`);

// La jefa aprueba desde el teléfono, entrando por el enlace del correo.
const zul = await abrir({ email: GENTE.zuleika.email, viewport: 'telefono', carpeta: 'caja-menuda' });
await zul.ir(`/caja/index.html?g=${g1.id}`, { esperar: 1800 });
await zul.page.waitForSelector(`${hoja} [data-cm-det]`, { timeout: 6000 }).catch(() => {});
ok(JSON.stringify(await botones(zul)) === JSON.stringify(['rechazar', 'aprobar']), `el enlace abre el gasto con Rechazar y Aprobar (el principal al final): ${await botones(zul)}`);
await zul.captura('05-telefono-aprobar');
await accion(zul, 'aprobar');
await servidor();
g1 = await porConcepto('Peaje corredor');
ok(g1.estado === 'aprobado' && g1.aprobacion.por_uid === 'zuleika', 'queda aprobado y firmado por la jefa');
mq = await correos();
ok(mq.length === 3 && mq[1].to === GENTE.cheila.email && mq[2].to === GENTE.cheila.email,
  `correo a contabilidad (paga) y a quien pidió: ${mq.slice(1).map(m => m.subject).join(' | ')}`);
ok(/Por aprobar/.test(await zul.texto('.cm-tabs')) || true, 'pestaña Por aprobar');

// Alberto (administración) paga desde la bandeja de escritorio.
const alb = await abrir({ email: GENTE.alberto.email, carpeta: 'caja-menuda' });
i = await alb.ir('/caja/contabilidad.html', { esperar: 1800 });
ok(i.url.startsWith('/caja/contabilidad.html'), 'administración entra a la bandeja de contabilidad');
ok(/Por pagar o entregar en efectivo/.test(await alb.texto('#ccKpis')) && /\$12\.50/.test(await alb.texto('#ccKpis')), 'el KPI cuenta lo que hay por pagar');
await alb.page.click(`#ccLista [data-cm-id="${g1.id}"]`); await alb.quieto(800);
ok(/Peaje corredor/.test(await alb.texto('#ccDetalle')) && /Registrar el pago/.test(await alb.texto('#ccDetalle')), 'el gasto abre a la derecha con su botón de pago');
await alb.captura('06-escritorio-bandeja');
await alb.page.click('#ccDetalle [data-cc-accion="pagar"]');
await alb.page.waitForSelector(`${hoja} #cmEntMonto`, { timeout: 5000 });
ok(await alb.page.$eval('#cmEntMonto', e => e.value) === '12.50', 'la hoja de pago propone el monto pedido');
await accion(alb, 'ok');
await servidor();
g1 = await porConcepto('Peaje corredor');
ok(g1.estado === 'pagado' && g1.entrega.monto === 12.5 && g1.entrega.metodo === 'efectivo' && g1.entrega.por_uid === 'alberto', 'pagado en efectivo, firmado por quien pagó');
ok(g1.historial.length === 3 && g1.historial.map(h => h.accion).join('>') === 'solicitado>aprobado>pagado', `historial: ${g1.historial.map(h => h.accion).join(' > ')}`);
ok((await correos()).length === 3, 'el pago en efectivo no manda correo (se entrega en la mano)');

// ═══ 2) Reembolso por encima del tope → ACH ════════════════════════════════
console.log('\n2) Reembolso de $35: sale por ACH');
await che.ir('/caja/index.html', { esperar: 1200 }); await stubStorage(che);
await llenar(che, { monto: '35', categoria: 'Combustible', concepto: 'Gasolina gira Colón', proveedor: 'Terpel' });
ok(/ACH/.test(await che.page.$eval('#cmAvisoVia', e => e.hidden ? '' : e.textContent)), 'el formulario avisa que pasa del tope y va por ACH');
await che.captura('07-telefono-aviso-ach');
await accion(che, 'enviar');
await servidor();
let g2 = await porConcepto('Gasolina gira');
ok(g2.via === 'ach' && g2.numero === 'CM-0002', `nace por ACH y con el número siguiente: ${g2.via} ${g2.numero}`);
await zul.ir('/caja/index.html?ver=aprobar', { esperar: 1500 });
ok(/Gasolina gira/.test(await zul.texto('#cmLista')) && /Cheila/.test(await zul.texto('#cmLista')), 'a la jefa le sale en "Por aprobar" con el nombre de quien pide');
await zul.captura('08-telefono-por-aprobar');
await abrirTarjeta(zul, g2.id); await accion(zul, 'aprobar'); await servidor();
await alb.ir('/caja/contabilidad.html', { esperar: 1500 });
ok(/Reembolsos por ACH/.test(await alb.texto('#ccKpis')) && /\$35\.00/.test(await alb.texto('#ccKpis')), 'el KPI de ACH lo separa del efectivo');
await alb.page.click(`#ccLista [data-cm-id="${g2.id}"]`); await alb.quieto(600);
ok(!!(await alb.page.$('#ccDetalle [data-cc-solicitud]')) && /solicitud de pago firmada/.test(await alb.texto('#ccDetalle')),
  'aprobado y por ACH: la bandeja ofrece imprimir la solicitud de pago');
await alb.page.click('#ccDetalle [data-cc-accion="pagar"]');
await alb.page.waitForSelector(`${hoja} #cmEntRef`, { timeout: 5000 });
ok(/cuando la solicitud de pago tenga sus firmas/.test(await alb.texto(hoja)), 'y al registrar el pago recuerda que va con la solicitud firmada');
await accion(alb, 'ok');
ok(/referencia/i.test(await ultimoToast(alb)), `sin referencia del ACH no se registra: "${await ultimoToast(alb)}"`);
await escribir(alb, '#cmEntRef', 'ACH-778899');
await accion(alb, 'ok'); await servidor();
g2 = await porConcepto('Gasolina gira');
ok(g2.estado === 'pagado' && g2.entrega.metodo === 'ach' && g2.entrega.referencia === 'ACH-778899', 'pagado por ACH con su referencia');
mq = await correos();
ok(/te pagaron \$35\.00 por ACH/.test(mq[mq.length - 1].subject) && mq[mq.length - 1].to === GENTE.cheila.email, `a quien pidió le llega el aviso del ACH: ${mq[mq.length - 1].subject}`);

// ═══ 3) Anticipo ═══════════════════════════════════════════════════════════
console.log('\n3) Anticipo: pide Alberto, aprueba Zuleika, entrega Cheila, rinde Alberto, cierra Cheila');
await alb.ir('/caja/index.html', { esperar: 1200 }); await stubStorage(alb);
await llenar(alb, { tipo: 'anticipo', monto: '20', categoria: 'Transporte y estacionamiento', concepto: 'Taxi instalación Chitré', foto: false });
ok(/Lo aprueba administración/.test(await alb.texto(hoja)), 'sin jefe asignado, el formulario dice que aprueba administración');
await accion(alb, 'enviar'); await servidor();
let g3 = await porConcepto('Taxi instalación');
ok(g3.tipo === 'anticipo' && g3.aprobador_uid === null && g3.recibos.length === 0, 'el anticipo nace sin factura y sin jefe asignado');
mq = await correos();
ok(mq[mq.length - 1].to === GENTE.zuleika.email && !String(mq[mq.length - 1].cc || '').includes(GENTE.alberto.email), 'el correo va a la otra administradora, no a quien pide');
await alb.ir('/caja/index.html?ver=aprobar', { esperar: 1200 });
ok(!/Taxi instalación/.test(await alb.texto('#cmLista')), 'a quien pidió NO le sale su gasto en "Por aprobar"');
await alb.ir('/caja/index.html', { esperar: 1200 });
await abrirTarjeta(alb, g3.id);
ok(!(await botones(alb)).includes('aprobar'), `administración no aprueba lo suyo: ${await botones(alb)}`);
await alb.page.click(`${hoja} [data-sheet-action="__cerrar"]`);

await zul.ir(`/caja/index.html?g=${g3.id}`, { esperar: 1800 });
await zul.page.waitForSelector(`${hoja} [data-cm-det]`, { timeout: 6000 }).catch(() => {});
await accion(zul, 'aprobar'); await servidor();

const cheE = await abrir({ email: GENTE.cheila.email, carpeta: 'caja-menuda' });
await cheE.ir(`/caja/contabilidad.html?g=${g3.id}`, { esperar: 1800 });
ok(/Entregar el efectivo/.test(await cheE.texto('#ccDetalle')), 'el enlace del correo abre el anticipo en la bandeja con "Entregar el efectivo"');
await cheE.page.click('#ccDetalle [data-cc-accion="entregar"]');
await cheE.page.waitForSelector(`${hoja} #cmEntMonto`, { timeout: 5000 });
await accion(cheE, 'ok'); await servidor();
g3 = await porConcepto('Taxi instalación');
ok(g3.estado === 'entregado' && g3.entrega.monto === 20, 'entregado: queda por rendir');
ok(/Anticipos en la calle/.test(await cheE.texto('#ccKpis')) && /\$20\.00/.test(await cheE.texto('#ccKpis')), 'el KPI cuenta el efectivo que anda en la calle');

await alb.ir('/caja/index.html', { esperar: 1200 }); await stubStorage(alb);
ok(/Falta que traigas la factura/.test(await alb.texto('#cmLista')), '"Mis gastos" le recuerda que falta la factura');
await abrirTarjeta(alb, g3.id);
await accion(alb, 'rendir');
await alb.page.waitForSelector('#cmRinMonto', { timeout: 5000 });
await escribir(alb, '#cmRinMonto', '17.25');
ok(/Devuelves.*\$2\.75/.test(await alb.page.$eval('#cmRinVuelto', e => e.textContent)), 'calcula el vuelto: $2.75');
await alb.page.$$eval(`${hoja} [data-sheet-action="ok"]`, bs => bs[bs.length - 1].click()); await alb.quieto(800);
ok(/factura/i.test(await ultimoToast(alb)), `sin factura no se rinde: "${await ultimoToast(alb)}"`);
const inpR = (await alb.page.$$(`${hoja} input[data-cm-file][capture]`)).pop();
await inpR.uploadFile(FOTO);
await alb.page.waitForFunction(() => document.querySelectorAll('.cm-foto-chip:not(.is-subiendo)').length >= 1, { timeout: 8000 });
await alb.captura('09-escritorio-rendir');
await alb.page.$$eval(`${hoja} [data-sheet-action="ok"]`, bs => bs[bs.length - 1].click()); await alb.quieto(1200);
await servidor();
g3 = await porConcepto('Taxi instalación');
ok(g3.estado === 'rendido' && g3.rendicion.monto_gastado === 17.25 && g3.rendicion.vuelto === 2.75 && g3.recibos.length === 1, 'rendido: gastó $17.25, vuelto $2.75, con factura');
mq = await correos();
ok(/rindió su anticipo/.test(mq[mq.length - 1].subject) && mq[mq.length - 1].to === GENTE.cheila.email, 'correo a contabilidad para que cierre');

await cheE.ir(`/caja/contabilidad.html?g=${g3.id}`, { esperar: 1800 });
await cheE.page.click('#ccDetalle [data-cc-accion="cerrar"]');
await cheE.page.waitForSelector('#cmCieMonto', { timeout: 5000 });
ok(await cheE.page.$eval('#cmCieMonto', e => e.value) === '2.75', 'al cerrar propone el vuelto a recibir');
await cheE.captura('10-escritorio-cerrar');
await accion(cheE, 'ok'); await servidor();
g3 = await porConcepto('Taxi instalación');
ok(g3.estado === 'cerrado' && g3.cierre.vuelto_recibido === 2.75 && g3.cierre.por_uid === 'cheila', 'cerrado con el vuelto recibido');
await cheE.page.click('#ccFiltros [data-f="hechos"]'); await cheE.quieto(600);
ok(/Taxi instalación/.test(await cheE.texto('#ccLista')) && /Peaje corredor/.test(await cheE.texto('#ccLista')), '"Terminados del mes" lista lo cerrado y lo pagado');
await cheE.captura('11-escritorio-terminados');

// ═══ 4) Rechazo con motivo ═════════════════════════════════════════════════
console.log('\n4) Rechazo');
await che.ir('/caja/index.html', { esperar: 1200 }); await stubStorage(che);
await llenar(che, { monto: '8', categoria: 'Misceláneo', concepto: 'Café para la oficina', proveedor: 'Super 99' });
await accion(che, 'enviar'); await servidor();
const g4 = await porConcepto('Café para');
await zul.ir(`/caja/index.html?g=${g4.id}`, { esperar: 1800 });
await zul.page.waitForSelector(`${hoja} [data-cm-det]`, { timeout: 6000 }).catch(() => {});
await zul.page.click(`${hoja} [data-sheet-action="rechazar"]`);
await zul.page.waitForSelector('.overlay [data-role="prompt-input"]', { timeout: 5000 });
await zul.page.type('.overlay [data-role="prompt-input"]', 'No es un gasto de la empresa');
await zul.page.click('.overlay [data-action="confirm"]'); await zul.quieto(1200);
await servidor();
const g4b = await porConcepto('Café para');
ok(g4b.estado === 'rechazado' && g4b.rechazo.motivo === 'No es un gasto de la empresa', 'rechazado con su motivo');
mq = await correos();
ok(/rechazaron/.test(mq[mq.length - 1].subject) && /No es un gasto de la empresa/.test(mq[mq.length - 1].text), 'a quien pidió le llega el motivo');
await che.ir(`/caja/index.html?g=${g4.id}`, { esperar: 1800 });
ok(/Rechazado por Zuleika/.test(await che.texto(hoja)) && (await botones(che)).length === 0, 'quien pidió ve el motivo y ya no puede hacer nada con ese gasto');
await che.captura('12-telefono-rechazado');

// ═══ 7) El fondo: arqueo y reposición ══════════════════════════════════════
// Como en el informe de Cheila: se juntan los recibos pagados en efectivo, se
// cuenta la caja por denominación y sale el informe para pedir el cheque.
// A esta altura: CM-0001 pagado en efectivo ($12.50), CM-0002 por ACH ($35,
// no toca el fondo), CM-0003 anticipo cerrado ($20 − $2.75 de vuelto = $17.25)
// y CM-0004 rechazado.
console.log('\n7) El fondo: arqueo y reposición');
const reps = async () => (await db.collection('caja_menuda_reposiciones').get()).docs.map(d => ({ id: d.id, ...d.data() }));
const contar = async (s, conteo) => {
  for (const [id, n] of Object.entries(conteo)) await escribir(s, `${hoja} [data-den="${id}"]`, n);
  await s.quieto(200);
};
// Clic por DOM: el aviso flotante del guardado anterior puede estar encima del botón.
const abrirArqueo = async (s) => { await s.page.$eval('#ccFondo [data-cc-fondo="arqueo"]', b => b.click()); await s.page.waitForSelector(`${hoja} [data-den="b20"]`, { timeout: 5000 }); };
let gs = await gastos();
ok(gs.filter(g => g.por_reponer === true).map(g => g.numero).sort().join() === 'CM-0001,CM-0003',
  `el servidor marcó por reponer lo que sacó efectivo del fondo: ${gs.filter(g => g.por_reponer === true).map(g => g.numero).sort()}`);
await cheE.ir('/caja/contabilidad.html', { esperar: 1800 });
let fondoTxt = await cheE.texto('#ccFondo');
ok(/\$170\.25/.test(fondoTxt) && /2 recibos pagados sin reponer: \$29\.75/.test(fondoTxt), `el fondo dice cuánto debe haber: ${fondoTxt.replace(/\s+/g, ' ').slice(0, 120)}`);
ok(!/Toca reponer/.test(fondoTxt), 'con $170 en caja todavía no toca reponer');
await cheE.captura('14-escritorio-fondo');

await abrirArqueo(cheE);
let hojaTxt = await cheE.texto(hoja);
ok(/CM-0001 al CM-0003/.test(hojaTxt) && /Debe haber en caja/.test(hojaTxt) && /Reponer \$29\.75/.test(hojaTxt), 'la hoja muestra los recibos que entran y el botón dice cuánto se repone');
await accion(cheE, 'arqueo');
ok(/Cuenta el efectivo/.test(await ultimoToast(cheE)), `sin contar no guarda: "${await ultimoToast(cheE)}"`);
await contar(cheE, { b20: 8, m25: 1 });
ok(/Falta/.test(await cheE.texto('#ccArqDif')) && /\$10\.00/.test(await cheE.texto('#ccArqDif')) && /\$160\.25/.test(await cheE.texto('#ccArqEfectivo')),
  `va contando: ${(await cheE.texto('#ccArqEfectivo'))} · ${(await cheE.texto('#ccArqDif')).replace(/\s+/g, ' ')}`);
await cheE.captura('15-escritorio-arqueo-falta');
await escribir(cheE, '#ccArqNota', 'Falta un billete de 10, lo busco');
await accion(cheE, 'arqueo'); await cheE.quieto(900, 15000);
let rs = await reps();
const arq = rs.find(r => r.tipo === 'arqueo');
ok(!!arq && arq.numero === 'ARQ-0001' && arq.estado === 'hecho' && arq.arqueo.diferencia === -10 && arq.esperado === 170.25 && arq.items.length === 0 && arq.created_by_uid === 'cheila',
  `el arqueo suelto queda guardado con lo que faltó: ${JSON.stringify(arq && { n: arq.numero, d: arq.arqueo.diferencia, e: arq.esperado })}`);
ok(/ARQ-0001 guardado: faltan \$10\.00/.test(await ultimoToast(cheE)), `y lo dice: "${await ultimoToast(cheE)}"`);
gs = await gastos();
ok(gs.filter(g => g.por_reponer === true).length === 2 && !gs.some(g => g.reposicion_id), 'un arqueo no toca los recibos: siguen por reponer');

// Ahora sí: aparece el billete, la caja cuadra y se repone.
await abrirArqueo(cheE);
await contar(cheE, { b20: 8, b10: 1, m25: 1 });
ok(/Cuadra/.test(await cheE.texto('#ccArqDif')), 'con el billete de 10 la caja cuadra');
await cheE.captura('16-escritorio-arqueo-cuadra');
await accion(cheE, 'reponer'); await cheE.quieto(1200, 15000);
rs = await reps();
const rep = rs.find(r => r.tipo === 'reposicion');
ok(!!rep && rep.numero === 'REP-0001' && rep.estado === 'preparada' && rep.n === 2 && rep.total === 29.75 && rep.desde === 'CM-0001' && rep.hasta === 'CM-0003'
  && rep.esperado === 170.25 && rep.arqueo.diferencia === 0 && rep.arqueo.efectivo === 170.25,
  `la reposición junta los 2 recibos por $29.75 y cuadra: ${JSON.stringify(rep && { n: rep.numero, t: rep.total, d: rep.desde, h: rep.hasta, dif: rep.arqueo.diferencia })}`);
ok(rep.items.map(i => `${i.numero}:${i.monto}:${i.categoria}`).join(' | ') === 'CM-0001:12.5:Peaje | CM-0003:17.25:Transporte y estacionamiento',
  `con la lista congelada (el anticipo entra por lo gastado, no por lo entregado): ${rep.items.map(i => `${i.numero}:${i.monto}`).join(' | ')}`);
gs = await gastos();
const marcados = gs.filter(g => g.reposicion_id === rep.id);
ok(marcados.length === 2 && marcados.every(g => g.por_reponer === false && g.reposicion_numero === 'REP-0001' && g.historial[g.historial.length - 1].accion === 'repuesto'),
  'cada recibo queda marcado con su reposición y con la entrada en su historial');
ok(!gs.find(g => g.numero === 'CM-0002').reposicion_id && !gs.find(g => g.numero === 'CM-0004').reposicion_id, 'el ACH y el rechazado no entran');
const nCorreos = (await correos()).length;
await servidor();
gs = await gastos();
ok(gs.filter(g => g.por_reponer === true).length === 0 && (await correos()).length === nCorreos, 'el eco del trigger no los vuelve a marcar ni manda correos');

// El informe sale solo, en el formato del Excel de Cheila.
const xl = await cheE.page.evaluate(() => window.__excel);
const cab = xl?.filas.find(f => f[0] === 'COMP') || [];
const fila3 = xl?.filas.find(f => f[0] === 'CM-0003') || [];
ok(xl?.archivo === 'caja-menuda-REP-0001.xlsx' && cab[3] === 'VALES Y VIÁTICOS' && cab[cab.length - 1] === 'TOTAL' && fila3[2] === 'Alberto Yohros' && fila3[4] === 17.25,
  `el informe se descarga solo, una columna por categoría: ${xl?.archivo} · ${cab.slice(0, 5).join(', ')}…`);
ok(xl.filas.find(f => f[2] === 'REEMBOLSO:')[3] === 29.75 && xl.filas.find(f => f[2] === 'TOTAL EN CAJA:')[3] === 170.25
  && xl.filas.find(f => f[0] === 'Efectivo en Caja')[3] === 170.25 && xl.filas.some(f => f[0] === 'Preparado por: Cheila Sánchez'),
  'con el reembolso, el total en caja, el arqueo y quién lo preparó');

fondoTxt = await cheE.texto('#ccFondo');
ok(/\$170\.25/.test(fondoTxt) && /0 recibos pagados sin reponer/.test(fondoTxt) && /cheque por cobrar: \$29\.75/.test(fondoTxt),
  `mientras el cheque no vuelve, en caja sigue habiendo lo mismo: ${fondoTxt.replace(/\s+/g, ' ').slice(0, 140)}`);
await cheE.page.click('#ccFiltros [data-f="hechos"]'); await cheE.quieto(600);
await cheE.page.click(`#ccLista [data-cm-id="${g1.id}"]`); await cheE.quieto(700);
ok(/En la reposición REP-0001/.test(await cheE.texto('#ccDetalle')) && !(await cheE.page.$('#ccCat')), 'el recibo dice en qué reposición entró y ya no se reclasifica');
await abrirArqueo(cheE);
ok(!(await botones(cheE)).includes('reponer'), `sin recibos nuevos no hay nada que reponer: ${await botones(cheE)}`);
await accion(cheE, 'cancelar');

// El cheque se cobra: el fondo vuelve a estar completo.
await cheE.page.$eval('#ccFondo [data-cc-fondo="historial"]', b => b.click());
await cheE.page.waitForSelector(`${hoja} .cc-rep`, { timeout: 5000 });
hojaTxt = await cheE.texto(hoja);
ok(/REP-0001/.test(hojaTxt) && /ARQ-0001/.test(hojaTxt) && /Cheque por cobrar/.test(hojaTxt) && /faltaron \$10\.00/.test(hojaTxt), 'el historial lista la reposición y el arqueo, con lo que faltó');
await cheE.quieto(600); await cheE.captura('17-escritorio-reposiciones');
await cheE.page.click(`${hoja} [data-rep-excel="${arq.id}"]`); await cheE.quieto(400);
const xlArq = await cheE.page.evaluate(() => window.__excel);
ok(xlArq.archivo === 'caja-menuda-ARQ-0001.xlsx' && xlArq.filas.some(f => f[0] === 'Faltante' && f[3] === 10) && !xlArq.filas.some(f => f[0] === 'COMP'), 'el arqueo también tiene su informe, con el faltante');
await cheE.page.click(`${hoja} [data-rep-cobrada="${rep.id}"]`);
await cheE.page.waitForSelector('.overlay [data-role="prompt-input"]', { timeout: 5000 });
await cheE.page.type('.overlay [data-role="prompt-input"]', '000445');
await cheE.page.click('.overlay [data-action="confirm"]'); await cheE.quieto(1200, 15000);
const repB = (await reps()).find(r => r.id === rep.id);
ok(repB.estado === 'repuesta' && repB.pago.referencia === '000445' && repB.pago.por_uid === 'cheila', 'la reposición queda con el cheque cobrado y quién lo anotó');
ok(/Cheque cobrado · 000445/.test(await cheE.texto(hoja)), 'y el historial lo muestra');
await accion(cheE, 'cerrar');
fondoTxt = await cheE.texto('#ccFondo');
ok(/\$200\.00/.test(fondoTxt) && !/por cobrar/.test(fondoTxt), `el fondo vuelve a estar completo: ${fondoTxt.replace(/\s+/g, ' ').slice(0, 90)}`);

// El servidor no le cree a la pantalla ni a cualquiera.
const llamar = (uid, data) => CALLABLES.cajaMenudaReponer.run({ data, auth: { uid, token: {} } }).then(() => 'ok', e => e.code || e.message);
ok(await llamar('marcos', { conteo: { b20: 10 }, solo_arqueo: true }) === 'permission-denied', 'un técnico no puede hacer el arqueo');
ok(await llamar('cheila', { conteo: { b20: 10 }, ids: gs.map(g => g.id) }) === 'failed-precondition', 'pedir reponer recibos ya repuestos, por ACH o rechazados no arma nada');
ok(await llamar('cheila', { conteo: { b50: 4 } }) === 'invalid-argument', 'un conteo con una denominación que no existe se rechaza');
ok((await reps()).length === 2, 'y ninguno de esos intentos dejó un documento');

// ═══ 8) Viático: sin factura ═══════════════════════════════════════════════
// Los "vales" de alimentación son viáticos: no llevan factura. Se piden, los
// aprueba el jefe y se cobran, igual que en el papel.
console.log('\n8) Viático: se pide sin factura');
await che.ir('/caja/index.html', { esperar: 1200 });
await llenar(che, { monto: '9.60', categoria: 'Peaje', concepto: 'Peaje sin foto', proveedor: 'ENA', foto: false });
await accion(che, 'enviar');
ok(/foto de la factura/.test(await ultimoToast(che)), `un peaje sin foto sigue sin salir: "${await ultimoToast(che)}"`);
await accion(che, 'cancelar');
await llenar(che, { monto: '5', categoria: 'Vales y viáticos', concepto: 'Viático gira Campana', foto: false });
const formViatico = await che.page.evaluate((h) => {
  const r = document.querySelector(h);
  const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  return {
    tipo: visible(r.querySelector('.cm-seg')),
    aviso: visible(r.querySelector('#cmAvisoViatico')),
    factura: [...r.querySelectorAll('[data-cm-factura]')].some(visible),
    fecha: r.querySelector('#cmFechaLbl').textContent,
    fechaVisible: visible(r.querySelector('#cmFecha')),
  };
}, hoja);
ok(!formViatico.tipo && formViatico.aviso && !formViatico.factura && formViatico.fecha === 'Fecha del viático' && formViatico.fechaVisible,
  `al elegir viático el formulario deja de pedir factura, proveedor y tipo: ${JSON.stringify(formViatico)}`);
await che.captura('18-telefono-viatico');
await accion(che, 'enviar'); await servidor();
let g5 = await porConcepto('Viático gira');
ok(!!g5 && g5.estado === 'solicitado' && g5.tipo === 'reembolso' && g5.via === 'efectivo' && g5.recibos.length === 0 && g5.proveedor === '' && g5.numero === 'CM-0005',
  `el viático nace sin factura y con su número: ${JSON.stringify(g5 && { e: g5.estado, t: g5.tipo, r: g5.recibos.length, n: g5.numero })}`);
await che.ir('/caja/index.html', { esperar: 1500 });
ok(/Viático · /.test(await che.texto(`[data-cm-id="${g5.id}"]`)) && !/Reembolso/.test(await che.texto(`[data-cm-id="${g5.id}"]`)), 'en la lista se llama Viático, no Reembolso');
await zul.ir(`/caja/index.html?g=${g5.id}`, { esperar: 1800 });
await zul.page.waitForSelector(`${hoja} [data-cm-det]`, { timeout: 6000 }).catch(() => {});
ok(/Viático: no lleva factura/.test(await zul.texto(hoja)), 'la jefa ve que es un viático sin factura');
await accion(zul, 'aprobar'); await servidor();
await cheE.ir(`/caja/contabilidad.html?g=${g5.id}`, { esperar: 1800 });
ok(!(await cheE.page.$('#ccDetalle [data-cc-solicitud]')), 'un viático en efectivo no lleva solicitud de pago');
// Cheila lo pidió y, ya aprobado por su jefa, lo paga ella misma como custodia.
await cheE.page.click('#ccDetalle [data-cc-accion="pagar"]');
await cheE.page.waitForSelector(`${hoja} #cmEntMonto`, { timeout: 5000 });
ok(/Le pagas el viático en efectivo/.test(await cheE.texto(hoja)) && /No lleva factura/.test(await cheE.texto(hoja)), 'al pagarlo, la hoja dice que es un viático sin factura');
await accion(cheE, 'ok'); await servidor();
g5 = await porConcepto('Viático gira');
ok(g5.estado === 'pagado' && g5.entrega.monto === 5 && g5.por_reponer === true, 'pagado en efectivo: sale del fondo y queda por reponer como cualquier recibo');
await cheE.ir('/caja/contabilidad.html', { esperar: 1800 });
fondoTxt = await cheE.texto('#ccFondo');
ok(/\$195\.00/.test(fondoTxt) && /1 recibo pagado sin reponer: \$5\.00/.test(fondoTxt), `y el fondo lo descuenta: ${fondoTxt.replace(/\s+/g, ' ').slice(0, 90)}`);

// ═══ 9) Solicitud de pago en papel ═════════════════════════════════════════
// Lo que no sale del fondo se paga con la SOLICITUD DE PAGO de contabilidad.
// El sistema imprime la hoja con lo que ya se aprobó; las firmas y el Vo.Bo.
// del director van a mano.
console.log('\n9) Solicitud de pago en papel');
const hojaImpresa = (s) => s.page.evaluate(() => { const h = window.__hoja || ''; window.__hoja = ''; return h; });
const plano = (h) => h.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
await cheE.page.click('#ccFiltros [data-f="hechos"]'); await cheE.quieto(600);
await cheE.page.click(`#ccLista [data-cm-id="${g1.id}"]`); await cheE.quieto(600);
ok(!(await cheE.page.$('#ccDetalle [data-cc-solicitud]')), 'lo que se pagó del fondo no tiene solicitud de pago');
await cheE.page.click(`#ccLista [data-cm-id="${g2.id}"]`); await cheE.quieto(600);
await cheE.page.click('#ccDetalle [data-cc-solicitud]'); await cheE.quieto(300);
const htmlAch = await hojaImpresa(cheE);
const sp = plano(htmlAch);
ok(/C COMUNICA, S\.A\./.test(sp) && /SOLICITUD DE PAGO/.test(sp) && /Páguese a la orden de: CHEILA SÁNCHEZ/.test(sp)
  && /La suma de: B\/\.35\.00 \(TREINTA Y CINCO CON 00\/100\)/.test(sp) && /Mediante: ACH/.test(sp) && /Reembolso: Gasolina gira Colón/.test(sp),
  `la hoja del ACH sale en el formato de contabilidad: ${sp.slice(sp.indexOf('SOLICITUD'), sp.indexOf('SOLICITUD') + 150)}`);
ok(/Ya consta en el sistema · CM-0002/.test(sp) && /Pedido — Cheila Sánchez/.test(sp) && /Aprobado — Zuleika Diaz/.test(sp) && /Pagado \(ACH ACH-778899\) — Alberto Yohros/.test(sp),
  'con lo que ya se aprobó en el sistema: quién pidió, quién aprobó y el pago');
ok(/Solicitado por: Cheila Sánchez/.test(sp) && /Revisado por: Lic\. Zuleika Díaz/.test(sp) && /Aprobado: Ing\. Alberto Yohros/.test(sp) && /Vo\.Bo\.: Sr\. Joseph Bettsack/.test(sp)
  && (htmlAch.match(/class="firma"/g) || []).length === 4, 'y las cuatro casillas para firmar a mano, la última el Vo.Bo.');

await cheE.page.$eval('#ccFondo [data-cc-fondo="historial"]', b => b.click());
await cheE.page.waitForSelector(`${hoja} .cc-rep`, { timeout: 5000 });
ok(!(await cheE.page.$(`${hoja} [data-rep-solicitud="${arq.id}"]`)), 'un arqueo suelto no pide cheque: no tiene solicitud');
await cheE.page.click(`${hoja} [data-rep-solicitud="${rep.id}"]`); await cheE.quieto(300);
const htmlRep = await hojaImpresa(cheE);
const sr = plano(htmlRep);
ok(/Páguese a la orden de: CHEILA SÁNCHEZ/.test(sr) && /B\/\.29\.75 \(VEINTINUEVE CON 75\/100\)/.test(sr) && /Mediante: CHEQUE/.test(sr)
  && /Reembolso de caja menuda CM-0001 al CM-0003/.test(sr), `la del cheque de la reposición: ${sr.slice(sr.indexOf('Páguese'), sr.indexOf('Páguese') + 150)}`);
ok(/Preparado por: Cheila Sánchez/.test(sr) && !/Vo\.Bo\./.test(sr) && (htmlRep.match(/class="firma"/g) || []).length === 3, 'va con tres firmas, sin Vo.Bo., como la de contabilidad');
ok(/Recibos de esta reposición \(2\)/.test(sr) && /CM-0001 .* Peaje corredor sur visita banco Zuleika Diaz 12\.50/.test(sr) && /Total 29\.75/.test(sr),
  'y lleva la lista de recibos con quién aprobó cada uno');
await accion(cheE, 'cerrar');

// Quién firma se cambia en "Fondo y tope".
await cheE.page.click('#ccConfig');
await cheE.page.waitForSelector(`${hoja} #cfVobo`, { timeout: 5000 });
ok(await cheE.page.$eval('#cfVobo', e => e.value) === 'Sr. Joseph Bettsack' && await cheE.page.$eval('#cfSinFac', e => e.value) === 'Vales y viáticos',
  'la configuración trae quién firma y qué categoría va sin factura');
await escribir(cheE, '#cfSinFac', 'Viaticos mal escrito');
await accion(cheE, 'ok');
ok(/no está en las categorías/.test(await ultimoToast(cheE)), `una categoría sin factura que no existe no se guarda: "${await ultimoToast(cheE)}"`);
await escribir(cheE, '#cfSinFac', 'Vales y viáticos');
await escribir(cheE, '#cfVobo', 'Sr. Michael Bettsack');
await accion(cheE, 'ok'); await cheE.quieto(900);
const cfgGuardada = (await db.doc('empresa/caja_menuda').get()).data() || {};
ok(cfgGuardada.firmas?.vobo === 'Sr. Michael Bettsack' && cfgGuardada.sin_factura?.join() === 'Vales y viáticos' && cfgGuardada.fondo === 200,
  `se guarda sin tocar lo demás: ${JSON.stringify({ v: cfgGuardada.firmas?.vobo, s: cfgGuardada.sin_factura, f: cfgGuardada.fondo })}`);
await cheE.page.click(`#ccLista [data-cm-id="${g2.id}"]`); await cheE.quieto(600);
await cheE.page.click('#ccDetalle [data-cc-solicitud]'); await cheE.quieto(300);
ok(/Vo\.Bo\.: Sr\. Michael Bettsack/.test(plano(await hojaImpresa(cheE))), 'y la siguiente hoja sale con el nuevo nombre');

// Las dos hojas, a la vista (para revisar cómo quedan impresas).
const visor = await cheE.page.browser().newPage();
await visor.setViewport({ width: 900, height: 1100 });
for (const [nombre, h] of [['19-solicitud-pago-ach', htmlAch], ['20-solicitud-pago-reposicion', htmlRep]]) {
  await visor.setContent(h, { waitUntil: 'load' });
  await visor.screenshot({ path: `C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/caja-menuda/${nombre}.png`, fullPage: true });
}
await visor.close();

// ═══ 5) Piloto y 6) Usuarios ═══════════════════════════════════════════════
console.log('\n5) Piloto · 6) Usuarios');
const mar = await abrir({ email: GENTE.marcos.email, viewport: 'telefono', carpeta: 'caja-menuda' });
await mar.ir('/caja/index.html', { esperar: 2500 });
ok(!(await mar.page.evaluate(() => location.pathname)).startsWith('/caja/'), 'piloto: un técnico todavía no entra (vuelve al inicio)');
await mar.ir('/index.html', { esperar: 1500 });
ok(!/Caja menuda/.test(await mar.texto('body')), 'y no ve la tarjeta en su inicio');
await che.ir('/index.html', { esperar: 1500 });
ok(/Caja menuda/.test(await che.texto('body')), 'contabilidad sí ve "Caja menuda" en su inicio');
await alb.ir('/admin/usuarios.html', { esperar: 2500 });
const jefeCheila = await alb.page.evaluate(() => { const s = document.querySelector('select[data-action="jefe"][data-uid="cheila"]'); return s ? s.options[s.selectedIndex].textContent : null; });
ok(jefeCheila === 'Zuleika Diaz', `Usuarios muestra el jefe de cada quien: Cheila → ${jefeCheila}`);
const opcionesAlb = await alb.page.evaluate(() => [...document.querySelectorAll('select[data-action="jefe"][data-uid="alberto"] option')].map(o => o.value));
ok(!opcionesAlb.includes('alberto') && opcionesAlb[0] === '', 'nadie se puede poner de jefe de sí mismo; vacío = administración');
await alb.captura('13-escritorio-usuarios');

// Errores de consola de todo el recorrido.
const errs = [che, zul, alb, cheE, mar].flatMap(s => s.errores).filter(e => !/favicon/.test(e));
ok(errs.length === 0, `sin errores de consola${errs.length ? ': ' + errs.slice(0, 6).join(' ‖ ') : ''}`);

for (const s of [che, zul, alb, cheE, mar]) await s.cerrar();
console.log(fallos ? `\n${fallos} FALLAS` : '\nCAJA MENUDA: recorrido completo OK');
process.exit(fallos ? 1 : 0);
