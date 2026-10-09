// Mide cuánto ancho usa el INICIO del Centro en pantallas grandes (2026-10-09).
//   node emu-medir-ancho-inicio.mjs [carpeta]
import { abrir, USUARIOS } from './emu-lib.mjs';
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const carpeta = process.argv[2] || 'centro-home-v2';
for (const [nombre, vp] of Object.entries({ hd1920: { width: 1920, height: 1080 }, laptop1536: { width: 1536, height: 864 }, base1280: { width: 1280, height: 800 } })) {
  const s = await abrir({ email: USUARIOS.admin, viewport: vp, carpeta });
  await s.ir('/clientes/centro.html', { esperar: 2500 });
  await s.page.waitForFunction(() => document.querySelector('#cgLista .cg-fila') && ![...document.querySelectorAll('#cgSenales .cg-senal .v')].some(e => e.textContent.trim() === '…'), { timeout: 25000 }).catch(() => {});
  await espera(500);
  const m = await s.page.evaluate(() => {
    const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; };
    return { vw: innerWidth, appwrap: r('.app-wrap'), busq: r('.cg-busq'), senales: r('#cgSenales'), fila: r('#cgLista .cg-fila'), sinScrollX: document.documentElement.scrollWidth <= innerWidth };
  });
  console.log(nombre, JSON.stringify(m));
  await s.captura(`W-inicio-${nombre}`, { full: false });
  await s.cerrar();
}
