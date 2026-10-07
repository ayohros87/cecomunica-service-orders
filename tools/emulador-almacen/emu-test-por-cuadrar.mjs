// P1 del plan de autoservicio (2026-10-07): "Corregir ubicación" (bodega),
// cola "Por cuadrar" en Almacén · Hoy y "Registrar entrega tardía" (recepción).
// Contra el emulador con datos de producción:
//   node emu-test-por-cuadrar.mjs
// Los triggers no corren aquí (solo auth + firestore + hosting).
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// ── 1) Bodega: Hoy · Por cuadrar ──────────────────────────────────────────
const bod = await abrir({ email: USUARIOS.inventario, carpeta: 'por-cuadrar' });
await bod.ir('/almacen/index.html', { esperar: 3000 });
await espera(2500);
const hoy = await bod.page.evaluate(() => {
  const g = [...document.querySelectorAll('#hoyGrupos .bj-grupo, #hoyGrupos section, #hoyGrupos .bj-panel, #hoyGrupos > *')]
    .map(e => e.innerText.split('\n')[0]).filter(Boolean);
  const btns = [...document.querySelectorAll('[data-cuadrar-orden]')].map(b => b.dataset.cuadrarOrden);
  const titulo = [...document.querySelectorAll('#hoyGrupos *')].find(e => /Por cuadrar/.test(e.textContent) && e.children.length < 6);
  return { grupos: g.slice(0, 20), btns, hayGrupo: !!titulo, texto: (document.getElementById('hoyGrupos')?.innerText || '').match(/Por cuadrar[^\n]*\n[\s\S]{0,600}/)?.[0] || '' };
});
console.log('    grupo Por cuadrar:', hoy.hayGrupo, '· órdenes con CTA:', hoy.btns.length);
console.log('    ' + hoy.texto.replace(/\n/g, '\n    ').slice(0, 700));
ok(!bod.errores.length, 'bodega Hoy sin errores de página: ' + bod.errores.join(' | '));
await bod.captura('01-hoy-por-cuadrar', { full: true });

// 1b) "El cliente ya los tiene" sobre la primera orden de la cola (si hay).
if (hoy.btns.length) {
  const oid = hoy.btns[0];
  const antes = await bod.page.evaluate(async (id) => {
    const s = await firebase.firestore().collection('equipos_pool').where('orden_actual_id', '==', id).get();
    return s.docs.map(d => ({ id: d.id, estado: d.data().estado, cli: d.data().asignacion?.cliente_id || null }));
  }, oid);
  console.log('    orden', oid, 'radios antes:', JSON.stringify(antes).slice(0, 300));
  await bod.page.evaluate((id) => document.querySelector(`[data-cuadrar-orden="${id}"]`).click(), oid);
  await bod.page.waitForSelector('[data-role="prompt-input"]', { timeout: 10000 });
  await bod.page.type('[data-role="prompt-input"]', 'Prueba emulador: el cliente los tiene desde la programación');
  await bod.captura('02-cuadrar-prompt');
  await bod.page.click('[data-action="confirm"]');
  await espera(4000);
  // Cierra el Modal.alert "Falta cerrar la orden"
  await bod.page.evaluate(() => document.querySelector('[data-sheet-action="ok"]')?.click());
  await espera(1500);
  const despues = await bod.page.evaluate(async (ids) => {
    const out = [];
    for (const id of ids) { const d = (await firebase.firestore().collection('equipos_pool').doc(id).get()).data(); out.push({ id, estado: d.estado, cli: d.asignacion?.cliente_id || null, oa: d.orden_actual_id || null, ver: d.verificado }); }
    return out;
  }, antes.map(a => a.id));
  console.log('    radios después:', JSON.stringify(despues).slice(0, 300));
  const movidos = despues.filter(d => d.estado === 'en_cliente' && d.oa === null);
  ok(movidos.length === antes.filter(a => ['en_taller', 'asignado_contrato'].includes(a.estado)).length, `todos los radios de ${oid} pasaron a en_cliente sin orden actual (${movidos.length}/${antes.length})`);
  const kardex = await bod.page.evaluate(async (id) => {
    const s = await firebase.firestore().collection('equipos_pool').doc(id).collection('movimientos').get();
    return s.docs.map(d => d.data()).filter(m => m.tipo === 'reubicacion').map(m => ({ de: m.de_estado, a: m.a_estado, notas: m.notas }));
  }, antes[0].id);
  ok(kardex.length === 1 && kardex[0].a === 'en_cliente', 'kardex reubicacion en el primer radio: ' + JSON.stringify(kardex).slice(0, 200));
  console.log('    toasts:', JSON.stringify(await bod.toasts()).slice(0, 300));
  ok(!bod.errores.length, 'bodega cuadrar sin errores: ' + bod.errores.join(' | '));
}

// ── 2) Bodega: Corregir ubicación desde la ficha (Avanzado) ───────────────
const sujeto = await bod.page.evaluate(async () => {
  const db = firebase.firestore();
  const s = await db.collection('equipos_pool').where('estado', '==', 'en_bodega').limit(50).get();
  const u = s.docs.map(d => ({ id: d.id, ...d.data() })).find(x => x.modelo_id && !x.asignacion?.gestion_doc_id && !/__/.test(x.id) && x.serial);
  const c = await db.collection('clientes').where('deleted', '==', false).limit(3).get();
  const cli = c.docs.map(d => ({ id: d.id, nombre: d.data().nombre })).find(x => x.nombre);
  return { id: u.id, serial: u.serial, cli };
});
console.log('    sujeto:', JSON.stringify(sujeto));
await bod.page.evaluate((s) => EquipoFicha.abrir(s), sujeto.serial);
await bod.page.waitForSelector('.modal-backdrop', { timeout: 10000 });
await espera(800);
const tieneBoton = await bod.page.evaluate(() => [...document.querySelectorAll('.modal-backdrop button')].some(b => /Corregir ubicación/.test(b.textContent)));
ok(tieneBoton, 'la ficha muestra "Corregir ubicación…"');
await bod.page.evaluate(() => [...document.querySelectorAll('.modal-backdrop button')].find(b => /Corregir ubicación/.test(b.textContent)).click());
await bod.page.waitForSelector('input[name="efuDestino"]', { timeout: 10000 });
await bod.page.click('input[name="efuDestino"][value="en_cliente"]');
await espera(300);
await bod.page.evaluate(() => { const i = document.getElementById('efuClienteInput'); i.value = ''; });
await bod.page.type('#efuClienteInput', sujeto.cli.nombre.slice(0, 14));
await espera(800);
const eligio = await bod.page.evaluate((id) => {
  const it = document.querySelector(`.combo-item[data-id="${id}"]`);
  if (!it) return false;
  it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); it.click(); return true;
}, sujeto.cli.id);
if (!eligio) await bod.page.evaluate((n) => { document.getElementById('efuClienteInput').value = n; }, sujeto.cli.nombre);
await bod.page.type('#efuMotivo', 'Prueba emulador: el cliente se lo llevó sin orden');
await bod.captura('03-corregir-ubicacion');
await bod.page.evaluate(() => document.querySelector('[data-sheet-action="aplicar"]').click());
await espera(3500);
const fin = await bod.page.evaluate(async (id) => (await firebase.firestore().collection('equipos_pool').doc(id).get()).data(), sujeto.id);
ok(fin.estado === 'en_cliente' && fin.asignacion?.cliente_id === sujeto.cli.id && fin.asignacion?.contrato_doc_id === null && fin.verificado === false,
  `ficha → en_cliente en custodia de ${sujeto.cli.nombre}: ${JSON.stringify({ estado: fin.estado, asig: fin.asignacion, ver: fin.verificado })}`);
console.log('    toasts:', JSON.stringify(await bod.toasts()).slice(-300));
ok(!bod.errores.length, 'bodega ficha sin errores: ' + bod.errores.join(' | '));

// ── 3) Recepción: Registrar entrega tardía ────────────────────────────────
const rec = await abrir({ email: USUARIOS.recepcion, carpeta: 'por-cuadrar' });
await rec.ir('/ordenes/index.html', { esperar: 2500 });
const cand = await rec.page.evaluate(async () => {
  const db = firebase.firestore();
  const s = await db.collection('ordenes_de_servicio').where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)').orderBy('fecha_creacion', 'desc').limit(120).get();
  const norm = (v) => String(v || '').toLowerCase();
  const os = s.docs.map(d => ({ ordenId: d.id, ...d.data() })).filter(o => o.eliminado !== true && !/entrada|visita|devolucion/.test(norm(o.tipo_de_servicio))
    && o.qc_requerido !== true && !o.contrato?.aplica && (o.equipos || []).some(e => e && !e.eliminado && (e.numero_de_serie || e.serial)));
  const o = os[0];
  return o ? { ordenId: o.ordenId, cliente_id: o.cliente_id, seriales: (o.equipos || []).map(e => e.numero_de_serie || e.serial).filter(Boolean) } : null;
});
console.log('    orden candidata:', JSON.stringify(cand));
if (!cand) { ok(false, 'no hay orden COMPLETADO sin QC ni contrato para probar'); }
else {
  await rec.ir(`/ordenes/index.html?ids=${cand.ordenId}`, { esperar: 3000 });
  await espera(1500);
  const item = await rec.page.evaluate((id) => {
    const b = document.querySelector(`.overflow-menu-btn[data-orden-id="${id}"]`);
    if (b) b.click();
    const it = document.querySelector(`#overflow-menu-${id} [data-action="entrega-tardia"]`);
    return { menu: !!b, item: !!it };
  }, cand.ordenId);
  ok(item.menu && item.item, 'el ⋯ de la orden trae "Registrar entrega tardía…"');
  await rec.captura('04-menu-entrega-tardia');
  await rec.page.evaluate((id) => document.querySelector(`#overflow-menu-${id} [data-action="entrega-tardia"]`).click(), cand.ordenId);
  await rec.page.waitForSelector('#etFecha', { timeout: 15000 });
  await rec.page.evaluate(() => { document.getElementById('etFecha').value = '2026-09-15'; });
  await rec.page.type('#etReceptor', 'Prueba Emulador');
  await rec.page.type('#etNotas', 'Prueba emulador: lo confirmó el vendedor con el cliente');
  await rec.captura('05-hoja-entrega-tardia');
  await rec.page.evaluate(() => document.querySelector('[data-sheet-action="registrar"]').click());
  await espera(5000);
  await rec.page.evaluate(() => document.querySelector('[data-sheet-action="ok"]')?.click());
  const res = await rec.page.evaluate(async (id, seriales) => {
    const db = firebase.firestore();
    const o = (await db.collection('ordenes_de_servicio').doc(id).get()).data();
    const us = [];
    for (const s of seriales.slice(0, 5)) { const q = await db.collection('equipos_pool').where('serial', '==', s).get(); q.forEach(d => us.push({ s, estado: d.data().estado, oa: d.data().orden_actual_id || null })); }
    return { estado: o.estado_reparacion, ct: o.correccion_terminal, de: o.correccion_terminal_de, fecha: o.fecha_entrega?.toDate?.()?.toISOString?.().slice(0, 10), et: o.entrega_tardia ? { mov: o.entrega_tardia.movidos, om: o.entrega_tardia.omitidos } : null, us };
  }, cand.ordenId, cand.seriales);
  console.log('    resultado:', JSON.stringify(res).slice(0, 500));
  ok(res.estado === 'ENTREGADO AL CLIENTE' && res.ct === true && res.de === 'COMPLETADO (EN OFICINA)' && res.fecha === '2026-09-15', 'orden ENTREGADO con correccion_terminal y fecha real');
  ok(res.us.every(u => u.estado === 'en_cliente' || u.estado === 'vendido' || u.estado === 'baja'), 'radios de la orden en_cliente (o fuera de alcance): ' + JSON.stringify(res.us).slice(0, 200));
  console.log('    toasts:', JSON.stringify(await rec.toasts()).slice(0, 300));
  ok(!rec.errores.length, 'recepción sin errores de página: ' + rec.errores.join(' | '));
}

await rec.cerrar(); await bod.cerrar();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
