// Lo que el recorrido anterior no midió:
//  a) "Tomar del estante" (picker FIFO, la vía normal según Alberto) con el
//     contrato de 50 (00d): pasos, tiempo, y si la hoja de verificación
//     obliga a escanear los 50 otra vez.
//  b) "Pegar columna" con 50 seriales: tiempo hasta que todas las casillas
//     tienen chip de validación.
//  c) Ctrl+K con un serial del pool (esperando hasta 8 s).
//  d) "Revisar" de Hoy: ¿abre la ficha aquí?
//  e) Técnico: los botones de la topbar se pintan aunque la pestaña lo
//     rechace. ¿"Recibir equipos" le abre el asistente?
//  f) Teléfono: Asignar de 50 (cuánto mide la página, pie pegajoso).
//   node 07-picker-y-varios.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
import fs from 'node:fs';
const SER50 = JSON.parse(fs.readFileSync(new URL('./seriales-lector-50.json', import.meta.url), 'utf8'));
const CONTRATO = 'PRUEBA-AUDIT-almacen-02';
const log = (...a) => console.log(...a);
const R = (n) => `${String(Math.round(n)).padStart(6)} ms`;
const ultimoModal = (p) => p.evaluate(() => { const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; return m ? m.innerText.replace(/\n{2,}/g, '\n').slice(0, 1500) : '(sin modal)'; });
const clicTextoModal = (p, txt) => p.evaluate((txt) => { const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; if (!m) return false; const b = [...m.querySelectorAll('button')].find(b => b.textContent.trim().includes(txt)); if (b) { b.click(); return true; } return false; }, txt);
const now = (p) => p.evaluate(() => performance.now());

// ── a) Picker con 50 ───────────────────────────────────────────────────
{
  const s = await abrir({ email: USUARIOS.inventario, viewport: 'escritorio', carpeta: 'almacen' });
  const p = s.page;
  log('\n=== a) Tomar del estante · contrato de 50 ===');
  const i1 = await s.ir(`/almacen/index.html?tab=asignar&contrato=${CONTRATO}`, { esperar: 1500 });
  log(`abrir Asignar (50): ${i1.msTotal} ms · ${i1.fsReqs} peticiones · casillas: ` + await p.evaluate(() => document.querySelectorAll('#asBody .serial-input').length));
  log('picklist: ' + (await s.texto('#asPicklist')).replace(/\n/g, ' · '));
  let t = await now(p);
  await p.click('[data-as="tomar"]');
  await p.waitForFunction(() => [...document.querySelectorAll('.modal-backdrop.open')].some(m => m.querySelector('.ep-check')), { timeout: 20000 }).catch(() => {});
  await s.quieto(600, 8000);
  log(`clic Tomar del estante → picker en ${R((await now(p)) - t)} · items: ` + await p.evaluate(() => document.querySelectorAll('.modal-backdrop.open .ep-check').length) + ' · ' + await p.evaluate(() => document.querySelector('.modal-backdrop.open .ep-count')?.innerText));
  log('picker texto: ' + (await ultimoModal(p)).slice(0, 500).replace(/\n/g, ' / '));
  await s.captura('26-inventario-escritorio-asignar-picker-50');
  t = await now(p);
  log('clic Selección automática: ' + await clicTextoModal(p, 'Selección automática'));
  await s.quieto(400, 5000);
  log(`   → ${R((await now(p)) - t)} · ` + await p.evaluate(() => document.querySelector('.modal-backdrop.open .ep-count')?.innerText) + ' · marcados ' + await p.evaluate(() => document.querySelectorAll('.modal-backdrop.open .ep-check:checked').length));
  await s.captura('27-inventario-escritorio-asignar-picker-auto');
  t = await now(p);
  log('clic Asignar seleccionados: ' + await clicTextoModal(p, 'Asignar seleccionados'));
  await p.waitForFunction(() => [...document.querySelectorAll('#asBody .serial-input')].filter(x => x.value.trim()).length >= 50, { timeout: 30000 }).catch(() => {});
  await s.quieto(1500, 20000);
  log(`   casillas llenas en ${R((await now(p)) - t)} · llenas: ` + await p.evaluate(() => [...document.querySelectorAll('#asBody .serial-input')].filter(x => x.value.trim()).length) + ' · chips: ' + await p.evaluate(() => document.querySelectorAll('#asBody .sf-slot .eqpool-chip').length) + ' · progreso: ' + (await s.texto('#asProg')));
  log('consultas tras el picker: ' + (await s.consultas()).slice(-6).join(' · '));
  await s.captura('28-inventario-escritorio-asignar-picker-lleno-50');
  await new Promise(r => setTimeout(r, 3500));
  t = await now(p);
  await p.click('[data-as="listo"]');
  await p.waitForFunction(() => document.querySelectorAll('.modal-backdrop.open').length > 0, { timeout: 25000 }).catch(() => {});
  await s.quieto(800, 10000);
  log(`clic Listo para programar → ${R((await now(p)) - t)}`);
  const txt = await ultimoModal(p);
  log('hoja: ' + txt.slice(0, 700).replace(/\n/g, ' / '));
  log('botón "Lista verificada" deshabilitado: ' + await p.evaluate(() => { const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; const b = [...(m?.querySelectorAll('button') || [])].find(b => /Lista verificada/.test(b.textContent)); return b ? b.disabled : '(no hay botón)'; }));
  log('¿hay forma de omitir / sustituir?: ' + await p.evaluate(() => { const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; return [...(m?.querySelectorAll('button, a, summary') || [])].map(b => b.textContent.trim()).filter(Boolean).join(' | '); }));
  await s.captura('29-inventario-escritorio-asignar-verificar-50');
  // Verificación: escanear 50 (lector) para medir el costo del 2º paso
  const hayVer = await p.evaluate(() => !![...document.querySelectorAll('.modal-backdrop.open')].pop()?.querySelector('[data-ver="input"]'));
  if (hayVer) {
    const seriales = await p.evaluate(() => [...document.querySelectorAll('#asBody .serial-input')].map(x => x.value.trim()).filter(Boolean));
    t = await now(p);
    await p.evaluate(() => [...document.querySelectorAll('.modal-backdrop.open')].pop().querySelector('[data-ver="input"]').focus());
    for (const serial of seriales) await p.keyboard.type(serial + '\n', { delay: 5 });
    await s.quieto(400, 5000);
    log(`2º escaneo de ${seriales.length}: ${R((await now(p)) - t)} · ` + await p.evaluate(() => [...document.querySelectorAll('.modal-backdrop.open')].pop()?.querySelector('[data-ver="faltan"]')?.innerText));
  }
  await p.keyboard.press('Escape'); await s.quieto(400, 3000);
  await p.keyboard.press('Escape'); await s.quieto(400, 3000);
  log('errores: ' + [...new Set(s.errores)].slice(0, 4).join(' | '));

  // ── b) Pegar columna con 50 (recarga: nada se guardó) ────────────────
  log('\n=== b) Pegar columna · 50 ===');
  await s.ir(`/almacen/index.html?tab=asignar&contrato=${CONTRATO}`, { esperar: 1500 });
  log('casillas vacías al recargar: ' + await p.evaluate(() => [...document.querySelectorAll('#asBody .serial-input')].filter(x => !x.value.trim()).length));
  t = await now(p);
  await p.click('#asBody [data-action="toggle-paste"]');
  await s.quieto(300, 3000);
  await p.evaluate((txt) => { const ta = document.querySelector('#asBody .paste-area'); ta.value = txt; ta.dispatchEvent(new Event('input', { bubbles: true })); }, SER50.join('\n'));
  await p.click('#asBody [data-action="apply-paste"]');
  await p.waitForFunction(() => document.querySelectorAll('#asBody .sf-slot .eqpool-chip').length >= 50, { timeout: 60000 }).catch(() => {});
  await s.quieto(1500, 20000);
  log(`pegar 50 → chips en ${R((await now(p)) - t)} · llenas: ` + await p.evaluate(() => [...document.querySelectorAll('#asBody .serial-input')].filter(x => x.value.trim()).length) + ' · chips: ' + await p.evaluate(() => document.querySelectorAll('#asBody .sf-slot .eqpool-chip').length) + ' · ' + (await s.texto('#asProg')));
  const cons = await s.consultas();
  log('consultas findBySerial durante el pegado: ' + cons.filter(x => /findBySerial/.test(x)).length + ' de ' + cons.length + ' · ejemplo: ' + cons.filter(x => /findBySerial/.test(x)).slice(0, 2).join(' · '));
  await s.captura('30b-inventario-escritorio-asignar-pegar-50');

  // ── c) Ctrl+K con serial ─────────────────────────────────────────────
  log('\n=== c) Ctrl+K con serial del pool ===');
  await s.ir('/almacen/index.html');
  await p.keyboard.down('Control'); await p.keyboard.press('k'); await p.keyboard.up('Control');
  await s.quieto(500, 4000);
  await p.keyboard.type('22610A3919', { delay: 10 });
  await p.waitForFunction(() => { const o = document.querySelector('.search-palette-overlay.is-open'); return o && !/Buscando/.test(o.innerText); }, { timeout: 10000 }).catch(() => {});
  await s.quieto(500, 3000);
  log('resultado: ' + (await p.evaluate(() => document.querySelector('.search-palette-overlay.is-open')?.innerText.replace(/\n{2,}/g, '\n').slice(0, 500))).replace(/\n/g, ' / '));
  await s.captura('65-inventario-escritorio-ctrlk-serial-resultado');
  await p.keyboard.press('Escape'); await s.quieto(300, 2000);
  // PoC serial? el placeholder dice "serial PoC"
  await p.keyboard.down('Control'); await p.keyboard.press('k'); await p.keyboard.up('Control'); await s.quieto(400, 3000);
  await p.keyboard.type('AUDALM0001', { delay: 10 });
  await p.waitForFunction(() => { const o = document.querySelector('.search-palette-overlay.is-open'); return o && !/Buscando/.test(o.innerText); }, { timeout: 10000 }).catch(() => {});
  log('resultado (serial solo del pool): ' + (await p.evaluate(() => document.querySelector('.search-palette-overlay.is-open')?.innerText.replace(/\n{2,}/g, '\n').slice(0, 300))).replace(/\n/g, ' / '));
  await p.keyboard.press('Escape'); await s.quieto(300, 2000);

  // ── d) Revisar de Hoy ────────────────────────────────────────────────
  log('\n=== d) Hoy · Revisar ===');
  t = await now(p);
  await p.evaluate(() => document.querySelector('#tab-hoy [data-ficha]')?.click());
  await p.waitForFunction(() => [...document.querySelectorAll('.modal-backdrop.open')].some(m => /Ficha del equipo/.test(m.innerText)), { timeout: 10000 }).catch(() => {});
  await s.quieto(500, 5000);
  log(`Revisar → ${R((await now(p)) - t)} · ` + (await ultimoModal(p)).slice(0, 400).replace(/\n/g, ' / '));
  await s.captura('66-inventario-escritorio-hoy-revisar-ficha');
  await p.keyboard.press('Escape'); await s.quieto(300, 2000);
  await s.cerrar();
}

// ── e) Técnico pulsa "Recibir equipos" ───────────────────────────────
{
  const s = await abrir({ email: USUARIOS.tecnico, viewport: 'escritorio', carpeta: 'almacen' });
  const p = s.page;
  log('\n=== e) técnico · Recibir equipos ===');
  await s.ir('/almacen/index.html', { esperar: 1000 });
  log('cuerpo: ' + (await s.texto('#bodyAlmacen')).slice(0, 120).replace(/\n/g, ' / '));
  await p.evaluate(() => [...document.querySelectorAll('.topbar-actions button, .topbar-actions a')].find(b => /Recibir equipos/.test(b.textContent))?.click());
  await s.quieto(1500, 8000);
  log('tras el clic: ' + (await ultimoModal(p)).slice(0, 300).replace(/\n/g, ' / '));
  await s.captura('67-tecnico-escritorio-almacen-recibir');
  await p.keyboard.press('Escape'); await s.quieto(300, 2000);
  await p.evaluate(() => [...document.querySelectorAll('.topbar-actions button, .topbar-actions a')].find(b => /Registrar venta/.test(b.textContent))?.click());
  await s.quieto(1500, 8000);
  log('Registrar venta: ' + (await ultimoModal(p)).slice(0, 200).replace(/\n/g, ' / '));
  log('errores: ' + [...new Set(s.errores)].slice(0, 4).join(' | '));
  await s.cerrar();
}

// ── f) Teléfono · Asignar de 50 ──────────────────────────────────────
{
  const s = await abrir({ email: USUARIOS.inventario, viewport: 'telefono', carpeta: 'almacen' });
  const p = s.page;
  log('\n=== f) teléfono · Asignar 50 ===');
  const i = await s.ir(`/almacen/index.html?tab=asignar&contrato=${CONTRATO}`, { esperar: 1500 });
  log(`abrir: ${i.msTotal} ms · geometria ${JSON.stringify(await s.geometria())}`);
  log('posición del formulario (px desde arriba): ' + await p.evaluate(() => Math.round(document.querySelector('#asBody')?.getBoundingClientRect().top + window.scrollY)));
  log('pie pegajoso visible sin scroll: ' + await p.evaluate(() => { const b = document.querySelector('[data-as="listo"]'); if (!b) return 'no hay botón'; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
  await s.captura('68-inventario-telefono-asignar-50');
  await p.focus('#asBody .serial-input');
  const t = await now(p);
  for (const serial of SER50.slice(0, 5)) await p.keyboard.type(serial + '\n', { delay: 5 });
  await s.quieto(800, 8000);
  log(`5 escaneos en teléfono: ${R((await now(p)) - t)} · llenas ` + await p.evaluate(() => [...document.querySelectorAll('#asBody .serial-input')].filter(x => x.value.trim()).length) + ' · foco en casilla ' + await p.evaluate(() => [...document.querySelectorAll('#asBody .serial-input')].indexOf(document.activeElement) + 1));
  await s.captura('69-inventario-telefono-asignar-5-escaneados');
  await s.cerrar();
}
