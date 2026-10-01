// Admin en las pantallas satélite de PoC: SIM cards, nueva consola, grupos,
// importar, imprimir; y cómo ven la Base PoC los roles de solo lectura.
//   node docs/auditoria-modulos/scripts/poc/04-admin-sims-consola-grupos.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

const R = [];
const log = (k, v) => { R.push([k, v]); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };
const modalTexto = (s) => s.page.evaluate(() => [...document.querySelectorAll('.overlay, .modal-backdrop.open')].map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 400)));

(async () => {
  let s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'poc' });
  try {
    // ── SIM cards ─────────────────────────────────────────────────────────
    let info = await s.ir('/POC/sim-cards.html');
    log('A01 sim-cards', { msTotal: info.msTotal, fsReqs: info.fsReqs, titulo: info.titulo });
    log('A01 consultas', await s.consultas());
    log('A01 tabs', await s.page.evaluate(() => [...document.querySelectorAll('.sim-tab')].map(b => b.innerText.replace(/\s+/g, ' '))));
    log('A01 geometria', await s.geometria());
    await s.captura('30-admin-escritorio-sim-cards');
    await s.page.type('#simBusqueda', '89507999000000000');
    await s.quieto(800, 5000);
    await s.hacer(() => SimCards.setTab('todos'));
    log('A02 buscar SIMs de prueba (todos)', await s.page.evaluate(() => [...document.querySelectorAll('#simTabla tr')].map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 120))));
    await s.captura('31-admin-escritorio-sim-cards-busqueda');
    await s.hacer(() => SimCards.abrirImport());
    log('A03 import modal', (await modalTexto(s))[0]);
    await s.captura('32-admin-escritorio-sim-import');
    await s.hacer(() => SimCards.cerrarImport());

    // ── Nueva consola ─────────────────────────────────────────────────────
    info = await s.ir('/POC/nueva-consola.html');
    log('A04 nueva consola', { msTotal: info.msTotal, fsReqs: info.fsReqs, titulo: info.titulo });
    await s.page.type('#clienteFiltro', 'PRUEBA-AUDIT');
    await s.quieto(1500, 15000);
    log('A05 cliente elegido', await s.page.evaluate(() => ({ cliente: document.getElementById('cliente')?.selectedOptions[0]?.textContent, ip: document.getElementById('ip')?.value, aviso: document.getElementById('avisoContrato')?.innerText, nombre: document.getElementById('nombre')?.value, btnGrupos: document.getElementById('btnTodosGrupos')?.innerText })));
    await s.page.type('#unit_id', 'PRUEBA-AUDIT-C1');
    await s.hacer(() => document.getElementById('btnTodosGrupos').click());
    log('A05 grupos', await s.page.evaluate(() => document.getElementById('gruposCuenta')?.innerText));
    await s.captura('33-admin-escritorio-nueva-consola', { full: true });
    await s.page.evaluate(() => document.getElementById('btnGuardar').click());
    await s.quieto(1500, 20000);
    log('A06 consola creada', { url: await s.page.evaluate(() => location.pathname), toasts: (await s.toasts()).map(t => t.msg), errores: s.errores.slice(0, 3) });

    // ── Administrar grupos ────────────────────────────────────────────────
    info = await s.ir('/admin/grupos.html');
    log('A07 grupos', { msTotal: info.msTotal, fsReqs: info.fsReqs, titulo: info.titulo });
    log('A07 consultas', await s.consultas());
    log('A07 topbar/h1', await s.page.evaluate(() => (document.querySelector('#topbar-mount')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160)));
    await s.captura('34-admin-escritorio-grupos');
    await s.page.type('#gpClienteSearch', 'PRUEBA-AUDIT');
    await s.quieto(1000, 10000);
    await s.hacer(() => { const it = document.querySelector('#gpClienteList [data-id], #gpClienteList li, #gpClienteList button, #gpClienteList .gp-cliente'); if (it) it.click(); });
    await s.quieto(1500, 15000);
    log('A08 grupos del cliente de prueba', await s.page.evaluate(() => ({ total: document.getElementById('gpTotalGrupos')?.innerText, lista: document.getElementById('gpGrupoList')?.innerText.replace(/\s+/g, ' ').slice(0, 300), prefijo: document.getElementById('gpPrefijoBar')?.innerText.replace(/\s+/g, ' ').slice(0, 160) })));
    await s.captura('35-admin-escritorio-grupos-cliente', { full: true });

    // ── Importar e imprimir ───────────────────────────────────────────────
    info = await s.ir('/POC/importar-poc.html');
    log('A09 importar', { msTotal: info.msTotal, titulo: info.titulo });
    await s.captura('36-admin-escritorio-importar');
    info = await s.ir('/POC/index.html');
    const ids = await s.page.evaluate(async () => { const r = await PocService.getByCliente({ clienteId: 'PRUEBA-AUDIT-poc-cliente', fresh: true }); return r.filter(d => d.deleted !== true).map(d => d.id); });
    info = await s.ir('/POC/imprimir-equipos.html?ids=' + encodeURIComponent(JSON.stringify(ids)));
    log('A10 imprimir', { msTotal: info.msTotal, fsReqs: info.fsReqs, ids: ids.length, consultas: (await s.consultas()).length });
    await s.captura('37-admin-escritorio-imprimir', { full: true });
    log('A10 errores', s.errores.slice(0, 5));
  } catch (e) { log('ERROR admin', String(e)); console.error(e); }
  await s.cerrar();

  // ── Roles de solo lectura y sin acceso ──────────────────────────────────
  for (const [rol, email] of [['jefe_taller', USUARIOS.jefe_taller], ['tecnico', USUARIOS.tecnico], ['inventario', USUARIOS.inventario], ['contabilidad', USUARIOS.contabilidad]]) {
    s = await abrir({ email, viewport: 'escritorio', carpeta: 'poc' });
    try {
      const info = await s.ir('/POC/index.html');
      await new Promise(r => setTimeout(r, 1500));
      log(`B ${rol} Base PoC`, { url: await s.page.evaluate(() => location.pathname), toasts: (await s.toasts()).map(t => t.msg), botones: await s.page.evaluate(() => [...document.querySelectorAll('.app-toolbar .btn, #topbar-mount .btn')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 12)), railPoc: await s.page.evaluate(() => !!document.querySelector('#rail-mount a[href*="POC"]')) });
      if (rol === 'jefe_taller') await s.captura('38-jefe-taller-escritorio-lista-solo-lectura');
    } catch (e) { log('ERROR ' + rol, String(e)); }
    await s.cerrar();
  }
  console.log('\n=== RESUMEN ===');
  R.forEach(([k, v]) => console.log(k, '→', typeof v === 'string' ? v : JSON.stringify(v)));
})();
