// Los tres iguales (Alberto 2026-10-09): inicio del Centro, ficha del cliente
// y Cotizaciones deben usar el MISMO ancho (1600 px del kit).
//   node emu-medir-ancho-tres.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const PAGINAS = [
  ['inicio', '/clientes/centro.html', '.app-wrap'],
  ['ficha', '/clientes/centro.html?id=jT6FlI02u2L52On6zsaj', '.app-wrap'],
  ['cotizaciones', '/cotizaciones/index.html', '.app-body'],
  ['nueva-cotizacion', '/cotizaciones/nueva-cotizacion.html', '.app-body'],
];
let fallos = 0;
for (const [nombre, vp] of Object.entries({ hd1920: { width: 1920, height: 1080 }, laptop1536: { width: 1536, height: 864 } })) {
  const s = await abrir({ email: USUARIOS.admin, viewport: vp, carpeta: 'ancho-tres' });
  const anchos = {};
  for (const [k, url, sel] of PAGINAS) {
    await s.ir(url, { esperar: 2500 });
    await espera(600);
    anchos[k] = await s.page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), max: getComputedStyle(e).maxWidth }; }, sel);
    await s.captura(`${nombre}-${k}`, { full: false });
  }
  const ws = Object.values(anchos).map(a => a?.w);
  const iguales = ws.every(w => w && Math.abs(w - ws[0]) <= 2);
  console.log(nombre, JSON.stringify(anchos), iguales ? 'IGUALES' : 'DISTINTOS');
  if (!iguales) fallos++;
  if (s.errores.length) { console.log('  errores:', s.errores.join(' | ')); }
  await s.cerrar();
}
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
