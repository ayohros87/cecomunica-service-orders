// B3 (ningún modelo preseleccionado), C4 (motivo del botón gris), C7 (aprobar con resumen y confirmación), C5 (RUC legible) y C6 (un formato de fecha).
// Admin crea un contrato TEMPORAL sobre el cliente de prueba PRUEBA-AUDIT-centro Empresa Dos (CLI=<id>) y lo aprueba.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const CLI = process.env.CLI;
if (!CLI) throw new Error('CLI=<id del cliente PRUEBA-AUDIT-centro Empresa Dos>');
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1600));
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });

// C5: RUC en cabecera (AGENCIA) y en el directorio
await s.ir('/clientes/centro.html?id=gFs21DErNjbZFbkGrdAH');
log('c5_cabecera', await s.texto('#fMeta'));
await s.ir('/clientes/centro.html');
log('c5_directorio', (await s.texto('#cgLista')).split('\n').filter(l => /RUC/.test(l)).slice(0, 3));

// C4: wizard temporal → botón gris con motivo visible; al marcar el check desaparece
await s.ir(`/clientes/centro.html?id=${CLI}`);
await s.page.evaluate(() => Centro.wizContrato({ temporal: true }));
await s.quieto(1000);
log('b3_contrato_sin_modelo', await s.page.evaluate(() => [...document.querySelectorAll('.modal-backdrop.open select[data-wcm-modelo]')].map(x => ({ value: x.value, texto: x.selectedOptions[0]?.text }))));
log('c4_antes', await s.page.evaluate(() => ({ disabled: document.getElementById('wcGuardar').disabled, motivo: document.getElementById('wcGuardarMotivo')?.innerText, motivoVisible: document.getElementById('wcGuardarMotivo')?.offsetParent !== null })));
await s.page.evaluate(() => Centro._wcIrAlCheck());
await new Promise(r => setTimeout(r, 600));
log('c4_scroll', await s.page.evaluate(() => { const c = document.getElementById('wcRepValidado'); const r = c.getBoundingClientRect(); const b = document.querySelector('.modal-backdrop.open .modal-body').getBoundingClientRect(); return { chkTop: Math.round(r.top), bodyTop: Math.round(b.top), bodyBottom: Math.round(b.bottom), visible: r.top >= b.top && r.bottom <= b.bottom, enfocado: document.activeElement === c }; }));
await s.captura('74-admin-escritorio-c4-guardar-gris-motivo');
// Llenar: modelo (segunda opción real), cantidad 2, precio 20, modalidad alquiler, duración 3 días
await s.page.evaluate(() => {
  const r = document.querySelector('.modal-backdrop.open');
  const sel = r.querySelector('select[data-wcm-modelo]'); sel.selectedIndex = 3; sel.dispatchEvent(new Event('change', { bubbles: true }));
  const set = (el, v) => { if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set(r.querySelector('input[data-wcm-cant]'), '2'); set(r.querySelector('input[data-wcm-precio]'), '20');
  const mod = r.querySelector('select[data-wcm-modalidad]'); if (mod) { mod.value = 'alquiler'; mod.dispatchEvent(new Event('change', { bubbles: true })); }
  set(document.getElementById('wcMeses'), '3');
  set(document.getElementById('wcObs'), 'PRUEBA-AUDIT-centro C7 aprobar con resumen');
  const c = document.getElementById('wcRepValidado'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
});
await s.quieto(300);
log('c4_despues', await s.page.evaluate(() => ({ disabled: document.getElementById('wcGuardar').disabled, motivoVisible: document.getElementById('wcGuardarMotivo')?.offsetParent !== null })));
await s.page.evaluate(() => document.getElementById('wcGuardar').click());
await s.quieto(1500, 25000); await new Promise(r => setTimeout(r, 2000));
log('c7_creado', { toasts: (await s.toasts()).slice(-2), errores: s.errores.slice(0, 5) });
await s.hacer(() => Centro._cerrarModal());

// C7: aprobar desde la fila de Ahora → diálogo con resumen
await s.ir(`/clientes/centro.html?id=${CLI}`);
const cid = await s.page.evaluate(() => Centro.contratos.find(c => c.estado === 'pendiente_aprobacion')?.id);
log('c7_pendiente', cid);
log('c7_ahora', (await s.texto('#fAhora')).split('\n').filter(Boolean).slice(0, 6));
await s.page.evaluate((id) => { Centro.aprobarContrato(id); }, cid);
await s.quieto(800);
const dialogo = await s.page.evaluate(() => { const o = [...document.querySelectorAll('.overlay')].pop(); return o ? { texto: o.innerText.replace(/\n+/g, ' | ').slice(0, 900), botones: [...o.querySelectorAll('button')].map(b => b.innerText.trim()) } : null; });
log('c7_dialogo', dialogo);
await s.captura('75-admin-escritorio-c7-aprobar-resumen');
// Cancelar → sigue pendiente
await s.page.evaluate(() => { const o = [...document.querySelectorAll('.overlay')].pop(); [...o.querySelectorAll('button')].find(b => /cancelar/i.test(b.innerText))?.click(); });
await s.quieto(500);
log('c7_tras_cancelar', await s.page.evaluate((id) => Centro.contratos.find(c => c.id === id)?.estado, cid));
// Aprobar de verdad
const t0 = Date.now();
await s.page.evaluate((id) => { Centro.aprobarContrato(id); }, cid);
await s.quieto(800);
await s.page.evaluate(() => { const o = [...document.querySelectorAll('.overlay')].pop(); [...o.querySelectorAll('button')].find(b => /^aprobar contrato$/i.test(b.innerText.trim()))?.click(); });
await s.quieto(1500, 20000); await new Promise(r => setTimeout(r, 2500));
log('c7_aprobado', { ms: Date.now() - t0, toasts: (await s.toasts()).slice(-2), estado: await s.page.evaluate((id) => Centro.contratos.find(c => c.id === id)?.estado, cid), ahora: (await s.texto('#fAhora')).split('\n').filter(Boolean).slice(0, 4) });

// C6: fechas en filas de gestiones y detalle de un demo (cliente con gestiones)
const conDemo = await s.page.evaluate(async () => { const q = await firebase.firestore().collection('gestiones').where('tipo', '==', 'demo').limit(5).get(); return q.docs.map(d => ({ cid: d.data().cliente_id, gid: d.id }))[0] || null; });
if (conDemo) {
  await s.ir(`/clientes/centro.html?id=${conDemo.cid}&g=${conDemo.gid}`);
  await s.hacer(() => { document.getElementById('blkGestiones').open = true; });
  const txt = await s.texto('#fGestiones');
  log('c6_fechas', { iso: (txt.match(/\d{4}-\d{2}-\d{2}/g) || []).slice(0, 3), gringas: (txt.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || []).slice(0, 3), formato: (txt.match(/\b\d{1,2} [a-z]{3} \d{4}\b/g) || []).slice(0, 4), salida: (txt.match(/Salida: [^·]+/) || [])[0] });
}
// B3: el demo arranca en "— Modelo —" y sin modelo no se envía
await s.ir(`/clientes/centro.html?id=${CLI}`);
await s.page.evaluate(() => Centro.wizDemo()); await s.quieto(800);
log('b3_demo', await s.page.evaluate(() => { const x = document.querySelector('.modal-backdrop.open select[data-wdl-modelo]'); return { value: x.value, texto: x.selectedOptions[0]?.text, primeraReal: x.options[1]?.text }; }));
await s.hacer(() => Centro._cerrarModal());
log('errores', s.errores.slice(0, 8));
await s.cerrar();

// Vendedora y cobros: RUC y fechas en la ficha; la vendedora no ve "Aprobar"
// La vendedora abre una cuenta suya (C COMUNICA, de karla.ferrer); cobros, la de prueba.
for (const [rol, cliId] of [['vendedor', '6yoaiUMRAhhSMtiC4O0S'], ['cobros', CLI]]) {
  const t = await abrir({ email: USUARIOS[rol], viewport: 'escritorio', carpeta: 'centro' });
  await t.ir(`/clientes/centro.html?id=${cliId}`);
  const fm = await t.texto('#fMeta');
  await t.hacer(() => { const b = document.getElementById('blkGestiones'); if (b) b.open = true; const c = document.getElementById('blkContratos'); if (c) c.open = true; });
  const body = await t.page.evaluate(() => document.body.innerText);
  log(`${rol}_ficha`, { meta: fm, iso: (body.match(/\d{4}-\d{2}-\d{2}/g) || []).slice(0, 3), gringas: (body.match(/\d{2}\/\d{2}\/\d{4}/g) || []).slice(0, 3), formato: (body.match(/\d{1,2} [a-z]{3} \d{4}/g) || []).slice(0, 3), botonAprobar: /Aprobar/.test(await t.texto('#fAhora')) });
  if (rol === 'vendedor') {
    await t.page.evaluate(() => Centro.wizContrato({ temporal: true })); await t.quieto(1000);
    log('vendedor_c4_b3', await t.page.evaluate(() => ({ gris: document.getElementById('wcGuardar')?.disabled, motivo: document.getElementById('wcGuardarMotivo')?.offsetParent !== null, modelo: document.querySelector('.modal-backdrop.open select[data-wcm-modelo]')?.value })));
  }
  log(`${rol}_errores`, t.errores.slice(0, 5));
  await t.cerrar();
}
