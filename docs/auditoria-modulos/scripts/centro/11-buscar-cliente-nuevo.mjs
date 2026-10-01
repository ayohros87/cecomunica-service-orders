// ¿Se encuentra el cliente recién creado (PRUEBA-AUDIT-centro Empresa Uno) desde el grid de edición masiva (cobros)
// y desde el Centro? Variantes con y sin guion, por RUC y por segunda palabra. Solo lectura.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 900));
const s = await abrir({ email: USUARIOS.cobros, viewport: 'escritorio', carpeta: 'centro' });
await s.ir('/clientes/index.html');
for (const q of ['PRUEBA-AUDIT', 'PRUEBA', 'prueba', 'Empresa Uno', 'uno', '155799999', '155799999-2-2026', '8-NT-1-21875', '8NT121875', 'AB SECURITY', 'ab sec']) {
  await s.page.evaluate(() => { const i = document.getElementById('q'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await s.page.type('#q', q);
  await new Promise(r => setTimeout(r, 2500));
  log('grid ' + q, { resumen: await s.texto('#resumen'), primeras: await s.page.evaluate(() => [...document.querySelectorAll('#tbody tr')].slice(0, 3).map(tr => tr.querySelector('[data-field=nombre]')?.value)) });
}
await s.captura('56-cobros-escritorio-grid-buscar-cliente-nuevo');
await s.ir('/clientes/centro.html');
for (const q of ['PRUEBA-AUDIT', 'PRUEBA', 'Empresa Uno', '155799999', '155799999-2-2026', '8-NT-1-21875']) {
  await s.page.evaluate(() => { const i = document.getElementById('cgBuscar'); i.value = ''; });
  await s.page.type('#cgBuscar', q);
  await new Promise(r => setTimeout(r, 2500));
  log('centro ' + q, { resumen: await s.texto('#cgResumen'), primeras: (await s.texto('#cgLista')).split('\n').filter(Boolean).slice(0, 4) });
}
// ¿qué campos de búsqueda tiene el doc nuevo?
log('doc', await s.page.evaluate(async () => { const d = await firebase.firestore().collection('clientes').doc('JQqR7m305yYck8eL0mYq').get(); const x = d.data(); return { keys: Object.keys(x).sort(), nombre_norm: x.nombre_norm, tokens: (x.searchTokens || []).length, ruc_norm: x.ruc_norm, rucdv_norm: x.rucdv_norm }; }));
log('doc_ab', await s.page.evaluate(async () => { const q = await firebase.firestore().collection('clientes').where('nombre', '==', 'AB SECURITY').get(); const x = q.docs[0].data(); return { keys: Object.keys(x).sort(), tokens: (x.searchTokens || []).length }; }));
await s.cerrar();
