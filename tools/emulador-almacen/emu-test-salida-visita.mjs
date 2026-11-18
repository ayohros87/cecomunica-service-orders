// Salida de radios a la visita (2026-11-18): bloque "Radios con técnicos" en
// Almacén · Hoy, hoja de salida (preview de la visita) y hoja de regreso, y la
// pista en "Registrar cambio de radio en sitio". Solo se abren: los callables
// NO se llaman (irían a producción); se prueban en
// functions/test-emulator/p4-modelo-reemplazo.js. Requiere radios sembrados
// en con_tecnico (ver el seed de la sesión). VISITA=<id> node emu-test-salida-visita.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';
const VISITA = process.env.VISITA;
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const bo = await abrir({ email: USUARIOS.inventario, carpeta: 'salida-visita' });
await bo.ir('/almacen/index.html', { esperar: 4000 });
await bo.page.waitForSelector('[data-salida-devolver]', { timeout: 30000 }).catch(() => {});
const bloque = await bo.page.evaluate(() => document.getElementById('hoySalidas')?.innerText || '');
ok(/radios con técnicos/i.test(bloque) && bloque.includes(process.env.VISITA), 'Hoy muestra los radios con técnicos de la visita');
await bo.captura('01-hoy');
await bo.page.click('[data-salida-nueva]');
await bo.page.waitForSelector('#svVisita');
await bo.page.type('#svVisita', VISITA);
await bo.page.type('#svSeriales', '14411D0452\n');
await bo.page.evaluate(() => document.getElementById('svVisita').dispatchEvent(new Event('change')));
await espera(1500);
const info = await bo.page.evaluate(() => document.getElementById('svInfo').innerText);
console.log('    preview:', info);
await bo.captura('02-salida');
await bo.page.keyboard.press('Escape'); await espera(600);
await bo.page.waitForSelector('[data-salida-devolver]', { timeout: 15000 });
await bo.page.click('[data-salida-devolver]');
await bo.page.waitForSelector('input[name="svDev"]');
const n = await bo.page.evaluate(() => document.querySelectorAll('input[name="svDev"]').length);
ok(n >= 2, `hoja de regreso lista ${n} radios`);
await bo.captura('03-recibir');
await bo.cerrar?.();

const te = await abrir({ email: USUARIOS.recepcion, carpeta: 'salida-visita' });
await te.ir(`/ordenes/index.html?ids=${VISITA}`, { esperar: 4000 });
await te.page.evaluate(() => CargaDiferida.regularizarReemplazo()).catch(() => {});
await te.page.evaluate((id) => abrirRegularizarReemplazo(id), VISITA).catch(e => console.log('    abrir:', e.message));
await te.page.waitForSelector('#rrEnt', { timeout: 15000 }).catch(() => {});
const pista = await te.page.evaluate(() => ({ dl: document.querySelectorAll('#rrLlevados option').length, txt: document.querySelector('.modal-body')?.innerText || '' }));
ok(pista.dl >= 2 && /Salieron de bodega con esta visita/.test(pista.txt), 'cambio en sitio sugiere los radios que salieron: ' + pista.dl);
await te.captura('04-cambio-en-sitio');
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
