// Mide el home en teléfono por rol: alto de cada bloque antes de llegar a los módulos.
import { abrir, USUARIOS } from './emu-lib.mjs';
const roles = process.argv.slice(2).length ? process.argv.slice(2) : ['admin','gerencia','recepcion','jefe_taller','tecnico','vendedor','inventario','contabilidad'];
for (const rol of roles) {
  const s = await abrir({ email: USUARIOS[rol], viewport: 'telefono', carpeta: 'home-movil' });
  try {
    await s.ir('/index.html');
    await s.page.waitForSelector('#gridModulos:not([style*="none"])', { timeout: 20000 }).catch(()=>{});
    await new Promise(r => setTimeout(r, 4000));
    const g = await s.page.evaluate(() => {
      const h = el => el && el.offsetParent !== null ? Math.round(el.getBoundingClientRect().height) : 0;
      const top = el => el ? Math.round(el.getBoundingClientRect().top + scrollY) : null;
      const q = s => document.querySelector(s);
      return {
        hero: h(q('.launch__hero')), signals: h(q('#signalsRow')),
        tarjetas: [...document.querySelectorAll('#signalsRow .kpis > .kpi')].map(k => k.innerText.replace(/\s+/g,' ').trim()),
        deuda: [...document.querySelectorAll('#signalsRow .kpis-deuda .kpi')].map(k => k.innerText.replace(/\s+/g,' ').trim()),
        cero: q('#signalsRow .kpis-zero')?.innerText.replace(/\s+/g,' ').trim(),
        feedDev: h(q('#feedDevoluciones')), feedOrd: h(q('#feedOrdenes')),
        otros: [...document.querySelectorAll('.feed-ordenes')].map(e => e.id + ':' + h(e)),
        busqueda: top(q('.launch__search')), modulos: top(q('#gridModulos')),
        alto: document.documentElement.scrollHeight,
      };
    });
    console.log(rol, JSON.stringify(g));
    await s.captura(rol, { full: true });
  } finally { await s.cerrar(); }
}
