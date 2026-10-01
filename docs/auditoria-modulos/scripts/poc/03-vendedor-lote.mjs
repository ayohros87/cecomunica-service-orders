// Ventas prepara un lote y lo envía a recepción; recepción lo carga desde la
// cola de "Nuevo lote" y crea los equipos. Solo emulador, datos PRUEBA-AUDIT-poc.
// También reproduce el bug de la lista parcial de clientes en "Preparar lote".
//   node docs/auditoria-modulos/scripts/poc/03-vendedor-lote.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

const R = [];
const log = (k, v) => { R.push([k, v]); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };
const modalTexto = (s) => s.page.evaluate(() => [...document.querySelectorAll('.overlay, .modal-backdrop.open')].map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 500)));
async function clicModal(s, texto) {
  const ok = await s.page.evaluate((t) => {
    const b = [...document.querySelectorAll('.overlay button, .overlay .btn, .modal-backdrop.open button, .modal-backdrop.open .btn')].find(x => x.innerText.trim().toLowerCase().includes(t.toLowerCase()));
    if (b) { b.click(); return b.innerText.trim(); } return null;
  }, texto);
  await s.quieto(800, 15000);
  return ok;
}
const CLIENTE = 'PRUEBA-AUDIT-poc CLIENTE';

(async () => {
  // ── Ventas: preparar y enviar ────────────────────────────────────────
  let s = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'poc' });
  try {
    // Camino real: la vendedora entra por el home y de ahí a Preparar lote.
    let info = await s.ir('/index.html');
    log('V00 home vendedor', { msTotal: info.msTotal, rail: await s.page.evaluate(() => [...document.querySelectorAll('#rail-mount a')].map(a => a.innerText.trim()).filter(Boolean).join(' | ')) });
    info = await s.ir('/POC/index.html');
    log('V00b vendedor abre Base PoC', { url: info.url });
    info = await s.ir('/POC/vendedores-batch.html');
    log('V01 preparar lote', { msTotal: info.msTotal, fsReqs: info.fsReqs, titulo: info.titulo, url: info.url });
    log('V01 consultas', await s.consultas());
    await s.captura('20-vendedor-escritorio-preparar-lote');
    // BUG a reproducir: lista de clientes parcial (cache-first) y cacheada 6 h en localStorage
    const conteo = await s.page.evaluate(async () => {
      if (!VB.clientesCargados) await VB.cargarClientesCache();
      const enCombo = VB.clientesCache.length;
      const servidor = (await ClientesService.getAllClientes({ fresh: true })).length;
      let ls = null; try { ls = JSON.parse(localStorage.getItem('cache_clientes_v1') || 'null'); } catch (_) {}
      return { enCombo, servidor, enLocalStorage: ls?.data?.length ?? null, expiraEn_h: ls?.exp ? Math.round((ls.exp - Date.now()) / 36e5) : null };
    });
    log('V02 clientes que ve la vendedora en el combo vs servidor', conteo);
    // 1) cliente (teclear + salir del campo = carga los grupos)
    await s.page.type('#clienteGlobal', CLIENTE);
    await s.page.evaluate(() => document.getElementById('clienteGlobal').blur());
    await s.quieto(1200, 15000);
    let est = await s.page.evaluate(() => ({ id: VB.clienteIDSeleccionado, grupos: VB.grupos, badge: document.getElementById('badgeCliente')?.innerText }));
    log('V03 cliente + grupos (sin refrescar)', est);
    if (!est.id) {
      await s.hacer(() => VB.refrescarClientes());
      await s.page.evaluate(() => { document.getElementById('clienteGlobal').value = ''; });
      await s.page.type('#clienteGlobal', CLIENTE);
      await s.page.evaluate(() => document.getElementById('clienteGlobal').blur());
      await s.quieto(1200, 15000);
      est = await s.page.evaluate(() => ({ id: VB.clienteIDSeleccionado, grupos: VB.grupos, badge: document.getElementById('badgeCliente')?.innerText, enCombo: VB.clientesCache.length }));
      log('V03b tras "Actualizar lista de clientes"', est);
    }
    // 2) modelo global
    await s.page.evaluate(() => { const sel = document.getElementById('modeloGlobal'); const o = [...sel.options].find(x => /PNC360S-R/i.test(x.textContent)); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change')); } });
    // 3) nombres
    await s.page.type('#serialesPaste', 'PRUEBA-AUDIT LOTE R1\nPRUEBA-AUDIT LOTE R2\nPRUEBA-AUDIT LOTE R3');
    // 4) generar tabla
    await s.hacer(() => VB.generarTabla());
    log('V04 tabla', await s.page.evaluate(() => ({ filas: document.querySelectorAll('#cuerpoTabla tr').length, resumen: document.getElementById('vbResumenCompletitud')?.innerText.replace(/\s+/g, ' ') })));
    // 5) grupo a todas (barra en lote)
    await s.hacer(() => { const cb = document.querySelector('#bulkBar .bulk-grupo'); if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); } });
    log('V05 tras aplicar grupo', await s.page.evaluate(() => document.getElementById('vbResumenCompletitud')?.innerText.replace(/\s+/g, ' ')));
    await s.captura('21-vendedor-escritorio-tabla-lote', { full: true });
    // 6) enviar a recepción
    await s.page.type('#vbNotas', 'PRUEBA-AUDIT-poc lote de auditoría (2)');
    await s.clic('#btnEnviarRecepcion');
    let m = await modalTexto(s);
    log('V06 modal al enviar', m);
    if (m.length) await clicModal(s, 'enviar');
    await s.quieto(1500, 20000);
    log('V06 toasts', (await s.toasts()).map(t => t.msg));
    log('V06 enviado', await s.page.evaluate(() => document.getElementById('vbEnviado')?.innerText.replace(/\s+/g, ' ')));
    log('V06 errores', s.errores);
    await s.captura('22-vendedor-escritorio-lote-enviado', { full: true });
  } catch (e) { log('ERROR vendedor', String(e)); console.error(e); }
  await s.cerrar();

  // ── Recepción: home → señal → nuevo lote ──────────────────────────────
  s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'poc' });
  try {
    let info = await s.ir('/index.html');
    log('R01 home señal lotes', await s.page.evaluate(() => [...document.querySelectorAll('.signal, .senal, [data-signal], a[href*="nuevo-batch"]')].map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 120)).filter(t => /lote/i.test(t)).slice(0, 2)));
    await s.captura('23-recepcion-escritorio-home-senal-lotes');
    info = await s.ir('/POC/nuevo-batch.html');
    log('R02 nuevo lote', { msTotal: info.msTotal, fsReqs: info.fsReqs, titulo: info.titulo });
    log('R02 consultas', await s.consultas());
    log('R02 cola', await s.page.evaluate(() => ({ visible: !document.getElementById('nbLotesPrep').hidden, n: document.getElementById('nbLotesPrepCount')?.innerText, filas: document.getElementById('nbLotesPrepLista')?.innerText.replace(/\s+/g, ' ').slice(0, 400) })));
    await s.captura('24-recepcion-escritorio-nuevo-lote-cola', { full: true });
    // Descartar el lote viejo de prueba (el primero que salió sin cliente_id)
    await s.hacer(() => { const b = [...document.querySelectorAll('[data-lote-descartar]')].find(x => x.closest('tr')?.innerText.includes('PRUEBA-AUDIT') && !x.closest('tr')?.innerText.includes('(2)')); if (b) b.click(); });
    log('R02b prompt descartar', (await modalTexto(s)).slice(-1)[0]);
    await s.page.type('.overlay [data-role="prompt-input"]', 'PRUEBA-AUDIT-poc: lote repetido de la auditoría');
    await clicModal(s, 'descartar');
    log('R02b toasts', (await s.toasts()).map(t => t.msg));
    // Cargar el lote (2) de la cola
    await s.hacer(() => { const b = [...document.querySelectorAll('[data-lote-cargar]')].find(x => x.closest('tr')?.innerText.includes('(2)')); if (b) b.click(); });
    await s.quieto(1500, 20000);
    log('R03 lote cargado', await s.page.evaluate(() => ({
      toasts: window.__toasts.map(t => t.msg).slice(-3), cliente: document.getElementById('cliente')?.selectedOptions[0]?.textContent, ip: document.getElementById('ip')?.value,
      contrato: document.getElementById('contratoJalar')?.innerText.replace(/\s+/g, ' ').slice(0, 120), unitId: document.getElementById('unit_id_inicial')?.value,
      nota: document.getElementById('nbPaso1Nota')?.innerText, preview: document.getElementById('previewVendedor')?.innerText.replace(/\s+/g, ' ').slice(0, 220),
      avisoSinContrato: !document.getElementById('avisoSinContrato').hidden, extra: document.getElementById('avisoSinContratoExtra')?.innerText,
    })));
    await s.captura('25-recepcion-escritorio-nuevo-lote-cargado', { full: true });
    // Seriales a mano (no hay contrato del que jalar)
    await s.page.evaluate(() => document.querySelector('.nb-adv')?.setAttribute('open', 'open'));
    await s.page.type('#seriales', 'PRUEBA-AUDIT-poc-101\nPRUEBA-AUDIT-poc-102\nPRUEBA-AUDIT-poc-103');
    await s.quieto(800, 5000);
    log('R04 preview con seriales', await s.page.evaluate(() => ({ aviso: document.querySelector('#previewVendedor .preview-aviso, #previewVendedor .preview-ok')?.innerText, sinContrato: !document.getElementById('avisoSinContrato').hidden })));
    await s.captura('26-recepcion-escritorio-nuevo-lote-preview', { full: true });
    // Crear equipos: contar modales
    const modales = [];
    await s.page.evaluate(() => document.querySelector('#batchForm button[type="submit"]').click());
    for (let i = 0; i < 8; i++) {
      await s.quieto(700, 20000);
      const url = await s.page.evaluate(() => location.pathname).catch(() => '');
      if (url.endsWith('/POC/index.html')) break;
      let m = await modalTexto(s).catch(() => []);
      if (!m.length) { await new Promise(r => setTimeout(r, 1500)); m = await modalTexto(s).catch(() => []); if (!m.length) continue; }
      modales.push(m[m.length - 1]);
      if (modales.length === 1) await s.captura('27-recepcion-escritorio-nuevo-lote-modal');
      const ok = await clicModal(s, 'guardar de todos') || await clicModal(s, 'crear') || await clicModal(s, 'continuar') || await clicModal(s, 'confirmar');
      log('R05 modal ' + modales.length, { texto: modales[modales.length - 1].slice(0, 220), boton: ok });
    }
    await s.quieto(1500, 20000);
    log('R05 resultado', { modales: modales.length, url: await s.page.evaluate(() => location.pathname), toasts: (await s.toasts()).map(t => t.msg).slice(-4), errores: s.errores.slice(0, 5) });
    log('R05 validación nativa', await s.page.evaluate(() => { const f = document.getElementById('batchForm'); return f ? { valido: f.checkValidity(), invalidos: [...f.querySelectorAll(':invalid')].map(e => e.id) } : 'ya no está en el lote'; }));
  } catch (e) { log('ERROR recepcion lote', String(e)); console.error(e); }
  await s.cerrar();

  // ── Ventas: ve el lote cargado ──────────────────────────────────────────
  s = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'poc' });
  try {
    await s.ir('/POC/vendedores-batch.html');
    log('V07 mis lotes tras cargar', await s.page.evaluate(() => document.getElementById('vbMisLotes')?.innerText.replace(/\s+/g, ' ').slice(0, 400)));
    await s.captura('28-vendedor-escritorio-mis-lotes', { el: '#vbMisLotesBox' });
  } catch (e) { log('ERROR vendedor 2', String(e)); }
  await s.cerrar();
  console.log('\n=== RESUMEN ===');
  R.forEach(([k, v]) => console.log(k, '→', typeof v === 'string' ? v : JSON.stringify(v)));
})();
