// Corregir los seriales de una gestión YA asignada, contra el emulador de
// FIRESTORE a secas (el de Functions pierde FieldValue — ver la memoria
// reference_emulador_functions_stub_fieldvalue). El trigger v2 se invoca por
// su `.run(event)` con snapshots reales.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-correccion \
//     "node functions/test-emulator/correccion-gestion.js"
//
// Por qué existe: la corrección mueve TRES cosas a la vez —la gestión, sus
// órdenes y el pool—. Si alguna se queda atrás, el sistema dice dos cosas
// distintas del mismo radio, que es justo lo que pasaba editando el serial
// dentro de la orden (caso R. SMITH ALTA PLAZA, 2026-09-15).
//
// Congela:
//   1) demo YA ENTREGADO: la gestión, su OS de programación y su devolución
//      quedan con el serial nuevo; el entrante hereda el lugar exacto del
//      saliente (estado y asignación) y el saliente vuelve al estante
//      marcado "verificar físicamente" — anduvo fuera;
//   2) aumento SIN entregar: el saliente vuelve al estante SIN esa marca —
//      nunca salió;
//   3) el entrante tiene que estar en bodega: si no, se rechaza con motivo y
//      no se mueve nada;
//   4) el pedido se consume: re-correr el trigger no vuelve a mover radios.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-correccion-gestion";

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onGestion = require("../src/triggers/gestiones/onGestionWrite");
assert.equal(typeof onGestion.run, "function");

const CLIENTE = "cli-rsmith";
const MODELO = "HYTERA PD606-R";
const MOD_ID = "mod-pd606r";

const ficha = (serial, estado, extra = {}) => db.doc(`equipos_pool/${serial}`).set({
  serial, serial_norm: serial, modelo_label: MODELO, modelo_id: MOD_ID, estado, ...extra,
});
const pool = (s) => db.doc(`equipos_pool/${s}`).get().then((d) => d.data());
const orden = (id) => db.doc(`ordenes_de_servicio/${id}`).get().then((d) => d.data());

async function correr(gid) {
  const ref = db.doc(`gestiones/${gid}`);
  const before = await ref.get();
  const after = await ref.get();
  await onGestion.run({ data: { before, after }, params: { gid } });
}

async function pedir(gid, pares) {
  const ref = db.doc(`gestiones/${gid}`);
  const before = await ref.get();
  await ref.set({ correccion_seriales_pendiente: { pares, por_email: "bodega@cecomunica.com", at: new Date().toISOString() } }, { merge: true });
  const after = await ref.get();
  await onGestion.run({ data: { before, after }, params: { gid } });
}

(async () => {
  await db.doc("empresa/config").set({ email_bodega: "b@t.com", email_activaciones: "a@t.com" });

  // ── 1) DEMO ya entregado ─────────────────────────────────────────────
  const GD = "GD20260914-01";
  await ficha("18607A0500", "en_cliente", {
    asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: CLIENTE,
      cliente_nombre: "R. SMITH ALTA PLAZA", gestion_doc_id: GD, tipo: "demo" },
  });
  await ficha("18607A0506", "en_bodega", { asignacion: null });
  await db.doc("ordenes_de_servicio/2026091504").set({
    tipo_de_servicio: "PROGRAMACIÓN", estado_reparacion: "ENTREGADO AL CLIENTE",
    cliente_id: CLIENTE, cliente_nombre: "R. SMITH ALTA PLAZA", gestion: { id: GD, tipo: "demo" },
    equipos: [{ id: "e1", serial: "18607A0500", numero_de_serie: "18607A0500", modelo: MODELO, modelo_id: MOD_ID, eliminado: false }],
  });
  await db.doc("ordenes_de_servicio/2026091513").set({
    tipo_de_servicio: "DEVOLUCION", estado_reparacion: "POR ASIGNAR",
    cliente_id: CLIENTE, gestion: { id: GD, tipo: "demo" }, equipos: [],
    devolucion: { modo: "recuperacion", esperados: [{ id: "x1", serial: "18607A0500", modelo: MODELO, resolucion: null }] },
  });
  await db.doc(`gestiones/${GD}`).set({
    tipo: "demo", estado: "en_demo", cliente_id: CLIENTE, cliente_nombre: "R. SMITH ALTA PLAZA",
    demo: { lineas: [{ modelo: MODELO, modelo_id: MOD_ID, cantidad: 1 }],
      seriales_asignados: [{ serial: "18607A0500", pool_doc_id: "18607A0500", modelo: MODELO, modelo_id: MOD_ID }] },
    ordenes: { programacion_id: "2026091504", programacion_ids: ["2026091504"], devolucion_id: "2026091513" },
    cierre: { asignacion: true, programacion: true, entrega: true }, deleted: false,
  });

  await pedir(GD, [{ anterior: "18607A0500", nuevo: "18607A0506", modelo: MODELO, modelo_id: MOD_ID }]);

  const gd = (await db.doc(`gestiones/${GD}`).get()).data();
  assert.equal(gd.demo.seriales_asignados[0].serial, "18607A0506", "la gestión queda con el serial correcto");
  assert.ok(!gd.correccion_seriales_pendiente, "el pedido se consume");
  assert.equal(gd.correcciones?.[0]?.pares?.[0]?.nuevo, "18607A0506", "queda el histórico de la corrección");

  const os = await orden("2026091504");
  assert.equal(os.equipos[0].serial, "18607A0506", "la OS de programación también");
  assert.equal(os.equipos[0].numero_de_serie, "18607A0506", "y su alias legacy, o el pool rastrea el viejo");
  assert.ok((os.os_logs || []).some((l) => l.action === "CORREGIR_SERIAL" && l.a === "18607A0506"), "con rastro en la orden");

  const dev = await orden("2026091513");
  assert.equal(dev.devolucion.esperados[0].serial, "18607A0506",
    "la devolución espera el radio que de verdad salió");

  const entrante = await pool("18607A0506");
  assert.equal(entrante.estado, "en_cliente", "el entrante hereda el lugar exacto del saliente");
  assert.equal(entrante.asignacion?.gestion_doc_id, GD, "y su asignación");
  const saliente = await pool("18607A0500");
  assert.equal(saliente.estado, "en_bodega", "el saliente vuelve al estante");
  assert.equal(saliente.verificado, false, "marcado por verificar: la gestión ya se había entregado");
  assert.equal(saliente.asignacion, null);

  // ── 4) idempotencia ──────────────────────────────────────────────────
  await correr(GD);
  assert.equal((await pool("18607A0506")).estado, "en_cliente", "re-correr no mueve nada");
  assert.equal((await db.doc(`gestiones/${GD}`).get()).data().correcciones.length, 1, "ni duplica el histórico");

  // ── 2) AUMENTO sin entregar: el saliente NO se marca ─────────────────
  const GA = "GA20260916-01";
  await ficha("B1300455", "asignado_contrato", {
    asignacion: { contrato_doc_id: "c1", contrato_id: "ALQ-1", cliente_id: CLIENTE, gestion_doc_id: GA },
  });
  await ficha("B1300461", "en_bodega", { asignacion: null });
  await db.doc("ordenes_de_servicio/2026091600").set({
    tipo_de_servicio: "PROGRAMACIÓN", estado_reparacion: "POR ASIGNAR", cliente_id: CLIENTE,
    gestion: { id: GA, tipo: "aumento" },
    equipos: [{ id: "e1", serial: "B1300455", numero_de_serie: "B1300455", modelo: MODELO, modelo_id: MOD_ID, eliminado: false }],
  });
  await db.doc(`gestiones/${GA}`).set({
    tipo: "aumento", estado: "pendiente_bodega", cliente_id: CLIENTE, cliente_nombre: "R. SMITH ALTA PLAZA",
    aumento: { contrato_doc_id: "c1", contrato_id: "ALQ-1", lineas: [{ modelo: MODELO, modelo_id: MOD_ID, cantidad: 1, precio: 20 }],
      seriales_asignados: [{ serial: "B1300455", pool_doc_id: "B1300455", modelo: MODELO, modelo_id: MOD_ID }] },
    ordenes: { programacion_id: "2026091600", programacion_ids: ["2026091600"] },
    cierre: { aprobacion: true, firma: true, derivacion: true, asignacion: true }, deleted: false,
  });

  await pedir(GA, [{ anterior: "B1300455", nuevo: "B1300461", modelo: MODELO, modelo_id: MOD_ID }]);

  const ga = (await db.doc(`gestiones/${GA}`).get()).data();
  assert.equal(ga.aumento.seriales_asignados[0].serial, "B1300461");
  assert.equal((await orden("2026091600")).equipos[0].serial, "B1300461");
  const sal2 = await pool("B1300455");
  assert.equal(sal2.estado, "en_bodega", "vuelve al estante");
  assert.notEqual(sal2.verificado, false, "SIN marca de verificar: nunca salió de la empresa");
  assert.equal((await pool("B1300461")).estado, "asignado_contrato", "el entrante hereda el estado del saliente");

  // ── 3) el entrante tiene que estar en bodega ─────────────────────────
  await ficha("OCUPADO01", "en_cliente", { asignacion: { cliente_id: "otro" } });
  await pedir(GA, [{ anterior: "B1300461", nuevo: "OCUPADO01", modelo: MODELO, modelo_id: MOD_ID }]);
  const ga2 = (await db.doc(`gestiones/${GA}`).get()).data();
  assert.equal(ga2.aumento.seriales_asignados[0].serial, "B1300461", "la gestión no se tocó");
  assert.equal((await pool("OCUPADO01")).asignacion?.cliente_id, "otro", "ni el radio de otro cliente");
  const evs = await db.collection(`gestiones/${GA}/eventos`).get();
  assert.ok(evs.docs.some((d) => d.data().accion === "correccion_incompleta"),
    "y el expediente dice por qué no se pudo");

  console.log("OK correccion-gestion: gestión, órdenes (programación y devolución) y pool");
  console.log("   corregidos a la vez; marca solo si el radio salió; idempotente; con política dura.");
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
