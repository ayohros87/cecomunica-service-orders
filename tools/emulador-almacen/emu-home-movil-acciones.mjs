// Home en el teléfono: la pastilla abre su panel, el ícono recuenta, el escritorio sigue igual.
import { abrir, USUARIOS } from './emu-lib.mjs';
const espera = ms => new Promise(r => setTimeout(r, ms));
let s = await abrir({ email: USUARIOS.vendedor, viewport: 'telefono', carpeta: 'home-movil' });
try {
  await s.ir('/index.html'); await espera(5000);
  await s.page.click('#signalsRow .kpis > [data-signal="REGV"]'); await espera(2500);
  const panel = await s.page.evaluate(() => { const p = document.querySelector('#signalsRow .bj-panel'); return p ? { alto: Math.round(p.getBoundingClientRect().height), texto: p.innerText.slice(0, 200) } : null; });
  console.log('panel REGV', JSON.stringify(panel));
  await s.captura('vendedor-panel');
  const r = await s.page.evaluate(async () => {
    const b = document.querySelector('#signalsRow .kpis-refresh'); const vis = b && b.offsetParent !== null; b.click();
    const dis = b.disabled; await new Promise(r => setTimeout(r, 3000)); return { visible: vis, deshabilitadoAlTocar: dis, despues: b.disabled };
  });
  console.log('recontar', JSON.stringify(r));
  await s.page.setViewport({ width: 1280, height: 800 }); await espera(800);
  console.log('al ensanchar', JSON.stringify(await s.page.evaluate(() => ({
    enDeuda: !!document.querySelector('#signalsRow .kpis-deuda [data-signal="REGV"]'),
    refreshVisible: document.querySelector('#signalsRow .kpis-refresh').offsetParent !== null,
  }))));
  console.log('errores', JSON.stringify(s.errores));
} finally { await s.cerrar(); }
s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'home-movil' });
try { await s.ir('/index.html'); await espera(5000); await s.captura('admin-escritorio'); console.log('errores esc', JSON.stringify(s.errores)); } finally { await s.cerrar(); }
