// P3 del plan de autoservicio (2026-10-07): el Centro ofrece "Trasladar a otra
// ficha de cliente…" en el menú del contrato y "Cambio de razón social /
// traslado de cuenta…" en el ⋯ de la cabecera; el buscador de clientes elige
// la ficha destino. Solo se abre y se elige: NO se confirma (el callable
// iría a producción; se prueba en test-emulator/traslado-cliente.js).
//   node emu-test-traslado.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const adm = await abrir({ email: USUARIOS.admin, carpeta: 'traslado' });
await adm.ir('/clientes/centro.html', { esperar: 2500 });
const caso = await adm.page.evaluate(async () => {
  const db = firebase.firestore();
  const s = await db.collection('contratos').where('estado', '==', 'activo').limit(10).get();
  const c = s.docs.map(d => ({ id: d.id, ...d.data() })).find(x => x.cliente_id && !x.deleted);
  return c ? { id: c.id, contrato_id: c.contrato_id, cliente_id: c.cliente_id, cliente: c.cliente_nombre } : null;
});
console.log('    caso:', JSON.stringify(caso));
await adm.ir(`/clientes/centro.html?id=${caso.cliente_id}`, { esperar: 3500 });
await espera(1500);
const acc = await adm.page.evaluate((id) => {
  const c = Centro.contratos.find(x => x.id === id);
  return Centro._accionesContrato(c).filter(x => x.id === 'trasladar').map(x => ({ label: x.label, ok: x.ok, grupo: x.grupo }));
}, caso.id);
ok(acc.length === 1 && acc[0].ok && acc[0].grupo === 'Corregir', 'acción "Trasladar a otra ficha…" para admin: ' + JSON.stringify(acc));
const masMenu = await adm.page.evaluate(() => document.getElementById('cgMasMenu')?.innerText || '');
ok(/traslado de cuenta/i.test(masMenu), 'el ⋯ de la cabecera trae "Cambio de razón social / traslado de cuenta…"');

// B2: hoja + buscador
await adm.page.evaluate((id) => Centro.trasladarContrato(id), caso.id);
await adm.page.waitForSelector('#trCliente', { timeout: 10000 });
await espera(1200);
const q = await adm.page.evaluate(async () => {
  const cs = await ClientesService.getAllClientes({ fresh: false });
  const c = cs.find(x => x.nombre && x.id !== Centro.cliente.id && x.activo !== false && !x.deleted);
  return { id: c.id, nombre: c.nombre };
});
await adm.page.type('#trCliente', q.nombre.slice(0, 10));
await espera(500);
const hits = await adm.page.evaluate(() => [...document.querySelectorAll('#trClienteLista .tr-hit')].map(b => b.dataset.id));
ok(hits.includes(q.id), `el buscador lista la ficha buscada (${hits.length} coincidencias)`);
await adm.page.evaluate((id) => document.querySelector(`#trClienteLista .tr-hit[data-id="${id}"]`).click(), q.id);
const sel = await adm.page.evaluate(() => ({ dest: Centro._trDestino?.id, input: document.getElementById('trCliente').value, lista: document.getElementById('trClienteLista').style.display }));
ok(sel.dest === q.id && sel.input === q.nombre && sel.lista === 'none', 'al elegir, queda el destino y la lista se cierra: ' + JSON.stringify(sel));
await adm.captura('01-trasladar-contrato');
// Sin motivo no avanza (y no llama a nada).
await adm.page.evaluate(() => Centro._trasladarContratoConfirmar(Centro.contratos.find(c => c.id)?.id));
await espera(500);
const t1 = await adm.toasts();
ok(t1.some(t => /motivo/i.test(t.msg)), 'sin motivo: aviso y no sale la confirmación');

// C1: hoja de la cuenta
await adm.page.evaluate(() => Centro._cerrarModal());
await espera(300);
await adm.page.evaluate(() => Centro.trasladarCuenta());
await adm.page.waitForSelector('#trCliente', { timeout: 10000 });
const txt = await adm.page.evaluate(() => document.getElementById('cgModal')?.innerText || '');
ok(/contrato\(s\) vigente\(s\)/.test(txt) && /por confirmar/.test(txt), 'la hoja de cuenta dice qué se mueve y qué no');
await adm.captura('02-trasladar-cuenta');
ok(!adm.errores.some(e => /PRODUCCIÓN/.test(e)), 'ninguna llamada a producción');
ok(!adm.errores.length, 'Centro sin errores de página: ' + adm.errores.join(' | '));

await adm.cerrar();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
