// Recorrido de RECEPCIÓN en la Base PoC (lista, búsqueda, cajón, SIM, masiva,
// cierre, pool) en escritorio, tablet y teléfono. Solo emulador.
//   node docs/auditoria-modulos/scripts/poc/02-recepcion-lista.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

const R = [];
const log = (k, v) => { R.push([k, v]); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };

// La búsqueda vive sobre una suscripción onSnapshot (no una promesa), así que
// quieto() no la ve: se espera a que el conjunto de vivas esté completo
// (PocList._escuchas.vivas.completo o el memo de respaldo) y luego al DOM.
async function buscar(s, campo, valor) {
  await s.page.select('#filtroCampo', campo);
  await s.page.evaluate(() => { const i = document.getElementById('filtroValor'); i.value = ''; i.focus(); });
  const t0 = await s.page.evaluate(() => performance.now());
  const idAntes = await s.page.evaluate(() => PocList._filtroID);
  await s.page.type('#filtroValor', valor);
  const fin = Date.now() + 60000;
  let st = null;
  while (Date.now() < fin) {
    await new Promise(r => setTimeout(r, 150));
    st = await s.page.evaluate((ia) => {
      const e = PocList._escuchas.vivas;
      const c = PocList._escuchas.cerradas;
      const incl = document.getElementById('incluirCerradas')?.checked;
      const datos = (!!(e && e.completo) || !!PocList._allDocs) && (!incl || !!(c && c.completo) || !!PocList._cerradasDocs);
      return { datos, corrio: PocList._filtroID > ia, fallo: !!(e && e.fallo), t: performance.now() };
    }, idAntes);
    if (st.datos && st.corrio) break;
  }
  const tDatos = st.t;
  await s.quieto(1000, 30000);
  const m = await s.page.evaluate(() => ({ filas: document.querySelectorAll('#devicesTable tr[data-id]').length, ultimaMut: window.__m.ultimaMut, resumen: document.getElementById('resumenEquiposTop')?.innerText }));
  return { msDatos: Math.round(tDatos - t0), msPintado: Math.round(m.ultimaMut - t0), filas: m.filas, fallo: st.fallo, resumen: (m.resumen || '').replace(/\s+/g, ' ').trim() };
}
// Modal.confirm/prompt del kit viven en `.overlay` (encima de todo) y las
// hojas en `.modal-backdrop.open`. Se busca el botón por texto en ambos.
async function clicModal(s, texto) {
  const ok = await s.page.evaluate((t) => {
    const b = [...document.querySelectorAll('.overlay button, .overlay .btn, .modal-backdrop.open button, .modal-backdrop.open .btn')].find(x => x.innerText.trim().toLowerCase().includes(t.toLowerCase()));
    if (b) { b.click(); return b.innerText.trim(); } return null;
  }, texto);
  await s.quieto(800, 15000);
  return ok;
}
const modalTexto = (s) => s.page.evaluate(() => [...document.querySelectorAll('.overlay, .modal-backdrop.open')].map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 400)));
const filaPrueba = (s, serial) => s.page.evaluate((sr) => { const r = [...document.querySelectorAll('#devicesTable tr[data-id]')].find(tr => tr.innerText.includes(sr)); return r ? r.dataset.id : null; }, serial);

(async () => {
  // ── Escritorio ──────────────────────────────────────────────────────────
  let s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'poc' });
  try {
    let info = await s.ir('/POC/index.html');
    log('E01 lista msTotal/fsReqs/primeraFs', { msTotal: info.msTotal, fsReqs: info.fsReqs, primeraFs: info.primeraFs, titulo: info.titulo, quieto: info.quieto });
    log('E01 consultas', await s.consultas());
    log('E01 errores', s.errores);
    log('E01 geometria', await s.geometria());
    log('E01 resumen', await s.page.evaluate(() => document.getElementById('resumenEquiposTop')?.innerText));
    await s.captura('01-recepcion-escritorio-lista');

    // Búsqueda por serial real (primera búsqueda paga la suscripción a las vivas)
    let b = await buscar(s, 'serial', '25512A1793');
    log('E02 buscar serial real (1ª búsqueda)', b);
    log('E02 consultas', (await s.consultas()).slice(-4));
    await s.captura('02-recepcion-escritorio-busqueda-serial');
    // Segunda búsqueda: cliente grande (289 fichas)
    b = await buscar(s, 'cliente', 'AGENCIA DE SEGURIDAD UNIDA');
    log('E03 buscar cliente 289 fichas (2ª búsqueda, en memoria)', b);
    await s.captura('03-recepcion-escritorio-cliente-grande');
    // Búsqueda de 2 letras (peor caso)
    b = await buscar(s, 'cliente', 'se');
    log('E04 buscar "se" (peor caso)', b);
    // Incluir cerradas + serial cerrado
    await s.page.evaluate(() => { document.getElementById('incluirCerradas').checked = true; });
    b = await buscar(s, 'serial', '25512A1793');
    log('E05 buscar con cerradas incluidas', b);
    log('E05 consultas', (await s.consultas()).slice(-3));
    await s.page.evaluate(() => { document.getElementById('incluirCerradas').checked = false; });

    // ── Cambiar SIM desde el cajón (flujo más frecuente) ─────────────────
    b = await buscar(s, 'serial', 'PRUEBA-AUDIT-poc-001');
    log('E06 buscar ficha de prueba', b);
    const id001 = await filaPrueba(s, 'PRUEBA-AUDIT-poc-001');
    await s.hacer((id) => { document.querySelector(`#devicesTable tr[data-id="${id}"] button[aria-label="Editar equipo"]`).click(); }, id001);
    log('E07 cajón abierto', await s.page.evaluate(() => !!document.querySelector('#editDrawerOverlay.open')));
    await s.captura('04-recepcion-escritorio-cajon-editar');
    // SIM que YA está en la ficha 002 del mismo cliente (activa): ¿lo valida?
    await s.page.evaluate(() => { document.getElementById('drawer-sim-number').value = ''; document.getElementById('drawer-sim-phone').value = ''; });
    await s.page.type('#drawer-sim-number', '8950799900000000002');
    await s.page.type('#drawer-sim-phone', '6000-0002');
    await s.hacer(() => document.querySelector('#editDrawerOverlay .drawer-actions .btn-primary').click());
    log('E08 guardar SIM repetido → toasts', await s.toasts());
    log('E08 modal', await modalTexto(s));
    log('E08 fila tras guardar', await s.page.evaluate((id) => document.querySelector(`#devicesTable tr[data-id="${id}"]`)?.innerText.replace(/\s+/g, ' '), id001));
    await s.captura('05-recepcion-escritorio-sim-repetido-guardado');

    // ── Asignar del pool a la ficha 004 (sin SIM) ─────────────────────────
    b = await buscar(s, 'cliente', 'PRUEBA-AUDIT-poc');
    log('E09 fichas del cliente de prueba', b);
    const id004 = await filaPrueba(s, 'PRUEBA-AUDIT-poc-004');
    await s.hacer((id) => { document.querySelector(`#devicesTable tr[data-id="${id}"] .seleccion-sim`).click(); }, id004);
    await s.clic('#btnSimPool');
    log('E10 modal pool', (await modalTexto(s))[0]);
    await s.captura('06-recepcion-escritorio-asignar-pool');
    await s.hacer(() => PocSimPool.autoSeleccionar());
    await s.hacer(() => document.querySelector('#simPoolModal .modal-footer .btn-primary').click());
    log('E10 confirmación', (await modalTexto(s)).slice(-1)[0]);
    await s.captura('06b-recepcion-escritorio-asignar-pool-confirmar');
    log('E10 botón', await clicModal(s, 'confirmar'));
    await s.quieto(1500, 15000);
    log('E10 toasts', (await s.toasts()).slice(-3));
    log('E10 fila 004', await s.page.evaluate((id) => document.querySelector(`#devicesTable tr[data-id="${id}"]`)?.innerText.replace(/\s+/g, ' '), id004));

    // ── Edición masiva ────────────────────────────────────────────────────
    b = await buscar(s, 'cliente', 'PRUEBA-AUDIT-poc');
    await s.hacer(() => { document.querySelectorAll('#devicesTable .seleccion-sim').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); });
    await s.clic('#btnEditarMasivo');
    log('E11 masiva activa', await s.page.evaluate(() => ({ inputs: document.querySelectorAll('#devicesTable input.table-input').length, resumen: document.getElementById('resumenEquiposTop')?.innerText.replace(/\s+/g, ' ') })));
    await s.captura('07-recepcion-escritorio-edicion-masiva');
    await s.clic('#btnCancelarMasivo');

    // ── Cerrar ficha 003 (con SIM) ────────────────────────────────────────
    const id003 = await filaPrueba(s, 'PRUEBA-AUDIT-poc-003');
    await s.hacer((id) => { document.querySelector(`#devicesTable tr[data-id="${id}"] button[aria-label="Cerrar ficha"]`).click(); }, id003);
    log('E12 modal cerrar', (await modalTexto(s))[0]);
    await s.captura('08-recepcion-escritorio-cerrar-ficha');
    await clicModal(s, 'cerrar ficha');
    log('E12 modal SIM', (await modalTexto(s))[0]);
    await s.captura('09-recepcion-escritorio-liberar-sim');
    await clicModal(s, 'poner disponibles');
    await s.quieto(1500, 15000);
    log('E12 toasts', (await s.toasts()).slice(-3));
    // Buscar la cerrada
    await s.page.evaluate(() => { document.getElementById('incluirCerradas').checked = true; });
    b = await buscar(s, 'serial', 'PRUEBA-AUDIT-poc-003');
    log('E13 cerrada visible con toggle', { ...b, fila: await s.page.evaluate(() => document.querySelector('#devicesTable tr[data-id]')?.innerText.replace(/\s+/g, ' ')) });
    await s.captura('10-recepcion-escritorio-ficha-cerrada');
    await s.page.evaluate(() => { document.getElementById('incluirCerradas').checked = false; });

    // ── Duplicados ────────────────────────────────────────────────────────
    let t0 = await s.page.evaluate(() => performance.now());
    await s.hacer(() => PocList.filtrarDuplicados('serial'));
    await s.quieto(1500, 40000);
    let m = await s.page.evaluate(() => ({ filas: document.querySelectorAll('#devicesTable tr[data-id]').length, ultimaMut: window.__m.ultimaMut, resumen: document.getElementById('resumenEquiposTop')?.innerText.replace(/\s+/g, ' ') }));
    log('E14 duplicados serial', { ms: Math.round(m.ultimaMut - t0), filas: m.filas, resumen: m.resumen });
    await s.captura('11-recepcion-escritorio-duplicados-serial');
    t0 = await s.page.evaluate(() => performance.now());
    await s.hacer(() => PocList.filtrarDuplicados('sim'));
    await s.quieto(1500, 40000);
    m = await s.page.evaluate(() => ({ filas: document.querySelectorAll('#devicesTable tr[data-id]').length, ultimaMut: window.__m.ultimaMut, resumen: document.getElementById('resumenEquiposTop')?.innerText.replace(/\s+/g, ' ') }));
    log('E15 duplicados SIM', { ms: Math.round(m.ultimaMut - t0), filas: m.filas, resumen: m.resumen });
    log('E15 acciones en fila duplicada', await s.page.evaluate(() => [...document.querySelectorAll('#devicesTable tr[data-id]')].slice(0, 1).map(r => [...r.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.title))));

    // ── Deep-link ?focus= (Ctrl+K) ────────────────────────────────────────
    info = await s.ir(`/POC/index.html?focus=${encodeURIComponent('PRUEBA-AUDIT-poc-001')}&campo=serial&id=${id001}`);
    log('E16 deep-link focus', { msTotal: info.msTotal, fsReqs: info.fsReqs, filas: await s.page.evaluate(() => document.querySelectorAll('#devicesTable tr[data-id]').length), resaltada: await s.page.evaluate(() => !!document.querySelector('#devicesTable tr[data-id][style*="outline"]')) });
    await s.captura('12-recepcion-escritorio-deeplink-focus');

    // ── Mostrar todo (4,590 filas) ───────────────────────────────────────
    info = await s.ir('/POC/index.html');
    t0 = await s.page.evaluate(() => performance.now());
    await s.page.evaluate(() => PocList.mostrarTodo());
    await s.quieto(2500, 90000);
    m = await s.page.evaluate(() => ({ filas: document.querySelectorAll('#devicesTable tr[data-id]').length, ultimaMut: window.__m.ultimaMut, alto: document.documentElement.scrollHeight }));
    log('E17 Mostrar todo', { ms: Math.round(m.ultimaMut - t0), filas: m.filas, alto: m.alto });
    log('E17 errores', s.errores.slice(0, 5));
  } catch (e) { log('ERROR escritorio', String(e)); console.error(e); }
  await s.cerrar();

  // ── Tablet ──────────────────────────────────────────────────────────────
  s = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'poc' });
  try {
    const info = await s.ir('/POC/index.html');
    log('T01 tablet lista', { msTotal: info.msTotal, fsReqs: info.fsReqs });
    log('T01 geometria', await s.geometria());
    await s.captura('13-recepcion-tablet-lista');
    const b = await buscar(s, 'serial', 'PRUEBA-AUDIT-poc-001');
    const id = await filaPrueba(s, 'PRUEBA-AUDIT-poc-001');
    await s.hacer((i) => { document.querySelector(`#devicesTable tr[data-id="${i}"] button[aria-label="Editar equipo"]`).click(); }, id);
    log('T02 cajón tablet', await s.page.evaluate(() => { const d = document.getElementById('editDrawer'); const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth }; }));
    await s.captura('14-recepcion-tablet-cajon');
    await s.hacer(() => PocEdit.cerrar());
    log('T03 columnas visibles', await s.page.evaluate(() => { const w = document.querySelector('.app-table-wrap'); return { scrollW: w.scrollWidth, clientW: w.clientWidth, tablaMasAncha: w.scrollWidth > w.clientWidth + 2 }; }));
  } catch (e) { log('ERROR tablet', String(e)); }
  await s.cerrar();

  // ── Teléfono ────────────────────────────────────────────────────────────
  s = await abrir({ email: USUARIOS.recepcion, viewport: 'telefono', carpeta: 'poc' });
  try {
    const info = await s.ir('/POC/index.html');
    log('M01 teléfono lista', { msTotal: info.msTotal, fsReqs: info.fsReqs });
    log('M01 geometria', await s.geometria());
    await s.captura('15-recepcion-telefono-lista');
    const b = await buscar(s, 'serial', 'PRUEBA-AUDIT-poc-001');
    log('M02 buscar', b);
    await s.captura('16-recepcion-telefono-busqueda', { full: true });
  } catch (e) { log('ERROR telefono', String(e)); }
  await s.cerrar();
  console.log('\n=== RESUMEN ===');
  R.forEach(([k, v]) => console.log(k, '→', typeof v === 'string' ? v : JSON.stringify(v)));
})();
