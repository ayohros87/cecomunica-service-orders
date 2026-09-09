// Anexo de REGULARIZACIÓN aplicado (onGestionWrite B3) contra el emulador de
// FIRESTORE a secas — mismo patrón que asignar-triggers.js (el emulador de
// Functions pierde admin.firestore.FieldValue, así que el trigger v2 se invoca
// con `.run(event)` y snapshots reales).
//
// Congela lo que el anexo tiene que dejar hecho cuando se aplica —da igual si
// lo firmó el cliente o si el vendedor lo cerró sin firma (2026-09-09):
//   1) los seriales que YA estaban en el pool quedan amarrados al contrato, y
//      la propiedad la manda la LÍNEA (una marca falsa "del cliente" se
//      corrige, con movimiento en el kardex);
//   2) un serial que el sistema NO conocía NACE con el anexo, en cliente y con
//      la propiedad de la línea;
//   3) los que el cliente declaró que NO tiene salen de la cuenta (por
//      clasificar, sin asignación);
//   4) la línea entra al contrato y la gestión cierra sola.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-regularizacion \
//     "node functions/test-emulator/regularizacion-anexo.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-regularizacion";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const trigger = require("../src/triggers/gestiones/onGestionWrite");
assert.equal(typeof trigger.run, "function", "el trigger v2 debe exponer .run(event)");

const GID = "GA20260909-01";
const CID = "cReg";
const CLIENTE = "cli-fm";
const VIEJO = "19O16C0873";     // ficha con la marca falsa "del cliente"
const NUEVO = "20222A0128";     // el cliente lo tiene y el sistema no lo sabe
const FUERA = "20313C1252";     // el cliente dice que NO lo tiene
let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const gestion = (estado, cierre) => ({
  tipo: "aumento", estado, cliente_id: CLIENTE, cliente_nombre: "FORTUNATO MANGRAVITA",
  deleted: false, cierre, contratos_afectados: [CID], ordenes: {},
  aumento: {
    contrato_doc_id: CID, contrato_id: "ALQ20251006-02", duracion_meses: 18,
    es_regularizacion: true,
    lineas: [{ modelo_id: "m1", modelo: "HYTERA PD606-R", cantidad: 2, precio: 25, modalidad: "alquiler" }],
    cargos: [], seriales_asignados: [],
    regulariza_seriales: [
      { pool_doc_id: VIEJO, serial: VIEJO, modelo_id: "m1", modelo: "HYTERA PD606-R", modalidad: "alquiler" },
      { pool_doc_id: null, serial: NUEVO, modelo_id: "m1", modelo: "HYTERA PD606-R", modalidad: "alquiler" },
    ],
    regulariza_no_tiene: [{ serial: FUERA, pool_doc_id: FUERA, modelo_id: "m1", modelo: "HYTERA PD606-R" }],
  },
});

(async () => {
  await db.doc(`contratos/${CID}`).set({ contrato_id: "ALQ20251006-02", cliente_id: CLIENTE,
    cliente_nombre: "FORTUNATO MANGRAVITA", estado: "activo", tipo_contrato: "Alquiler", codigo_tipo: "ALQ",
    equipos: [{ modelo_id: "m1", modelo: "PD606-R", cantidad: 3, precio: 25 }] });
  const enCliente = (serial, propiedad) => ({
    serial, serial_norm: serial, modelo_id: "m1", modelo_label: "HYTERA PD606-R",
    estado: "en_cliente", condicion: "reuso", propiedad, verificado: false, origen: "migracion_orden",
    asignacion: { cliente_id: CLIENTE, cliente_nombre: "FORTUNATO MANGRAVITA" },
  });
  await db.doc(`equipos_pool/${VIEJO}`).set(enCliente(VIEJO, "cliente"));
  await db.doc(`equipos_pool/${FUERA}`).set(enCliente(FUERA, "cliente"));

  // Gerencia aprueba: pendiente_aprobacion → pendiente_bodega + cierre.firma,
  // sin pasar por firma del cliente (2026-09-09). Es el mismo flanco que B3
  // esperaba de la firma, así que el efecto es idéntico.
  const ref = db.doc(`gestiones/${GID}`);
  await ref.set(gestion("pendiente_aprobacion", {}));
  const before = await ref.get();
  await ref.set(gestion("pendiente_bodega", { aprobacion: true, firma: true }));
  const after = await ref.get();
  await trigger.run({ data: { before, after }, params: { gid: GID } });

  const viejo = (await db.doc(`equipos_pool/${VIEJO}`).get()).data();
  assert.equal(viejo.asignacion?.contrato_doc_id, CID, "el serial queda amarrado al contrato");
  assert.equal(viejo.propiedad, "cecomunica", "la línea de alquiler corrige la marca falsa");
  const movV = await db.collection(`equipos_pool/${VIEJO}/movimientos`).get();
  assert.ok(movV.docs.some(d => /Propiedad corregida por la línea del anexo/.test(d.data().notas || "")),
    "la corrección queda en el kardex");
  ok("serial conocido: amarrado al contrato y propiedad corregida por la línea");

  const nuevo = (await db.doc(`equipos_pool/${NUEVO}`).get()).data();
  assert.ok(nuevo, "la ficha del serial desconocido nace con el anexo");
  assert.equal(nuevo.estado, "en_cliente");
  assert.equal(nuevo.propiedad, "cecomunica");
  assert.equal(nuevo.asignacion?.contrato_doc_id, CID);
  assert.equal(nuevo.asignacion?.cliente_id, CLIENTE);
  ok("serial que el sistema no conocía: nace en cliente, con contrato y propiedad de la línea");

  const fuera = (await db.doc(`equipos_pool/${FUERA}`).get()).data();
  assert.equal(fuera.estado, "por_clasificar", "el que el cliente no tiene sale de la cuenta");
  assert.equal(fuera.asignacion, null);
  const movF = await db.collection(`equipos_pool/${FUERA}/movimientos`).get();
  assert.ok(movF.docs.some(d => d.data().tipo === "liberacion"), "kardex liberacion");
  ok("serial que el cliente NO tiene: soltado de la cuenta, por clasificar");

  const c = (await db.doc(`contratos/${CID}`).get()).data();
  assert.ok((c.equipos || []).some(l => l.enmienda_id === GID && l.cantidad === 2 && l.modalidad === "alquiler"),
    "la línea del anexo entra al contrato con su modalidad");
  assert.ok((c.enmiendas_aumento || []).includes(GID));
  const g = (await ref.get()).data();
  assert.equal(g.estado, "cerrada", "sin bodega ni entrega, la gestión cierra sola");
  ok("el contrato gana la línea y la gestión cierra");

  // 5) REEMPLAZO de un radio que el sistema no conocía (2026-09-09): el
  //    vendedor lo declara en el wizard y la ficha nace con la solicitud, en
  //    campo y sin contrato — de ahí en adelante es un reemplazo normal.
  const DANADO = "20919D0999";
  const GR = "GR20260909-01";
  const rRef = db.doc(`gestiones/${GR}`);
  const reemplazo = {
    tipo: "reemplazo", estado: "pendiente_bodega", cliente_id: CLIENTE,
    cliente_nombre: "FORTUNATO MANGRAVITA", deleted: false, cierre: {}, ordenes: {},
    items: [{
      serial_saliente: DANADO, pool_doc_id_saliente: null, saliente_sin_ficha: true,
      modelo_id: "m1", modelo: "HYTERA PD606-R", contrato_doc_id: null, contrato_id: null,
      elegibilidad: "alquiler", motivo_codigo: "dano_no_reparable", motivo_detalle: "no enciende",
      modelo_solicitado: "HYTERA PD606-R", modelo_solicitado_id: "m1",
      serial_nuevo: null, pool_doc_id_nuevo: null,
    }],
  };
  await rRef.set(reemplazo);
  const rAfter = await rRef.get();
  await trigger.run({ data: { before: { exists: false }, after: rAfter }, params: { gid: GR } });

  const danado = (await db.doc(`equipos_pool/${DANADO}`).get()).data();
  assert.ok(danado, "la ficha del radio declarado nace con la solicitud");
  assert.equal(danado.estado, "en_cliente");
  assert.equal(danado.origen, "declarado_vendedor");
  assert.equal(danado.verificado, false, "nadie lo verificó: queda por confirmar");
  assert.equal(danado.asignacion?.cliente_id, CLIENTE);
  assert.equal(danado.asignacion?.contrato_doc_id, null, "sin contrato: la cuenta sigue pidiendo regularización");
  const g2 = (await rRef.get()).data();
  assert.equal(g2.items[0].pool_doc_id_saliente, DANADO, "la solicitud queda apuntando a la ficha nueva");
  const ev = await db.collection(`gestiones/${GR}/eventos`).get();
  assert.ok(ev.docs.some(d => (d.data().accion || "") === "declaracion"), "queda dicho en el expediente");
  ok("reemplazo de un radio que el sistema no conocía: la ficha nace y la solicitud la apunta");

  console.log(`\nOK — ${n} comprobaciones del anexo de regularización`);
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
