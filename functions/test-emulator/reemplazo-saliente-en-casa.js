// El saliente "en casa" que ninguna orden tiene (2026-09-30).
//
// Caso real SERV20260918-01 (INNOVACION & LOGISTICA ALIMENTARIA): 22806A0291 y
// 22806A0294 fallaron DURANTE la programación del propio contrato, se quitaron
// de la orden 2026091807 y el taller propuso su reemplazo con el radio en el
// mostrador (saliente_en_casa). Pasó esto:
//   · la entrega del contrato marcó en_cliente a TODOS los seriales del
//     contrato, también a los dos que ya no estaban en la orden;
//   · el reemplazo, al ver "en casa", dejó la disposición a la orden de taller…
//     que ya no los tenía.
// El Anexo A listó 9 radios (los 2 salientes + sus 2 entrantes) hasta que
// bodega los corrigió a mano.
//
// Congela, contra Firestore real:
//   1) la entrega del contrato NO marca en_cliente a un sustituido;
//   2) el reemplazo con saliente en casa y pegado al contrato lo suelta a
//      devuelto_revision sin asignación (nunca a bodega);
//   3) el caso normal (saliente en_taller por su orden) no se toca;
//   4) un saliente asignado a OTRO contrato no se toca.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-saliente-casa \
//     "node functions/test-emulator/reemplazo-saliente-en-casa.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-saliente-casa";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onEntregaPool = require("../src/triggers/contratos/onEntregaPool");
const onOrdenWriteGestion = require("../src/triggers/gestiones/onOrdenWriteGestion");

const CID = "cto-innovacion";
const CONTRATO = "SERV20260918-01";
const GID = "GR20260918-01";
const OS = "2026091809";
const QUEDA = "22806A0254";
const SALIENTE = "22806A0291";
const ENTRANTE = "24220A2196";
const MOD = { id: "x7hlVuYhyf22JhzR4hqz", label: "HYTERA PNC360S-R" };
let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const asig = (cid = CID, contrato = CONTRATO) => ({
  contrato_doc_id: cid, contrato_id: contrato, cliente_id: "cli-1",
  cliente_nombre: "INNOVACION & LOGISTICA ALIMENTARIA, S.A.",
});
const ficha = (serial, estado, asignacion = asig()) => db.doc(`equipos_pool/${serial}`).set({
  serial, serial_norm: serial, modelo_id: MOD.id, modelo_label: MOD.label,
  estado, asignacion, propiedad: "cecomunica", verificado: true,
});
const leer = async (serial) => (await db.doc(`equipos_pool/${serial}`).get()).data();
const gestion = (item = {}) => ({
  tipo: "reemplazo", estado: "en_proceso", cliente_id: "cli-1",
  contratos_afectados: [CID], cierre: { aprobacion: true },
  items: [{
    serial_saliente: SALIENTE, pool_doc_id_saliente: SALIENTE, saliente_en_casa: true,
    serial_nuevo: ENTRANTE, pool_doc_id_nuevo: ENTRANTE,
    modelo: MOD.label, modelo_id: MOD.id, contrato_id: CONTRATO, contrato_doc_id: CID,
    motivo_codigo: "dano_no_reparable", elegibilidad: "alquiler", ...item,
  }],
});

async function limpiar() {
  for (const c of ["equipos_pool", "gestiones", "contratos", "ordenes_de_servicio", "mail_queue"]) {
    const s = await db.collection(c).get();
    for (const d of s.docs) {
      for (const sub of await d.ref.listCollections()) {
        const ss = await sub.get(); await Promise.all(ss.docs.map(x => x.ref.delete()));
      }
      await d.ref.delete();
    }
  }
}

// Evento v2 con snapshots reales.
async function eventoDoc(ruta, antes, despues, params) {
  const ref = db.doc(ruta);
  await ref.set(antes);
  const before = await ref.get();
  await ref.set(despues);
  const after = await ref.get();
  return { data: { before, after }, params };
}

async function entregaDelContrato() {
  await limpiar();
  await ficha(QUEDA, "asignado_contrato");
  await ficha(SALIENTE, "asignado_contrato");
  for (const s of [QUEDA, SALIENTE]) {
    await db.doc(`contratos/${CID}/seriales/${s}`).set({ serial: s, modelo_id: MOD.id, modelo: MOD.label, contrato_id: CONTRATO });
  }
  await db.doc(`gestiones/${GID}`).set(gestion());
  const base = { contrato_id: CONTRATO, estado: "aprobado", entrega_confirmada: false };
  await onEntregaPool.run(await eventoDoc(`contratos/${CID}`, base, { ...base, entrega_confirmada: true }, { cid: CID }));
  assert.equal((await leer(QUEDA)).estado, "en_cliente", "el que sí salió queda entregado");
  const s = await leer(SALIENTE);
  assert.equal(s.estado, "asignado_contrato", `el sustituido no se entrega, quedó ${s.estado}`);
  ok("la entrega del contrato no marca en_cliente al radio que el reemplazo sacó de la orden");
}

async function entregaDelEntrante({ estadoSaliente, asignacionSaliente = asig() }) {
  await limpiar();
  await ficha(SALIENTE, estadoSaliente, asignacionSaliente);
  await ficha(ENTRANTE, "en_taller");
  await db.doc(`gestiones/${GID}`).set(gestion());
  const os = { tipo_de_servicio: "PROGRAMACIÓN", gestion: { id: GID, tipo: "reemplazo" }, estado_reparacion: "LISTO PARA ENTREGA" };
  await onOrdenWriteGestion.run(await eventoDoc(`ordenes_de_servicio/${OS}`, os,
    { ...os, estado_reparacion: "ENTREGADO AL CLIENTE" }, { ordenId: OS }));
  const g = (await db.doc(`gestiones/${GID}`).get()).data();
  assert.equal(g.cierre?.entrada, true, "en casa: el paso de entrada queda cumplido");
  assert.equal((await leer(ENTRANTE)).reemplaza_a, SALIENTE, "el linaje del entrante se estampa igual");
  return leer(SALIENTE);
}

(async () => {
  await entregaDelContrato();

  // El orden real de SERV20260918-01: la entrega del contrato llegó antes y
  // marcó el saliente en_cliente (código viejo); luego se entrega el entrante.
  let s = await entregaDelEntrante({ estadoSaliente: "en_cliente" });
  assert.equal(s.estado, "devuelto_revision", `debe quedar por revisar, quedó ${s.estado}`);
  assert.equal(s.asignacion, null, "y fuera del contrato");
  assert.notEqual(s.pendiente_devolucion, true, "sin deuda de devolución: ya está aquí");
  ok("saliente en casa marcado en_cliente → devuelto_revision sin asignación");

  s = await entregaDelEntrante({ estadoSaliente: "asignado_contrato" });
  assert.equal(s.estado, "devuelto_revision");
  assert.equal(s.asignacion, null);
  ok("saliente en casa aún asignado al contrato → devuelto_revision sin asignación");

  s = await entregaDelEntrante({ estadoSaliente: "en_taller" });
  assert.equal(s.estado, "en_taller", "lo tiene su orden de taller: ella decide");
  assert.equal(s.asignacion?.contrato_doc_id, CID);
  ok("caso normal: el saliente en su orden de taller no se toca");

  s = await entregaDelEntrante({ estadoSaliente: "en_cliente", asignacionSaliente: asig("otro", "SERV20260101-01") });
  assert.equal(s.estado, "en_cliente", "de otro contrato: no es nuestro");
  assert.equal(s.asignacion?.contrato_doc_id, "otro");
  ok("saliente asignado a otro contrato no se toca");

  console.log(`\n${n} PASS — reemplazo con saliente en casa`);
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
