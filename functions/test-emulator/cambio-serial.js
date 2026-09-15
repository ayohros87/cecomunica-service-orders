// Cambio de serial (gestión GC) de punta a punta contra el emulador de
// FIRESTORE a secas — sin el emulador de Functions, cuyo runtime sustituye
// admin.firestore por un stub que pierde FieldValue (ver memoria
// reference_emulador_functions_stub_fieldvalue). Los triggers v2 se invocan
// por su `.run(event)` con snapshots REALES del emulador.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-cambio-serial \
//     "node functions/test-emulator/cambio-serial.js"
//
// Por qué existe: aplicar la corrección REESCRIBE una fila de seriales del
// contrato y con eso mueve dos unidades del pool. Leer el código no basta —
// aquí se ve el intercambio ocurriendo.
//
// Congela:
//   1) bodega confirma el serial real → el contrato queda listando el nuevo,
//      el viejo vuelve a bodega marcado "verificar físicamente" y el nuevo
//      queda con el cliente (en_cliente, porque el contrato ya tuvo entrega);
//   2) la gestión cierra sola (cierre.asignacion + cierre.derivacion) y sale
//      el correo de corrección a activaciones con el par anterior→nuevo;
//   3) queda rastro en seriales_historial del contrato;
//   4) volver a correr el trigger NO aplica la corrección dos veces;
//   5) un ítem que apunta al contrato de OTRO cliente no se aplica;
//   6) un radio que salió en un DEMO tampoco (ahí se anula el demo).
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-cambio-serial";

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onGestion = require("../src/triggers/gestiones/onGestionWrite");
const onSerial = require("../src/triggers/contratos/onSerialWrite");
assert.equal(typeof onGestion.run, "function", "onGestionWrite debe exponer .run(event)");
assert.equal(typeof onSerial.run, "function", "onSerialWrite debe exponer .run(event)");

const CID = "contrato-cdp";
const CID_AJENO = "contrato-de-otro";
const CLIENTE = "cli-cdp";
const GID = "GC20260915-01";
const VIEJO = "26314A1691";          // el que figura en el sistema (mal)
const NUEVO = "26314A1687";          // el que el cliente tiene de verdad
const MODELO = "HYT-P50";

async function seed() {
  await db.doc("empresa/config").set({
    email_bodega: "bodega-test@cecomunica.com",
    email_activaciones: "activaciones-test@cecomunica.com",
  });
  await db.doc(`clientes/${CLIENTE}`).set({ nombre: "CDP HOLDINGS INC" });
  await db.doc(`contratos/${CID}`).set({
    contrato_id: "PROP20260731-03", cliente_id: CLIENTE, cliente_nombre: "CDP HOLDINGS INC",
    estado: "activo", entrega_confirmada: true,          // ya se entregó: el nuevo va a en_cliente
    equipos: [{ modelo: MODELO, cantidad: 1, modalidad: "alquiler" }],
  });
  await db.doc(`contratos/${CID_AJENO}`).set({
    contrato_id: "ALQ20260101-01", cliente_id: "otro-cliente", cliente_nombre: "OTRA EMPRESA S.A.",
    estado: "activo",
  });
  // La fila de seriales del contrato: lo que el sistema cree hoy.
  await db.doc(`contratos/${CID}/seriales/fila1`).set({
    serial: VIEJO, modelo: MODELO, contrato_doc_id: CID, contrato_id: "PROP20260731-03",
    cliente_id: CLIENTE, cliente_nombre: "CDP HOLDINGS INC", source: "manual",
  });
  // Pool: el viejo figura con el cliente; el correcto sigue "en bodega"
  // (nunca se fue, porque nadie supo que era el que salió).
  await db.doc(`equipos_pool/${VIEJO}`).set({
    serial: VIEJO, serial_norm: VIEJO, modelo_label: MODELO, estado: "en_cliente",
    asignacion: { contrato_doc_id: CID, contrato_id: "PROP20260731-03", cliente_id: CLIENTE, cliente_nombre: "CDP HOLDINGS INC" },
  });
  await db.doc(`equipos_pool/${NUEVO}`).set({
    serial: NUEVO, serial_norm: NUEVO, modelo_label: MODELO, estado: "en_bodega", asignacion: null,
  });
}

// Escribe la gestión y corre el trigger con los snapshots reales. Después
// propaga a mano el efecto de la fila de seriales (onSerialWrite), que en
// producción lo dispara el runtime.
async function escribirGestion(patch, { primera = false } = {}) {
  const ref = db.doc(`gestiones/${GID}`);
  const before = await ref.get();
  const filasAntes = await snapshotFilas();
  await ref.set(patch, { merge: true });
  const after = await ref.get();
  await onGestion.run({ data: { before: primera ? null : before, after }, params: { gid: GID } });
  await propagarFilas(filasAntes);
}

async function snapshotFilas() {
  const snap = await db.collection(`contratos/${CID}/seriales`).get();
  return new Map(snap.docs.map((d) => [d.id, d]));
}

// onSerialWrite por cada fila que cambió: es quien mueve el pool.
async function propagarFilas(antes) {
  const ahora = await db.collection(`contratos/${CID}/seriales`).get();
  for (const d of ahora.docs) {
    const b = antes.get(d.id);
    if (b && b.data()?.serial === d.data()?.serial) continue;
    await onSerial.run({ data: { before: b || { exists: false }, after: d }, params: { cid: CID, sid: d.id } });
  }
}

const pool = (s) => db.doc(`equipos_pool/${s}`).get().then((d) => d.data());

(async () => {
  await seed();

  // ── 1) La gestión nace pidiendo corregir, sin serial real todavía ──────
  await escribirGestion({
    tipo: "cambio_serial", estado: "pendiente_bodega",
    cliente_id: CLIENTE, cliente_nombre: "CDP HOLDINGS INC",
    responsable_email: "cecrecep@cecomunica.com",
    items: [{
      serial: VIEJO, serial_norm: VIEJO, modelo: MODELO, contrato_doc_id: CID,
      contrato_id: "PROP20260731-03", motivo_codigo: "error_captura",
      motivo_detalle: "No es el serial de la factura 10317", serial_nuevo: null,
    }],
    cierre: {}, ordenes: {}, deleted: false,
  }, { primera: true });

  let mails = await db.collection("mail_queue").get();
  assert.equal(mails.size, 1, "al crearse sale UN correo, el de bodega");
  const aviso = mails.docs[0].data();
  assert.equal(aviso.to, "bodega-test@cecomunica.com");
  assert.match(aviso.subject, /Cambio de serial GC20260915-01: confirmar el serial correcto/);
  assert.match(aviso.bodyContent, /No hay que sacar nada del estante/);
  assert.match(aviso.cc || "", /cecrecep@cecomunica\.com/);

  let g = (await db.doc(`gestiones/${GID}`).get()).data();
  assert.ok(!g.cierre?.derivacion, "sin el serial real no se aplica nada");
  assert.equal((await pool(VIEJO)).estado, "en_cliente", "el pool no se movió todavía");

  // ── 2) Bodega confirma el serial real → se aplica sola ────────────────
  await escribirGestion({
    items: [{
      serial: VIEJO, serial_norm: VIEJO, modelo: MODELO, contrato_doc_id: CID,
      contrato_id: "PROP20260731-03", motivo_codigo: "error_captura",
      motivo_detalle: "No es el serial de la factura 10317",
      serial_nuevo: NUEVO, confirmado_por_bodega: true,
    }],
  });

  // El contrato ahora lista el serial correcto.
  const fila = (await db.doc(`contratos/${CID}/seriales/fila1`).get()).data();
  assert.equal(fila.serial, NUEVO, "la fila del contrato quedó con el serial real");
  assert.equal(fila.corregido_por_gestion, GID);

  // El intercambio en el pool: el viejo vuelve al estante por verificar, el
  // correcto queda con el cliente (el contrato ya tenía entrega confirmada).
  const viejo = await pool(VIEJO);
  assert.equal(viejo.estado, "en_bodega", "el serial equivocado vuelve al estante");
  assert.equal(viejo.verificado, false, "y queda marcado para verificar físicamente");
  assert.equal(viejo.asignacion, null, "ya no cuelga del contrato");
  const nuevo = await pool(NUEVO);
  assert.equal(nuevo.estado, "en_cliente", "el serial real queda con el cliente");
  assert.equal(nuevo.asignacion?.contrato_doc_id, CID, "y amarrado al contrato");

  // Rastro: el valor anterior no se pierde al sobrescribir la fila.
  const hist = await db.collection(`contratos/${CID}/seriales_historial`).get();
  assert.equal(hist.size, 1, "queda un registro en el historial de seriales");
  assert.equal(hist.docs[0].data().eliminados[0].serial, VIEJO);
  assert.equal(hist.docs[0].data().agregados[0].serial, NUEVO);

  // El expediente queda aplicado; el cierre lo estampa el siguiente flanco.
  g = (await db.doc(`gestiones/${GID}`).get()).data();
  assert.equal(g.cierre?.asignacion, true);
  assert.equal(g.cierre?.derivacion, true);
  assert.ok(!g.correccion_en_curso, "la puerta transaccional se cierra siempre");
  assert.equal(g.correccion?.aplicados?.[0]?.nuevo, NUEVO);

  // Correo de corrección a activaciones, con el par tachado→nuevo.
  mails = await db.collection("mail_queue").get();
  assert.equal(mails.size, 2, "sale el segundo correo: la corrección a activaciones");
  const corr = mails.docs.map((d) => d.data()).find((m) => /Corrección de seriales/.test(m.subject));
  assert.ok(corr, "debe haber un correo de corrección");
  assert.equal(corr.to, "activaciones-test@cecomunica.com");
  assert.match(corr.bodyContent, new RegExp(`${VIEJO}[\\s\\S]*${NUEVO}`));

  // ── 3) Cierre automático en el flanco siguiente ───────────────────────
  await escribirGestion({ notas: "toque para el flanco de cierre" });
  g = (await db.doc(`gestiones/${GID}`).get()).data();
  assert.equal(g.estado, "cerrada", "con asignacion+derivacion la gestión cierra sola");

  // ── 4) Idempotencia: re-correr no vuelve a corregir ni a avisar ───────
  const antesMails = (await db.collection("mail_queue").get()).size;
  await escribirGestion({ notas: "re-entrega del evento" });
  assert.equal((await db.collection("mail_queue").get()).size, antesMails,
    "re-correr el trigger no manda otra corrección");
  assert.equal((await db.collection(`contratos/${CID}/seriales_historial`).get()).size, 1,
    "ni escribe otro registro de historial");
  assert.equal((await db.doc(`contratos/${CID}/seriales/fila1`).get()).data().serial, NUEVO);

  // ── 5) Candado: un ítem que apunta al contrato de OTRO cliente ────────
  const GID2 = "GC20260915-02";
  const ref2 = db.doc(`gestiones/${GID2}`);
  await ref2.set({
    tipo: "cambio_serial", estado: "pendiente_bodega",
    cliente_id: CLIENTE, cliente_nombre: "CDP HOLDINGS INC",
    items: [{ serial: "AJENO0001", modelo: MODELO, contrato_doc_id: CID_AJENO,
      contrato_id: "ALQ20260101-01", motivo_codigo: "otro", serial_nuevo: "AJENO0002" }],
    cierre: {}, ordenes: {}, deleted: false,
  });
  const after2 = await ref2.get();
  await onGestion.run({ data: { before: null, after: after2 }, params: { gid: GID2 } });
  const g2 = (await ref2.get()).data();
  assert.ok(!g2.cierre?.derivacion, "no se aplica sobre el contrato de otro cliente");
  const evs = await db.collection(`gestiones/${GID2}/eventos`).get();
  assert.ok(evs.docs.some((d) => d.data().accion === "correccion_incompleta"),
    "y queda dicho en el expediente por qué no se aplicó");

  // ── 6) Un radio que salio en un DEMO no se corrige por aqui ──────────
  // Caso R. SMITH ALTA PLAZA (2026-09-15): el demo no tiene contrato, asi que
  // "corregirlo" dejaria demo.seriales_asignados y la OS con los viejos.
  await db.doc("equipos_pool/DEMO0001").set({
    serial: "DEMO0001", serial_norm: "DEMO0001", modelo_label: MODELO, estado: "en_cliente",
    asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: CLIENTE,
      cliente_nombre: "CDP HOLDINGS INC", gestion_doc_id: "GD20260914-01", tipo: "demo" },
  });
  const GID3 = "GC20260915-03";
  const ref3 = db.doc(`gestiones/${GID3}`);
  await ref3.set({
    tipo: "cambio_serial", estado: "pendiente_bodega",
    cliente_id: CLIENTE, cliente_nombre: "CDP HOLDINGS INC",
    items: [{ serial: "DEMO0001", modelo: MODELO, contrato_doc_id: null,
      motivo_codigo: "error_captura", serial_nuevo: "DEMO0002" }],
    cierre: {}, ordenes: {}, deleted: false,
  });
  const after3 = await ref3.get();
  await onGestion.run({ data: { before: null, after: after3 }, params: { gid: GID3 } });
  const g3 = (await ref3.get()).data();
  assert.ok(!g3.cierre?.derivacion, "un equipo en demo no se corrige por esta via");
  assert.equal((await pool("DEMO0001")).estado, "en_cliente", "y el pool no se toca");
  const evs3 = await db.collection(`gestiones/${GID3}/eventos`).get();
  assert.ok(evs3.docs.some((d) => /demo/.test(d.data().detalle || "")),
    "el expediente dice que el camino es anular el demo");

  console.log("OK cambio-serial: contrato corregido, intercambio en el pool, cierre solo,");
  console.log("   correo a activaciones, idempotente y con candado de cliente.");
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
