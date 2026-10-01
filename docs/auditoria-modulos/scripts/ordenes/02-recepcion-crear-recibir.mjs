// Recorrido 02 · Recepción (escritorio): crear 2 órdenes REPARACIÓN (A con 2 equipos,
// B con 1) y recibirlas en mostrador (A con firma en canvas, B sin firma + motivo).
// Escribe SOLO en el emulador. Prefijo PRUEBA-AUDIT-ordenes.
import { abrir, USUARIOS, PREFIJO, stubStorage, esperarUrl, firmarCanvas, elegirOpcion, tipear, medir, log } from './lib-ordenes.mjs';
import fs from 'node:fs';

const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ordenes' });
const creadas = [];

async function crearOrden({ cliente, obs, seriales, recibirDirecto }) {
  let pasos = 0;
  const info = await s.ir('/ordenes/nueva-orden.html');
  log('nueva-orden:', JSON.stringify(info));
  if (!creadas.length) await s.captura('02-recepcion-escritorio-nueva-orden-vacia');
  await tipear(s, '#clienteFiltro', cliente); pasos++;
  await s.quieto(600, 5000);
  const c = await elegirOpcion(s, '#cliente', cliente); pasos++;
  log('  cliente:', c);
  const t = await elegirOpcion(s, '#tipo', 'REPARACI'); pasos++;
  log('  tipo:', t);
  await s.quieto(600, 5000);
  const vend = await s.page.$eval('#vendedor', el => ({ v: el.value, txt: el.selectedOptions[0]?.textContent, hint: document.getElementById('vendedorHint')?.textContent }));
  log('  vendedor auto:', JSON.stringify(vend));
  await tipear(s, '#observaciones', obs); pasos++;
  if (!creadas.length) await s.captura('02-recepcion-escritorio-nueva-orden-llena');
  const t0 = Date.now();
  await s.page.click('#ordenForm button[type=submit]'); pasos++;
  const url = await esperarUrl(s, /nuevo-batch\.html\?orden_id=/);
  const ordenId = new URL('http://x' + url).searchParams.get('orden_id');
  log(`  → orden ${ordenId} creada; aterrizó en ${url} en ${Date.now() - t0} ms; toasts:`, JSON.stringify(await s.toasts()));
  creadas.push(ordenId);
  if (creadas.length === 1) await s.captura('02-recepcion-escritorio-lote-vacio');
  const filas0 = await s.page.$$eval('#filasBatch tr', t => t.length);
  await s.page.click('#filasBatch tr:first-child .serie'); pasos++;
  await s.page.keyboard.type(seriales[0]); pasos++;
  await s.page.keyboard.press('Enter');
  await s.quieto(500, 3000);
  const filas1 = await s.page.$$eval('#filasBatch tr', t => t.length);
  const activo = await s.page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
  log(`  Enter en serial: filas ${filas0} -> ${filas1}; foco queda en: ${activo}`);
  await s.page.keyboard.press('Tab');
  const activo2 = await s.page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
  log(`  Tab tras serial: foco en ${activo2}`);
  const m1 = await elegirOpcion(s, '#filasBatch tr:nth-child(1) .modelo', 'NX-'); pasos++;
  log('  modelo fila 1:', m1);
  for (let i = 1; i < seriales.length; i++) {
    await s.page.evaluate(() => [...document.querySelectorAll('button')].find(b => /Agregar fila/.test(b.textContent)).click()); pasos++;
    await s.page.keyboard.type(seriales[i]); pasos++;
    await elegirOpcion(s, `#filasBatch tr:nth-child(${i + 1}) .modelo`, 'NX-'); pasos++;
  }
  await s.quieto(800, 5000);
  const chips = await s.page.$$eval('#filasBatch .rowdot, #filasBatch [class*=serial-chip], #filasBatch [class*=sf-]', els => els.map(e => (e.title || e.textContent || '').trim()).filter(Boolean));
  log('  chips de serial:', JSON.stringify(chips).slice(0, 300));
  if (creadas.length === 1) await s.captura('02-recepcion-escritorio-lote-2-equipos');
  const btnRecibir = await s.page.$eval('#btnGuardarRecibir', b => ({ hidden: b.hidden, display: getComputedStyle(b).display, txt: b.textContent.trim() }));
  log('  btnGuardarRecibir:', JSON.stringify(btnRecibir));
  const t1 = Date.now();
  if (recibirDirecto && !btnRecibir.hidden) { await s.page.click('#btnGuardarRecibir'); pasos++; }
  else { await s.page.click('#btnGuardar'); pasos++; }
  const url2 = await esperarUrl(s, /index\.html\?orden=/);
  log(`  → guardado, aterrizó en ${url2} en ${Date.now() - t1} ms; toasts:`, JSON.stringify(await s.toasts()));
  return { ordenId, pasos };
}

const A = await crearOrden({ cliente: 'COLON CONTAINER', obs: `${PREFIJO} A - dos radios, no encienden`, seriales: ['AUDIT-A-0001', 'AUDIT-A-0002'], recibirDirecto: true });
log(`ORDEN A ${A.ordenId}: ${A.pasos} interacciones hasta guardar equipos`);
await s.captura('02-recepcion-escritorio-aterrizaje-con-recibir');
let abierto = await s.page.$eval('#modalEntrega', el => !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none').catch(() => false);
log('  modal recepción abierto solo:', abierto, '| título:', await s.texto('#modalEntregaTitle').catch(() => ''));
if (!abierto) { await s.page.click(`tr[data-orden-id="${A.ordenId}"] [data-action="recibir-mostrador"]`); await s.quieto(); }
await s.captura('02-recepcion-escritorio-modal-recepcion');
log('  texto modal:', (await s.texto('#modalEntrega')).replace(/\n+/g, ' | ').slice(0, 900));
let pasosRec = 0;
await tipear(s, '#entregaReceptorNombre', 'Juan Cliente (prueba)'); pasosRec++;
await firmarCanvas(s, '#entregaFirmaCanvas'); pasosRec++;
log('  stub storage:', await stubStorage(s));
await medir(s, 'confirmar recepción A', async () => { await s.page.click('#btnConfirmarEntrega'); pasosRec++; });
log('  toasts:', JSON.stringify(await s.toasts()), '| errores:', s.errores.slice(0, 5));
await s.captura('02-recepcion-escritorio-tras-recibir');
const estadoA = await s.page.$eval(`tr[data-orden-id="${A.ordenId}"]`, tr => tr.innerText.replace(/\n/g, ' | ')).catch(e => 'fila no visible: ' + e.message);
log('  fila A ahora:', estadoA, `| ${pasosRec} interacciones en el acuse`);

const B = await crearOrden({ cliente: 'MACELLO', obs: `${PREFIJO} B - un radio, sin audio`, seriales: ['AUDIT-B-0001'], recibirDirecto: true });
log(`ORDEN B ${B.ordenId}: ${B.pasos} interacciones hasta guardar equipos`);
abierto = await s.page.$eval('#modalEntrega', el => !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none').catch(() => false);
if (!abierto) { await s.page.click(`tr[data-orden-id="${B.ordenId}"] [data-action="recibir-mostrador"]`); await s.quieto(); }
await tipear(s, '#entregaReceptorNombre', 'Mensajero de MACELLO (prueba)');
await s.page.click('#entregaRecepcionSinFirma');
await s.quieto(400, 3000);
await s.captura('02-recepcion-escritorio-modal-recepcion-sin-firma');
await tipear(s, '#entregaRecepcionSinFirmaMotivo', 'Lo trajo el mensajero, el cliente no vino (prueba)');
await medir(s, 'confirmar recepción B sin firma', async () => { await s.page.click('#btnConfirmarEntrega'); });
log('  toasts:', JSON.stringify(await s.toasts()), '| errores:', s.errores.slice(0, 5));
const estadoB = await s.page.$eval(`tr[data-orden-id="${B.ordenId}"]`, tr => tr.innerText.replace(/\n/g, ' | ')).catch(e => 'fila no visible: ' + e.message);
log('  fila B ahora:', estadoB);
log('CONSULTAS últimas:', (await s.consultas()).slice(-12).join(' ; '));
fs.writeFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', JSON.stringify({ A: A.ordenId, B: B.ordenId }, null, 2));
await s.cerrar();
