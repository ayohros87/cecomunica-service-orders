// Vendedora (Karla) en escritorio: cartera, alta de cliente con RUC/DV, ficha nueva en el Centro,
// gestiones que puede iniciar, y la prueba del DOBLE CLIC al crear un demo (P0 #10 de la auditoría anterior).
// Crea UN cliente y UNA gestión de prueba con prefijo PRUEBA-AUDIT-centro. Luego, teléfono.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const s = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'centro' });
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1600));

let info = await s.ir('/clientes/centro.html');
log('v_directorio', { ...info, geo: await s.geometria(), consultas: await s.consultas(), errores: s.errores.slice(0, 6) });
log('v_resumen', await s.texto('#cgResumen'));
log('v_rail', (await s.texto('#rail-mount')).split('\n').filter(Boolean));
log('v_segOculto', await s.page.evaluate(() => ({ seg: document.querySelector('.seg')?.classList.contains('hidden'), aprob: document.getElementById('cgAprobaciones')?.classList.contains('hidden'), extras: document.getElementById('cgToolsExtra')?.innerText })));
await s.captura('20-vendedor-escritorio-cartera');

// Alta de cliente
info = await s.ir('/clientes/ficha.html?nuevo=1&from=centro');
log('v_alta_carga', { ...info, consultas: await s.consultas(), errores: s.errores.slice(0, 6) });
log('v_alta_campos', await s.page.evaluate(() => [...document.querySelectorAll('#fkRoot input:not([type=hidden]), #fkRoot select, #fkRoot textarea')].filter(e => e.offsetParent).map(e => `${e.tagName.toLowerCase()}#${e.id || e.dataset.k || e.name || '?'}${e.required ? '*' : ''}`)));
await s.captura('21-vendedor-escritorio-alta-vacia', { full: true });
let pasos = 0;
await s.page.type('#nombre', 'PRUEBA-AUDIT-centro Empresa Uno'); pasos++;
await s.page.click('[data-tipo="juridica"]'); pasos++;
await s.quieto(400);
await s.page.type('[data-k="p1"]', '155799999'); pasos++;
await s.page.type('[data-k="p2"]', '2'); pasos++;
await s.page.type('[data-k="p3"]', '2026'); pasos++;
await s.quieto(400);
log('v_alta_ruc', await s.page.evaluate(() => ({ ruc: document.getElementById('ruc').value, dv: document.getElementById('dv').value, estado: document.querySelector('[data-ruc-estado]')?.innerText })));
await s.page.type('#representante', 'Juan Prueba'); pasos++;
await s.page.type('#representante_cedula', '8-123-456'); pasos++;
await s.page.type('#telefono', '6000-0000'); pasos++;
await s.page.type('#email', 'prueba-audit-centro@example.com'); pasos++;
log('v_alta_vendedor', await s.page.evaluate(() => { const v = document.getElementById('vendedor'); return { valor: v?.value, texto: v?.selectedOptions?.[0]?.innerText, opciones: v?.options?.length, disabled: v?.disabled }; }));
log('v_alta_barra', await s.texto('.fk-bar'));
await s.captura('22-vendedor-escritorio-alta-llena', { full: true });
const t0 = Date.now();
await s.page.click('[data-fk-guardar]'); pasos++;
await s.quieto(1500, 20000);
await new Promise(r => setTimeout(r, 1500));
log('v_alta_guardado', { ms: Date.now() - t0, pasos, url: await s.page.evaluate(() => location.pathname + location.search), toasts: await s.toasts(), errores: s.errores.slice(0, 6) });
await s.quieto(1200);
const urlNueva = await s.page.evaluate(() => location.search);
const idNuevo = new URLSearchParams(urlNueva).get('id');
log('v_id_nuevo', idNuevo);
await s.captura('23-vendedor-escritorio-cliente-nuevo-en-centro');
log('v_ficha_nueva', { cab: await s.texto('.cg-head'), ahora: await s.texto('#fAhora'), resumen: await s.texto('#fResumen') });
await s.clic('#btnGestion');
log('v_menu_gestion', await s.texto('#cgMenu'));
await s.captura('24-vendedor-escritorio-menu-gestion-cliente-nuevo');
await s.hacer(() => document.getElementById('cgMenu').classList.add('hidden'));
await s.clic('#btnMasFicha');
log('v_menu_mas', await s.texto('#cgMasMenu'));
await s.hacer(() => document.getElementById('cgMasMenu').classList.add('hidden'));

// Demo con DOBLE CLIC
await s.page.evaluate(() => Centro.wizDemo());
await s.quieto(1000);
await s.page.evaluate(() => { const sel = document.querySelector('.modal-backdrop.open select[data-wdl-modelo]'); sel.selectedIndex = 1; sel.dispatchEvent(new Event('change', { bubbles: true })); });
await s.page.type('.modal-backdrop.open #wdFin', 'PRUEBA-AUDIT-centro doble clic');
await s.captura('25-vendedor-escritorio-wiz-demo-lleno');
const antes = await s.page.evaluate(async () => (await GestionesService.listarPorCliente(Centro.cliente.id)).length);
const r = await s.page.evaluate(() => {
  const b = [...document.querySelectorAll('.modal-backdrop.open button')].find(x => x.innerText.trim() === 'Enviar solicitud');
  b.click(); b.click(); b.click();
  return { disabledTrasClic: b.disabled, texto: b.innerText };
});
await s.quieto(1500, 20000);
await new Promise(r => setTimeout(r, 2500));
const despues = await s.page.evaluate(async () => { const g = await GestionesService.listarPorCliente(Centro.cliente.id); return g.map(x => ({ id: x.id, tipo: x.tipo, estado: x.estado, fin: x.demo?.finalidad })); });
log('v_doble_clic', { antes, ...r, despues, toasts: (await s.toasts()).slice(-4), errores: s.errores.slice(0, 6) });
await s.hacer(() => { document.getElementById('blkGestiones').open = true; });
await s.captura('26-vendedor-escritorio-gestion-demo-creada');
log('v_gestiones_bloque', (await s.texto('#fGestiones')).split('\n').filter(Boolean).slice(0, 30));
// abrir expediente
const gid = despues[0]?.id;
if (gid) {
  await s.hacer((id) => document.getElementById('grow-' + id)?.click(), gid);
  await s.quieto(800);
  log('v_expediente', (await s.texto('#fGestiones')).split('\n').filter(Boolean).slice(0, 50));
  await s.captura('27-vendedor-escritorio-expediente-demo', { el: '#blkGestiones' });
  log('v_expediente_acciones', await s.page.evaluate((g) => { const x = Centro.gestiones.find(y => y.id === g); return Centro._accionesGestion(x).map(a => `${a.grupo} | ${a.label} | ${a.ok ? 'ok' : 'NO: ' + a.motivo}`); }, gid));
}
log('v_errores', s.errores.slice(0, 10));
await s.cerrar();

// Teléfono: cartera y ficha
const p = await abrir({ email: USUARIOS.vendedor, viewport: 'telefono', carpeta: 'centro' });
info = await p.ir('/clientes/centro.html');
log('v_tel_directorio', { ...info, geo: await p.geometria() });
await p.captura('28-vendedor-telefono-cartera');
if (idNuevo) {
  info = await p.ir(`/clientes/centro.html?id=${idNuevo}`);
  log('v_tel_ficha', { ...info, geo: await p.geometria(), dock: await p.texto('#cgDock') });
  await p.captura('29-vendedor-telefono-ficha');
  await p.captura('29b-vendedor-telefono-ficha-completa', { full: true });
}
await p.cerrar();
