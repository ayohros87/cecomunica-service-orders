// ¿La topbar de /almacen/ deja que un rol sin Almacén ejecute acciones?
// La página rechaza el cuerpo ("Esta área es de administración e inventario")
// pero pinta los botones. Recepción y vendedor tienen update en equipos_pool
// (firestore.rules puedeGestionarSeriales), así que una venta podría pasar.
// Prueba: recepción vende AUDALM0005 (ficha PRUEBA-AUDIT, en bodega) por
// excepción; técnico intenta recibir AUDALM0011 (nuevo). Se mira el toast.
//   node 08-guard-topbar-roles.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (...a) => console.log(...a);
const CONFIRM = '.overlay [data-action="confirm"]';
async function confirmar(p, s) { await p.waitForSelector(CONFIRM, { timeout: 8000, visible: true }).catch(() => {}); await p.evaluate((sel) => { const os = document.querySelectorAll(sel); os[os.length - 1]?.click(); }, CONFIRM); await s.quieto(800, 10000); }
const textoDialogo = (p) => p.evaluate(() => { const os = document.querySelectorAll('.overlay'); const o = os[os.length - 1]; if (o) return o.innerText.replace(/\n{2,}/g, '\n').slice(0, 300); const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; return m ? m.innerText.replace(/\n{2,}/g, '\n').slice(0, 300) : '(nada)'; });

for (const [rol, email, serial, accion] of [['recepcion', USUARIOS.recepcion, 'AUDALM0005', 'venta'], ['vendedor', USUARIOS.vendedor, 'AUDALM0001', 'venta'], ['tecnico', USUARIOS.tecnico, 'AUDALM0011', 'recibir']]) {
  const s = await abrir({ email, viewport: 'escritorio', carpeta: 'almacen' });
  const p = s.page;
  log(`\n=== ${rol} · ${accion} ${serial} ===`);
  await s.ir('/almacen/index.html', { esperar: 1000 });
  log('cuerpo: ' + (await s.texto('#bodyAlmacen')).slice(0, 80).replace(/\n/g, ' / '));
  if (accion === 'venta') {
    await p.evaluate(() => [...document.querySelectorAll('.topbar-actions button, .topbar-actions a')].find(b => /Registrar venta/.test(b.textContent))?.click());
    await p.waitForSelector('#asvFactura', { timeout: 10000, visible: true }).catch(() => {});
    await s.quieto(500, 5000);
    await p.evaluate((serial) => { const ta = document.querySelector('#asvSeriales'); if (ta) { ta.value = serial; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, serial);
    await p.focus('#asvCliente'); await p.keyboard.type('PRUEBA-AUDIT-almacen CLIENTE', { delay: 5 });
    await p.focus('#asvFactura'); await p.keyboard.type('PRUEBA-AUDIT-guard', { delay: 5 });
    await p.click('#asvBtnGuardar'); await s.quieto(800, 8000);
    log('   diálogo 1: ' + (await textoDialogo(p)).replace(/\n/g, ' / ').slice(0, 160));
    await confirmar(p, s);
    log('   diálogo 2: ' + (await textoDialogo(p)).replace(/\n/g, ' / ').slice(0, 200));
    await confirmar(p, s);
    await s.quieto(1500, 10000);
    log('   diálogo 3: ' + (await textoDialogo(p)).replace(/\n/g, ' / ').slice(0, 200));
    await confirmar(p, s).catch(() => {});
  } else {
    await p.evaluate(() => [...document.querySelectorAll('.topbar-actions button, .topbar-actions a')].find(b => /Recibir equipos/.test(b.textContent))?.click());
    await p.waitForSelector('#asrSeriales', { timeout: 10000, visible: true }).catch(() => {});
    await p.focus('#asrModeloFiltro'); await p.keyboard.type('PNC360S-R', { delay: 5 }); await s.quieto(400, 3000);
    await p.evaluate((serial) => { const ta = document.querySelector('#asrSeriales'); ta.value = serial; ta.dispatchEvent(new Event('input', { bubbles: true })); }, serial);
    await p.click('#asrBtnGuardar'); await s.quieto(2000, 12000);
  }
  await s.captura(`70-${rol}-escritorio-almacen-${accion}-resultado`);
  log('   toasts: ' + JSON.stringify((await s.toasts()).slice(-3)));
  log('   errores: ' + [...new Set(s.errores)].filter(e => !/favicon|lucide/.test(e)).slice(0, 4).join(' | '));
  await s.cerrar();
}
