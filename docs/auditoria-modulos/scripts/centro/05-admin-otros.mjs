// Admin: regularización (bandeja + "Qué falta"), fichas con gestiones vivas y expediente, duplicados, archivo de gestiones,
// formulario de edición de cliente, y la ficha grande en teléfono. Solo lectura.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1800));
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });

let info = await s.ir('/clientes/regularizacion.html');
log('a_reg', { ...info, geo: await s.geometria(), consultas: await s.consultas(), errores: s.errores.slice(0, 6) });
log('a_reg_texto', { chips: await s.texto('#rgChips'), resumen: await s.texto('#rgResumen'), filas: (await s.texto('#rgRows')).split('\n').filter(Boolean).slice(0, 24) });
await s.captura('30-admin-escritorio-regularizacion-bandeja');
// abrir detalle de la primera fila
await s.hacer(() => document.querySelector('#rgRows .rg-row, #rgRows [data-abrir], #rgRows tr, #rgRows .rg-fila')?.click());
log('a_reg_detalle', (await s.texto('#rgRows')).split('\n').filter(Boolean).slice(0, 30));
await s.captura('31-admin-escritorio-regularizacion-detalle');

// Qué falta en la ficha grande
info = await s.ir('/clientes/centro.html?id=gFs21DErNjbZFbkGrdAH');
await s.page.evaluate(() => Centro.verRegularizacion());
await s.quieto(800);
log('a_que_falta', await s.texto('.modal-backdrop.open'));
await s.captura('32-admin-escritorio-que-falta');
await s.hacer(() => Centro._cerrarModal());
// ⋯ del contrato aprobado sin firma: ¿Enviar para firma está habilitado?
await s.hacer(() => { document.getElementById('blkContratos').open = true; });
const accCon = await s.page.evaluate(() => { const c = Centro.contratos.find(x => x.contrato_id === 'ALQ20260611-02'); return Centro._accionesContrato(c).map(a => `${a.grupo} | ${a.label} | ${a.ok ? 'ok' : 'NO: ' + a.motivo}`); });
log('a_acciones_contrato_aprobado', accCon);
await s.page.evaluate(() => { const c = Centro.contratos.find(x => x.contrato_id === 'ALQ20260611-02'); Centro.verContrato(c.id); });
await s.quieto(1000);
log('a_ver_contrato', (await s.texto('.modal-backdrop.open')).slice(0, 1500));
await s.captura('33-admin-escritorio-ver-contrato-aprobado');
await s.hacer(() => Centro._cerrarModal());

// Ficha con gestiones vivas: C COMUNICA, S.A. y SEPROSA
for (const [id, tag] of [['6yoaiUMRAhhSMtiC4O0S', 'ccomunica'], ['jT6FlI02u2L52On6zsaj', 'seprosa']]) {
  info = await s.ir(`/clientes/centro.html?id=${id}`);
  log(`a_ficha_${tag}`, { ms: info.msTotal, fs: info.fsReqs, geo: await s.geometria(), cab: await s.texto('.cg-head'), ahora: await s.texto('#fAhora'), resumen: await s.texto('#fResumen'), sum: await s.page.evaluate(() => ['blkGestiones', 'blkContratos', 'blkEquipos'].map(i => document.getElementById(i).open + ' ' + document.getElementById(i).querySelector('.sum').innerText)) });
  await s.captura(`34-admin-escritorio-ficha-${tag}`);
  await s.hacer(() => { document.getElementById('blkGestiones').open = true; });
  log(`a_gestiones_${tag}`, (await s.texto('#fGestiones')).split('\n').filter(Boolean).slice(0, 40));
  const gid = await s.page.evaluate(() => (Centro.gestiones || []).find(g => GestionesService.ABIERTAS.includes(g.estado))?.id || (Centro.gestiones || [])[0]?.id);
  if (gid) {
    await s.hacer((g) => document.getElementById('grow-' + g)?.click(), gid);
    await s.quieto(800);
    log(`a_expediente_${tag}`, (await s.texto('#fGestiones')).split('\n').filter(Boolean).slice(0, 60));
    await s.captura(`35-admin-escritorio-expediente-${tag}`, { el: '#blkGestiones' });
    log(`a_expediente_acciones_${tag}`, await s.page.evaluate((g) => { const x = Centro.gestiones.find(y => y.id === g); return { estado: x.estado, tipo: x.tipo, acc: Centro._accionesGestion(x).map(a => `${a.grupo} | ${a.label} | ${a.ok ? 'ok' : 'NO: ' + a.motivo}`) }; }, gid));
  }
}

// Duplicados
info = await s.ir('/admin/clientes-duplicados.html');
log('a_dup', { ...info, consultas: await s.consultas(), errores: s.errores.slice(0, 6), texto: (await s.texto('body')).slice(0, 1500) });
await s.captura('36-admin-escritorio-duplicados');

// Archivo de gestiones
info = await s.ir('/contratos/index.html?tab=gestiones');
log('a_archivo', { ...info, errores: s.errores.slice(0, 6) });
await s.hacer(() => document.querySelector('[data-tab="gestiones"], #tabGestiones, button[onclick*="gestiones"]')?.click());
await s.quieto(1500);
log('a_archivo_texto', (await s.texto('body')).split('\n').filter(Boolean).slice(0, 40));
await s.captura('37-admin-escritorio-archivo-gestiones');

// Formulario de edición del cliente grande
info = await s.ir('/clientes/ficha.html?id=gFs21DErNjbZFbkGrdAH&from=centro');
log('a_ficha_form', { ...info, geo: await s.geometria(), consultas: await s.consultas(), chips: await s.texto('#chipActivo') + ' | ' + await s.texto('#chipContratos') + ' | ' + await s.texto('#chipHistorial'), docs: await s.page.evaluate(() => document.getElementById('seccionDocumentos')?.style.display + ' ' + document.getElementById('docList')?.innerText.slice(0, 300)) });
await s.captura('38-admin-escritorio-ficha-formulario', { full: true });
await s.hacer(() => document.getElementById('chipHistorial')?.click());
await s.quieto(1000);
log('a_historial_modal', (await s.texto('.modal-backdrop.open, #modalHist')).slice(0, 1200));
await s.captura('39-admin-escritorio-historial-ficha');
await s.cerrar();

// Teléfono, ficha grande
const p = await abrir({ email: USUARIOS.admin, viewport: 'telefono', carpeta: 'centro' });
info = await p.ir('/clientes/centro.html?id=gFs21DErNjbZFbkGrdAH');
log('a_tel_ficha', { ...info, geo: await p.geometria(), dock: await p.texto('#cgDock') });
await p.captura('40-admin-telefono-ficha-grande');
await p.captura('40b-admin-telefono-ficha-grande-completa', { full: true });
await p.cerrar();
