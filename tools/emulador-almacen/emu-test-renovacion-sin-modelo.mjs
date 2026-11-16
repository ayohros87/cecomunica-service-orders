// Renovación de una cuenta con seriales SIN modelo (caso FALCON 2026-11-16):
// el aviso pregunta el modelo por serial, la línea sube sola y el plan guardado
// lleva modelo_corregido. Necesita el emulador sembrado con datos de producción.
//   node emu-test-renovacion-sin-modelo.mjs
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
await s.page.evaluate(() => Centro._wcMarcarTodos('continua'));
await espera(600);
const sels = await s.page.evaluate(() => [...document.querySelectorAll('select[data-wcpsm]')].map(x => x.dataset.wcpsm));
ok(sels.length === 10, `selector "¿qué modelo es?" para los 10 sin modelo (${sels.length})`);
const txt = await s.page.evaluate(() => document.getElementById('wcPlanConc')?.innerText);
ok(/sin modelo en el sistema/.test(txt), 'el aviso dice "sin modelo en el sistema"');
// Cuadrar sin elegir: toast explicativo
await s.page.evaluate(() => Centro._wcCuadrar());
await espera(300);
ok((await s.toasts()).some(t => /sin modelo: elige/.test(t.msg)), 'Cuadrar con seriales sin modelo explica qué hacer');
await s.captura('06-sin-modelo');
// Elegir: 23905A0433 → PNC460-R; el resto → PNC360S-R
for (const id of sels) {
  await s.page.evaluate((id) => {
    const sel = document.querySelector(`select[data-wcpsm="${id}"]`);
    const o = [...sel.options].find(o => o.textContent.trim() === (id === '23905A0433' ? 'HYTERA PNC460-R' : 'HYTERA PNC360S-R'));
    sel.value = o.value; sel.dispatchEvent(new Event('change'));
  }, id);
  await espera(150);
}
const r = await s.page.evaluate(() => { const c = Centro._wcConciliar(); return { ok: c.ok, sinLinea: c.sinLinea.length, desajuste: c.desajuste, lineas: Centro._lineasModelo('wcm').map(l => l.modelo + '×' + l.cantidad), txt: document.getElementById('wcPlanConc')?.innerText }; });
console.log(JSON.stringify(r, null, 1));
ok(r.ok && r.sinLinea === 0, 'tras elegir, la cuenta cuadra');
ok(r.lineas.includes('HYTERA PNC360S-R×13') && r.lineas.includes('HYTERA PNC460-R×2'), 'las líneas subieron solas: ' + r.lineas.join(', '));
await s.captura('07-elegidos');
await s.page.evaluate(() => {
  document.querySelectorAll('#wcLineas [data-wcm-precio]').forEach(i => { i.value = '15'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const c = document.getElementById('wcRepValidado'); if (c) { c.checked = true; c.dispatchEvent(new Event('change')); }
});
await s.page.evaluate(() => Centro.crearContrato());
await espera(4000);
const t = await s.toasts();
console.log('TOASTS', JSON.stringify(t.slice(-2)));
const plan = await s.page.evaluate(async (cid) => {
  const q = await firebase.firestore().collection('contratos').where('cliente_id', '==', cid).get();
  const c = q.docs[0]?.data();
  return c && { id: c.contrato_id, unidades: (c.transicion_plan?.unidades || []).map(u => `${u.serial} ${u.modelo} ${u.modelo_corregido ? 'CORR' : ''}`) };
}, ID);
console.log(JSON.stringify(plan, null, 1));
ok(plan && plan.unidades.filter(u => u.endsWith('CORR')).length === 10, 'el plan guardado lleva modelo_corregido en los 10');
ok(plan && plan.unidades.some(u => u.startsWith('23905A0433 HYTERA PNC460-R')), '23905A0433 quedó como PNC460-R');
console.log('ERRORES', JSON.stringify(s.errores));
console.log(fallos ? `${fallos} FALLAS` : 'TODO OK');
await s.cerrar();
