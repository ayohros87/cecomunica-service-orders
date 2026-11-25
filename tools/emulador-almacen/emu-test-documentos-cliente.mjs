// Expediente legal del cliente, de punta a punta (2026-11-25, pedido de Zuleika):
//   Cobros abre la ficha → ve qué falta → pide los documentos (enlace) →
//   el CLIENTE, sin sesión y en el teléfono, sube una foto y un PDF →
//   Cobros los ve "por revisar", marca uno y rechaza el otro →
//   el directorio filtra "Docs por revisar" y "Expediente incompleto" →
//   la vendedora ve qué falta sin poder abrir nada →
//   la página de firma le ofrece al cliente subir lo que falta.
//
// Emuladores: auth, firestore, STORAGE y hosting (dist/ recién construido):
//   firebase emulators:start --only auth,firestore,storage,hosting --project cecomunica-service-orders
//   (desde functions/) FIRESTORE_EMULATOR_HOST=… FIREBASE_AUTH_EMULATOR_HOST=… NODE_PATH=./node_modules node ../tools/emulador-almacen/emu-seed-todo.js
//   node tools/emulador-almacen/emu-test-documentos-cliente.mjs
//
// No hay emulador de Functions (su runtime rompe FieldValue): las dos
// callables se atienden AQUÍ. documentosClientePublico corre con su handler
// real contra los emuladores de Firestore y Storage; el trigger del resumen
// (onClienteDocumentoWrite) se llama a mano después de cada escritura.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

process.env.FIRESTORE_EMULATOR_HOST = process.env.EMU_FS || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.EMU_AUTH || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.EMU_ST || '127.0.0.1:9199';
const ST_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const BASE = process.env.BASE || 'http://127.0.0.1:5000';
const PROYECTO = 'cecomunica-service-orders';
const BUCKET = `${PROYECTO}.firebasestorage.app`;
const PASS = 'emulador123';
const CAPTURAS = 'C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/documentos-cliente';

const require = createRequire('file:///C:/Projects/cecomunica-service-orders/functions/');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROYECTO, storageBucket: BUCKET });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const callable = require('./src/callable/documentosClientePublico.js')._interno;
const { recalcular } = require('./src/triggers/clientes/onClienteDocumentoWrite.js')._interno;
const puppeteer = require('puppeteer-core');

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(CAPTURAS, { recursive: true });

// ── Sesiones del navegador ──────────────────────────────────────────────
const VIEW = {
  escritorio: { width: 1366, height: 768 },
  telefono: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const chunks = new Map();
async function chunkParchado(url, email) {
  const k = url + '|' + (email || '');
  if (chunks.has(k)) return chunks.get(k);
  let src = await (await fetch(url)).text();
  const antes = src.length;
  src = src.replace(/settings\(\{merge:!0,/, `settings({merge:!0,host:"${process.env.FIRESTORE_EMULATOR_HOST}",ssl:!1,`);
  const [stH, stP] = ST_HOST.split(':');
  src = src.replace(/(\w+)\.auth\(\)\.setPersistence\(/, (m, y) =>
    `${y}.auth().useEmulator("http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}",{disableWarnings:!0});` +
    `${y}.storage().useEmulator("${stH}",${stP});` +
    (email ? `(function(){var a=${y}.auth();var o=a.onAuthStateChanged.bind(a);a.onAuthStateChanged=function(cb){return o(function(u){` +
      `if(u){cb(u);}else if(!window.__login){window.__login=1;` +
      `a.signInWithEmailAndPassword(${JSON.stringify(email)},${JSON.stringify(PASS)}).catch(function(e){console.error("login",e.code||e)});}});};})();` : '') +
    `window.__EMULADOR__=1;${y}.auth().setPersistence(`);
  if (src.length === antes) throw new Error('no se pudo parchar ' + url);
  chunks.set(k, src);
  return src;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const llamadas = [];
async function atenderCallable(req, nombre) {
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
  const data = (JSON.parse(req.postData() || '{}').data) || {};
  llamadas.push({ nombre, data });
  try {
    let result;
    if (nombre === 'documentosClientePublico') {
      result = await callable.handler({ data }, { db, admin, bucket, expedienteEmailTo: async () => 'cobros@cecomunica.com' });
      // Lo que en producción hace el trigger onClienteDocumentoWrite.
      if (data.accion === 'registrar') {
        const p = data.s ? await db.doc(`documentos_solicitudes/${data.s}`).get() : await db.doc(`firma_solicitudes/${data.f}`).get();
        if (p.exists) await recalcular(p.data().cliente_id);
      }
    } else if (nombre === 'getClienteDocUrl') {
      result = { status: 'ok', url: 'about:blank#doc-firmado' };
    } else {
      return req.respond({ status: 404, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { status: 'NOT_FOUND', message: nombre } }) });
    }
    return req.respond({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ result }) });
  } catch (e) {
    const status = { 'invalid-argument': 'INVALID_ARGUMENT', 'resource-exhausted': 'RESOURCE_EXHAUSTED' }[e.code] || 'INTERNAL';
    return req.respond({ status: status === 'INTERNAL' ? 500 : 400, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({ error: { status, message: e.message } }) });
  }
}

async function abrir({ email = null, viewport = 'escritorio' } = {}) {
  const perfil = `${(process.env.TEMP || 'C:/Temp').replace(/\\/g, '/')}/chrome-docs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--disable-extensions', `--user-data-dir=${perfil}`, '--lang=es-PA'] });
  const page = await browser.newPage();
  await page.setViewport(VIEW[viewport]);
  await page.setRequestInterception(true);
  const s = { browser, page, errores: [] };
  page.on('request', async (req) => {
    const u = req.url();
    try {
      if (/\/assets\/firebase-init-[^/]+\.js$/.test(u)) return req.respond({ status: 200, contentType: 'application/javascript', body: await chunkParchado(u, email) });
      const fn = u.match(/cloudfunctions\.net\/(\w+)$/);
      if (fn) return atenderCallable(req, fn[1]);
      if (/googleapis\.com|identitytoolkit/.test(u) && !u.includes('fonts') && !u.includes('127.0.0.1')) s.errores.push('¡PRODUCCIÓN! ' + u.slice(0, 110));
      return req.continue();
    } catch (e) { console.error('interceptor:', e.message); try { req.continue(); } catch {} }
  });
  page.on('console', m => { if (m.type() === 'error') s.errores.push(m.text().slice(0, 220)); });
  page.on('pageerror', e => s.errores.push('pageerror ' + String(e).slice(0, 220)));
  page.on('dialog', async d => { s.errores.push('dialog nativo: ' + d.message().slice(0, 100)); await d.accept(); });
  await page.evaluateOnNewDocument(() => {
    window.__toasts = [];
    let toast; Object.defineProperty(window, 'Toast', { configurable: true, get: () => toast, set: (v) => {
      toast = v; if (v && typeof v.show === 'function' && !v.__env) { const os = v.show.bind(v); v.__env = true;
        v.show = (msg, type, d) => { window.__toasts.push(`${type || 'ok'}: ${msg}`); return os(msg, type, d); }; } } });
    // El portapapeles no existe en headless sin permiso: que "Copiar" no reviente.
    window.__copiado = null;
  });
  s.ir = async (url) => { await page.goto(BASE + url, { waitUntil: 'domcontentloaded' }); };
  s.captura = async (nombre, full = false) => { const p = `${CAPTURAS}/${nombre}.png`; await page.screenshot({ path: p, fullPage: full }); return p; };
  s.toasts = () => page.evaluate(() => window.__toasts || []);
  s.sinDesborde = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  s.cerrar = async () => { try { await browser.close(); } catch {} try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {} };
  return s;
}

// ── Datos de la prueba ──────────────────────────────────────────────────
// Un cliente activo, con contrato vivo, vendedora asignada y SIN documentos.
async function elegirCliente() {
  const vend = (await db.collection('usuarios').where('email', '==', 'karla.ferrer@cecomunica.com').get()).docs[0];
  const cts = await db.collection('contratos').where('estado', '==', 'activo').limit(400).get();
  for (const d of cts.docs) {
    const c = d.data();
    if (c.deleted === true || !c.cliente_id) continue;
    const cli = await db.doc(`clientes/${c.cliente_id}`).get();
    if (!cli.exists || cli.data().activo === false || cli.data().deleted === true) continue;
    if ((await cli.ref.collection('documentos').limit(1).get()).size) continue;
    // Corrida repetible: los enlaces que dejó una corrida anterior se retiran.
    const viejas = await db.collection('documentos_solicitudes').where('cliente_id', '==', cli.id).get();
    await Promise.all(viejas.docs.map(x => x.ref.update({ estado: 'cancelado' })));
    await db.doc('firma_solicitudes/prueba-firma-docs-0001').delete().catch(() => {});
    // La vendedora de la prueba pasa a atender esta cuenta (solo en el emulador).
    await cli.ref.update({ vendedor_asignado: vend.id, vendedor_email: vend.data().email, expediente: admin.firestore.FieldValue.delete() });
    return { id: cli.id, nombre: cli.data().nombre, contrato: d.id };
  }
  throw new Error('no hay cliente de prueba');
}

async function fixtures() {
  const dir = `${(process.env.TEMP || 'C:/Temp').replace(/\\/g, '/')}/docs-cliente-fixtures`;
  fs.mkdirSync(dir, { recursive: true });
  // Una "foto" de verdad (PNG grande: la página tiene que pasarla a JPEG) y un PDF mínimo.
  const s = await abrir({ viewport: 'escritorio' });
  await s.page.setContent('<body style="margin:0;background:#dfe7ef;font:48px Arial;padding:80px">CÉDULA DE PRUEBA<br>8-888-8888<br>REPRESENTANTE LEGAL</body>');
  await s.page.screenshot({ path: `${dir}/cedula.png` });
  await s.cerrar();
  fs.writeFileSync(`${dir}/aviso.pdf`, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  fs.writeFileSync(`${dir}/falso.pdf`, '<html>esto no es un pdf</html>');
  return { foto: `${dir}/cedula.png`, pdf: `${dir}/aviso.pdf`, falso: `${dir}/falso.pdf` };
}

// ═════════════════════════════════════════════════════════════════════════
const cli = await elegirCliente();
const fx = await fixtures();
console.log(`Cliente de prueba: ${cli.nombre} (${cli.id})`);
const FICHA = `/clientes/centro.html?id=${encodeURIComponent(cli.id)}`;
const abrirTabDocs = async (s) => {
  await s.page.waitForFunction(() => window.Centro?.cliente && !document.getElementById('tabDocumentos')?.classList.contains('hidden'), { timeout: 30000 });
  await s.page.evaluate(() => Centro.abrirBloque('blkDocumentos'));
  await s.page.waitForFunction(() => document.querySelectorAll('#fDocumentos .cg-req').length === 3, { timeout: 20000 });
  await espera(400);
};

// ── 1. Cobros: la pestaña dice qué falta ──
console.log('— 1. Cobros abre la ficha');
const cobros = await abrir({ email: 'cobros@cecomunica.com' });
await cobros.ir(FICHA);
await abrirTabDocs(cobros);
let t = await cobros.page.evaluate(() => ({
  aviso: document.querySelector('#fDocumentos .cg-docs-aviso')?.innerText || '',
  reqs: [...document.querySelectorAll('#fDocumentos .cg-req')].map(e => [e.className.replace('cg-req cg-req--', ''), e.innerText.replace(/\n/g, ' | ')]),
  contacto: [...document.querySelectorAll('#fContacto dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.innerText]).find(x => x[0] === 'Documentos')?.[1] || '',
  iconos: document.querySelectorAll('#fDocumentos i[data-lucide]').length,
}));
ok(/Faltan 3 de 3/.test(t.aviso), `aviso: "${t.aviso.split('\n')[0]}"`);
ok(t.reqs.length === 3 && t.reqs.every(r => r[0] === 'falta'), `los tres requisitos en falta: ${t.reqs.map(r => r[1]).join(' · ')}`);
ok(/Faltan 3 de 3/.test(t.contacto) && /pedirlos al cliente/.test(t.contacto), `tarjeta Contacto: "${t.contacto}"`);
ok(t.iconos === 0, 'todos los iconos de la pestaña se convirtieron (están en el vendor)');
ok(await cobros.sinDesborde(), 'sin scroll horizontal a 1366');
await cobros.captura('01-cobros-pestana-vacia');

// ── 2. Pedir documentos: elegir y generar el enlace ──
console.log('— 2. Cobros pide los documentos');
await cobros.page.evaluate(() => Centro.pedirDocumentos());
await cobros.page.waitForSelector('#cgModal input[name="cgPide"]', { timeout: 10000 });
const marcados = await cobros.page.evaluate(() => [...document.querySelectorAll('#cgModal input[name="cgPide"]')].map(i => i.checked));
ok(marcados.length === 3 && marcados.every(Boolean), 'los tres que faltan vienen marcados');
await cobros.captura('02-cobros-elegir');
await cobros.page.click('#cgPedirBtn');
await cobros.page.waitForSelector('#wdLink', { timeout: 15000 });
const enlace = await cobros.page.$eval('#wdLink', e => e.value);
const sid = new URL(enlace).searchParams.get('s');
ok(/\/documentos\/\?s=[\w-]{15,}$/.test(enlace), `enlace generado: ${enlace}`);
const solDoc = (await db.doc(`documentos_solicitudes/${sid}`).get()).data();
ok(solDoc?.estado === 'pendiente' && solDoc.cliente_id === cli.id && solDoc.pide.length === 3 && solDoc.creado_por_email === 'cobros@cecomunica.com',
  'la solicitud quedó en Firestore (las rules la aceptaron), a nombre de Cobros');
const diasVence = Math.round((solDoc.vence_at.toMillis() - Date.now()) / 864e5);
ok(diasVence === 30, `vence en ${diasVence} días`);
await cobros.captura('03-cobros-enlace');
// Enviar por correo
await cobros.page.$eval('#wdEmail', e => { e.value = 'cliente@ejemplo.com'; });
await cobros.page.click('#wdEnviar');
await cobros.page.waitForFunction(() => (window.__toasts || []).some(x => /Enlace enviado/.test(x)), { timeout: 15000 });
const mailCli = (await db.collection('mail_queue').where('meta.documentos_solicitud', '==', sid).get()).docs.map(d => d.data())[0];
ok(mailCli?.to === 'cliente@ejemplo.com' && mailCli.ctaUrl === enlace && /Aviso de Operación o Registro Público/.test(mailCli.bodyContent),
  `correo al cliente encolado: "${mailCli?.subject}"`);
// El toast sale antes de anotar el envío (es best-effort): se espera el dato.
let anotado = null;
for (let i = 0; i < 20 && !anotado; i++) { await espera(250); anotado = (await db.doc(`documentos_solicitudes/${sid}`).get()).data().enviado_a || null; }
ok(anotado === 'cliente@ejemplo.com', 'se anotó a quién se envió');
await cobros.page.evaluate(() => Centro._cerrarModal());

// ── 3. El cliente, en el teléfono y sin sesión ──
console.log('— 3. El cliente abre el enlace en el teléfono');
const cliente = await abrir({ viewport: 'telefono' });
await cliente.ir(`/documentos/?s=${sid}`);
await cliente.page.waitForSelector('#form:not(.hidden)', { timeout: 20000 });
t = await cliente.page.evaluate(() => ({
  titulo: document.querySelector('#form h2').innerText,
  pedidos: [...document.querySelectorAll('#fPedidos .card h3')].map(h => h.innerText),
  vence: document.getElementById('fVence').innerText,
  sesion: !!firebase.auth().currentUser,
  select: !!document.getElementById('tipo-constitucion'),
}));
ok(t.titulo.includes(cli.nombre), `saluda por el nombre de la empresa: "${t.titulo}"`);
ok(t.pedidos.length === 3, `pide los tres: ${t.pedidos.join(' · ')}`);
ok(!t.sesion, 'sin sesión');
ok(t.select, 'el primero pregunta cuál de los dos documentos es');
ok(/funciona hasta el/.test(t.vence), t.vence);
ok(await cliente.sinDesborde(), 'sin scroll horizontal a 390');
await cliente.captura('04-cliente-formulario', true);

// Enviar sin nada → aviso, no llamada
await cliente.page.click('#btnEnviar');
await espera(300);
ok(/al menos un documento/.test(await cliente.page.$eval('#fMsg', e => e.textContent)), 'sin archivos no envía: lo dice en la página');

// Foto para la cédula (PNG → JPEG), PDF para el aviso, y un "PDF" falso para el recibo
const subir = async (req, archivo) => {
  const antes = await cliente.page.$$eval(`#lista-${req} li`, x => x.length);
  const inp = await cliente.page.$(`input[data-archivo="${req}"]`);
  await inp.uploadFile(archivo);
  await cliente.page.waitForFunction((r, n) => document.querySelectorAll(`#lista-${r} li`).length === n, { timeout: 15000 }, req, antes + 1);
};
await subir('cedula', fx.foto);
await cliente.page.select('#tipo-constitucion', 'aviso_operacion');
await subir('constitucion', fx.pdf);
await subir('direccion', fx.falso);
const listados = await cliente.page.$$eval('.archivos li span', xs => xs.map(x => x.innerText));
ok(listados.some(x => /cedula\.jpg/.test(x)), `la foto PNG se convirtió a JPEG: ${listados.join(' · ')}`);
await cliente.page.click('#btnEnviar');
await espera(300);
ok(/nombre completo/.test(await cliente.page.$eval('#fMsg', e => e.textContent)), 'sin nombre no envía');
await cliente.page.type('#fNombre', 'Ana Representante');
await cliente.captura('05-cliente-con-archivos', true);
await cliente.page.click('#btnEnviar');
await cliente.page.waitForFunction(() => !document.getElementById('fResultado').classList.contains('hidden'), { timeout: 40000 });
t = await cliente.page.evaluate(() => ({
  resultado: document.getElementById('fResultado').innerText,
  aviso: document.getElementById('fMsg').innerText,
  pedidos: [...document.querySelectorAll('#fPedidos .card h3')].map(h => h.innerText.replace(/\s+/g, ' ')),
}));
ok(/Recibimos 2 archivos/.test(t.resultado) && /Todavía falta: Recibo de luz, agua o teléfono/.test(t.resultado), `resultado: "${t.resultado}"`);
ok(/1 archivo no se pudo leer/.test(t.aviso), `el PDF falso se rechazó y se lo dice: "${t.aviso}"`);
ok(t.pedidos.filter(p => /Recibido/.test(p)).length === 2, `dos quedan como recibidos: ${t.pedidos.join(' · ')}`);
await cliente.captura('06-cliente-enviado', true);
ok(cliente.errores.filter(e => /PRODUCCIÓN/.test(e)).length === 0, 'la página del cliente no tocó producción');

// Lo que quedó del lado del servidor
const docs = (await db.collection(`clientes/${cli.id}/documentos`).get()).docs.map(d => ({ id: d.id, ...d.data() }));
ok(docs.length === 2 && docs.every(d => d.revision?.estado === 'pendiente' && d.origen?.cliente && d.origen.solicitud === sid && d.origen.nombre === 'Ana Representante'),
  `2 documentos en el expediente, por revisar, con el nombre de quien los subió (${docs.map(d => d.tipo).join(', ')})`);
ok(docs.some(d => d.tipo === 'aviso_operacion' && d.content_type === 'application/pdf') && docs.some(d => d.tipo === 'cedula_representante' && d.content_type === 'image/jpeg'),
  'cada uno con su tipo y su formato');
const enStorage = await Promise.all(docs.map(async d => (await bucket.file(d.storage_path).exists())[0]));
ok(enStorage.every(Boolean), 'los archivos están en clientes_documentos/ (Storage)');
const [resto] = await bucket.getFiles({ prefix: `clientes_docs_entrada/${sid}/` });
ok(resto.length === 0, 'la carpeta de entrada quedó vacía (también el archivo rechazado)');
const solDespues = (await db.doc(`documentos_solicitudes/${sid}`).get()).data();
ok(solDespues.estado === 'pendiente' && Object.keys(solDespues.recibidos || {}).length === 2, 'la solicitud sigue viva: falta el recibo');
const mailCobros = (await db.collection('mail_queue').where('meta.tipo', '==', 'expediente_documentos_recibidos').get()).docs.map(d => d.data()).filter(m => m.meta.solicitud === sid);
ok(mailCobros.length === 1 && mailCobros[0].to === 'cobros@cecomunica.com' && /karla\.ferrer/.test(mailCobros[0].cc || ''),
  `un aviso a Cobros con copia a la vendedora: "${mailCobros[0]?.subject}" (cc ${mailCobros[0]?.cc})`);
const exp = (await db.doc(`clientes/${cli.id}`).get()).data().expediente;
ok(exp?.por_revisar === 2 && exp.direccion === 'falta' && exp.cedula === 'por_revisar' && exp.completo === false, `resumen en la ficha: ${JSON.stringify({ ...exp, actualizado_at: undefined })}`);

// Un enlace no deja ver nada: recargar muestra lo mismo, sin nombres de archivo
await cliente.ir(`/documentos/?s=${sid}`);
await cliente.page.waitForSelector('#form:not(.hidden)', { timeout: 20000 });
const html = await cliente.page.content();
ok(!/aviso\.pdf|cedula\.jpg|clientes_documentos/.test(html), 'al volver a abrir el enlace no aparece ningún archivo del expediente');
// Enlaces malos
await cliente.ir('/documentos/?s=noexiste12345');
await cliente.page.waitForSelector('#noValido:not(.hidden)', { timeout: 15000 });
ok(true, 'un enlace que no existe muestra "Enlace no válido"');
await cliente.captura('07-cliente-no-valido');
await cliente.ir('/documentos/');
await cliente.page.waitForSelector('#noValido:not(.hidden)', { timeout: 15000 });
ok(true, 'sin portador, "Enlace no válido"');

// ── 4. Cobros revisa ──
console.log('— 4. Cobros revisa lo que subió el cliente');
await cobros.ir(FICHA + '&docs=1');
await cobros.page.waitForFunction(() => document.querySelectorAll('#fDocumentos .cg-doc').length === 2, { timeout: 30000 });
await espera(500);
t = await cobros.page.evaluate(() => ({
  pestana: !document.getElementById('blkDocumentos').hidden,
  aviso: document.querySelector('#fDocumentos .cg-docs-aviso')?.innerText.split('\n')[0] || '',
  reqs: [...document.querySelectorAll('#fDocumentos .cg-req')].map(e => e.className.replace('cg-req cg-req--', '')),
  filas: [...document.querySelectorAll('#fDocumentos .cg-doc')].map(e => e.innerText.replace(/\n+/g, ' | ')),
  enlace: document.querySelector('#fDocumentos .cg-docs-enlace')?.innerText || '',
  n: document.getElementById('nDocumentos').textContent,
}));
ok(t.pestana, '?docs=1 (el botón del correo) abre la pestaña Documentos');
ok(/Falta 1 de 3: Recibo de servicio · 2 por revisar/.test(t.aviso), `aviso: "${t.aviso}"`);
ok(JSON.stringify(t.reqs) === JSON.stringify(['por_revisar', 'por_revisar', 'falta']), `requisitos: ${t.reqs.join(', ')}`);
ok(t.filas.every(f => /Por revisar/.test(f) && /Subido por el cliente \(Ana Representante\)/.test(f) && /Marcar revisado/.test(f) && /Rechazar/.test(f)), 'cada fila dice quién lo subió y ofrece revisar o rechazar');
ok(/enlace de carga abierto/.test(t.enlace) && /enviado a cliente@ejemplo\.com/.test(t.enlace) && /ya recibió/.test(t.enlace), `enlace abierto: "${t.enlace.replace(/\n/g, ' ')}"`);
ok(t.n === '2', 'la pestaña cuenta 2 archivos');
await cobros.captura('08-cobros-por-revisar');

// Marcar revisado el aviso de operación
const idAviso = docs.find(d => d.tipo === 'aviso_operacion').id;
const idCedula = docs.find(d => d.tipo === 'cedula_representante').id;
await cobros.page.evaluate((id) => Centro.revisarDocumento(id), idAviso);
await cobros.page.waitForFunction(() => document.querySelectorAll('#fDocumentos .cg-req--ok').length === 1, { timeout: 15000 });
const rev = (await db.doc(`clientes/${cli.id}/documentos/${idAviso}`).get()).data().revision;
ok(rev.estado === 'ok' && rev.por_email === 'cobros@cecomunica.com' && rev.at, `revisado por ${rev.por_email}`);
// Rechazar la cédula (prompt del kit)
cobros.page.evaluate((id) => Centro.rechazarDocumento(id), idCedula);
await cobros.page.waitForSelector('[data-role="prompt-input"]', { timeout: 10000 });
await cobros.page.type('[data-role="prompt-input"]', 'La foto salió borrosa, no se lee el número');
await cobros.captura('09-cobros-rechazar');
await cobros.page.evaluate(() => [...document.querySelectorAll('.overlay .btn')].find(b => /Rechazar/.test(b.textContent)).click());
await cobros.page.waitForFunction(() => document.querySelectorAll('#fDocumentos .cg-doc').length === 1, { timeout: 15000 });
const rech = (await db.doc(`clientes/${cli.id}/documentos/${idCedula}`).get()).data();
ok(rech.deleted === true && rech.revision.estado === 'rechazado' && /borrosa/.test(rech.revision.motivo), 'rechazado: sale del expediente con su motivo');
ok((await bucket.file(rech.storage_path).exists())[0], 'el archivo rechazado se conserva en Storage (auditoría)');
await recalcular(cli.id); await recalcular(cli.id);
await espera(600);
t = await cobros.page.evaluate(() => ({
  reqs: [...document.querySelectorAll('#fDocumentos .cg-req')].map(e => e.className.replace('cg-req cg-req--', '')),
  aviso: document.querySelector('#fDocumentos .cg-docs-aviso')?.innerText.split('\n')[0] || '',
}));
ok(JSON.stringify(t.reqs) === JSON.stringify(['ok', 'falta', 'falta']), `tras revisar y rechazar: ${t.reqs.join(', ')}`);
ok(/Faltan 2 de 3/.test(t.aviso), `aviso: "${t.aviso}"`);
await cobros.captura('10-cobros-revisado');
ok(cobros.errores.filter(e => !/favicon|ERR_FAILED|net::/.test(e)).length === 0, `sin errores de consola en la ficha (${cobros.errores.slice(0, 3).join(' ‖ ')})`);

// "Ver" abre una pestaña con la URL firmada (callable simulada)
const antesTabs = (await cobros.browser.pages()).length;
await cobros.page.evaluate((id) => Centro.verDocumento(id), idAviso);
await espera(1200);
ok((await cobros.browser.pages()).length === antesTabs + 1 && llamadas.some(l => l.nombre === 'getClienteDocUrl' && l.data.docId === idAviso), '"Ver" pide la URL firmada y abre el documento en otra pestaña');
// La pestaña nueva deja a la ficha en segundo plano (sin rAF, los waitForFunction no avanzan).
for (const pg of await cobros.browser.pages()) { if (pg !== cobros.page) await pg.close().catch(() => {}); }
await cobros.page.bringToFront();

// ── 5. El directorio: los dos filtros de Cobros ──
console.log('— 5. Directorio');
// Otro documento por revisar para que el filtro tenga a quién mostrar.
await db.collection(`clientes/${cli.id}/documentos`).doc('prueba-recibo').set({
  tipo: 'comprobante_direccion', nombre_archivo: 'recibo.jpg', storage_path: `clientes_documentos/${cli.id}/prueba-recibo.jpg`,
  content_type: 'image/jpeg', size: 1000, subido_por: null, subido_en: admin.firestore.Timestamp.now(), deleted: false,
  origen: { cliente: true, solicitud: sid, nombre: 'Ana Representante' }, revision: { estado: 'pendiente' } });
await recalcular(cli.id);
await cobros.ir('/clientes/centro.html');
await cobros.page.waitForFunction(() => document.querySelectorAll('#cgFiltros .bj-filtro').length > 3 && window.Centro?._dir && !Centro._dir.provisional, { timeout: 40000 });
await espera(1500);
t = await cobros.page.evaluate(() => [...document.querySelectorAll('#cgFiltros .bj-filtro')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
ok(t.some(x => /^Docs por revisar [1-9]d*$/.test(x)), `chip "Docs por revisar" con su número: ${t.filter(x => /Docs|Expediente/.test(x)).join(' · ')}`);
ok(t.some(x => /^Expediente incompleto$/.test(x)), 'chip "Expediente incompleto" sin número hasta abrirlo');
await cobros.page.evaluate(() => Centro.setFiltro('docs_revisar'));
await espera(800);
let filas = await cobros.page.evaluate(() => [...document.querySelectorAll('#cgLista .cg-fila')].map(a => a.innerText.replace(/\n+/g, ' | ')));
// (corridas anteriores pueden haber dejado otra cuenta con documentos por revisar)
const laMia = filas.find(f => f.includes(cli.nombre));
ok(filas.length >= 1 && laMia && /1 por revisar/.test(laMia) && filas.every(f => /\d por revisar/.test(f)),`filtra a las cuentas con documentos por revisar (${filas.length}): ${laMia?.slice(0, 130)}`);
await cobros.captura('11-directorio-por-revisar');
const lecturasAntes = llamadas.length;
await cobros.page.evaluate(() => Centro.setFiltro('docs_faltan'));
await cobros.page.waitForFunction(() => window.Centro._docsVivos && document.querySelectorAll('#cgLista .cg-fila').length > 0, { timeout: 40000 });
await espera(800);
t = await cobros.page.evaluate(() => ({
  n: document.querySelectorAll('#cgLista .cg-fila').length,
  vivos: Centro._docsVivos.size,
  chip: [...document.querySelectorAll('#cgFiltros .bj-filtro')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).find(x => /Expediente incompleto/.test(x)),
  muestra: [...document.querySelectorAll('#cgLista .cg-fila')].slice(0, 3).map(a => a.innerText.replace(/\n+/g, ' | ').slice(0, 120)),
  todasConChip: [...document.querySelectorAll('#cgLista .cg-fila')].every(a => /Faltan? \d de 3|\d por revisar/.test(a.innerText)),
}));
ok(t.n > 0 && t.n <= t.vivos, `"Expediente incompleto": ${t.n} cuentas de ${t.vivos} con contrato vivo — ${t.chip}`);
ok(t.todasConChip, `cada fila dice cómo está su expediente: ${t.muestra[0]}`);
await cobros.captura('12-directorio-incompleto');
ok(llamadas.length === lecturasAntes, 'el filtro no llama a ninguna function');
await cobros.cerrar();

// ── 6. La vendedora: ve qué falta, no abre nada, puede pedir ──
console.log('— 6. La vendedora');
const vend = await abrir({ email: 'karla.ferrer@cecomunica.com' });
await vend.ir(FICHA);
await vend.page.waitForFunction(() => window.Centro?.cliente && document.querySelector('#fContacto dl'), { timeout: 40000 });
await espera(800);
t = await vend.page.evaluate(() => ({
  tab: !document.getElementById('tabDocumentos').classList.contains('hidden'),
  contacto: [...document.querySelectorAll('#fContacto dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.innerText]).find(x => x[0] === 'Documentos')?.[1] || '',
  chips: [...document.querySelectorAll('#cgFiltros .bj-filtro')].map(b => b.innerText).join(' '),
}));
ok(!t.tab, 'no tiene la pestaña Documentos (no puede abrir el expediente)');
ok(/Falta 1 de 3: Cédula del representante · 1 por revisar/.test(t.contacto) && /pedirlos al cliente/.test(t.contacto) && !/ver el expediente/.test(t.contacto),
  `pero ve qué falta y puede pedirlo: "${t.contacto}"`);
await vend.page.evaluate(() => Centro.pedirDocumentos());
await vend.page.waitForSelector('#wdLink', { timeout: 15000 });
ok((await vend.page.$eval('#wdLink', e => e.value)) === enlace, 'le sale el MISMO enlace que ya pidió Cobros (uno por cliente)');
await vend.captura('13-vendedora-enlace');
// Retirar el enlace
await vend.page.evaluate((id) => { Centro._retirarEnlaceDocs(id); }, sid);
await vend.page.waitForFunction(() => [...document.querySelectorAll('.overlay .btn')].some(b => /Retirar/.test(b.textContent)), { timeout: 10000 });
await vend.page.evaluate(() => [...document.querySelectorAll('.overlay .btn')].find(b => /^Retirar$/.test(b.textContent.trim())).click());
await vend.page.waitForFunction(() => (window.__toasts || []).some(x => /Enlace retirado/.test(x)), { timeout: 15000 });
ok((await db.doc(`documentos_solicitudes/${sid}`).get()).data().estado === 'cancelado', 'la vendedora retira el enlace');
await vend.ir('/clientes/centro.html');
await vend.page.waitForFunction(() => document.querySelectorAll('#cgFiltros .bj-filtro').length > 1, { timeout: 40000 });
ok(!/Docs por revisar|Expediente incompleto/.test(await vend.page.evaluate(() => document.getElementById('cgFiltros').innerText)), 'en su directorio no salen los filtros de Cobros');
ok(vend.errores.filter(e => !/favicon|ERR_FAILED|net::/.test(e)).length === 0, `sin errores de consola (${vend.errores.slice(0, 3).join(' ‖ ')})`);
await vend.cerrar();

await cliente.ir(`/documentos/?s=${sid}`);
await cliente.page.waitForSelector('#noValido:not(.hidden)', { timeout: 15000 });
ok(true, 'el enlace retirado ya no sirve');

// ── 7. La página de firma ofrece subir lo que falta ──
console.log('— 7. Enlace de firma');
const fsid = 'prueba-firma-docs-0001';
await db.doc(`firma_solicitudes/${fsid}`).set({
  estado: 'activado', tipo: 'contrato', cliente_id: cli.id, cliente_nombre: cli.nombre, contrato_doc_id: cli.contrato, contrato_id: 'ALQ-PRUEBA',
  created_at: admin.firestore.Timestamp.now(), representante: { nombre: 'Ana Representante', cedula: '8-888-8888' },
  resumen: { equipos: [], cargos: [], total_mensual: 0 },
  firma: { nombre: 'Ana Representante', cedula: '8-888-8888', acepta: true, firmado_at: admin.firestore.Timestamp.now() },
});
await cliente.ir(`/firmar/?s=${fsid}`);
await cliente.page.waitForSelector('#yaFirmado:not(.hidden)', { timeout: 20000 });
await cliente.page.waitForSelector('#yfDocs:not(.hidden)', { timeout: 20000 });
t = await cliente.page.evaluate(() => ({ txt: document.getElementById('yfDocsTxt').innerText, href: document.getElementById('yfDocsLink').getAttribute('href') }));
ok(/falta: Cédula del representante legal\./.test(t.txt), `después de firmar: "${t.txt}"`);
ok(t.href === `/documentos/?f=${fsid}`, `el botón lleva a ${t.href}`);
ok(await cliente.sinDesborde(), 'sin scroll horizontal a 390');
await cliente.captura('14-firma-aviso-documentos', true);
await cliente.page.click('#yfDocsLink');
await cliente.page.waitForSelector('#form:not(.hidden)', { timeout: 20000 });
t = await cliente.page.evaluate(() => [...document.querySelectorAll('#fPedidos .card h3')].map(h => h.innerText.replace(/\s+/g, ' ')));
ok(t.length === 2 && /Cédula/.test(t[0]) && /Recibo.*Recibido/.test(t[1]), `por el enlace de firma pide lo que falta y muestra lo recibido: ${t.join(' · ')}`);
const inp = await cliente.page.$('input[data-archivo="cedula"]');
await inp.uploadFile(fx.foto);
await cliente.page.waitForFunction(() => document.querySelectorAll('#lista-cedula li').length === 1, { timeout: 15000 });
await cliente.page.type('#fNombre', 'Ana Representante');
await cliente.page.click('#btnEnviar');
await cliente.page.waitForSelector('#completo:not(.hidden)', { timeout: 40000 });
ok(true, 'con la cédula ya no falta nada por recibir: "Documentos recibidos"');
await cliente.captura('15-cliente-completo');
const porFirma = (await db.collection(`clientes/${cli.id}/documentos`).where('origen.firma_solicitud', '==', fsid).get()).docs.map(d => d.data());
ok(porFirma.length === 1 && porFirma[0].tipo === 'cedula_representante' && porFirma[0].revision.estado === 'pendiente', 'entró por el enlace de firma, por revisar');
// Con todo recibido, la página de firma ya no molesta
await cliente.ir(`/firmar/?s=${fsid}`);
await cliente.page.waitForSelector('#yaFirmado:not(.hidden)', { timeout: 20000 });
await espera(2500);
ok(await cliente.page.$eval('#yfDocs', e => e.classList.contains('hidden')), 'sin nada que pedir, la página de firma no muestra el aviso');
ok(cliente.errores.filter(e => /PRODUCCIÓN/.test(e)).length === 0, 'nada tocó producción');
await cliente.cerrar();

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
