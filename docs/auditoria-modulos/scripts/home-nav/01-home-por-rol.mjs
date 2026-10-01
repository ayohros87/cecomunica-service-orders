// Recorrido 01: el home con cada rol (escritorio) y recepción/técnico/bodega en tablet y teléfono.
// Solo lectura. Perfil de Chrome nuevo por sesión = camino frío (sin caché de señales).
// node docs/auditoria-modulos/scripts/home-nav/01-home-por-rol.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
import fs from 'node:fs';

const CASOS = [
  ...Object.keys(USUARIOS).map(r => [r, 'escritorio']),
  ['recepcion', 'tablet'], ['recepcion', 'telefono'],
  ['tecnico', 'telefono'], ['inventario', 'telefono'], ['inventario', 'tablet'],
];
const out = [];
let n = 1;
for (const [rol, vp] of CASOS) {
  const s = await abrir({ email: USUARIOS[rol], viewport: vp, carpeta: 'home-nav' });
  const info = await s.ir('/index.html', { esperar: 1500 });
  // Espera extra a que terminen los conteos (los tiles pierden is-loading)
  const t0 = Date.now();
  await s.page.waitForFunction(() => !document.querySelector('.kpi.is-loading') && !document.querySelector('.kpis-skel'), { timeout: 20000 }).catch(() => {});
  await s.quieto(1200, 8000);
  const msSenales = Date.now() - t0;
  const d = await s.page.evaluate(() => {
    const txt = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
    const zona = (el) => el.closest('.kpis-zero__items') ? 'aldia' : el.closest('.kpis-deuda__items') ? 'seguimiento' : 'dia';
    const senales = [...document.querySelectorAll('[data-signal]')].map(el => ({ id: el.dataset.signal, label: txt(el.querySelector('.kpi__t')), val: txt(el.querySelector('.kpi__val')), sub: txt(el.querySelector('.kpi__delta')), zona: zona(el), alert: el.classList.contains('kpi--alert'), abre: el.classList.contains('kpi--abre'), nuevo: el.classList.contains('kpi--nuevo'), href: el.getAttribute('href') }));
    const tarjetas = [...document.querySelectorAll('#gridModulos .mcard[data-visible="true"]')].filter(e => e.style.display !== 'none').map(e => txt(e.querySelector('.mcard__t')));
    const rail = [...document.querySelectorAll('#ccRail .rail__link')].map(a => ({ t: txt(a.querySelector('.rail__txt')), active: a.classList.contains('is-active'), visible: !!a.offsetParent }));
    const grupos = [...document.querySelectorAll('#ccRail .rail__group')].map(txt);
    const feedDev = document.getElementById('feedDevoluciones');
    const feedTxt = feedDev && feedDev.style.display !== 'none' ? txt(feedDev).slice(0, 200) : null;
    const fab = document.querySelector('.rail-fab');
    return { saludo: txt(document.getElementById('saludoNombre')) + ' / ' + txt(document.getElementById('saludoMeta')), senales, tarjetas, rail, grupos, feedTxt, meta: txt(document.querySelector('.kpis-meta')), fabVisible: !!(fab && fab.offsetParent), railVisible: !!document.getElementById('ccRail')?.offsetParent, hint: txt(document.getElementById('hintKeys')), banner: txt(document.getElementById('impersonateBanner')) };
  });
  const geo = await s.geometria();
  const cap = await s.captura(`${String(n).padStart(2, '0')}-${rol}-${vp}-home`, { full: true });
  const consultas = await s.consultas();
  const rec = { rol, vp, info, msSenales, ...d, geo, consultas, errores: s.errores.slice(0, 10), toasts: await s.toasts(), cap };
  out.push(rec);
  console.log(`\n=== ${rol} @ ${vp} · ${info.msTotal} ms total, fsReqs=${info.fsReqs}, primeraFs=${info.primeraFs}, señales listas en +${msSenales} ms, quieto=${info.quieto}`);
  console.log('  saludo:', d.saludo, d.banner ? ' BANNER:' + d.banner : '');
  console.log('  señales:', d.senales.map(x => `${x.id}=${x.val}[${x.zona}${x.alert ? '!' : ''}${x.abre ? '▾' : ''}] "${x.label}"`).join(' · ') || '(ninguna)');
  console.log('  meta:', d.meta, '| feed devoluciones:', d.feedTxt ? d.feedTxt.slice(0, 80) : '—');
  console.log('  tarjetas:', d.tarjetas.join(' | '));
  console.log('  rail:', d.railVisible ? d.rail.map(r => (r.active ? '*' : '') + r.t).join(' | ') : `(oculto; FAB=${d.fabVisible})`, '| grupos:', d.grupos.join('/'));
  console.log('  geo:', JSON.stringify(geo));
  console.log('  consultas:', consultas.length, consultas.slice(0, 25).join(' ; '));
  if (s.errores.length) console.log('  ERRORES:', s.errores.slice(0, 6));
  // Teléfono: abrir el drawer del rail y contar clics a un módulo
  if (vp === 'telefono') {
    const fab = await s.page.$('.rail-fab, #ccRailToggle');
    if (fab) {
      await fab.click(); await s.quieto(600, 4000);
      const abierto = await s.page.evaluate(() => document.getElementById('ccRail')?.classList.contains('is-open'));
      await s.captura(`${String(n).padStart(2, '0')}b-${rol}-${vp}-drawer`);
      console.log('  drawer abre con FAB:', abierto);
      const links = await s.page.evaluate(() => [...document.querySelectorAll('#ccRail .rail__link')].map(a => ({ t: a.innerText.trim(), h: a.getAttribute('href'), r: a.getBoundingClientRect().height })));
      console.log('  drawer links:', links.map(l => `${l.t}(${Math.round(l.r)}px)`).join(' | '));
    } else console.log('  SIN FAB ni toggle en teléfono');
  }
  await s.cerrar();
  n++;
}
fs.writeFileSync('C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/home-nav/01-home-por-rol.json', JSON.stringify(out, null, 1));
