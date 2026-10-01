// Asignar 25 seriales a un contrato desde Almacén · Asignar con LECTOR
// simulado (serial + Enter, 5 ms por carácter), y cerrar con pick & confirm.
// Requiere 00-seed-prueba.js (contrato PRUEBA-AUDIT-almacen-01, 25 × PNC360S-R).
//   node 03-asignar-lector.mjs [escritorio|telefono] [SERIALES_JSON]
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
import fs from 'node:fs';

// Variables de entorno: CONTRATO (defecto PRUEBA-AUDIT-almacen-01), N (25) y
// SERIALES_FILE (seriales-lector.json). Para el contrato de 50 (00d):
//   CONTRATO=PRUEBA-AUDIT-almacen-02 N=50 SERIALES_FILE=seriales-lector-50.json node 03-asignar-lector.mjs
const VP = process.argv[2] || 'escritorio';
const N = Number(process.env.N || 25);
const SERIALES = JSON.parse(process.argv[3] || fs.readFileSync(new URL(`./${process.env.SERIALES_FILE || 'seriales-lector.json'}`, import.meta.url), 'utf8')).slice(0, N);
const CONTRATO = process.env.CONTRATO || 'PRUEBA-AUDIT-almacen-01';
const MALO = process.argv[4] || '';   // serial en cliente: se escanea en la casilla 25 para ver el bloqueo
const ESCANEO = MALO ? [...SERIALES.slice(0, N - 1), MALO] : SERIALES;
const s = await abrir({ email: USUARIOS.inventario, viewport: VP, carpeta: 'almacen' });
const p = s.page;
const R = (n) => `${String(Math.round(n)).padStart(6)} ms`;
const now = () => p.evaluate(() => performance.now());
const enModal = (fn, ...args) => p.evaluate((f, ...a) => {
  const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1];
  return m ? (new Function('m', 'args', `return (${f})(m, ...args)`))(m, a) : null;
}, fn.toString(), ...args);
const textoModal = () => enModal((m) => m.innerText.replace(/\n{2,}/g, '\n').slice(0, 1200));

console.log(`\n=== Asignar con lector · ${VP} · ${SERIALES.length} seriales ===`);
const i1 = await s.ir(`/almacen/index.html?tab=asignar&contrato=${CONTRATO}`, { esperar: 1500 });
console.log(`abrir Asignar con el contrato: ${i1.msTotal} ms · 1ª Firestore ${i1.primeraFs} ms · ${i1.fsReqs} peticiones`);
console.log('encabezado: ' + (await s.texto('.as-work-h')).replace(/\n/g, ' · '));
console.log('picklist: ' + (await s.texto('#asPicklist')).replace(/\n/g, ' · '));
console.log('toolbar: ' + (await s.texto('#asToolbar')).replace(/\n/g, ' · '));
console.log('casillas: ' + await p.evaluate(() => document.querySelectorAll('#asBody .serial-input').length));
await s.captura(`20-inventario-${VP}-asignar-contrato-${N}`);

// ── Escaneo: serial + Enter en cada casilla ────────────────────────────
await p.focus('#asBody .serial-input');
const tInicio = await now();
const tiempos = [];
for (const [i, serial] of ESCANEO.entries()) {
  const t = await now();
  await p.keyboard.type(serial + '\n', { delay: 5 });
  // esperar a que el foco esté en la siguiente casilla vacía (o se suelte)
  await p.waitForFunction((n) => {
    const a = document.activeElement;
    const llenas = [...document.querySelectorAll('#asBody .serial-input')].filter(x => x.value.trim()).length;
    return llenas >= n && (!a || !a.classList.contains('serial-input') || !a.value.trim());
  }, { timeout: 8000 }, i + 1).catch(() => {});
  tiempos.push((await now()) - t);
  if (i === 4) await s.captura(`21-inventario-${VP}-asignar-5-escaneados`);
}
const tEscaneo = (await now()) - tInicio;
console.log(`${N} escaneos: ${R(tEscaneo)} · por escaneo: mín ${R(Math.min(...tiempos))} · mediana ${R(tiempos.sort((a, b) => a - b)[Math.floor(N / 2)])} · máx ${R(Math.max(...tiempos))}`);
await s.quieto(1500, 15000);
console.log('progreso: ' + (await s.texto('#asProg')) + ' · chips SerialField: ' + await p.evaluate(() => document.querySelectorAll('#asBody .sf-slot .eqpool-chip').length));
console.log('chips (muestra): ' + await p.evaluate(() => [...document.querySelectorAll('#asBody .sf-slot')].slice(0, 3).map(x => x.innerText).join(' | ')));
await s.captura(`22-inventario-${VP}-asignar-${N}-escaneados`);
console.log('consultas durante el escaneo: ' + (await s.consultas()).filter(x => /findBySerial|Descartados|Condiciones/.test(x)).length + ' de ' + (await s.consultas()).length);

// ── Listo para programar → validación → verificar lista (2º escaneo) ──
let t = await now();
await new Promise(r => setTimeout(r, 3500));   // que se vaya el toast del último Enter (tapa el pie pegajoso)
t = await now();
await p.click('[data-as="listo"]');
await p.waitForFunction(() => document.querySelectorAll('.modal-backdrop.open').length > 0, { timeout: 20000 }).catch(() => {});
await s.quieto(600, 10000);
console.log(`clic "Listo para programar" → ${R((await now()) - t)} · modal: ` + ((await textoModal()) || '(ninguno)').split('\n').slice(0, 2).join(' / '));
await s.captura(`23-inventario-${VP}-asignar-${MALO ? 'bloqueo' : 'verificar-lista'}`);
if (MALO) {
  console.log('panel de bloqueo: ' + ((await textoModal()) || '').replace(/\n/g, ' / ').slice(0, 500));
  await enModal((m) => m.querySelector('[data-sheet-action="cancel"]')?.click()); await s.quieto(500, 5000);
  // corregir la casilla 25 y volver a intentar
  await p.evaluate((bueno) => { const i = [...document.querySelectorAll('#asBody .serial-input')].pop(); i.focus(); i.value = ''; i.value = bueno; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); }, SERIALES[N - 1]);
  await s.quieto(800, 8000);
  t = await now();
  await p.click('[data-as="listo"]');
  await p.waitForFunction(() => { const ms = document.querySelectorAll('.modal-backdrop.open'); return ms.length > 0 && ms[ms.length - 1].innerText.includes('Verificar la lista'); }, { timeout: 20000 }).catch(() => {});
  console.log(`2º intento → hoja de verificación en ${R((await now()) - t)}`);
  await s.captura(`23-inventario-${VP}-asignar-verificar-lista`);
}
const hayVerificacion = await enModal((m) => !!m.querySelector('[data-ver="input"]'));
if (hayVerificacion) {
  t = await now();
  await enModal((m) => m.querySelector('[data-ver="input"]').focus());
  for (const serial of SERIALES) { await p.keyboard.type(serial + '\n', { delay: 5 }); }
  await s.quieto(400, 5000);
  console.log(`2º escaneo (verificación) de ${N}: ${R((await now()) - t)} · ` + (await enModal((m) => m.querySelector('[data-ver="faltan"]')?.innerText)));
  await s.captura(`24-inventario-${VP}-asignar-lista-verificada`);
  await enModal((m) => m.querySelector('[data-sheet-action="confirm"]')?.click()); await s.quieto(800, 10000);
}
console.log('hoja final: ' + ((await textoModal()) || '(ninguna)').split('\n').slice(0, 6).join(' / '));
await s.captura(`25-inventario-${VP}-asignar-hoja-listo`);
t = await now();
await enModal((m) => m.querySelector('[data-sheet-action="confirm"]')?.click()); await s.quieto(1500, 20000);
console.log(`confirmar "Listo para programar": ${R((await now()) - t)}`);
console.log('toasts: ' + JSON.stringify((await s.toasts()).slice(-3)));
console.log('cola tras cerrar: ' + (await s.texto('#asCola')).replace(/\n/g, ' · ').slice(0, 300));
console.log('errores: ' + [...new Set(s.errores)].slice(0, 5).join(' | '));
await s.cerrar();
