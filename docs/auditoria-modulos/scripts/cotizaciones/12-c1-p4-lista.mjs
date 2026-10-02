// Auditoría de módulos 2026-09-30 · Cotizaciones · C1 + P4 (ejecución 2026-10-02).
// La lista baja el alcance en UNA lectura y tarjetas, segmentos y tabla
// cuentan sobre la misma lista. Mide viajes a Firestore y compara la tarjeta
// "Enviadas · esperando" con el segmento "Enviada" (antes: 36 viajes y
// "12 Enviadas" vs "Enviada 5" en la vista Taller de Solangel).
//   node 12-c1-p4-lista.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (...a) => console.log(...a);
const num = (txt, label) => { const m = new RegExp(label + '\\s+(\\d+)').exec(txt); return m ? Number(m[1]) : null; };

for (const [quien, email] of [['Karla (vendedora)', USUARIOS.vendedor], ['Solangel (jefa de taller)', USUARIOS.jefe_taller], ['Alberto (admin)', USUARIOS.admin]]) {
  const s = await abrir({ email, viewport: 'escritorio', carpeta: 'cotizaciones' });
  const P = s.page;
  const r = await s.ir('/cotizaciones/index.html', { esperar: 1500 });
  log(`\n=== ${quien} · ${r.msTotal} ms · fsReqs ${r.fsReqs} · errores ${JSON.stringify(s.errores.slice(0, 2))}`);
  log('subtítulo:', await s.texto('#headerSubtitle'), '| footer:', await s.texto('#footerResumen'));
  for (const tipo of ['taller', 'ventas', 'todas']) {
    await P.click(`#tipoSeg [data-tipo="${tipo}"]`); await s.quieto(400);
    const segs = (await s.texto('#segments')).replace(/\n/g, ' ');
    const tarjetaEnviadas = Number(await s.texto('#statPendientes'));
    const segEnviada = num(segs, 'Enviada');
    const tarjetaMonto = await s.texto('#statMontoAprobado');
    const nAceptadas = num(segs, 'Aceptada');
    const pendSub = await s.texto('#statMontoSub');
    log(`  [${tipo}] tipoSeg: ${(await s.texto('#tipoSeg')).replace(/\n/g, ' ')} | segmentos: ${segs}`);
    log(`  [${tipo}] tarjeta Enviadas=${tarjetaEnviadas} vs segmento Enviada=${segEnviada} → ${tarjetaEnviadas === segEnviada ? 'IGUAL' : 'DISTINTO'} | monto ${tarjetaMonto} (${pendSub}) | tasa ${await s.texto('#statTasa')} (${await s.texto('#statTasaSub')})`);
    // Tocar el segmento Enviada: la tabla muestra exactamente ese número de filas
    const btnEnv = await P.$('#segments [data-estado="enviada"]');
    if (btnEnv) { await btnEnv.click(); await s.quieto(400); log(`  [${tipo}] clic "Enviada" → filas en la tabla: ${await P.evaluate(() => document.querySelectorAll('#tablaCotizaciones tr[data-id]').length)} | footer: ${await s.texto('#footerResumen')}`); await P.click('#segments [data-estado="todas"]'); await s.quieto(300); }
  }
  // Rango de fechas: recorta tarjetas, segmentos y tabla por igual
  await P.click('#tipoSeg [data-tipo="todas"]'); await s.quieto(300);
  await P.evaluate(() => { const i = document.getElementById('filtroDesde'); i.value = '2026-09-01'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await s.quieto(500);
  log('  [rango desde 1-sep] segmentos:', (await s.texto('#segments')).replace(/\n/g, ' '), '| tarjeta Enviadas:', await s.texto('#statPendientes'), '| sub:', await s.texto('#statTasaSub'), '| footer:', await s.texto('#footerResumen'));
  await s.captura(`66-c1-${quien.split(' ')[0].toLowerCase()}-lista-un-alcance`);
  log('  consultas:', (await s.consultas()).map(q => q.replace(/\s+/g, ' ')).slice(0, 8));
  await s.cerrar();
}
