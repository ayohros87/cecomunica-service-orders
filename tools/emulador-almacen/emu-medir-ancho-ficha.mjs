// Mide cuánto ancho real usa la ficha del cliente en pantallas grandes
// (pedido de Alberto 2026-10-08: "sobra mucho espacio a los lados").
//   node emu-medir-ancho-ficha.mjs [carpeta]
import { abrir, USUARIOS } from './emu-lib.mjs';
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const carpeta = process.argv[2] || 'ficha-v3';
const ID = 'jT6FlI02u2L52On6zsaj'; // SEPROSA
for (const [nombre, vp] of Object.entries({ hd1920: { width: 1920, height: 1080 }, laptop1536: { width: 1536, height: 864 }, base1280: { width: 1280, height: 800 } })) {
  const s = await abrir({ email: USUARIOS.admin, viewport: vp, carpeta });
  await s.ir(`/clientes/centro.html?id=${ID}`, { esperar: 2500 });
  await s.page.waitForFunction(() => document.querySelector('#cgVerbos .cg-verbo') && !document.querySelector('#fResumenTab .cg-skel'), { timeout: 25000 });
  await espera(600);
  const m = await s.page.evaluate(() => {
    const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; };
    return { vw: innerWidth, rail: r('.cc-rail, #rail-mount > *'), appwrap: r('.app-wrap'), ficha: r('.cg-ficha'), main: r('.cg-main'), aside: r('.cg-aside'), tabla: r('#fResumenTab table'), maxW: getComputedStyle(document.querySelector('.app-wrap')).maxWidth };
  });
  console.log(nombre, JSON.stringify(m));
  await s.captura(`W-${nombre}`, { full: false });
  await s.cerrar();
}
