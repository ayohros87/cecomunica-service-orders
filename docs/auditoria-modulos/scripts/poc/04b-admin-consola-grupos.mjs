// Admin: nueva consola y Administrar grupos con el cliente de prueba
// (repite el tramo A04–A08 del script 04 una vez que el cliente lleva deleted:false).
//   node docs/auditoria-modulos/scripts/poc/04b-admin-consola-grupos.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const R = [];
const log = (k, v) => { R.push([k, v]); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };
const modalTexto = (s) => s.page.evaluate(() => [...document.querySelectorAll('.overlay, .modal-backdrop.open')].map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 400)));

(async () => {
  const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'poc' });
  try {
    let info = await s.ir('/POC/nueva-consola.html');
    log('A04 nueva consola', { msTotal: info.msTotal, fsReqs: info.fsReqs, titulo: info.titulo });
    log('A04 consultas', await s.consultas());
    await s.page.type('#clienteFiltro', 'PRUEBA-AUDIT-poc');
    await s.quieto(1500, 15000);
    log('A05 cliente elegido', await s.page.evaluate(() => ({ cliente: document.getElementById('cliente')?.selectedOptions[0]?.textContent, ip: document.getElementById('ip')?.value, aviso: document.getElementById('avisoContrato')?.innerText, nombre: document.getElementById('nombre')?.value, btnGrupos: document.getElementById('btnTodosGrupos')?.innerText })));
    await s.page.type('#unit_id', 'PRUEBA-AUDIT-C1');
    await s.hacer(() => document.getElementById('btnTodosGrupos').click());
    log('A05 grupos', await s.page.evaluate(() => document.getElementById('gruposCuenta')?.innerText));
    await s.captura('33-admin-escritorio-nueva-consola', { full: true });
    await s.page.evaluate(() => document.getElementById('btnGuardar').click());
    await s.quieto(1500, 20000);
    log('A06 consola creada', { url: await s.page.evaluate(() => location.pathname), toasts: (await s.toasts()).map(t => t.msg), errores: s.errores.slice(0, 3) });

    info = await s.ir('/admin/grupos.html');
    log('A07 grupos', { msTotal: info.msTotal, fsReqs: info.fsReqs, titulo: info.titulo });
    log('A07 consultas', await s.consultas());
    await s.captura('34-admin-escritorio-grupos');
    await s.page.type('#gpClienteSearch', 'PRUEBA-AUDIT-poc');
    await s.quieto(1000, 10000);
    log('A08 lista filtrada', await s.page.evaluate(() => document.getElementById('gpClienteList')?.innerText.replace(/\s+/g, ' ').slice(0, 200)));
    await s.hacer(() => { const it = [...document.querySelectorAll('#gpClienteList *')].find(e => e.children.length === 0 && /PRUEBA-AUDIT-poc/.test(e.textContent)); if (it) it.click(); });
    await s.quieto(1500, 15000);
    log('A08 grupos del cliente de prueba', await s.page.evaluate(() => ({ total: document.getElementById('gpTotalGrupos')?.innerText, lista: document.getElementById('gpGrupoList')?.innerText.replace(/\s+/g, ' ').slice(0, 300), prefijo: document.getElementById('gpPrefijoBar')?.innerText.replace(/\s+/g, ' ').slice(0, 160), addPanel: document.getElementById('gpAddPanel')?.innerText.replace(/\s+/g, ' ').slice(0, 200) })));
    await s.captura('35-admin-escritorio-grupos-cliente', { full: true });
    log('A08 geometria', await s.geometria());
  } catch (e) { log('ERROR admin', String(e)); console.error(e); }
  await s.cerrar();
  console.log('\n=== RESUMEN ===');
  R.forEach(([k, v]) => console.log(k, '→', typeof v === 'string' ? v : JSON.stringify(v)));
})();
