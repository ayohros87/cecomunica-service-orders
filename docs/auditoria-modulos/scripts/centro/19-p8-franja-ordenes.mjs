// P8 (08-home): la ficha del Centro enlaza sus órdenes abiertas (?ids=) y, para quien entra a
// Almacén, cada serial del contrato. SEPROSA tiene 2 órdenes abiertas vivas (2025081904, 2026092508).
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const SEPROSA = 'jT6FlI02u2L52On6zsaj';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1200));
for (const rol of ['admin', 'recepcion']) {
  const s = await abrir({ email: USUARIOS[rol], viewport: 'escritorio', carpeta: 'centro' });
  await s.ir(`/clientes/centro.html?id=${SEPROSA}`);
  const r = await s.page.evaluate(() => {
    const a = [...document.querySelectorAll('.cg-resumen a')].find(x => /Órdenes abiertas/.test(x.innerText));
    return { abiertas: (Centro.ordenesAbiertas || []).map(o => o.id), enlace: a ? { txt: a.innerText, href: a.getAttribute('href') } : null };
  });
  log(`${rol}_franja`, r);
  await s.hacer(() => { const b = document.getElementById('blkContratos'); if (b) b.open = true; const c = document.querySelector('[onclick*="verContrato"]'); c?.click(); });
  await s.quieto(800);
  log(`${rol}_almacen`, await s.page.evaluate(() => { const l = [...document.querySelectorAll('a[href*="almacen/index.html?tab=existencias"]')]; return { n: l.length, primero: l[0]?.getAttribute('href') || null }; }));
  if (r.enlace) {
    await s.ir('/clientes/' + r.enlace.href);
    await s.quieto(1500);
    log(`${rol}_bandeja`, { url: s.page.url().replace(/^.*\/ordenes/, '/ordenes'), filas: await s.page.evaluate(() => [...document.querySelectorAll('[data-orden-id], tr[data-id]')].map(x => x.dataset.ordenId || x.dataset.id).slice(0, 5)), texto: (await s.page.evaluate(() => document.body.innerText)).match(/202\d{7}/g)?.slice(0, 5) });
  }
  await s.captura(`76-${rol}-escritorio-p8-franja`);
  log(`${rol}_errores`, s.errores.slice(0, 5));
  await s.cerrar();
}
