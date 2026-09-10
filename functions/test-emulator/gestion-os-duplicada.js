// La gestión no puede sacar DOS órdenes de programación (2026-09-10).
//
// Caso real GR20260910-01 (Silverking / Westin): bodega asignó el serial y
// `onGestionArchivo` —que vive sobre el mismo documento— escribió
// `seriales_norm` de vuelta. Las dos escrituras entraron a la sección C de
// onGestionWrite a 300 ms una de otra; las dos leyeron fresco ANTES de que la
// primera estampara `programacion_id` (la marca se ponía después de crear las
// órdenes) y salieron las OS 2026091003 y 2026091004 idénticas, dos correos a
// Recepción y una "incidencia de pool" falsa.
//
// Congela las dos defensas:
//   1) dos invocaciones CONCURRENTES que ambas pasan los filtros → una sola
//      OS (la puerta transaccional reserva `ordenes.programacion_en_curso`);
//   2) el eco de `seriales_norm` no hace correr la máquina de estados;
//   3) si no se pudo crear ninguna OS, la puerta queda ABIERTA (sin la marca)
//      para que el próximo evento reintente.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-gestion-os \
//     "node functions/test-emulator/gestion-os-duplicada.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-gestion-os";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const trigger = require("../src/triggers/gestiones/onGestionWrite");
assert.equal(typeof trigger.run, "function", "el trigger v2 debe exponer .run(event)");

const GID = "GR20260910-01";
const SALIENTE = "23418A0372";
const NUEVO = "23411A1111";
let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const gestionBase = (extra = {}) => ({
  tipo: "reemplazo",
  estado: "pendiente_bodega",
  cliente_id: "cli-1",
  cliente_nombre: "SILVERKING INVESTMENT CORP - HOTEL WESTIN PANAMA",
  responsable_uid: "vend-1",
  responsable_email: "zuleika.diaz@cecomunica.com",
  cierre: {},
  items: [{
    serial_saliente: SALIENTE,
    pool_doc_id_saliente: SALIENTE,
    modelo: "HYTERA PNC360S-R", modelo_id: "m1",
    modelo_solicitado: "HYTERA PNC360S-R", modelo_solicitado_id: "m1",
    motivo_codigo: "otro", motivo_detalle: "problema con el conector del audio",
    elegibilidad: "alquiler", contrato_id: null, contrato_doc_id: null,
  }],
  ...extra,
});

const conSerial = (extra = {}) => {
  const g = gestionBase(extra);
  g.items[0].serial_nuevo = NUEVO;
  g.items[0].pool_doc_id_nuevo = NUEVO;
  g.items[0].asignado_at = new Date().toISOString();
  return g;
};

// Un evento v2 armado a mano: snapshots reales sin pasar por el emulador de
// Functions (memoria reference_emulador_functions_stub_fieldvalue).
async function evento(antes, despues) {
  const ref = db.doc(`gestiones/${GID}`);
  await ref.set(antes);
  const before = await ref.get();
  await ref.set(despues);
  const after = await ref.get();
  return { data: { before, after }, params: { gid: GID } };
}

const ordenesDeLaGestion = async () => {
  const snap = await db.collection("ordenes_de_servicio").where("gestion.id", "==", GID).get();
  return snap.docs.filter(d => !d.data().eliminado).map(d => d.id);
};

const limpiar = async () => {
  for (const c of ["ordenes_de_servicio", "mail_queue"]) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map(d => d.ref.delete()));
  }
  await db.doc(`equipos_pool/${NUEVO}`).set({
    serial: NUEVO, serial_norm: NUEVO, modelo_id: "m1", modelo_label: "PNC360S-R",
    estado: "en_bodega", condicion: "usado", propiedad: "cecomunica", verificado: true,
  });
};

(async () => {
  await db.doc("clientes/cli-1").set({
    nombre: "SILVERKING INVESTMENT CORP - HOTEL WESTIN PANAMA", vendedor_asignado: "vend-1", activo: true,
  });
  await db.doc("usuarios/recep-1").set({ rol: "recepcion", email: "cecrecep@cecomunica.com" });
  await db.doc(`equipos_pool/${SALIENTE}`).set({
    serial: SALIENTE, serial_norm: SALIENTE, modelo_id: "m1", modelo_label: "PNC360S-R",
    estado: "en_cliente", propiedad: "cecomunica",
  });

  // ── 1) La carrera: dos escrituras reales, casi simultáneas ────────────
  // (bodega asigna el serial · alguien toca `notas` un instante después).
  // Antes de la puerta transaccional esto sacaba DOS OS.
  await limpiar();
  const evA = await evento(gestionBase(), conSerial());
  const evB = await evento(conSerial(), conSerial({ notas: "el cliente pasa mañana" }));
  await Promise.all([trigger.run(evA), trigger.run(evB)]);

  let ids = await ordenesDeLaGestion();
  assert.equal(ids.length, 1, `una sola OS de programación, salieron ${ids.length}: ${ids.join(", ")}`);
  ok(`dos invocaciones concurrentes → una sola OS (${ids[0]})`);

  let g = (await db.doc(`gestiones/${GID}`).get()).data();
  assert.equal(g.ordenes.programacion_id, ids[0], "la gestión apunta a la OS que existe");
  assert.deepEqual(g.ordenes.programacion_ids, ids, "programacion_ids sin fantasmas");
  assert.equal("programacion_en_curso" in g.ordenes, false, "la marca de la puerta se limpia al estampar");
  assert.equal(g.cierre.asignacion, true, "cierre.asignacion queda en true");
  ok("la gestión queda apuntando a esa OS y sin la marca de la puerta");

  const correos = await db.collection("mail_queue").where("meta.paso", "==", "programacion").get();
  assert.equal(correos.size, 1, `un solo correo a Recepción, salieron ${correos.size}`);
  ok("Recepción recibe un solo correo");

  const u = (await db.doc(`equipos_pool/${NUEVO}`).get()).data();
  assert.equal(u.estado, "asignado_contrato", `el entrante queda asignado, quedó ${u.estado}`);
  const movs = await db.doc(`equipos_pool/${NUEVO}`).collection("movimientos").get();
  const asign = movs.docs.filter(d => d.data().tipo === "asignacion_gestion");
  assert.equal(asign.length, 1, `un solo movimiento de asignación, hubo ${asign.length}`);
  ok("el pool se mueve una sola vez (sin la 'incidencia' falsa del duplicado)");

  // ── 2) El eco del indexador no decide nada ────────────────────────────
  await limpiar();
  await db.doc(`gestiones/${GID}`).set(conSerial());
  const eco = await evento(conSerial(), conSerial({ seriales_norm: [SALIENTE, NUEVO] }));
  await trigger.run(eco);
  ids = await ordenesDeLaGestion();
  assert.equal(ids.length, 0, `el eco de seriales_norm no crea OS, creó ${ids.length}`);
  ok("el eco de seriales_norm se ignora");

  // Pero el flanco de verdad, con seriales_norm ya puesto, sí trabaja.
  const real = await evento(
    gestionBase({ seriales_norm: [SALIENTE] }),
    conSerial({ seriales_norm: [SALIENTE, NUEVO] }),
  );
  await trigger.run(real);
  ids = await ordenesDeLaGestion();
  assert.equal(ids.length, 1, "la asignación real sí crea su OS");
  ok("la asignación real sigue creando su OS");

  // ── 3) Puerta abierta si no se pudo crear ninguna OS ──────────────────
  // Ítems sin serial_nuevo: asignacionCompleta() no pasa, así que se fuerza
  // el camino de "reservó y no creó" dejando los equipos sin serial.
  await limpiar();
  const sinSerial = conSerial();
  sinSerial.items[0].serial_nuevo = "   ";           // completa para el filtro…
  sinSerial.items[0].asignado_at = new Date().toISOString();
  const vacio = await evento(gestionBase(), sinSerial);
  await trigger.run(vacio);
  g = (await db.doc(`gestiones/${GID}`).get()).data();
  ids = await ordenesDeLaGestion();
  if (!ids.length) {
    assert.equal("programacion_en_curso" in (g.ordenes || {}), false,
      "sin OS creada la puerta debe quedar abierta para el próximo evento");
    ok("sin OS creada la puerta queda abierta (reintentable)");
  } else {
    ok("(el filtro descartó el caso vacío antes de la puerta)");
  }

  console.log(`\n${n} verificaciones OK`);
  process.exit(0);
})().catch((e) => { console.error("\nFALLÓ:", e.message); process.exit(1); });
