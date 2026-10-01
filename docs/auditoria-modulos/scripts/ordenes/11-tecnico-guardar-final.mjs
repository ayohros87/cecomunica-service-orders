// Recorrido 11 · ¿"Guardar" (sin "y siguiente") guarda la intervención? En la corrida 2 el
// último equipo de A y el único de B quedaron "sin intervención" tras pulsar Guardar.
// Crea la orden C (recepción, 2 equipos, recibida sin firma), la asigna (jefa) y como Marcos
// prueba: eq1 "Guardar y siguiente" → eq2 "Guardar"; luego reabre eq2 y prueba "Guardar" solo.
// Escribe SOLO en el emulador. Prefijo PRUEBA-AUDIT-ordenes.
import { abrir, USUARIOS, PREFIJO, esperarUrl, elegirOpcion, tipear, medir, log, modalAbierto } from './lib-ordenes.mjs';
import fs from 'node:fs';
const J = 'C:/Projects/cecomunica-service-orders/docs/auditoria-modulos/capturas/ordenes/_ordenes-prueba.json';

// 1. Recepción crea C
const r = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ordenes' });
await r.ir('/ordenes/nueva-orden.html');
await tipear(r, '#clienteFiltro', 'MACELLO'); await r.quieto(600, 5000);
await elegirOpcion(r, '#cliente', 'MACELLO'); await elegirOpcion(r, '#tipo', 'REPARACI'); await r.quieto(600, 5000);
await tipear(r, '#observaciones', `${PREFIJO} C - prueba del botón Guardar`);
await r.page.click('#ordenForm button[type=submit]');
const u = await esperarUrl(r, /nuevo-batch\.html\?orden_id=/);
const C = new URL('http://x' + u).searchParams.get('orden_id');
await r.page.click('#filasBatch tr:first-child .serie'); await r.page.keyboard.type('AUDIT-C-0001');
await elegirOpcion(r, '#filasBatch tr:nth-child(1) .modelo', 'NX-');
await r.page.evaluate(() => [...document.querySelectorAll('button')].find(b => /Agregar fila/.test(b.textContent)).click());
await r.page.keyboard.type('AUDIT-C-0002'); await elegirOpcion(r, '#filasBatch tr:nth-child(2) .modelo', 'NX-');
await r.page.click('#btnGuardarRecibir');
await esperarUrl(r, /index\.html\?orden=/);
await r.quieto(800, 8000);
await tipear(r, '#entregaReceptorNombre', 'Mensajero (prueba C)');
await r.page.click('#entregaRecepcionSinFirma'); await r.quieto(300, 2000);
await tipear(r, '#entregaRecepcionSinFirmaMotivo', 'prueba C sin firma');
await medir(r, 'confirmar recepción C', async () => { await r.page.click('#btnConfirmarEntrega'); });
log('C =', C, '| fila:', await r.page.$eval(`tr[data-orden-id="${C}"]`, tr => tr.innerText.replace(/\s+/g, ' ')).catch(() => '-'));
await r.cerrar();
const ids = JSON.parse(fs.readFileSync(J, 'utf8')); ids.C = C; fs.writeFileSync(J, JSON.stringify(ids, null, 2));

// 2. Jefa asigna a Marcos
const j = await abrir({ email: USUARIOS.jefe_taller, viewport: 'escritorio', carpeta: 'ordenes' });
await j.ir(`/ordenes/index.html?orden=${C}`);
await j.page.evaluate((id) => document.querySelector(`[data-action="asignar-tecnico"][data-orden-id="${id}"]`).click(), C); await j.quieto(600, 5000);
await elegirOpcion(j, '#asignarTecnicoSelect', 'Marcos');
await medir(j, 'asignar C', async () => { await j.page.click('#modalAsignar [data-action="confirmar-asignar-tecnico"]'); });
log('toasts jefa:', JSON.stringify((await j.toasts()).slice(-1)));
await j.cerrar();

// 3. Marcos en teléfono
const s = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'ordenes' });
await s.ir(`/ordenes/index.html?orden=${C}`);
const estadoBtn = () => s.page.evaluate(() => { const b = document.getElementById('btnGuardarTrabajoEquipo'); const bs = document.getElementById('btnGuardarTrabajoSiguiente'); return { guardar: { disabled: b?.disabled, txt: b?.innerText.trim(), visible: !!b?.offsetParent }, siguiente: { disabled: bs?.disabled, display: bs?.style.display, visible: !!bs?.offsetParent } }; });
const docEquipos = () => s.page.evaluate((id) => ((APP.state.orders || []).find(o => o.ordenId === id)?.equipos || []).map(e => ({ s: e.numero_de_serie || e.serial, t: (e.trabajo_tecnico || e.intervencion || e.trabajo || '').toString().slice(0, 40) })), C);
await s.page.evaluate((id) => document.querySelector(`[data-action="abrir-equipos-mobile"][data-orden-id="${id}"]`).click(), C); await s.quieto(600, 5000);
await s.page.evaluate(() => document.querySelectorAll('#equiposMobileList [data-action="abrir-trabajo-equipo"]')[0].click()); await s.quieto(600, 5000);
log('botones al abrir eq1:', JSON.stringify(await estadoBtn()));
await s.page.click('#trabajoEquipoText'); await s.page.keyboard.type('Eq1: cambio de antena (prueba C).');
await medir(s, 'Guardar y siguiente (eq1)', async () => { await s.page.click('#btnGuardarTrabajoSiguiente'); });
log('toasts:', JSON.stringify((await s.toasts()).slice(-1)), '| pos:', await s.texto('#trabajoNavPos').catch(() => '-'));
log('botones en eq2 tras "y siguiente":', JSON.stringify(await estadoBtn()));
await s.captura('11-tecnico-telefono-eq2-botones-tras-siguiente', { el: '#modalTrabajoEquipo .modal' });
await s.page.click('#trabajoEquipoText'); await s.page.keyboard.type('Eq2: limpieza (prueba C).');
const t0 = Date.now();
await s.page.click('#btnGuardarTrabajoEquipo'); await s.quieto(800, 10000);
log(`Guardar (eq2): ${Date.now() - t0} ms | toasts:`, JSON.stringify((await s.toasts()).slice(-1)), '| modal intervención visible:', await s.page.evaluate(() => !!document.getElementById('modalTrabajoEquipo')?.offsetParent));
log('equipos en memoria:', JSON.stringify(await docEquipos()));
// Recarga y verifica desde Firestore
await s.ir(`/ordenes/index.html?orden=${C}`);
log('equipos tras recargar:', JSON.stringify(await docEquipos()));
// Prueba 2: abrir eq2 directamente y pulsar solo "Guardar"
await s.page.evaluate((id) => document.querySelector(`[data-action="abrir-equipos-mobile"][data-orden-id="${id}"]`).click(), C); await s.quieto(600, 5000);
await s.page.evaluate(() => document.querySelectorAll('#equiposMobileList [data-action="abrir-trabajo-equipo"]')[1].click()); await s.quieto(600, 5000);
log('botones al abrir eq2 directo:', JSON.stringify(await estadoBtn()));
await s.page.click('#trabajoEquipoText', { clickCount: 3 }); await s.page.keyboard.type('Eq2: limpieza, segundo intento (prueba C).');
const t1 = Date.now();
await s.page.click('#btnGuardarTrabajoEquipo'); await s.quieto(800, 10000);
log(`Guardar directo (eq2): ${Date.now() - t1} ms | toasts:`, JSON.stringify((await s.toasts()).slice(-1)), '| modal visible:', await s.page.evaluate(() => !!document.getElementById('modalTrabajoEquipo')?.offsetParent));
await s.ir(`/ordenes/index.html?orden=${C}`);
log('equipos tras recargar (2):', JSON.stringify(await docEquipos()));
log('errores:', s.errores.slice(0, 6));
await s.cerrar();
