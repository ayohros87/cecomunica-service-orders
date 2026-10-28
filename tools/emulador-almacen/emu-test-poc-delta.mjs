// Buscador del PoC por DELTA (auditoría de lecturas 2026-10-21): caché local +
// `sync_at > marca` + count() de validación. Contra el emulador CON functions
// (onPocDeviceSello tiene que sellar de verdad):
//   firebase emulators:start --only auth,firestore,hosting,functions
//   (sembrar con los triggers apagados: PUT :4400/functions/disableBackgroundTriggers)
//   node emu-test-poc-delta.mjs
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
const usoPoc = async () => {
  const d = (await db.collection('uso_diario').doc(hoy()).get()).data() || {};
  return Object.fromEntries(Object.entries(d.acciones || {}).filter(([k]) => k.startsWith('poc.')));
};
const verdad = async () => {
  // La definición del app: la query de PocService (sin created_at no entra).
  const s = await db.collection('poc_devices').where('deleted', '!=', true)
    .orderBy('deleted').orderBy('created_at', 'desc').get();
  return new Map(s.docs.map(d => [d.id, d.data()]));
};
const verdadCerradas = async () => {
  const s = await db.collection('poc_devices').where('deleted', '==', true).get();
  return new Map(s.docs.map(d => [d.id, d.data()]));
};
const conjunto = (s) => s.page.evaluate(async () => {
  const [docs, cerr] = await Promise.all([PocList._getAllMemo(), PocList._getCerradasMemo()]);
  await new Promise(r => setTimeout(r, 1500)); // que Uso.accion alcance a escribir
  return { ids: docs.map(d => d.id), nombres: Object.fromEntries(docs.map(d => [d.id, d.cliente_nombre || ''])),
    cerradas: cerr.map(d => d.id),
    marca: localStorage.getItem('poc_vivas_sync_v1'), marcaC: localStorage.getItem('poc_cerradas_sync_v1') };
});
const abrirPoc = async (s) => {
  await s.page.goto(BASE + '/POC/index.html', { waitUntil: 'domcontentloaded' });
  await s.page.waitForFunction(() => window.PocList && window.PocService && firebase.auth().currentUser, { timeout: 30000 });
  await espera(2500);
};
const mismoConjunto = (r, v) => r.ids.length === v.size && r.ids.every(id => v.has(id));
const mismasCerradas = (r, v) => r.cerradas.length === v.size && r.cerradas.every(id => v.has(id));
const esperarSello = async (ids, ms = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const snaps = await Promise.all(ids.map(id => db.collection('poc_devices').doc(id).get()));
    if (snaps.every(s => s.exists && s.data().sync_at)) return snaps.map(s => s.data().sync_at.toMillis());
    await espera(1000);
  }
  return null;
};

const s = await abrir({ email: USUARIOS.recepcion, carpeta: 'poc-delta' });
try {
  console.log('1) Primera vez en este navegador: conjunto completo y queda la marca');
  await abrirPoc(s);
  const u0 = await usoPoc();
  const r1 = await conjunto(s);
  const v1 = await verdad();
  ok(mismoConjunto(r1, v1), `conjunto = servidor (${r1.ids.length} / ${v1.size})`);
  ok(!!r1.marca, `marca guardada: ${r1.marca}`);
  const c1 = await verdadCerradas();
  ok(mismasCerradas(r1, c1), `cerradas = servidor (${r1.cerradas.length} / ${c1.size})`);
  ok(!!r1.marcaC, `marca de cerradas guardada: ${r1.marcaC}`);

  console.log('2) Cambios desde el SERVIDOR (como un trigger o un script): editar, cerrar, alta');
  const vivos = [...v1.keys()];
  const [idEditar, idCerrar] = [vivos[10], vivos[20]];
  await db.collection('poc_devices').doc(idEditar).update({ cliente_nombre: 'ZZ PRUEBA DELTA' });
  await db.collection('poc_devices').doc(idCerrar).update({ deleted: true });
  const nuevo = await db.collection('poc_devices').add({ serial: 'ZZDELTA0001', deleted: false, created_at: admin.firestore.Timestamp.now(), cliente_nombre: 'ZZ ALTA DELTA' });
  const sellos = await esperarSello([idEditar, idCerrar, nuevo.id]);
  ok(!!sellos, `el trigger selló las tres fichas: ${sellos}`);
  await espera(5000);
  const s2 = (await db.collection('poc_devices').doc(idEditar).get()).data().sync_at.toMillis();
  ok(sellos && s2 === sellos[0], 'el sello no se repite (sin eco)');

  console.log('3) Se reabre la página: sale por delta y trae los tres cambios');
  await abrirPoc(s);
  const r3 = await conjunto(s);
  const v3 = await verdad();
  const u3 = await usoPoc();
  ok(mismoConjunto(r3, v3), `conjunto = servidor (${r3.ids.length} / ${v3.size})`);
  ok(r3.nombres[idEditar] === 'ZZ PRUEBA DELTA', 'la edición llegó');
  ok(!r3.ids.includes(idCerrar), 'la ficha cerrada salió');
  ok(r3.ids.includes(nuevo.id), 'el alta entró');
  const c3 = await verdadCerradas();
  ok(mismasCerradas(r3, c3), `cerradas = servidor (${r3.cerradas.length} / ${c3.size})`);
  ok(r3.cerradas.includes(idCerrar), 'la ficha cerrada entró a las cerradas');
  ok((u3['poc.cerradas.delta-ok'] || 0) > (u0['poc.cerradas.delta-ok'] || 0), 'las cerradas también por delta');
  ok((u3['poc.vivas.delta-ok'] || 0) > (u0['poc.vivas.delta-ok'] || 0), `usó el delta: ${JSON.stringify(u3)}`);

  console.log('4) En vivo: un cambio con la página abierta llega sin recargar');
  const idVivo = vivos[30];
  await db.collection('poc_devices').doc(idVivo).update({ cliente_nombre: 'ZZ EN VIVO' });
  let enVivo = false;
  for (let i = 0; i < 30 && !enVivo; i++) { await espera(1000); enVivo = (await conjunto(s)).nombres[idVivo] === 'ZZ EN VIVO'; }
  ok(enVivo, 'el cambio en vivo llegó al conjunto');

  console.log('5) Borrado DURO (sin sello): el conteo no cuadra → conjunto completo, nunca incompleto');
  // Lejos de la primera página: la lista carga las 50 más nuevas del servidor al
  // abrir y eso ya limpiaría la caché de una ficha de arriba.
  const idBorrar = vivos[vivos.length - 100];
  await db.collection('poc_devices').doc(idBorrar).delete();
  await abrirPoc(s);
  const r5 = await conjunto(s);
  const v5 = await verdad();
  const u5 = await usoPoc();
  ok(mismoConjunto(r5, v5), `conjunto = servidor (${r5.ids.length} / ${v5.size})`);
  ok(!r5.ids.includes(idBorrar), 'la ficha borrada no aparece');
  ok(mismasCerradas(r5, await verdadCerradas()), `cerradas = servidor (${r5.cerradas.length})`);
  ok((u5['poc.vivas.conteo-no-cuadra'] || 0) > (u3['poc.vivas.conteo-no-cuadra'] || 0), `cayó a la completa: ${JSON.stringify(u5)}`);

  console.log('6) Y la vez siguiente vuelve al delta');
  await abrirPoc(s);
  const r6 = await conjunto(s);
  const u6 = await usoPoc();
  ok(mismoConjunto(r6, await verdad()), `conjunto = servidor (${r6.ids.length})`);
  ok(mismasCerradas(r6, await verdadCerradas()), `cerradas = servidor (${r6.cerradas.length})`);
  ok((u6['poc.vivas.delta-ok'] || 0) > (u5['poc.vivas.delta-ok'] || 0), 'usó el delta otra vez');
} finally {
  console.log('errores de página:', s.errores.filter(e => !/favicon|DevTools/.test(e)).slice(0, 6));
  await s.browser.close();
}
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
