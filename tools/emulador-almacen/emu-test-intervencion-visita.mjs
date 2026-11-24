// Intervención en órdenes grandes (2026-11-24, visita 2026111905 de DECAMERON:
// 146 radios, "Revisión general" tecleado 95 veces y 7 cambios de radio como
// texto libre). Contra el emulador, en teléfono y como técnico.
//   node tools/emulador-almacen/emu-test-intervencion-visita.mjs
// Qué protege:
//   · los textos ya usados en la orden salen de un toque, agrupando variantes,
//     y los de un solo radio no estorban;
//   · "Guardar y siguiente" salta al siguiente equipo PENDIENTE y se esconde
//     cuando no queda a dónde ir;
//   · en una visita, "Lo cambié por otro radio" registra el cambio desde el
//     radio, con los radios de bodega de un toque, y deja escrita la
//     intervención.
// El callable NO se llama (iría a producción): se sustituye por uno falso que
// escribe en el emulador lo que el de verdad deja en la orden. Su lógica se
// prueba en functions/test-emulator/cambio-en-sitio-devolucion.js.
import { createRequire } from 'node:module';
import { abrir, USUARIOS } from './emu-lib.mjs';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const require = createRequire('file:///C:/Projects/cecomunica-service-orders/functions/');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK     ' : 'FALLA  ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const V = '2099020201';
const REF = db.collection('ordenes_de_servicio').doc(V);
const hecho = (texto, seg) => ({ trabajo_tecnico: texto, trabajo_tecnico_updated_at: TS.fromMillis(Date.now() - seg * 1000), trabajo_tecnico_nombre: USUARIOS.tecnico });
const eq = (n, extra = {}) => ({ id: `e${n}`, serial: `ZZIV9A000${n}`, numero_de_serie: `ZZIV9A000${n}`, modelo: 'NX-420-R', observaciones: 'sin observaciones', eliminado: false, ...extra });
const linea = (s) => ({ serial: s, modelo: 'KENWOOD NX-420-R', estado: 'llevado', at: TS.now(), por_email: USUARIOS.inventario });

const te = await abrir({ email: USUARIOS.tecnico, viewport: 'telefono', carpeta: 'intervencion-visita' });
const p = te.page;
await te.ir('/ordenes/index.html', { esperar: 3000 });
const yo = await p.evaluate(() => ({ uid: firebase.auth().currentUser?.uid, rol: APP.state.userRole }));
console.log('   técnico:', JSON.stringify(yo));

await REF.set({
  ordenId: V, numero_orden: V, tipo_de_servicio: 'VISITA TECNICA', estado_reparacion: 'ASIGNADO', eliminado: false,
  cliente_id: 'zziv-cli', cliente_nombre: 'ZZIV HOTEL DE PRUEBA', tecnico_asignado: 'Marcos Perez', tecnico_uid: yo.uid,
  fecha_creacion: TS.now(), fecha_asignacion: TS.now(),
  equipos: [
    eq(1, hecho('Revisión general', 300)), eq(2, hecho('revisión general.', 200)), eq(3),
    eq(4, hecho('Cambio de flex PS J87-0040-05', 100)), eq(5), eq(6),
  ],
  radios_salida: { ZZIV1A0001: linea('ZZIV1A0001'), ZZIV1A0002: linea('ZZIV1A0002') },
});

await te.ir(`/ordenes/index.html?ids=${V}`, { esperar: 4000 });
const cargada = await p.evaluate((id) => !!APP.state.orders.find(o => o.ordenId === id), V);
ok(cargada, 'el técnico ve la visita');

const estado = () => p.evaluate(() => ({
  abierto: !document.getElementById('modalTrabajoEquipo').classList.contains('hidden'),
  titulo: document.getElementById('trabajoEquipoTitle').textContent,
  pos: document.getElementById('trabajoNavPos').textContent,
  texto: document.getElementById('trabajoEquipoText').value,
  chips: [...document.querySelectorAll('#trabajoTextosUsados .trabajo-texto-chip')].map(b => b.innerText.replace(/\s+/g, ' ').trim()),
  sig: getComputedStyle(document.getElementById('btnGuardarTrabajoSiguiente')).display !== 'none',
  cambio: document.getElementById('trabajoCambioSitio').innerText.replace(/\s+/g, ' ').trim(),
  cambioVisible: getComputedStyle(document.getElementById('trabajoCambioSitio')).display !== 'none',
}));
const equipos = async () => (await REF.get()).data().equipos;

// 1) Radio pendiente: el texto repetido de un toque; el de un solo radio no sale.
await p.evaluate((id) => abrirTrabajoEquipoModal(id, 2), V);
await espera(800);
let s = await estado();
ok(s.abierto && /ZZIV9A0003/.test(s.titulo), 'abre la intervención del tercer radio');
ok(s.chips.length === 1 && /^Revisión general ×2$/.test(s.chips[0]), `un solo botón, con las variantes juntas: ${JSON.stringify(s.chips)}`);
ok(/Equipo 3 de 6 · faltan 3/.test(s.pos), `dice cuántos faltan: ${s.pos}`);
ok(s.cambioVisible && /Lo cambié por otro radio/.test(s.cambio) && /Tienes 2 radios de bodega/.test(s.cambio), `visita: ofrece el cambio en sitio — ${s.cambio}`);
await te.captura('01-textos-de-un-toque');
await p.click('#trabajoTextosUsados .trabajo-texto-chip');
s = await estado();
ok(s.texto === 'Revisión general', `el toque escribe el texto: "${s.texto}"`);

// 2) Guardar y siguiente salta el radio 4 (ya tiene intervención) y cae en el 5.
await p.click('#btnGuardarTrabajoSiguiente');
await espera(2500);
s = await estado();
ok((await equipos())[2].trabajo_tecnico === 'Revisión general', 'el tercer radio quedó guardado');
ok(s.abierto && /ZZIV9A0005/.test(s.titulo) && /Equipo 5 de 6 · faltan 2/.test(s.pos), `salta al siguiente pendiente: ${s.titulo} · ${s.pos}`);
ok(s.chips.length === 1 && /×3$/.test(s.chips[0]) && s.texto === '', `el botón sigue ahí y el texto empieza vacío: ${JSON.stringify(s.chips)}`);

// 3) Cambio en sitio desde el radio. El callable se sustituye por uno falso.
const llamadas = [];
await p.exposeFunction('__callableFalso', async (nombre, data) => {
  llamadas.push({ nombre, data });
  const k = String(data.serialSaliente).toUpperCase();
  await REF.set({
    reemplazos_regularizados: { [k]: { gestion_id: 'GR20990202-01', saliente: data.serialSaliente, entrante: data.serialEntrante, devolucion_id: '2099020299' } },
    radios_salida: { [data.serialEntrante]: { estado: 'dejado' } },
  }, { merge: true });
  return { ok: true, gestion_id: 'GR20990202-01', devolucion_id: '2099020299', contrato: null };
});
await p.evaluate(async () => {
  await CargaDiferida.regularizarReemplazo();
  const real = firebase.functions.bind(firebase);
  firebase.functions = (...a) => {
    const f = real(...a);
    return { httpsCallable: (nombre) => (nombre === 'regularizarReemplazoOrden'
      ? async (data) => ({ data: await window.__callableFalso(nombre, data) }) : f.httpsCallable(nombre)) };
  };
});
await p.click('#btnCambioEnSitio');
await p.waitForSelector('#rrEnt', { timeout: 15000 });
let hoja = await p.evaluate(() => ({
  sal: document.getElementById('rrSal').value, fijo: document.getElementById('rrSal').disabled,
  opciones: document.getElementById('rrSal').options.length,
  chips: [...document.querySelectorAll('[data-rr-llevado]')].map(b => b.textContent.trim()),
}));
ok(hoja.sal === 'ZZIV9A0005' && hoja.fijo && hoja.opciones === 1, `la hoja abre con ESTE radio como el recibido del cliente: ${JSON.stringify(hoja)}`);
ok(hoja.chips.join(',') === 'ZZIV1A0001,ZZIV1A0002', `los radios de bodega salen de un toque: ${hoja.chips.join(' · ')}`);
await p.click('[data-rr-llevado="ZZIV1A0002"]');
ok((await p.evaluate(() => document.getElementById('rrEnt').value)) === 'ZZIV1A0002', 'el toque escribe el serial del que se dejó');
await p.type('#rrMotivo', 'No transmitía');
await te.captura('02-cambio-en-sitio');
await p.click('[data-sheet-action="registrar"]');
await espera(4000);
ok(llamadas.length === 1 && llamadas[0].data.ordenId === V && llamadas[0].data.serialSaliente === 'ZZIV9A0005'
  && llamadas[0].data.serialEntrante === 'ZZIV1A0002' && llamadas[0].data.salienteEnCasa === true && llamadas[0].data.motivo === 'No transmitía',
  `se registra el cambio de ese radio: ${JSON.stringify(llamadas.map(l => l.data))}`);
const e5 = (await equipos())[4];
ok(e5.trabajo_tecnico === 'Radio reemplazado en sitio por la serie ZZIV1A0002. No transmitía', `la intervención queda escrita sola: "${e5.trabajo_tecnico}"`);
s = await estado();
ok(s.abierto && /ZZIV9A0006/.test(s.titulo) && /faltan 1|falta 1/.test(s.pos), `y pasa al siguiente pendiente: ${s.titulo} · ${s.pos}`);
ok(/Tienes 1 radio de bodega/.test(s.cambio), `el radio que se dejó ya no se ofrece: ${s.cambio}`);
ok(!s.sig, 'en el último pendiente no hay "Guardar y siguiente"');
ok(s.chips.length === 1 && /^Revisión general ×3$/.test(s.chips[0]), `el texto del cambio no se vuelve botón: ${JSON.stringify(s.chips)}`);

// 4) El radio cambiado dice por cuál se cambió y ya no ofrece cambiarlo.
await p.evaluate((id) => abrirTrabajoEquipoModal(id, 4), V);
await espera(800);
s = await estado();
ok(/Cambiado en sitio por ZZIV1A0002/.test(s.cambio) && /GR20990202-01/.test(s.cambio) && !/Lo cambié/.test(s.cambio), `el radio cambiado lo dice: ${s.cambio}`);
await te.captura('03-radio-cambiado');

// 5) Fuera de una visita no se ofrece el cambio en sitio.
await REF.set({ tipo_de_servicio: 'REPARACION' }, { merge: true });
await espera(1500);
await p.evaluate((id) => abrirTrabajoEquipoModal(id, 5), V);
await espera(800);
s = await estado();
ok(!s.cambioVisible, 'en una reparación no aparece "Lo cambié por otro radio"');

const errores = te.errores.filter(e => !/favicon|clipboard|Clipboard/.test(e));
ok(!errores.length, 'sin errores de página: ' + JSON.stringify(errores.slice(0, 4)));
await te.cerrar?.();
await REF.delete();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
