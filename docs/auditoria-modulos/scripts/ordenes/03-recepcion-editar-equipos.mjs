// Recorrido 03 · Recepción: editar equipos de una orden (la acción más frecuente
// del sistema, 631/mes): corregir serial, agregar equipo, quitar equipo.
// Escritorio y tablet. Usa la orden A de 02 (PRUEBA-AUDIT-ordenes).
import { abrir, USUARIOS, esperarUrl, elegirOpcion, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';

const ids = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json', 'utf8'));
const A = ids.A;

for (const vp of ['escritorio', 'tablet']) {
  const s = await abrir({ email: USUARIOS.recepcion, viewport: vp, carpeta: 'ordenes' });
  const info = await s.ir(`/ordenes/index.html?orden=${A}`);
  log(`\n=== ${vp} · orden ${A} · carga ${info.msTotal} ms`);
  let pasos = 0;
  // 1. Expandir la fila
  await medir(s, 'expandir fila', async () => { await s.page.click(`tr[data-orden-id="${A}"][data-orden-row]`); pasos++; });
  const eq = await s.page.$$eval(`tr.filaDetalle[data-orden-id="${A}"] tr.equipo-row`, trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').slice(0, 120)));
  log('  equipos visibles:', JSON.stringify(eq));
  await s.captura(`03-recepcion-${vp}-fila-expandida`);
  // Geometría de los controles del detalle (lápiz, basura)
  const geo = await s.page.$$eval(`tr.filaDetalle[data-orden-id="${A}"] button, tr.filaDetalle[data-orden-id="${A}"] [role=button]`, bs => {
    const r = bs.filter(b => b.offsetParent).map(b => { const x = b.getBoundingClientRect(); return { t: (b.title || b.innerText || b.className).trim().slice(0, 30), w: Math.round(x.width), h: Math.round(x.height), op: getComputedStyle(b).opacity }; });
    return { n: r.length, chicos: r.filter(x => x.w < 36 || x.h < 36).length, muestra: r.slice(0, 8) };
  });
  log('  controles del detalle:', JSON.stringify(geo));
  if (vp === 'tablet') { await s.cerrar(); continue; }

  // 2. Corregir el serial del segundo equipo (lápiz → Modal.prompt)
  const lapices = await s.page.$$eval(`tr.filaDetalle[data-orden-id="${A}"] .lapiz[data-campo="numero_de_serie"]`, ls => ls.map(l => ({ v: l.dataset.valor, vis: !!l.offsetParent, op: getComputedStyle(l).opacity, w: l.getBoundingClientRect().width })));
  log('  lápices de serial:', JSON.stringify(lapices));
  await medir(s, 'abrir editor de serial', async () => {
    await s.page.evaluate((A) => document.querySelectorAll(`tr.filaDetalle[data-orden-id="${A}"] .lapiz[data-campo="numero_de_serie"]`)[1].click(), A); pasos++;
  });
  log('  modal:', JSON.stringify(await modalAbierto(s)));
  await s.captura('03-recepcion-escritorio-editar-serial-prompt');
  const inputSel = '.overlay:not(.hidden) input:not([type=hidden]), .overlay:not(.hidden) textarea, .modal-backdrop.open input, .modal-backdrop.open textarea';
  await s.page.click(inputSel, { clickCount: 3 }); await s.page.keyboard.type('AUDIT-A-0002C'); pasos++;
  await s.quieto(700, 5000);
  const chipSerial = await s.page.evaluate(() => ([...document.querySelectorAll('.overlay:not(.hidden), .modal-backdrop.open')].map(o => o.innerText).join(' ') || '').replace(/\s+/g, ' '));
  log('  texto del prompt con SerialField:', chipSerial.slice(0, 300));
  await medir(s, 'Enter para guardar serial', async () => { await s.page.keyboard.press('Enter'); pasos++; });
  log('  toasts:', JSON.stringify(await s.toasts()));
  const eq2 = await s.page.$$eval(`tr.filaDetalle[data-orden-id="${A}"] tr.equipo-row`, trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').slice(0, 60)));
  log('  equipos tras corregir:', JSON.stringify(eq2), `| ${pasos} interacciones (expandir + lápiz + teclear + Enter)`);
  await s.captura('03-recepcion-escritorio-tras-corregir-serial');

  // 3. Agregar un equipo (botón + → nuevo-batch)
  let pasosAdd = 0;
  const t0 = Date.now();
  await s.page.click(`[data-action="nuevo-batch"][data-orden-id="${A}"]`); pasosAdd++;
  const u = await esperarUrl(s, /nuevo-batch\.html\?orden_id=/);
  log(`  → agregar: ${u} en ${Date.now() - t0} ms`);
  const filas = await s.page.$$eval('#filasBatch tr', t => t.length);
  log('  filas al abrir (¿trae los existentes?):', filas, '| resumen cabecera:', (await s.texto('.app-wrap')).replace(/\s+/g, ' ').slice(0, 200));
  await s.page.click('#filasBatch tr:last-child .serie'); pasosAdd++;
  await s.page.keyboard.type('AUDIT-A-0003'); pasosAdd++;
  await elegirOpcion(s, '#filasBatch tr:last-child .modelo', 'NX-'); pasosAdd++;
  const t1 = Date.now();
  await s.page.click('#btnGuardar'); pasosAdd++;
  const u2 = await esperarUrl(s, /index\.html\?orden=/);
  log(`  → guardado, ${u2} en ${Date.now() - t1} ms | ${pasosAdd} interacciones + 2 cargas de página`);
  // 4. Quitar el equipo agregado
  let pasosDel = 0;
  await medir(s, 'expandir fila', async () => { await s.page.click(`tr[data-orden-id="${A}"][data-orden-row]`); pasosDel++; });
  const n3 = await s.page.$$eval(`tr.filaDetalle[data-orden-id="${A}"] tr.equipo-row`, trs => trs.length);
  await medir(s, 'clic basura', async () => {
    await s.page.evaluate((A) => { const b = [...document.querySelectorAll(`tr.filaDetalle[data-orden-id="${A}"] [data-action="eliminar-equipo"]`)].pop(); b.click(); }, A); pasosDel++;
  });
  log('  confirm:', JSON.stringify(await modalAbierto(s)));
  await s.captura('03-recepcion-escritorio-eliminar-equipo-confirm');
  await medir(s, 'confirmar eliminar', async () => { await s.page.evaluate(() => { const b = [...document.querySelectorAll('.overlay:not(.hidden) button, .modal-backdrop.open button')].find(x => /Eliminar|Confirmar|Sí|Aceptar/i.test(x.textContent)); b.click(); }); pasosDel++; });
  const n4 = await s.page.$$eval(`tr.filaDetalle[data-orden-id="${A}"] tr.equipo-row`, trs => trs.length);
  log(`  equipos ${n3} -> ${n4} | ${pasosDel} interacciones | toasts:`, JSON.stringify((await s.toasts()).slice(-2)));
  // ¿Se puede deshacer? ¿queda rastro?
  const rastro = await s.page.evaluate((A) => { const o = (APP.state.orders || []).find(x => x.ordenId === A); return (o?.equipos || []).map(e => ({ s: e.serial || e.numero_de_serie, elim: !!e.eliminado })); }, A);
  log('  equipos[] en memoria (eliminado = soft):', JSON.stringify(rastro));
  log('  errores:', s.errores.slice(0, 5));
  await s.cerrar();
}
