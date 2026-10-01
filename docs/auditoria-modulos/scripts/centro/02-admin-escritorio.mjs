// Admin en escritorio: directorio, buscador, ficha grande (AGENCIA DE SEGURIDAD UNIDA: 273 equipos, 20 contratos),
// menú de gestiones y cada wizard hasta el paso de guardar (sin guardar). Solo lectura.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const GRANDE = process.env.CLI || 'gFs21DErNjbZFbkGrdAH';
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });
const out = {};
const log = (k, v) => { out[k] = v; console.log(k, JSON.stringify(v).slice(0, 1500)); };

// 1. Directorio
let info = await s.ir('/clientes/centro.html');
log('directorio', { ...info, geo: await s.geometria(), consultas: await s.consultas(), errores: s.errores.slice(0, 8) });
await s.captura('01-admin-escritorio-directorio');
log('directorio_texto_aprobaciones', await s.texto('#cgAprobaciones'));
log('directorio_resumen', await s.texto('#cgResumen'));
// primeras 5 filas
log('directorio_filas', (await s.texto('#cgLista')).split('\n').filter(Boolean).slice(0, 12));

// 2. Buscador
const t0 = Date.now();
await s.page.type('#cgBuscar', 'seguridad');
await s.quieto(800);
log('buscar', { ms: Date.now() - t0, resumen: await s.texto('#cgResumen'), consultas: (await s.consultas()).slice(-4) });
await s.captura('02-admin-escritorio-buscar');

// 3. Ficha grande
info = await s.ir(`/clientes/centro.html?id=${GRANDE}`);
const geo = await s.geometria();
log('ficha', { ...info, geo, consultas: await s.consultas(), errores: s.errores.slice(0, 8) });
await s.captura('03-admin-escritorio-ficha-grande-pliegue');
await s.captura('03b-admin-escritorio-ficha-grande-completa', { full: true });
log('ficha_cabecera', await s.texto('.cg-head'));
log('ficha_ahora', await s.texto('#fAhora'));
log('ficha_resumen', await s.texto('#fResumen'));
log('ficha_sumarios', await s.page.evaluate(() => ['blkGestiones', 'blkContratos', 'blkEquipos', 'blkActividad'].map(id => {
  const d = document.getElementById(id); return { id, open: d.open, sum: d.querySelector('.sum')?.innerText, top: Math.round(d.getBoundingClientRect().top) }; })));
log('ficha_primario', await s.page.evaluate(() => ({ primario: document.getElementById('btnPrimario')?.innerText, oculto: document.getElementById('btnPrimario')?.classList.contains('hidden') })));
// Qué hay arriba del pliegue (800px)
log('pliegue', await s.page.evaluate(() => [...document.querySelectorAll('#vistaFicha .ds-card, #fAhora, #fResumen, .cg-block')].map(e => { const r = e.getBoundingClientRect(); return { el: e.id || e.className.split(' ')[0], top: Math.round(r.top), bottom: Math.round(r.bottom) }; })));
// Abrir todos los bloques
await s.hacer(() => { for (const id of ['blkGestiones', 'blkContratos', 'blkEquipos']) document.getElementById(id).open = true; });
log('ficha_todo_abierto', await s.geometria());
await s.captura('04-admin-escritorio-ficha-grande-contratos', { el: '#blkContratos' });
log('contratos_tabla', (await s.texto('#fContratos')).split('\n').filter(Boolean).slice(0, 40));
log('equipos_bloque', (await s.texto('#fEquipos')).split('\n').filter(Boolean).slice(0, 30));
await s.captura('05-admin-escritorio-ficha-grande-equipos', { el: '#blkEquipos' });
// Actividad (historial inmutable)
await s.hacer(() => { document.getElementById('blkActividad').open = true; });
await s.quieto(1500);
log('actividad', (await s.texto('#fActividad')).split('\n').filter(Boolean).slice(0, 25));
await s.captura('06-admin-escritorio-ficha-actividad', { el: '#blkActividad' });

// 4. Menú Nueva gestión
await s.page.evaluate(() => window.scrollTo(0, 0));
await s.clic('#btnGestion');
log('menu_gestion', await s.texto('#cgMenu'));
await s.captura('07-admin-escritorio-menu-nueva-gestion');
await s.hacer(() => document.getElementById('cgMenu').classList.add('hidden'));
await s.clic('#btnMasFicha');
log('menu_mas', await s.texto('#cgMasMenu'));
await s.hacer(() => document.getElementById('cgMasMenu').classList.add('hidden'));

// 5. Wizards: abrir cada uno, contar campos, capturar, cerrar
const wiz = [
  ['aumento', 'Centro.wizAgregarEquipos()'],
  ['reemplazo', 'Centro.wizReemplazo()'],
  ['demo', 'Centro.wizDemo()'],
  ['baja', 'Centro.wizBaja()'],
  ['terminacion', 'Centro.wizTerminacionCuenta()'],
  ['cambio-serial', 'Centro.wizCambioSerial()'],
  ['ajuste', 'Centro.wizAjuste()'],
  ['contrato-temporal', 'Centro.wizContrato({temporal:true})'],
  ['renovar', 'Centro.wizContrato({renovarCuenta:true})'],
  ['regularizar', 'Centro.wizRegularizarCuenta()'],
];
let n = 8;
for (const [nombre, code] of wiz) {
  const t = Date.now();
  try { await s.page.evaluate(code); } catch (e) { log('wiz_' + nombre + '_error', String(e).slice(0, 200)); continue; }
  await s.quieto(1000, 20000);
  const m = await s.page.evaluate(() => {
    const r = document.querySelector('.modal-backdrop.open .modal'); if (!r) return null;
    const q = (sel) => [...r.querySelectorAll(sel)].filter(e => e.offsetParent !== null);
    return { titulo: r.querySelector('.modal-title, h3')?.innerText, inputs: q('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])').length,
      checks: q('input[type=checkbox],input[type=radio]').length, selects: q('select').length, textareas: q('textarea').length, botones: q('button').map(b => b.innerText.trim()).filter(Boolean),
      alto: r.scrollHeight, altoVisible: r.getBoundingClientRect().height, bodyScroll: r.querySelector('.modal-body')?.scrollHeight, filasTabla: r.querySelectorAll('tbody tr').length,
      texto: r.innerText.slice(0, 1800) };
  });
  log('wiz_' + nombre, { ms: Date.now() - t, ...m, toasts: (await s.toasts()).slice(-2), consultas: (await s.consultas()).slice(-3) });
  await s.captura(`${String(n).padStart(2, '0')}-admin-escritorio-wiz-${nombre}`);
  n++;
  await s.hacer(() => Centro._cerrarModal());
  // si quedó otro modal abierto (p. ej. confirm), ciérralo
  await s.page.evaluate(() => document.querySelectorAll('.modal-backdrop.open .modal-close').forEach(b => b.click()));
}
log('errores_final', s.errores.slice(0, 15));
await s.cerrar();
