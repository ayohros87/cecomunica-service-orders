import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
{
  const t = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'home-nav' });
  await t.ir('/ordenes/editar-orden.html?id=2026093002', { esperar: 1500 });
  console.log('técnico editar-orden toasts:', JSON.stringify(await t.toasts()), '| errores:', t.errores.slice(0, 4));
  console.log('toasts visibles:', await t.page.evaluate(() => [...document.querySelectorAll('.toast')].map(x => x.className + ': ' + x.innerText.trim().slice(0, 100))));
  await t.cerrar();
  const r = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'home-nav' });
  await r.ir('/ordenes/editar-orden.html?id=2026093002', { esperar: 1500 });
  console.log('recepción editar-orden toasts:', JSON.stringify(await r.toasts()), '| errores:', r.errores.slice(0, 4));
  // lote PoC: ¿recepción puede contar?
  const lpc = await r.page.evaluate(async () => { try { const s = await firebase.firestore().collection('poc_lotes_preparados').where('estado', '==', 'pendiente').get(); return { n: s.size, docs: s.docs.map(d => ({ id: d.id, ...Object.fromEntries(Object.entries(d.data()).filter(([k]) => /estado|creado|vendedor|cliente|fecha/.test(k)).map(([k, v]) => [k, v && v.toDate ? v.toDate().toISOString() : v])) })) }; } catch (e) { return 'ERR ' + (e.code || e.message); } });
  console.log('recepción lotes pendientes:', JSON.stringify(lpc));
  await r.cerrar();
}
{
  const a = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'home-nav' });
  await a.ir('/admin/uso.html', { esperar: 1500 }); await a.quieto(1500, 10000);
  console.log('uso.html:', JSON.stringify(await a.page.evaluate(() => ({ resumen: document.getElementById('usoResumen')?.innerText, tablas: [...document.querySelectorAll('table')].map(t => [...t.querySelectorAll('tbody tr')].slice(0, 6).map(tr => tr.innerText.replace(/\s+/g, ' ').slice(0, 70))) }))), '| errores:', a.errores.slice(0, 3));
  const raw = await a.page.evaluate(async () => { const d = await firebase.firestore().collection('uso_diario').doc('2026-09-30').get(); const v = d.data() || {}; return { existe: d.exists, keys: Object.keys(v), nPag: Object.keys(v.paginas || {}).length, nUsu: Object.keys(v.usuarios || {}).length, muestraPag: Object.entries(v.paginas || {}).slice(0, 3), tipoValor: typeof Object.values(v.paginas || {})[0] }; });
  console.log('uso_diario/2026-09-30 leído desde el navegador:', JSON.stringify(raw));
  await a.cerrar();
}
