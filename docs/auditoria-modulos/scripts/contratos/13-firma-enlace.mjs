// Auditoría CONTRATOS · Paso D: firma por ENLACE. La vendedora genera el
// enlace desde el Centro (escritorio) y el cliente lo abre en el teléfono
// (/firmar/?s=), lee, se identifica, firma. Storage y callables están
// bloqueados (no emulados): la subida de la cédula/selfie falla a propósito
// y la firma se termina de registrar con 02-simular-trigger.js.
// Uso: node 13-firma-enlace.mjs
import { abrir, USUARIOS, blindar, contador, clicTexto, leerEstado, guardarEstado, espera, firmarCanvas, pngPrueba, texto } from './_lib.mjs';
const { clienteId, contratoId, contratoNum } = leerEstado();
const TMP = 'C:/Users/ayohr/AppData/Local/Temp/claude/c--Projects-cecomunica-service-orders/60b5518e-dd51-4291-ac4d-c4f75cea0c5b/scratchpad';

// ── Vendedora: enviar para firma ──
let s = await blindar(await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'contratos' }));
const k = contador('vendedora envía a firma');
let sid = null;
try {
  const home = await s.ir('/index.html');
  const firv = await s.page.evaluate(() => document.querySelector('[data-signal-val="FIRV"]')?.textContent?.trim());
  console.log('home vendedora · FIRV =', firv, home.msTotal, 'ms');
  await s.page.click('[data-signal="FIRV"]').catch(() => {}); await s.quieto(1500);
  await s.captura('30-vendedor-escritorio-home-mis-contratos-por-firmar');
  console.log('panel FIRV:', (await texto(s, '.bj-panel')).replace(/\n/g, ' | ').slice(0, 400));
  k.paso('home: clic en "Mis contratos por firmar" y en "Pedir firma" de la fila', 2);

  await s.ir(`/clientes/centro.html?id=${encodeURIComponent(clienteId)}&contrato=${encodeURIComponent(contratoId)}`);
  await s.page.evaluate(() => window.Centro?.abrirBloque?.('blkGestiones')); await s.quieto(600);
  await s.page.evaluate((id) => window.Centro.abrirGestion('ct-' + id), contratoId); await s.quieto(1000);
  await s.captura('31-vendedor-escritorio-tramite-esperando-firma', { full: true });
  console.log('Ahora:', (await texto(s, '#fAhora')).replace(/\n/g, ' | ').slice(0, 300));
  // Si ya había un enlace (corrida anterior), se retira por la UI: es el camino
  // de "me equivoqué / hay que editar" y vale medirlo aparte.
  const conEnlace = await s.page.evaluate((id) => (window.Centro?.contratos || []).find(c => c.id === id)?.firma_solicitud_estado === 'pendiente', contratoId);
  if (conEnlace) {
    await s.page.evaluate((id) => document.querySelector(`#grow-ct-${id} .cg-masbtn`)?.click(), contratoId); await s.quieto(500);
    console.log('menú ⋯ con enlace abierto:', (await texto(s, '.cg-menu:not(.hidden)')).replace(/\n/g, ' | ').slice(0, 600));
    await clicTexto(s, 'Retirar el enlace de firma', { dentro: '.cg-menu:not(.hidden)' });
    await s.captura('31b-vendedor-escritorio-retirar-enlace-confirmar');
    await clicTexto(s, 'Retirar enlace', { tag: 'button' }); await s.quieto(1500);
    console.log('retirar enlace → toasts:', JSON.stringify((await s.toasts()).slice(-1)), '(3 interacciones: ⋯, Retirar, confirmar)');
    await s.page.evaluate(() => window.Centro?.abrirBloque?.('blkGestiones')); await s.quieto(400);
  }
  const t0 = Date.now();
  await clicTexto(s, 'Enviar para firma', { dentro: '#fAhora', esperar: 1500 }); k.paso('clic "Enviar para firma" (Ahora)');
  await s.page.waitForSelector('#wfLink', { timeout: 8000 }).catch(() => {});
  console.log('enlace generado en', Date.now() - t0, 'ms · toasts:', JSON.stringify((await s.toasts()).slice(-2)));
  await s.captura('32-vendedor-escritorio-modal-enviar-para-firma');
  console.log('modal:', (await texto(s, '#cgModal')).replace(/\n/g, ' | ').slice(0, 700));
  const url = await s.page.evaluate(() => document.getElementById('wfLink')?.value);
  sid = url ? new URL(url).searchParams.get('s') : null;
  console.log('enlace:', url, '· sid', sid);
  k.paso('clic "Copiar" (y pegar en WhatsApp) — o teclear correo + "Enviar correo"', 1);
  guardarEstado({ sid, urlFirma: url });
  console.log('\n' + k.tabla());
  console.log('errores:', s.errores.filter(e => !/favicon|lucide/i.test(e)).slice(0, 6));
} finally { await s.cerrar(); }
if (!sid) throw new Error('sin enlace de firma');

// ── Cliente: firma en el teléfono (página pública) ──
s = await blindar(await abrir({ email: USUARIOS.recepcion, viewport: 'telefono', carpeta: 'contratos' }));
const kc = contador('cliente firma en el celular');
try {
  const r = await s.ir(`/firmar/?s=${sid}`, { esperar: 1500 });
  console.log('/firmar/', r.msTotal, 'ms');
  await s.captura('33-cliente-telefono-firmar-arriba');
  await s.captura('34-cliente-telefono-firmar-pagina-completa', { full: true });
  const g = await s.geometria(); console.log('geometría /firmar/:', g);
  // Estado inicial: aceptación deshabilitada hasta abrir el contrato.
  const acepta0 = await s.page.evaluate(() => document.getElementById('fAcepta')?.disabled);
  console.log('acepta deshabilitado antes de leer:', acepta0);
  // 1) Abrir "Leer el contrato completo"
  await s.page.click('#fDocDet summary'); await s.quieto(600); kc.paso('abrir "Leer el contrato completo"');
  await s.captura('35-cliente-telefono-contrato-completo-anexo', { full: true });
  const doc = await texto(s, '#fDocumento'); console.log('documento (recorte):', doc.replace(/\n/g, ' | ').slice(0, 600));
  console.log('¿Anexo A con seriales?', /Anexo A[\s\S]*?\d+\s+[A-Z0-9]{6,}/.test(doc), '· longitud', doc.length);
  await s.page.click('#fDocDet summary'); await s.quieto(300);
  // 2) Quién firma: nombre y cédula ya vienen prellenados (representante).
  const pre = await s.page.evaluate(() => ({ nombre: document.getElementById('fNombre').value, cedula: document.getElementById('fCedula').value, tipo: document.getElementById('fDocTipo').value, cargo: document.getElementById('fCargo').value }));
  console.log('prellenado:', pre);
  // ¿Y si firma otra persona? aparece la tarjeta del documento de autorización.
  await s.page.evaluate(() => { const n = document.getElementById('fNombre'); n.value = 'JUAN OTRO FIRMANTE'; n.dispatchEvent(new Event('input', { bubbles: true })); const c = document.getElementById('fCedula'); c.value = '8-111-1111'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  await s.quieto(400);
  const autVisible = await s.page.evaluate(() => !document.getElementById('fAutCard').classList.contains('hidden'));
  console.log('firmante distinto → pide autorización:', autVisible);
  await s.captura('36-cliente-telefono-firmante-distinto-pide-autorizacion', { el: '#fAutCard' });
  await s.page.evaluate((p) => { const n = document.getElementById('fNombre'); n.value = p.nombre; n.dispatchEvent(new Event('input', { bubbles: true })); const c = document.getElementById('fCedula'); c.value = p.cedula; c.dispatchEvent(new Event('input', { bubbles: true })); }, pre);
  await s.quieto(300);
  // 3) Fotos: cédula y selfie (2 tomas).
  const png = pngPrueba(TMP, 'foto-prueba.png');
  await (await s.page.$('#fCedFoto')).uploadFile(png); await espera(500); kc.paso('tomar foto de la cédula');
  await (await s.page.$('#fSelfieFoto')).uploadFile(png); await espera(500); kc.paso('tomar selfie');
  await s.page.click('#fConsentBio'); kc.paso('marcar consentimiento (Ley 81)');
  // 4) Firma y aceptación.
  await firmarCanvas(s, '#firmaCanvas'); kc.paso('dibujar la firma');
  await s.page.click('#fAcepta'); kc.paso('marcar "Declaro que he leído…"');
  await s.captura('37-cliente-telefono-listo-para-firmar', { full: true });
  // 5) Firmar: la subida a Storage está bloqueada (no emulado) → error visible.
  await s.page.click('#btnFirmar'); await s.quieto(1500); kc.paso('clic "Firmar el contrato"');
  const msg = await texto(s, '#fMsg'); console.log('mensaje tras firmar (Storage bloqueado a propósito):', msg);
  console.log('bloqueadas (prod):', await s.bloqueadas());
  await s.captura('38-cliente-telefono-error-subida');
  // Validaciones: ¿qué pasa si me equivoco? (sin foto, sin leer)
  console.log('\n' + kc.tabla());
  console.log('errores:', s.errores.filter(e => !/favicon|lucide|AUDITOR/i.test(e)).slice(0, 6));
} finally { await s.cerrar(); }
