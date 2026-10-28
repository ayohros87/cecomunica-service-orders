// Lista de clientes por DELTA (auditoría de lecturas 2026-10-28): caché local +
// `sync_at > marca` + count() de validación. Contra el emulador CON functions
// (onClienteSello tiene que sellar de verdad). Sembrar SIN functions,
// `emulators:export`, y arrancar con `--import` (ver emu-test-poc-delta.mjs):
//   firebase emulators:start --only auth,firestore,hosting,functions --import <export>
//   node emu-test-clientes-delta.mjs
import { createRequire } from 'node:module';
import { abrir, USUARIOS, BASE } from './emu-lib.mjs';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const require = createRequire('C:/Projects/cecomunica-service-orders/functions/package.json');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Panama' });
const usoClientes = async () => {
  const d = (await db.collection('uso_diario').doc(hoy()).get()).data() || {};
  return Object.fromEntries(Object.entries(d.acciones || {}).filter(([k]) => k.startsWith('clientes.lista.')));
};
const verdad = async () => {
  const s = await db.collection('clientes').where('deleted', '==', false).orderBy('nombre').get();
  return s.docs.map(d => ({ id: d.id, nombre: d.data().nombre }));
};
const lista = (s) => s.page.evaluate(async () => {
  const docs = await ClientesService.getAllClientes({ fresh: true });
  await new Promise(r => setTimeout(r, 1500)); // que Uso.accion alcance a escribir
  return { docs: docs.map(d => ({ id: d.id, nombre: d.nombre })), marca: localStorage.getItem('clientes_vivos_sync_v1') };
});
const abrirPagina = async (s) => {
  await s.page.goto(BASE + '/ordenes/nueva-orden.html', { waitUntil: 'domcontentloaded' });
  await s.page.waitForFunction(() => window.ClientesService && firebase.auth().currentUser, { timeout: 30000 });
  await espera(2500);
};
// Misma lista y en el MISMO orden que la query del servidor.
const igual = (r, v) => r.docs.length === v.length && r.docs.every((d, i) => d.id === v[i].id && d.nombre === v[i].nombre);
const esperarSello = async (ids, ms = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const snaps = await Promise.all(ids.map(id => db.collection('clientes').doc(id).get()));
    if (snaps.every(s => s.exists && s.data().sync_at)) return snaps.map(s => s.data().sync_at.toMillis());
    await espera(1000);
  }
  return null;
};

// Restos de una corrida anterior.
for (const d of (await db.collection('clientes').where('nombre', '>=', 'ZZ DELTA').where('nombre', '<', 'ZZ DELTB').get()).docs) await d.ref.delete();

const s = await abrir({ email: USUARIOS.recepcion, carpeta: 'clientes-delta' });
try {
  await abrirPagina(s);
  await s.page.evaluate(() => localStorage.removeItem('clientes_vivos_sync_v1'));

  console.log('1) Primera vez: lista completa del servidor y queda la marca');
  const u0 = await usoClientes();
  const r1 = await lista(s);
  const v1 = await verdad();
  ok(igual(r1, v1), `lista = servidor (${r1.docs.length} / ${v1.length})`);
  ok(!!r1.marca, `marca guardada: ${r1.marca}`);

  console.log('2) Cambios desde el SERVIDOR: editar, soft-borrar, alta');
  const [idEditar, idBorrar] = [v1[10].id, v1[20].id];
  await db.collection('clientes').doc(idEditar).update({ nombre: 'ZZ DELTA EDITADO' });
  await db.collection('clientes').doc(idBorrar).update({ deleted: true });
  const nuevo = await db.collection('clientes').add({ nombre: 'ZZ DELTA ALTA', deleted: false, activo: true });
  const sellos = await esperarSello([idEditar, idBorrar, nuevo.id]);
  ok(!!sellos, `el trigger selló los tres: ${sellos}`);
  await espera(5000);
  const s2 = (await db.collection('clientes').doc(idEditar).get()).data().sync_at.toMillis();
  ok(sellos && s2 === sellos[0], 'el sello no se repite (sin eco)');
  const hist = await db.collection('clientes').doc(idEditar).collection('historial').get();
  ok(hist.docs.every(h => !(h.data().campos || []).includes('sync_at')), `el historial no registra el sello (${hist.size} entradas)`);

  console.log('3) Se reabre: sale por delta y trae los tres cambios');
  await abrirPagina(s);
  const r3 = await lista(s);
  const v3 = await verdad();
  const u3 = await usoClientes();
  ok(igual(r3, v3), `lista = servidor, mismo orden (${r3.docs.length} / ${v3.length})`);
  ok(r3.docs.find(d => d.id === idEditar)?.nombre === 'ZZ DELTA EDITADO', 'la edición llegó');
  ok(!r3.docs.some(d => d.id === idBorrar), 'el borrado salió');
  ok(r3.docs.some(d => d.id === nuevo.id), 'el alta entró');
  ok((u3['clientes.lista.delta-ok'] || 0) > (u0['clientes.lista.delta-ok'] || 0), `usó el delta: ${JSON.stringify(u3)}`);

  console.log('4) Borrado FÍSICO (sin sello): el conteo no cuadra → lista completa, nunca incompleta');
  const idFisico = v3[v3.length - 30].id;
  await db.collection('clientes').doc(idFisico).delete();
  await abrirPagina(s);
  const r4 = await lista(s);
  const v4 = await verdad();
  const u4 = await usoClientes();
  ok(igual(r4, v4), `lista = servidor (${r4.docs.length} / ${v4.length})`);
  ok(!r4.docs.some(d => d.id === idFisico), 'el borrado físico no aparece');
  ok((u4['clientes.lista.conteo-no-cuadra'] || 0) > (u3['clientes.lista.conteo-no-cuadra'] || 0), `cayó a la completa: ${JSON.stringify(u4)}`);

  console.log('5) Y la vez siguiente vuelve al delta');
  await abrirPagina(s);
  const r5 = await lista(s);
  const u5 = await usoClientes();
  ok(igual(r5, await verdad()), `lista = servidor (${r5.docs.length})`);
  ok((u5['clientes.lista.delta-ok'] || 0) > (u4['clientes.lista.delta-ok'] || 0), 'usó el delta otra vez');

  console.log('6) Otro usuario en el mismo navegador: su marca no vale → completa');
  await s.page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('clientes_vivos_sync_v1'));
    localStorage.setItem('clientes_vivos_sync_v1', JSON.stringify({ ...m, uid: 'otro' }));
  });
  const u6a = await usoClientes();
  const r6 = await lista(s);
  const u6 = await usoClientes();
  ok(igual(r6, await verdad()), `lista = servidor (${r6.docs.length})`);
  ok((u6['clientes.lista.delta-ok'] || 0) === (u6a['clientes.lista.delta-ok'] || 0), 'no usó el delta');
  ok(JSON.parse(r6.marca).uid !== 'otro', 'la marca quedó a nombre del usuario actual');
} finally {
  console.log('errores de página:', s.errores.filter(e => !/favicon|DevTools/.test(e)).slice(0, 6));
  await s.browser.close();
}
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
