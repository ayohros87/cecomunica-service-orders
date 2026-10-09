// Capturas del directorio del Centro (home) como admin y como vendedora, para
// el rediseño pedido el 2026-10-08.
import { abrir, USUARIOS } from './emu-lib.mjs';
const espera = (ms) => new Promise(r => setTimeout(r, ms));
for (const [rol, email] of [['admin', USUARIOS.admin], ['vendedora', USUARIOS.vendedor]]) {
  const s = await abrir({ email, viewport: { width: 1536, height: 864 }, carpeta: 'centro-home' });
  const info = await s.ir('/clientes/centro.html', { esperar: 2500 });
  await espera(1200);
  const m = await s.page.evaluate(() => ({
    filas: document.querySelectorAll('#cgLista .cg-row').length,
    resumen: document.getElementById('cgResumen')?.textContent.trim(),
    aprob: document.getElementById('cgAprobaciones')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 300),
    tools: [...document.querySelectorAll('.cg-tools .btn, .cg-tools .seg-btn, .cg-tools label')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    chips: [...new Set([...document.querySelectorAll('#cgLista .cg-chip')].map(e => e.textContent.trim().replace(/\d+/g, 'n')))],
    alto: document.documentElement.scrollHeight,
  }));
  console.log(rol, info.msTotal + 'ms', JSON.stringify(m));
  await s.captura(`home-${rol}-arriba`, { full: false });
  await s.captura(`home-${rol}-completo`, { full: true });
  await s.cerrar();
}
