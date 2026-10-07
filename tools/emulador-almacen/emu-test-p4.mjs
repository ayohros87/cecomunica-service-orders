// P4 del plan de autoservicio (2026-10-07): chip "sin modelo / modelo sin
// verificar" en la fila del equipo (R3), "Registrar como reemplazo…" en el ⋯
// de la orden (E1) y "Completar modelo" en la fila (sin modelo) de
// Existencias (D1). Solo se abre: los callables NO se llaman (irían a
// producción); se prueban en test-emulator/p4-modelo-reemplazo.js.
//   node emu-test-p4.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// ── R3 + E1 en Órdenes (recepción) ──
const rec = await abrir({ email: USUARIOS.recepcion, carpeta: 'p4' });
await rec.ir('/ordenes/index.html', { esperar: 2500 });
const caso = await rec.page.evaluate(async () => {
  const db = firebase.firestore();
  // Una ficha sin modelo con cliente, y una orden abierta que la liste.
  const s = await db.collection('equipos_pool').where('modelo_id', '==', null).where('estado', '==', 'en_cliente').limit(40).get();
  for (const d of s.docs) {
    const u = d.data(); if (u.modelo_label) continue;
    const sn = String(u.serial_norm || d.id).toLowerCase();
    const q = await db.collection('ordenes_de_servicio').where('searchTokens', 'array-contains', sn).limit(5).get();
    const o = q.docs.map(x => ({ id: x.id, ...x.data() })).find(x => x.eliminado !== true && !/^(ENTREGAD|CERRADA|ANULADA)/.test(x.estado_reparacion || ''));
    if (o) return { serial: u.serial || d.id, ordenId: o.id, n: (o.equipos || []).length };
  }
  // Si no hay abierta, una PROGRAMACIÓN entregada con ≥2 radios y sin gestión.
  const p = await db.collection('ordenes_de_servicio').where('estado_reparacion', '==', 'ENTREGADO AL CLIENTE').orderBy('fecha_creacion', 'desc').limit(60).get();
  const o2 = p.docs.map(x => ({ id: x.id, ...x.data() })).find(x => !x.gestion?.id && x.cliente_id && /PROGRAMAC/i.test(x.tipo_de_servicio || '') && (x.equipos || []).filter(e => e && (e.numero_de_serie || e.serial)).length >= 2);
  return o2 ? { serial: null, ordenId: o2.id, n: (o2.equipos || []).length } : null;
});
console.log('    caso:', JSON.stringify(caso));
if (!caso) ok(false, 'no hay orden para probar');
else {
  await rec.ir(`/ordenes/index.html?ids=${caso.ordenId}`, { esperar: 3000 });
  await espera(1500);
  // Expandir la fila (equipos) si hace falta: el decorador corre al pintar la tabla.
  await rec.page.evaluate((id) => { const tr = document.querySelector(`tr[data-orden-id="${id}"], [data-orden-id="${id}"].orden-row, .orden-row`); tr?.click?.(); }, caso.ordenId);
  await espera(2500);
  const chips = await rec.page.evaluate(() => [...document.querySelectorAll('.eqpool-chip-aviso')].map(c => c.textContent.trim()));
  if (caso.serial) ok(chips.some(t => /sin modelo|modelo sin verificar/.test(t)), 'R3: chip del modelo flojo en la fila: ' + JSON.stringify(chips).slice(0, 200));
  else console.log('    (sin ficha sin modelo en una orden abierta; R3 no se evalúa)');
  const item = await rec.page.evaluate((id) => {
    document.querySelector(`.overflow-menu-btn[data-orden-id="${id}"]`)?.click();
    return !!document.querySelector(`#overflow-menu-${id} [data-action="regularizar-reemplazo"]`);
  }, caso.ordenId);
  ok(item, 'E1: el ⋯ de la orden trae "Registrar como reemplazo…"');
  await rec.page.evaluate((id) => document.querySelector(`#overflow-menu-${id} [data-action="regularizar-reemplazo"]`)?.click(), caso.ordenId);
  await rec.page.waitForSelector('#rrSal', { timeout: 15000 });
  const sel = await rec.page.evaluate(() => ({ sal: document.querySelectorAll('#rrSal option').length, ent: document.querySelectorAll('#rrEnt option').length, distintos: document.getElementById('rrSal').value !== document.getElementById('rrEnt').value }));
  ok(sel.sal >= 2 && sel.ent >= 2 && sel.distintos, 'E1: la hoja lista los radios de la orden con saliente ≠ entrante: ' + JSON.stringify(sel));
  await rec.captura('01-registrar-reemplazo');
  // Sin motivo no llama al servidor.
  await rec.page.evaluate(() => document.querySelector('[data-sheet-action="registrar"]').click());
  await espera(500);
  const aviso = await rec.page.evaluate(() => document.getElementById('rrAviso')?.textContent || '');
  ok(/mínimo 10/.test(aviso), 'E1: sin motivo se frena en la hoja');
  await rec.page.evaluate(() => document.querySelector('[data-sheet-action="cerrar"]')?.click());
  ok(!rec.errores.some(e => /PRODUCCIÓN/.test(e)), 'ninguna llamada a producción');
  ok(!rec.errores.length, 'Órdenes sin errores de página: ' + rec.errores.join(' | '));
}
await rec.cerrar();

// ── D1 en Existencias (bodega) ──
const bod = await abrir({ email: USUARIOS.inventario, carpeta: 'p4' });
await bod.ir('/almacen/index.html?tab=existencias', { esperar: 3500 });
await espera(2000);
const fila = await bod.page.evaluate(() => {
  const f = (AlmacenExistencias && window.AlmacenExistencias) ? null : null;
  const tr = [...document.querySelectorAll('tr')].find(t => /\(sin modelo\)/.test(t.textContent || ''));
  if (!tr) return null;
  tr.click();
  return tr.textContent.replace(/\s+/g, ' ').slice(0, 120);
});
console.log('    fila sin modelo:', fila);
await espera(3000);
const btnCM = await bod.page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /Completar modelo/.test(b.textContent)).map(b => b.textContent.trim()));
ok(btnCM.length >= 1, 'D1: la fila (sin modelo) ofrece "Completar modelo (N)" por bloque: ' + JSON.stringify(btnCM).slice(0, 200));
await bod.captura('02-existencias-sin-modelo', { full: false });
ok(!bod.errores.length, 'Existencias sin errores de página: ' + bod.errores.join(' | '));
await bod.cerrar();

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
