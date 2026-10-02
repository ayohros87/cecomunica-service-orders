// Verificación D17 (plan §3.8): contabilidad ve Finanzas, Centro de gestión y
// Clientes, y su home trae las señales de Finanzas (FAV avisos sin facturar
// > 7 d, COM comisiones listas) en vez de quedar vacío. Andrea (cobros) sigue
// como recepción; admin no gana señales nuevas.
// Antes (auditoría 2026-09-30, 08 §2.1): contabilidad → "ninguna" señal, 2 tarjetas.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

const leerHome = (s) => s.page.evaluate(() => {
  const txt = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
  const zona = (el) => el.closest('.kpis-zero__items') ? 'aldia' : el.closest('.kpis-deuda__items') ? 'seguimiento' : 'dia';
  return {
    senales: [...document.querySelectorAll('[data-signal]')].map(el => `${el.dataset.signal}=${txt(el.querySelector('.kpi__val'))}[${zona(el)}] "${txt(el.querySelector('.kpi__t'))}"`),
    tarjetas: [...document.querySelectorAll('#gridModulos .mcard[data-visible="true"]')].filter(e => e.style.display !== 'none').map(e => txt(e.querySelector('.mcard__t'))),
    rail: [...document.querySelectorAll('#ccRail .rail__link')].map(a => txt(a.querySelector('.rail__txt'))),
  };
});

for (const [rol, vp] of [['contabilidad', 'escritorio'], ['contabilidad', 'telefono'], ['cobros', 'escritorio'], ['admin', 'escritorio']]) {
  const s = await abrir({ email: USUARIOS[rol], viewport: vp, carpeta: 'home-nav' });
  const info = await s.ir('/index.html', { esperar: 1500 });
  await s.page.waitForFunction(() => !document.querySelector('.kpi.is-loading') && !document.querySelector('.kpis-skel'), { timeout: 20000 }).catch(() => {});
  await s.quieto(1200, 8000);
  const d = await leerHome(s);
  console.log(`\n=== ${rol} @ ${vp} · ${info.msTotal} ms, fsReqs=${info.fsReqs}`);
  console.log('  señales:', d.senales.join(' · ') || '(ninguna)');
  console.log('  tarjetas:', d.tarjetas.join(' | '));
  console.log('  rail:', d.rail.join(' | '));
  if (s.errores.length) console.log('  ERRORES:', s.errores.filter(e => !/favicon/.test(e)).slice(0, 4));
  if (rol === 'contabilidad') {
    await s.captura(`94-contabilidad-${vp}-home`, { full: true });
    // Abrir el panel de FAV y leer las filas
    if (await s.page.$('[data-signal="FAV"]')) {
      await s.page.click('[data-signal="FAV"]'); await s.quieto(1000, 10000);
      console.log('  panel FAV:', JSON.stringify(await s.page.evaluate(() => { const p = document.querySelector('.bj-panel'); return { filas: p?.querySelectorAll('.bj-row').length, primera: p?.querySelector('.bj-row')?.innerText.replace(/\s+/g, ' ').slice(0, 140), cta: p?.querySelector('.bj-row a[href]')?.getAttribute('href') }; })));
    }
    if (vp === 'escritorio') {
      // Centro: lista y ficha, de consulta
      const c = await s.ir('/clientes/centro.html', { esperar: 1500 }); await s.quieto(1500, 15000);
      const lista = await s.page.evaluate(() => ({ restringido: /Acceso restringido/.test(document.body.innerText), filas: document.querySelectorAll('#cgLista .cg-row').length, nuevoCliente: !!document.querySelector('a[href*="nuevo=1"]'), railActivo: document.querySelector('#ccRail .rail__link.is-active')?.innerText.trim() }));
      console.log('  Centro lista →', c.msTotal, 'ms', JSON.stringify(lista), s.errores.filter(e => !/favicon/.test(e)).slice(0, 3));
      const f = await s.ir('/clientes/centro.html?id=6yoaiUMRAhhSMtiC4O0S', { esperar: 2000 }); await s.quieto(2000, 20000);
      const ficha = await s.page.evaluate(() => ({ restringido: /Acceso restringido/.test(document.body.innerText), ficha: !document.getElementById('vistaFicha')?.classList.contains('hidden'), nombre: document.body.innerText.includes('C COMUNICA'), botonesGestion: [...document.querySelectorAll('#vistaFicha button, #vistaFicha a.btn')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 12) }));
      console.log('  Centro ficha →', f.msTotal, 'ms', JSON.stringify(ficha), (await s.toasts()).map(t => t.msg).slice(0, 2), s.errores.filter(e => !/favicon/.test(e)).slice(0, 3));
      await s.captura('95-contabilidad-escritorio-centro-ficha', { full: true });
      // Finanzas: bandeja y comisiones por deep-link
      for (const pag of ['/facturacion/bandeja.html', '/facturacion/comisiones.html']) {
        const r = await s.ir(pag, { esperar: 1500 }); await s.quieto(1500, 15000);
        console.log(`  ${pag} → ${r.msTotal} ms · restringido=${/restringid|Acceso/.test(await s.texto('main, body'))} · errores=${JSON.stringify(s.errores.filter(e => !/favicon/.test(e)).slice(0, 2))}`);
      }
    }
  }
  await s.cerrar();
}
