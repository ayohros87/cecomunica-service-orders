// Auditoría CONTRATOS · Paso B: admin (Alberto) aprueba el contrato desde el
// Centro. Captura la señal del home, la cola "Ahora", la línea de tiempo del
// trámite antes/después y cuenta interacciones. Uso: node 11-admin-aprueba.mjs
import { abrir, USUARIOS, blindar, contador, clicTexto, leerEstado, espera } from './_lib.mjs';
const { clienteId, contratoId, contratoNum } = leerEstado();
const s = await blindar(await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'contratos' }));
const k = contador('admin aprueba');
try {
  const home = await s.ir('/index.html');
  const apr = await s.page.evaluate(() => document.querySelector('[data-signal-val="APR"]')?.textContent?.trim() || '(sin señal)');
  const fir = await s.page.evaluate(() => ({ FIR: document.querySelector('[data-signal-val="FIR"]')?.textContent?.trim(), FIRV: document.querySelector('[data-signal-val="FIRV"]')?.textContent?.trim() }));
  console.log('home admin', home.msTotal, 'ms · APR =', apr, '· firmar', JSON.stringify(fir));
  // Abrir el panel de "Pendientes por aprobar" para ver la fila del contrato de prueba.
  await s.page.click('[data-signal="APR"]').catch(() => {}); await s.quieto(1500);
  await s.captura('10-admin-escritorio-home-pendientes-por-aprobar');
  const panel = await s.texto('.bj-panel'); console.log('panel APR:', panel.replace(/\n/g, ' | ').slice(0, 500));
  k.paso('home: clic en la señal "Pendientes por aprobar" y clic en la fila del contrato', 2);

  const c = await s.ir(`/clientes/centro.html?id=${encodeURIComponent(clienteId)}&contrato=${encodeURIComponent(contratoId)}`);
  console.log('centro (deep-link ?contrato=)', c.msTotal, 'ms');
  await s.page.evaluate(() => window.Centro?.abrirBloque?.('blkGestiones')); await s.quieto(800);
  await s.page.evaluate((id) => window.Centro.abrirGestion('ct-' + id), contratoId); await s.quieto(1000);
  await s.captura('11-admin-escritorio-tramite-antes-de-aprobar', { full: true });
  const exp = await s.page.evaluate((id) => document.getElementById('grow-ct-' + id)?.parentElement?.innerText || '', contratoId);
  console.log('expediente antes:', exp.replace(/\n/g, ' | ').slice(0, 1200));

  // Camino feliz: la cola "Ahora" trae "Aprobar" directo.
  const ahora = await s.texto('#fAhora'); console.log('Ahora:', ahora.replace(/\n/g, ' | ').slice(0, 300));
  const t0 = Date.now();
  await clicTexto(s, 'Aprobar', { dentro: '#fAhora', esperar: 1500 }); k.paso('clic "Aprobar" en la cola Ahora (sin confirmación)');
  console.log('aprobar →', Date.now() - t0, 'ms · toasts:', JSON.stringify((await s.toasts()).slice(-2)));
  await espera(800);
  await s.page.evaluate(() => window.Centro?.abrirBloque?.('blkGestiones')); await s.quieto(600);
  await s.page.evaluate((id) => window.Centro.abrirGestion('ct-' + id), contratoId); await s.quieto(1000);
  await s.captura('12-admin-escritorio-tramite-aprobado-esperando-seriales', { full: true });
  const exp2 = await s.page.evaluate((id) => document.getElementById('grow-ct-' + id)?.parentElement?.innerText || '', contratoId);
  console.log('expediente después:', exp2.replace(/\n/g, ' | ').slice(0, 1200));
  const est = await s.page.evaluate((id) => (window.Centro?.contratos || []).find(c => c.id === id)?.estado, contratoId);
  console.log('estado:', est, contratoNum);
  // Menú ⋯ del contrato: qué ofrece al admin en este estado.
  await s.page.evaluate((id) => document.querySelector(`#grow-ct-${id} .cg-masbtn`)?.click(), contratoId); await s.quieto(600);
  await s.captura('13-admin-escritorio-menu-acciones-aprobado');
  const menu = await s.texto('.cg-menu:not(.hidden), #cgAcciones, .cg-menu-acc'); console.log('menú ⋯:', menu.replace(/\n/g, ' | ').slice(0, 700));
  console.log('\n' + k.tabla());
  console.log('errores:', s.errores.filter(e => !/favicon|lucide/i.test(e)).slice(0, 8));
} finally { await s.cerrar(); }
