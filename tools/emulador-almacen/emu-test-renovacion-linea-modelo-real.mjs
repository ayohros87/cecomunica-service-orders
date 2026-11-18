// Renovación con las líneas copiadas de la ORDEN DE COMPRA y no del radio real
// (Karla, PANDEPORTES 2026-11-18): líneas KENWOOD NX-420-R ×30 / NX-920 ×1 y los
// radios son HYTERA. El verificado (25725A0540, PNC460) quedaba "sin línea" con
// un aviso que no decía qué modelo faltaba; los de migración sin verificar iban
// a cambiar de modelo en el inventario. Ahora cada aviso trae un botón que
// agrega la línea del modelo REAL. Necesita el emulador sembrado con producción.
//   node emu-test-renovacion-linea-modelo-real.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const ID = '47bDLhpcjKQVd4oK8KKI';
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const s = await abrir({ email: USUARIOS.gerencia, carpeta: 'pandeportes' });
await s.ir(`/clientes/centro.html?id=${ID}`, { esperar: 4000 });
await espera(2000);
await s.page.evaluate(() => Centro.wizContrato({ renovarCuenta: true }));
await espera(3000);
await s.page.evaluate(() => Centro._wcMarcarTodos('continua'));
await espera(600);
// Las líneas como las puso Karla: lo que dice la orden de compra.
await s.page.evaluate(() => {
  const cont = document.getElementById('wcLineas');
  cont.innerHTML = '';
  const por = (re) => (Centro.modelos || []).find(m => re.test(m.label));
  const a = por(/NX-?420-?R$/i) || por(/NX-?420/i), b = por(/NX-?920/i);
  cont.insertAdjacentHTML('beforeend', Centro._lineaModeloPre('wcm', true, { modelo_id: a.id, modelo: a.label, cantidad: 30, precio: 30, modalidad: 'alquiler' }));
  cont.insertAdjacentHTML('beforeend', Centro._lineaModeloPre('wcm', true, { modelo_id: b.id, modelo: b.label, cantidad: 1, precio: 35, modalidad: 'alquiler' }));
  Centro._wcConciliar();
});
await espera(300);
const antes = await s.page.evaluate(() => {
  const c = Centro._wcConciliar();
  return { sinLinea: c.sinLinea.map(u => u.serial), corregidos: c.modeloCorregido.length,
    txt: document.getElementById('wcPlanConc')?.innerText,
    botones: [...document.querySelectorAll('#wcPlanConc button[data-modelo]')].map(b => b.textContent.trim()) };
});
console.log(JSON.stringify(antes, null, 1));
ok(antes.sinLinea.includes('25725A0540'), 'el verificado 25725A0540 sale sin línea');
ok(/25725A0540[\s\S]*es un HYTERA PNC460 y ninguna línea/.test(antes.txt), 'el aviso dice QUÉ modelo es');
ok(antes.botones.some(t => /Agregar la línea HYTERA PNC460/.test(t)), 'hay botón para agregar su línea');
ok(antes.corregidos > 0 && antes.botones.some(t => /^Son HYTERA/.test(t)), 'el cambio de modelo ofrece "Son HYTERA…: ponerlos en su línea"');
await s.captura('01-lineas-de-la-oc');
// Un clic por aviso hasta que no quede ninguno.
for (let i = 0; i < 8; i++) {
  const quedo = await s.page.evaluate(() => {
    const b = document.querySelector('#wcPlanConc button[data-modelo]');
    if (!b) return false;
    b.click(); return true;
  });
  if (!quedo) break;
  await espera(250);
}
const r = await s.page.evaluate(() => {
  const c = Centro._wcConciliar();
  return { sinLinea: c.sinLinea.length, corregidos: c.modeloCorregido.length, desajuste: c.desajuste,
    nuevos: c.modalidad?.nuevos, lineas: Centro._lineasModelo('wcm').map(l => `${l.modelo}×${l.cantidad} ${l.modalidad}`) };
});
console.log(JSON.stringify(r, null, 1));
ok(r.sinLinea === 0, 'ya no queda ningún serial sin línea');
ok(r.corregidos === 0, 'ya no se le cambia el modelo a ningún radio');
ok(!r.desajuste, 'sin desajuste');
ok(r.lineas.some(l => /^HYTERA PNC460×4 alquiler/.test(l)) && r.lineas.some(l => /^HYTERA PNC360S-R×4 alquiler/.test(l)),
  'cada familia quedó en su línea con sus 4 (el verificado y la variante incluidos): ' + r.lineas.join(', '));
ok((await s.toasts()).some(t => /baja o quita la que ya no aplique/.test(t.msg)), 'avisa que sobran las líneas de la orden de compra');
await s.captura('02-lineas-reales');
console.log('ERRORES', JSON.stringify(s.errores));
console.log(fallos ? `${fallos} FALLAS` : 'TODO OK');
await s.cerrar();
