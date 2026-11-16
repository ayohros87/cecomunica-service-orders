// Renovación de FALCON con reemplazo de TODOS los radios (2026-11-16): el serial
// agregado a mano (22806A0233, ficha con otro cliente) se liga a su ficha, dice
// dónde está y admite "Se reemplaza"; los reemplazos sin modelo preguntan qué
// modelo entra. Necesita el emulador sembrado y SIN contratos de FALCON.
//   node emu-test-renovacion-reemplazo-agregado.mjs
import { abrir } from './emu-lib.mjs';
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const ID = '7jNAakzRyiAFa0lDVPvU';
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const s = await abrir({ email: 'elvia.onodera@cecomunica.com', carpeta: 'falcon' });
await s.ir(`/clientes/centro.html?id=${ID}`, { esperar: 4000 });
await espera(2000);
await s.page.evaluate(() => Centro.wizContrato({ renovarCuenta: true }));
await espera(3000);
// Los 16 se reemplazan por uno nuevo del mismo modelo
await s.page.evaluate(() => Centro._wcMarcarTodos('reemplaza'));
await espera(500);
// Agregar 22806A0233 (ficha en el pool, con CROWN LOGISTIC)
await s.page.evaluate(() => { document.getElementById('wcSerialNuevo').value = '22806A0233'; return Centro._wcAgregarSerial(); });
await espera(1500);
const ag = await s.page.evaluate(() => ({ a: Centro._wcPlanState.agregados[0], fila: document.querySelector('select[data-wcpad="0"]') ? [...document.querySelector('select[data-wcpad="0"]').options].map(o => o.value) : null }));
console.log(JSON.stringify(ag));
ok(ag.a && ag.a.pool_id === '22806A0233', 'el agregado queda ligado a su ficha (pool_id)');
ok(/Por clasificar/.test(ag.a?.aviso || '') && /CROWN/.test(ag.a?.aviso || ''), 'el aviso dice dónde está: ' + ag.a?.aviso);
ok(ag.fila && ag.fila.includes('reemplaza'), 'el agregado se puede marcar "Se reemplaza"');
await s.page.evaluate(() => { const x = document.querySelector('select[data-wcpad="0"]'); x.value = 'reemplaza'; x.dispatchEvent(new Event('change')); });
await espera(500);
const sels = await s.page.evaluate(() => [...document.querySelectorAll('select[data-wcpsm]')].map(x => x.dataset.wcpsm + ':' + x.dataset.wcpsmDestino));
console.log('selectores', sels.length, sels.join(' '));
ok(sels.length === 11, `11 "se reemplaza por…" (10 sin modelo + el agregado): ${sels.length}`);
await s.captura('08-reemplazo-sin-modelo');
for (const id of sels.map(x => x.split(':')[0])) {
  await s.page.evaluate((id) => {
    const sel = document.querySelector(`select[data-wcpsm="${id}"]`);
    if (!sel) return;
    const o = [...sel.options].find(o => o.textContent.trim() === 'HYTERA PNC360S-R');
    sel.value = o.value; sel.dispatchEvent(new Event('change'));
  }, id);
  await espera(150);
}
const r = await s.page.evaluate(() => { const c = Centro._wcConciliar(); return { ok: c.ok, sinLinea: c.sinLinea.length, faltaModelo: c.faltaModelo, desajuste: c.desajuste, mod: c.modalidad, lineas: Centro._lineasModelo('wcm').map(l => l.modelo + '×' + l.cantidad), txt: document.getElementById('wcPlanConc')?.innerText }; });
console.log(JSON.stringify(r, null, 1));
ok(r.ok, 'la cuenta cuadra con los 17 reemplazos');
ok(r.mod && r.mod.reemplazos === 17, '17 reemplazos');
await s.captura('09-reemplazo-elegidos');
await s.page.evaluate(() => {
  document.querySelectorAll('#wcLineas [data-wcm-precio]').forEach(i => { i.value = '15'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const c = document.getElementById('wcRepValidado'); if (c) { c.checked = true; c.dispatchEvent(new Event('change')); }
});
await s.page.evaluate(() => Centro.crearContrato());
await espera(4000);
console.log('TOASTS', JSON.stringify((await s.toasts()).slice(-2)));
const plan = await s.page.evaluate(async (cid) => {
  const q = await firebase.firestore().collection('contratos').where('cliente_id', '==', cid).get();
  const c = q.docs[0]?.data();
  return c && { id: c.contrato_id, unidades: (c.transicion_plan?.unidades || []).map(u => `${u.serial} ${u.destino} ${u.modelo || '-'} → ${u.reemplazo_modelo || 'mismo'} ${u.fuente}`) };
}, ID);
console.log(JSON.stringify(plan, null, 1));
ok(plan && plan.unidades.length === 17 && plan.unidades.every(u => / reemplaza /.test(u)), 'el contrato guardado trae los 17 en "se reemplaza"');
console.log('ERRORES', JSON.stringify(s.errores));
console.log(fallos ? `${fallos} FALLAS` : 'TODO OK');
await s.cerrar();
