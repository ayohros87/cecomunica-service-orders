// Verificación R4 + C8 (08-home-navegacion-admin).
// R4: "Listas para entregar" (recepción) y "Sin movimiento" (admin) ahora
//     paginan con orderBy(documentId()) y tope explícito (600 → "N+"). Los
//     números deben seguir siendo los de la verdad (ENT 46, EST 13 el 30-sep;
//     02-verdad-senales.js los recalcula) y las consultas no deben dispararse.
// C8: admin/operacion.html "Requiere atención" ya no abre con una cotización
//     aprobada vencida hace 106 días: solo enviadas vencidas ≤ 30 días.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

for (const [rol, ids] of [['recepcion', ['S1', 'ENT']], ['admin', ['S1', 'EST']], ['jefe_taller', ['S1', 'EST']]]) {
  const s = await abrir({ email: USUARIOS[rol], viewport: 'escritorio', carpeta: 'home-nav' });
  const info = await s.ir('/index.html', { esperar: 1500 });
  await s.page.waitForFunction(() => !document.querySelector('.kpi.is-loading') && !document.querySelector('.kpis-skel'), { timeout: 25000 }).catch(() => {});
  await s.quieto(1200, 8000);
  const vals = await s.page.evaluate((ids) => Object.fromEntries(ids.map(id => [id, document.querySelector(`[data-signal="${id}"] .kpi__val`)?.innerText.trim()])), ids);
  const cons = (await s.consultas()).filter(c => /listListasParaEntregar|listEstancadas|countListasParaEntregar|countEstancadas/.test(c));
  console.log(`${rol}: ${JSON.stringify(vals)} · ${info.msTotal} ms, fsReqs=${info.fsReqs} · ${cons.join(' ; ')}`);
  if (rol === 'admin') {
    await s.page.click('[data-signal="EST"]'); await s.quieto(1000, 10000);
    console.log('  panel EST filas:', await s.page.evaluate(() => document.querySelectorAll('.bj-panel .bj-row').length), '· cabecera:', await s.page.evaluate(() => document.querySelector('.bj-panel .bj-panel-head, .bj-panel .bj-head')?.innerText.replace(/\s+/g, ' ').slice(0, 80)));
    const op = await s.ir('/admin/operacion.html', { esperar: 2500 }); await s.quieto(2500, 40000);
    const at = await s.page.evaluate(() => {
      const heads = [...document.querySelectorAll('.att-section-header')].map(h => h.innerText.trim());
      const cot = [...document.querySelectorAll('li')].map(li => li.innerText.replace(/\s+/g, ' ').trim()).filter(t => /COT-/.test(t)).slice(0, 4);
      return { heads, cot, todoEnOrden: /Todo en orden/.test(document.body.innerText) };
    });
    console.log(`  admin/operacion → ${op.msTotal} ms · secciones: ${JSON.stringify(at.heads)} · cotizaciones: ${JSON.stringify(at.cot)} · todoEnOrden=${at.todoEnOrden}`);
    await s.captura('96-admin-escritorio-operacion-atencion');
  }
  await s.cerrar();
}
