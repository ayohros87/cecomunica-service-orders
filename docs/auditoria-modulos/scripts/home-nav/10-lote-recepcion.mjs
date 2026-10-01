import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
for (const rol of ['recepcion', 'admin']) {
  const s = await abrir({ email: USUARIOS[rol], viewport: 'escritorio', carpeta: 'home-nav' });
  await s.ir('/index.html', { esperar: 1200 });
  const r = await s.page.evaluate(async () => {
    const out = {};
    try { const q = firebase.firestore().collection('poc_lotes_preparados').where('estado', '==', 'pendiente'); out.server = (await q.get({ source: 'server' })).size; } catch (e) { out.server = 'ERR ' + (e.code || e.message); }
    try { out.agg = window.FbAgg ? await FbAgg.count('poc_lotes_preparados', [['estado', '==', 'pendiente']]) : 'sin FbAgg'; } catch (e) { out.agg = 'ERR ' + (e.code || e.message); }
    try { out.senal = await SenalesService.countLotesPocPorCargar(); } catch (e) { out.senal = 'ERR ' + (e.code || e.message); }
    try { out.todos = (await firebase.firestore().collection('poc_lotes_preparados').get({ source: 'server' })).docs.map(d => d.id + ':' + d.data().estado); } catch (e) { out.todos = 'ERR ' + (e.code || e.message); }
    return out;
  });
  console.log(rol, JSON.stringify(r), s.errores.slice(0, 3));
  await s.cerrar();
}
