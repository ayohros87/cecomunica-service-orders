// "Activos" sin texto en el buscador filtra la página del servidor y el botón
// "Seleccionar los N" marca todo (Brenda, 2026-10-17: "aún no puedo seleccionar
// los activos"). Corre contra el emulador sembrado con `npm run build` hecho:
//   node tools/emulador-almacen/emu-test-poc-activos-seleccion.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

const fallos = [];
const ok = (cond, msg) => { console.log((cond ? 'OK     ' : 'FALLA  ') + msg); if (!cond) fallos.push(msg); };
const s = await abrir({ email: USUARIOS.recepcion, carpeta: 'baja-poc' });
const p = s.page;
p.on('response', r => { if (r.status() >= 400) console.log('       HTTP', r.status(), r.url().slice(0, 140), 'body:', String(r.request().postData() || '').slice(0, 400)); });
await s.ir('/POC/index.html', { esperar: 1500 });

const filas = () => p.evaluate(() => [...document.querySelectorAll('#devicesTable tr[data-id]')].map(r => r.cells[3]?.dataset.activo === 'true'));
const resumen = () => p.evaluate(() => document.getElementById('resumenSeleccionados')?.textContent.replace(/\s+/g, ' ').trim() || '');

// 1. Página inicial (Todos): mezcla de activos e inactivos, botón "Seleccionar los 50".
let f = await filas();
ok(f.length === 50, `página inicial: ${f.length} filas (${f.filter(Boolean).length} activas)`);
ok(/^Seleccionar los 50$/.test(await resumen()), `barra: "${await resumen()}"`);

// 2. "Activos" sin texto: solo activos, desde el servidor.
await p.click('input[name="pocEstadoActivo"][value="activos"]');
await s.quieto(1500);
f = await filas();
ok(f.length === 50 && f.every(Boolean), `Activos sin texto: ${f.length} filas, todas activas (${f.filter(Boolean).length})`);
await s.captura('07-activos-pagina');

// 3. "Cargar más" sigue trayendo solo activos.
await p.click('#btnCargarMas');
await s.quieto(1500);
f = await filas();
ok(f.length === 100 && f.every(Boolean), `tras "Cargar más": ${f.length} filas, todas activas`);

// 4. Botón "Seleccionar los N" → "N de N seleccionados" y casilla del encabezado marcada.
await p.click('#resumenSeleccionados button');
await s.quieto(300);
ok((await resumen()) === '100 de 100 seleccionados', `tras el botón: "${await resumen()}"`);
ok(await p.evaluate(() => document.querySelector('#encabezadoTabla .check-all').checked), 'la casilla del encabezado quedó marcada');
await s.captura('08-seleccionados-boton');

// 5. Desmarcar desde el encabezado → vuelve el botón.
await p.click('#encabezadoTabla .check-all');
await s.quieto(300);
ok(/^Seleccionar los 100$/.test(await resumen()), `desmarcado: "${await resumen()}"`);

// 6. "Inactivos" sin texto: solo inactivos.
await p.click('input[name="pocEstadoActivo"][value="inactivos"]');
await s.quieto(1500);
f = await filas();
ok(f.length > 0 && f.every(x => !x), `Inactivos sin texto: ${f.length} filas, ninguna activa`);

// 7. Con cliente en el buscador + Activos: lo de siempre.
await p.click('input[name="pocEstadoActivo"][value="activos"]');
await p.type('#filtroValor', 'unidad mo');
await p.waitForFunction(() => /en la búsqueda/.test(document.getElementById('resumenEquiposTop')?.textContent || ''), { timeout: 90000 });
await s.quieto(800);
f = await filas();
ok(f.length > 0 && f.every(Boolean), `cliente + Activos: ${f.length} filas activas`);
const clientes = await p.evaluate(() => [...new Set([...document.querySelectorAll('#devicesTable tr[data-id]')].map(r => r.cells[1]?.querySelector('strong')?.textContent.trim()))]);
ok(clientes.every(c => /UNIDAD MO/i.test(c)), 'todas las filas son del cliente buscado: ' + JSON.stringify(clientes));
await p.click('#resumenSeleccionados button');
await s.quieto(300);
ok((await resumen()) === `${f.length} de ${f.length} seleccionados`, `cliente + botón: "${await resumen()}"`);

const errores = s.errores.filter(e => !/favicon|rebotó a login/.test(e));
ok(!errores.length, 'sin errores de consola ' + JSON.stringify(errores.slice(0, 5)));
await s.browser.close();
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);
