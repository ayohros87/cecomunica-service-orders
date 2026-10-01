// Recorrido 09 · Bandeja: chips, búsqueda, presets, avanzado, densidad, truncados.
// Solo lectura. Jefa de taller en escritorio (es quien más filtra según los audit logs).
import { abrir, USUARIOS, medir, log, tipear } from './lib-ordenes.mjs';

const s = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
const info = await s.ir('/ordenes/index.html');
log('carga:', JSON.stringify(info));
await s.captura('09-jefe-escritorio-bandeja');

// Truncados: ancho de columna vs ancho del texto en las primeras filas
const trunc = await s.page.evaluate(() => {
  const out = [];
  const filas = [...document.querySelectorAll('tr[data-orden-row]')].slice(0, 12);
  for (const tr of filas) {
    for (const td of tr.querySelectorAll('td')) {
      const el = td.querySelector('a, .chip-estado, .tipo-chip, span') || td;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) out.push({ col: td.cellIndex, txt: (el.innerText || '').trim().slice(0, 24), sw: el.scrollWidth, cw: el.clientWidth });
    }
  }
  const th = [...document.querySelectorAll('#ordersTable thead th')].map(t => ({ t: t.innerText.trim(), w: Math.round(t.getBoundingClientRect().width) }));
  return { th, cortados: out.slice(0, 20), n: out.length };
});
log('columnas:', JSON.stringify(trunc.th));
log(`celdas con texto cortado en 12 filas: ${trunc.n}`, JSON.stringify(trunc.cortados));
// ¿El número se monta sobre el cliente?
const solape = await s.page.evaluate(() => {
  const tr = document.querySelector('tr[data-orden-row]');
  const a = tr.querySelector('td:nth-child(2) a, td:nth-child(2)'); const b = tr.querySelector('td:nth-child(3)');
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  return { numero: a.innerText.trim(), anchoTexto: a.scrollWidth, anchoCelda: Math.round(ra.width), finNumero: Math.round(ra.right), inicioCliente: Math.round(rb.left), overflow: getComputedStyle(a).overflow };
});
log('solape número/cliente:', JSON.stringify(solape));
// Opacidad de los botones de acción en reposo
const op = await s.page.$$eval('tr[data-orden-row] .btn-flujo, tr[data-orden-row] .overflow-menu-btn', bs => { const o = bs.slice(0, 6).map(b => ({ t: b.innerText.trim().slice(0, 12), op: getComputedStyle(b).opacity, h: Math.round(b.getBoundingClientRect().height) })); return o; });
log('acciones (opacidad, alto):', JSON.stringify(op));

// Chips: tiempo y conteo
for (const chip of ['por_asignar', 'ASIGNADO', 'COMPLETADO (EN OFICINA)']) {
  const ms = await medir(s, `chip ${chip}`, async () => { await s.page.evaluate((c) => document.querySelector(`.estado-chips-bar [data-estado="${c}"], .estado-chips-bar [data-value="${c}"]`)?.click(), chip); });
  const r = await s.page.evaluate(() => ({ filas: document.querySelectorAll('tr[data-orden-row]').length, total: document.getElementById('resumenOrdenes')?.innerText, cargarMas: !!document.getElementById('btnCargarMas')?.offsetParent, url: location.search }));
  log('  →', JSON.stringify(r));
}
await s.captura('09-jefe-escritorio-chip-listos');
// Chip Cerradas (menú)
await s.page.evaluate(() => document.querySelector('.estado-chips-bar [data-estado="cerradas"], .estado-chips-bar .estado-chip--cerradas, .estado-chips-bar [data-menu]')?.click());
await s.quieto(600, 4000);
await s.captura('09-jefe-escritorio-chip-cerradas-menu');
log('chips markup:', await s.page.evaluate(() => [...document.querySelectorAll('.estado-chips-bar button, .estado-chips-bar [role=button]')].map(b => `${b.dataset.estado || b.dataset.value || b.dataset.action || ''}:${b.innerText.replace(/\s+/g, ' ').trim()}`).join(' | ')));
await s.page.keyboard.press('Escape');

// Búsquedas
await s.page.evaluate(() => document.querySelector('.estado-chips-bar [data-estado=""], .estado-chips-bar [data-estado="todas"], .estado-chips-bar button')?.click());
await s.quieto(600, 4000);
for (const q of ['COLON', 'colon container', 'AUDIT-A', '2026093006', '20260808', 'MACEL']) {
  await tipear(s, '#filtroRapido', q);
  const ms = await medir(s, `buscar "${q}"`, async () => { await s.page.keyboard.press('Enter'); });
  const r = await s.page.evaluate(() => ({ filas: document.querySelectorAll('tr[data-orden-row]').length, total: document.getElementById('resumenOrdenes')?.innerText, vacio: document.querySelector('.empty-state')?.innerText?.replace(/\s+/g, ' ').slice(0, 120) }));
  log('  →', JSON.stringify(r));
}
await s.captura('09-jefe-escritorio-busqueda');
// ¿Un chip borra la búsqueda? (auditoría anterior)
await tipear(s, '#filtroRapido', 'COLON'); await s.page.keyboard.press('Enter'); await s.quieto(800, 5000);
await s.page.evaluate(() => document.querySelector('.estado-chips-bar [data-estado="ASIGNADO"]')?.click()); await s.quieto(800, 5000);
log('chip tras búsqueda: filtroRapido =', JSON.stringify(await s.page.$eval('#filtroRapido', i => i.value)), '| filas', await s.page.$$eval('tr[data-orden-row]', t => t.length), '| resumen', await s.texto('#resumenOrdenes'));
await s.page.click('#filtroRapido', { clickCount: 3 }); await s.page.keyboard.press('Backspace');
// Presets
await s.page.click('#presetsMenuWrap button, #presetsMenuWrap'); await s.quieto(500, 3000);
log('presets menú:', (await s.texto('#presetsMenu')).replace(/\n/g, ' | '));
await s.captura('09-jefe-escritorio-presets');
await s.page.keyboard.press('Escape');
// Avanzado
await s.page.click('#btnToggleAvanzados'); await s.quieto(500, 3000);
await s.captura('09-jefe-escritorio-avanzado');
log('avanzado:', (await s.texto('#filtrosAvanzados')).replace(/\n/g, ' | ').slice(0, 300));
// Vista de tarjetas en escritorio
await s.page.evaluate(() => [...document.querySelectorAll('button')].find(b => /Vista de tarjetas/.test(b.title || b.getAttribute('aria-label') || ''))?.click()); await s.quieto(800, 5000);
await s.captura('09-jefe-escritorio-vista-tarjetas');
// Mis órdenes (jefe también trabaja como técnico)
log('toggle Mis órdenes visible:', await s.page.$eval('#toggleMisOrdenes', t => !!t.offsetParent).catch(() => false));
log('errores:', s.errores.slice(0, 6));
log('consultas de búsqueda:', (await s.consultas()).filter(c => /search|filterBy|buscar/i.test(c)).join(' ; '));
await s.cerrar();
