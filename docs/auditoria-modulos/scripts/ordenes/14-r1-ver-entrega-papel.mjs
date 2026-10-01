// R1 (ejecución 2026-10-01) · "Ver entrega" de una entrega con firma en papel debe decir
// quién recibió (entrega_persona_interna), el motivo y la nota firmada (o "falta subir").
// Solo lectura. Recepción en tablet. Busca en el emulador la entrega en papel más reciente.
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'ordenes' });
await s.ir('/ordenes/index.html');
const casos = await s.page.evaluate(async () => {
  const snap = await firebase.firestore().collection('ordenes_de_servicio')
    .where('no_recibido', '==', true).orderBy('fecha_entrega', 'desc').limit(3).get();
  return snap.docs.map(d => ({ id: d.id, persona: d.data().entrega_persona_interna || null, motivo: d.data().no_recibido_motivo || null, nota: !!d.data().nota_firmada_url, receptor: d.data().receptor_nombre || null }));
});
log('entregas en papel (doc):', JSON.stringify(casos));
for (const c of casos) {
  await s.ir(`/ordenes/index.html?ids=${c.id}`);
  const abierto = await s.page.evaluate((id) => { const b = document.querySelector(`[data-action="ver-entrega"][data-orden-id="${id}"]`); if (!b) return false; b.click(); return true; }, c.id);
  if (!abierto) { log(`  ${c.id}: sin botón "Ver entrega" en la fila (¿no cargó?)`); continue; }
  await s.quieto(800, 6000);
  const txt = await s.page.evaluate(() => (document.querySelector('.modal-backdrop.open, .overlay:not(.hidden)')?.innerText || '').replace(/\s+/g, ' '));
  const m = txt.match(/Recibido por\s*([^·]*?)\s*Fecha y hora/);
  log(`  ${c.id}: Recibido por → "${(m ? m[1] : '?').trim().slice(0, 60)}" | firmó en papel: ${/Firmó en papel/.test(txt)} | nota: ${/Nota firmada por el cliente|Ver la nota firmada/.test(txt) ? 'visible' : (/Falta subir la nota/.test(txt) ? 'falta subir (botón ' + (/Subir la nota/.test(txt)) + ')' : 'no se menciona')}`);
  await s.captura(`14-r1-ver-entrega-papel-${c.id}`);
  await s.page.keyboard.press('Escape'); await s.quieto(300, 2000);
}
log('errores:', s.errores.slice(0, 5));
await s.cerrar();
