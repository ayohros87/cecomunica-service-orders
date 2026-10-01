// R3 (ejecución 2026-10-01) · Las fechas de la bandeja y de la orden impresa salen en hora de
// Panamá. Métrica del informe (00c): órdenes cuya fecha en UTC cae en otro día que en Panamá.
// Aquí se cuenta cuántas de esas pintan HOY la fecha de Panamá en la celda (meta: todas).
// Solo lectura. Recepción, escritorio.
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ordenes' });
await s.ir('/ordenes/index.html?estado=ENTREGADO%20AL%20CLIENTE');
await s.quieto(1500, 15000);
const r = await s.page.evaluate(() => {
  const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const pa = (d) => { const x = new Date(d.getTime() - 5 * 3600000); return `${x.getUTCDate()} ${MES[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
  const utc = (d) => `${d.getUTCDate()} ${MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  let total = 0, corridasUtc = 0, bienPintadas = 0, malPintadas = 0;
  const ej = [];
  for (const o of (APP.state.orders || [])) {
    const d = o.fecha_creacion?.toDate?.(); if (!d) continue;
    total++;
    const celda = document.querySelector(`tr[data-orden-id="${o.ordenId}"] td:nth-child(6)`)?.innerText.trim().split('\n')[0].trim();
    if (!celda) continue;
    const esperado = pa(d);
    if (utc(d) !== esperado) corridasUtc++;
    if (celda === esperado) bienPintadas++; else { malPintadas++; if (ej.length < 4) ej.push(`${o.ordenId}: celda "${celda}" esperado "${esperado}" (UTC ${d.toISOString()})`); }
  }
  // Un caso sintético de noche (9:54 p. m. Panamá = 02:54Z del día siguiente)
  const noche = new Date('2026-10-01T02:54:00Z');
  return { total, corridasUtc, bienPintadas, malPintadas, ej,
    sintetico: { corta: formatFecha({ toDate: () => noche }), larga: formatFechaHora({ toDate: () => noche }) },
    linea: document.querySelector('tr[data-orden-row] td:nth-child(6)')?.innerText.trim() };
});
log(JSON.stringify(r, null, 1));
await s.captura('16-r3-bandeja-entregadas-fechas');
// Orden impresa
const id = await s.page.evaluate(() => (APP.state.orders || [])[0]?.ordenId);
await s.ir(`/ordenes/imprimir-orden.html?id=${id}`);
await s.quieto(1200, 10000);
const imp = await s.page.evaluate(() => (document.body.innerText.match(/\d{1,2} [a-z]{3} \d{4}[^\n]*/g) || []).slice(0, 4));
log('impreso', id, '→', JSON.stringify(imp));
log('errores:', s.errores.slice(0, 5));
await s.cerrar();
