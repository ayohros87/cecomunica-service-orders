// Admin: crea un contrato TEMPORAL de prueba (PRUEBA-AUDIT-centro) para ver la bandeja "Pendientes por aprobar",
// el expediente en trámite ("qué falta y quién"), aprueba, y mira qué dice la ficha después. Todo sobre el cliente de prueba.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const CLI = process.env.CLI;
if (!CLI) throw new Error('CLI=<id del cliente PRUEBA-AUDIT-centro>');
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1800));
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });

let info = await s.ir(`/clientes/centro.html?id=${CLI}`);
log('p_ficha', { ms: info.msTotal, cab: await s.texto('.cg-head'), ahora: await s.texto('#fAhora') });
// Contrato temporal: llenar modelo, cantidad, precio, modalidad, duración
await s.page.evaluate(() => Centro.wizContrato({ temporal: true }));
await s.quieto(1000);
const campos = await s.page.evaluate(() => {
  const r = document.querySelector('.modal-backdrop.open');
  return [...r.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(e => e.offsetParent).map(e => `${e.tagName.toLowerCase()} ${[...e.attributes].map(a => a.name).filter(n => n.startsWith('data-') || n === 'id').join(',')} = ${e.value}`);
});
log('p_wiz_temporal_campos', campos);
await s.page.evaluate(() => document.getElementById('wcGuardar').click());
await s.quieto(800);
log('p_guardar_vacio', { toasts: (await s.toasts()).slice(-3), rojos: await s.page.evaluate(() => document.querySelectorAll('.modal-backdrop.open .has-error, .modal-backdrop.open [style*="border-color"], .modal-backdrop.open .is-invalid').length), modal: await s.page.evaluate(() => !!document.querySelector('.modal-backdrop.open')) });
await s.captura('60a-admin-escritorio-wiz-temporal-guardar-vacio');
let pasos = 0;
await s.page.evaluate(() => {
  const r = document.querySelector('.modal-backdrop.open');
  const sel = r.querySelector('select[data-wcm-modelo]');
  sel.selectedIndex = 3; sel.dispatchEvent(new Event('change', { bubbles: true }));
}); pasos++;
await s.quieto(400);
const llenado = await s.page.evaluate(() => {
  const r = document.querySelector('.modal-backdrop.open');
  const set = (el, v) => { if (!el) return false; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
  const out = {};
  out.cant = set(r.querySelector('input[data-wcm-cant]'), '2');
  out.precio = set(r.querySelector('input[data-wcm-precio]'), '20');
  const mod = r.querySelector('select[data-wcm-modalidad]'); out.mod = !!mod; if (mod) { mod.value = 'alquiler'; mod.dispatchEvent(new Event('change', { bubbles: true })); }
  const dur = [...r.querySelectorAll('input[type=number], input:not([data-wcm-cant]):not([data-wcm-precio])')].find(i => i.value === '7'); out.dur = !!dur; if (dur) set(dur, '3');
  const obs = r.querySelector('textarea'); out.obs = !!obs; if (obs) set(obs, 'PRUEBA-AUDIT-centro contrato temporal');
  return out;
}); pasos += 4;
log('p_wiz_temporal_llenado', llenado);
log('p_btn_antes_check', await s.page.evaluate(() => ({ disabled: document.getElementById('wcGuardar').disabled, chk: document.getElementById('wcRepValidado')?.checked, chkTop: Math.round(document.getElementById('wcRepValidado')?.getBoundingClientRect().top), bodyH: document.querySelector('.modal-backdrop.open .modal-body').getBoundingClientRect().height, texto: document.getElementById('wcRepValidado')?.closest('label')?.innerText })));
await s.page.evaluate(() => { const c = document.getElementById('wcRepValidado'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); pasos++;
await s.quieto(300);
log('p_btn_tras_check', await s.page.evaluate(() => document.getElementById('wcGuardar').disabled));
await s.captura('60-admin-escritorio-wiz-temporal-lleno');
const t0 = Date.now();
await s.page.evaluate(() => document.getElementById('wcGuardar').click()); pasos++;
await s.quieto(1500, 25000);
await new Promise(r => setTimeout(r, 2500));
log('p_guardar', { ms: Date.now() - t0, pasos, toasts: (await s.toasts()).slice(-4), errores: s.errores.slice(0, 6), modalAbierto: await s.page.evaluate(() => !!document.querySelector('.modal-backdrop.open')) });
log('p_modal_tras_guardar', (await s.texto('.modal-backdrop.open')).slice(0, 800));
await s.hacer(() => Centro._cerrarModal());
await s.quieto(1500);
log('p_ficha_tras', { ahora: await s.texto('#fAhora'), resumen: await s.texto('#fResumen'), gest: (await s.texto('#fGestiones')).split('\n').filter(Boolean).slice(0, 30) });
await s.captura('61-admin-escritorio-ficha-contrato-en-tramite');
// Directorio: bandeja de aprobaciones
info = await s.ir('/clientes/centro.html');
log('p_bandeja', { ms: info.msTotal, texto: await s.texto('#cgAprobaciones') });
await s.captura('62-admin-escritorio-pendientes-por-aprobar');
await s.hacer(() => document.querySelector('#cgAprobaciones a[href*="id="]')?.click());
await s.quieto(1500);
log('p_revisar_aterriza', { url: await s.page.evaluate(() => location.search), scrollY: await s.page.evaluate(() => window.scrollY), gestAbierto: await s.page.evaluate(() => document.getElementById('blkGestiones').open) });
await s.captura('63-admin-escritorio-revisar-aterriza');
// Expediente del contrato en trámite y sus acciones
const cid = await s.page.evaluate(() => Centro.contratos.find(c => c.estado === 'pendiente_aprobacion')?.id);
log('p_acciones_pendiente', await s.page.evaluate((id) => { const c = Centro.contratos.find(x => x.id === id); return Centro._accionesContrato(c).map(a => `${a.grupo} | ${a.label} | ${a.ok ? 'ok' : 'NO: ' + a.motivo}`); }, cid));
await s.hacer((id) => document.getElementById('grow-' + id)?.click() || document.querySelector(`[data-contrato="${id}"], #crow-${id}`)?.click(), cid);
await s.quieto(800);
log('p_tramite_texto', (await s.texto('#fGestiones')).split('\n').filter(Boolean).slice(0, 40));
await s.captura('64-admin-escritorio-tramite-contrato', { el: '#blkGestiones' });
// Aprobar
const t1 = Date.now();
await s.page.evaluate((id) => Centro.aprobarContrato(id), cid);
await s.quieto(1000);
log('p_aprobar_dialogo', (await s.texto('.modal-backdrop.open')).slice(0, 600));
await s.captura('65-admin-escritorio-aprobar-dialogo');
await s.page.evaluate(() => { const b = [...document.querySelectorAll('.modal-backdrop.open button')].find(x => /aprobar/i.test(x.innerText) && !/cancelar/i.test(x.innerText)); b?.click(); });
await s.quieto(1500, 20000);
await new Promise(r => setTimeout(r, 3000));
log('p_aprobado', { ms: Date.now() - t1, toasts: (await s.toasts()).slice(-3), errores: s.errores.slice(0, 6), ahora: await s.texto('#fAhora'), tramite: (await s.texto('#fGestiones')).split('\n').filter(Boolean).slice(0, 30) });
await s.captura('66-admin-escritorio-tras-aprobar');
log('p_acciones_aprobado', await s.page.evaluate((id) => { const c = Centro.contratos.find(x => x.id === id); return { estado: c.estado, seriales: c.seriales_estado, acc: Centro._accionesContrato(c).map(a => `${a.grupo} | ${a.label} | ${a.ok ? 'ok' : 'NO: ' + a.motivo}`) }; }, cid));
await s.cerrar();
