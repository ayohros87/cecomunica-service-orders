// P4 + P6 (ejecución 2026-10-01) · Mide la bandeja a 1280 (rail abierto) y 1024: anchos de
// columna, celdas con texto cortado en 12 filas, solape número/cliente, y el lápiz de editar
// (opacidad en reposo y tamaño). Correr antes y después del cambio. Solo lectura, recepción.
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
for (const vp of ['escritorio', 'tablet']) {
  const s = await abrir({ email: USUARIOS.recepcion, viewport: vp, carpeta: 'ordenes' });
  await s.ir('/ordenes/index.html');
  await s.quieto(1200, 10000);
  const r = await s.page.evaluate(() => {
    const out = [];
    const filas = [...document.querySelectorAll('tr[data-orden-row]')].slice(0, 12);
    for (const tr of filas) {
      for (const td of tr.querySelectorAll('td')) {
        if (td.classList.contains('acciones')) continue;
        const el = td.querySelector('.chip-estado, .tipo-chip, .orden-id, .cliente-text') || td;
        const cw = el.clientWidth, sw = el.scrollWidth;
        const tdw = td.clientWidth;
        // cortado = el contenido no cabe en su caja o se sale de la celda
        const cortado = (sw > cw + 1 && cw > 0) || (el.getBoundingClientRect().right > td.getBoundingClientRect().right + 1);
        if (cortado) out.push({ col: td.cellIndex, txt: (el.innerText || '').trim().slice(0, 18), sw, cw, tdw });
      }
    }
    const th = [...document.querySelectorAll('#ordersTable thead th, .orders-table thead th')].map(t => `${t.innerText.trim().slice(0, 8)}:${Math.round(t.getBoundingClientRect().width)}`);
    const tr = document.querySelector('tr[data-orden-row]');
    const num = tr?.querySelector('td:nth-child(1) .orden-id'); const cli = tr?.querySelector('td:nth-child(2)');
    const solape = num && cli ? Math.round(num.getBoundingClientRect().right - cli.getBoundingClientRect().left) : null;
    const rail = document.querySelector('.rail'); const railW = rail ? Math.round(rail.getBoundingClientRect().width) : 0;
    return { vw: innerWidth, railW, th, cortadas: out.length, ej: out.slice(0, 8), solapeNumeroSobreCliente: solape };
  });
  log(`[${vp}]`, JSON.stringify(r));
  await s.captura(`18-p4-${vp}-bandeja`);
  // Lápiz: expandir la primera fila con equipos y medir
  await s.page.evaluate(() => { const tr = [...document.querySelectorAll('tr[data-orden-row]')].find(t => !/DEVOLUCI/i.test(t.innerText)); tr?.querySelector('td')?.click(); });
  await s.quieto(1000, 8000);
  const lap = await s.page.evaluate(() => { const l = document.querySelector('.filaDetalle .lapiz, .orden-expandida-wrapper .lapiz'); if (!l) return null; const r = l.getBoundingClientRect(); const cs = getComputedStyle(l); return { opacidad: cs.opacity, w: Math.round(r.width), h: Math.round(r.height), n: document.querySelectorAll('.lapiz').length }; });
  log(`[${vp}] lápiz en reposo:`, JSON.stringify(lap));
  await s.captura(`18-p4-${vp}-fila-expandida`);
  await s.cerrar();
}
