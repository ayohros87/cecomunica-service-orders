// P2 del plan de autoservicio (2026-10-07): el Centro ofrece "Declarar el
// contrato sustituto…" en un anulado con vínculo pendiente, lo lista en
// "Ahora", y el aviso de "contrato vivo con los mismos equipos" se pinta.
// Contra el emulador con datos de producción (sin functions: la hoja se abre,
// NO se confirma — el callable se prueba en test-emulator/declarar-sustituto.js).
//   node emu-test-declarar-sustituto.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const adm = await abrir({ email: USUARIOS.administrador || USUARIOS.admin || 'ayohros@cecomunica.com', carpeta: 'declarar-sustituto' });
await adm.ir('/clientes/centro.html', { esperar: 2500 });
const caso = await adm.page.evaluate(async () => {
  const db = firebase.firestore();
  const s = await db.collection('contratos').where('sustitucion_vinculo_pendiente', '==', true).limit(5).get();
  const c = s.docs.map(d => ({ id: d.id, ...d.data() })).find(x => x.cliente_id && x.estado === 'anulado');
  return c ? { id: c.id, contrato_id: c.contrato_id, cliente_id: c.cliente_id, cliente: c.cliente_nombre, motivo: c.sustitucion_vinculo_motivo, sust: c.sustituido_por_id || null } : null;
});
console.log('    caso:', JSON.stringify(caso));
if (!caso) { ok(false, 'no hay contrato anulado con sustitucion_vinculo_pendiente en el emulador'); }
else {
  await adm.ir(`/clientes/centro.html?id=${caso.cliente_id}`, { esperar: 3500 });
  await espera(2000);
  const ahora = await adm.page.evaluate(() => (document.getElementById('fAhora')?.innerText || ''));
  ok(/sustituy|sustituto|pasar sus equipos/i.test(ahora), 'Ahora menciona el sustituto pendiente: ' + ahora.replace(/\n/g, ' ').slice(0, 220));
  const acc = await adm.page.evaluate((id) => {
    const c = Centro.contratos.find(x => x.id === id);
    const a = Centro._accionesContrato(c);
    return a.filter(x => x.id === 'declarar_sustituto').map(x => ({ label: x.label, ok: x.ok, primaria: x.primaria, hint: x.hint }));
  }, caso.id);
  ok(acc.length === 1 && acc[0].ok, 'acción en el menú del contrato: ' + JSON.stringify(acc));
  await adm.captura('01-ahora', { full: true });
  await adm.page.evaluate((id) => Centro.declararSustituto(id), caso.id);
  await adm.page.waitForSelector('#dsSustituto', { timeout: 10000 });
  await espera(600);
  const sel = await adm.page.evaluate(() => [...document.querySelectorAll('#dsSustituto option')].map(o => o.textContent.trim()));
  console.log('    candidatos:', JSON.stringify(sel).slice(0, 300));
  ok(sel.length >= 1, 'la hoja lista los contratos vivos de la cuenta');
  await adm.captura('02-hoja-declarar');
  ok(!adm.errores.some(e => /PRODUCCIÓN/.test(e)), 'ninguna llamada a producción');
  ok(!adm.errores.length, 'Centro sin errores de página: ' + adm.errores.join(' | '));
}

// B1: la hoja del contrato vivo igual (solo pintado).
await adm.page.evaluate(() => Centro._cerrarModal?.());
await espera(300);
await adm.page.evaluate(() => { Centro._wcPreguntarDuplicado({ id: 'x', contrato_id: 'ALQ20260720-02', estado: 'activo', equipos: [{ modelo: 'PNC460-R', cantidad: 22 }], total_mensual: 588.5 }); });
await adm.page.waitForSelector('[data-sheet-action="sustituye"]', { timeout: 8000 });
const btns = await adm.page.evaluate(() => [...document.querySelectorAll('[data-sheet-action]')].map(b => b.textContent.trim()).filter(Boolean));
ok(btns.some(b => /sustituye a ALQ20260720-02/i.test(b)) && btns.some(b => /distintas/i.test(b)), 'hoja B1 con las tres salidas: ' + JSON.stringify(btns));
await adm.captura('03-hoja-duplicado');

await adm.cerrar();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
