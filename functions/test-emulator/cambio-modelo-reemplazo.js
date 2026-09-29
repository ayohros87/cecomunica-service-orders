// Cambio de MODELO en un reemplazo = decisión de administración (2026-09-29).
//
// Caso real GR20260923-01 (TRANSPORTE LIGO): el reemplazo se aprobó con un
// PNC550-R y bodega puso un PNC460-R ("no hay PNC550 en buen estado"). El
// precio del cliente salió del modelo aprobado y nadie decidió si seguía
// igual. Alberto: "si luego bodega decide cambiar el modelo, ¿quién dice que
// el precio es el mismo?".
//
// Congela, contra Firestore real:
//   1) asignar otro modelo NO programa: la gestión vuelve a
//      pendiente_aprobacion con cambio_modelo pendiente y UN correo a ventas@;
//   2) el eco de esa escritura no manda un segundo correo;
//   3) aprobar (tarifa se mantiene) → sale la OS, sin el aviso genérico a bodega;
//   4) rechazar → no hay OS; bodega recibe el aviso de poner otro radio;
//      y al poner uno del modelo aprobado, la OS sale;
//   5) N/R de la misma familia (PNC460 ↔ PNC460-R) programa directo;
//   6) reglas: bodega no escribe cambio_modelo; administración sí, al decidir.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-cambio-modelo \
//     "node functions/test-emulator/cambio-modelo-reemplazo.js"
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-cambio-modelo";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const trigger = require("../src/triggers/gestiones/onGestionWrite");

const GID = "GR20260923-01";
const SALIENTE = "21708A0008";
const PNC460_SERIAL = "23905A0437";
const PNC550_SERIAL = "21708A9999";
const M550 = "h71xBSqhTKCGX1zkOrzC";
const M460 = "6tdGBjLOmq567GJRTMbQ";
let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const gestionBase = (extra = {}) => ({
  tipo: "reemplazo", estado: "pendiente_bodega",
  cliente_id: "cli-ligo", cliente_nombre: "TRANSPORTE LIGO, S.A.",
  responsable_uid: "vend-1", responsable_email: "vendedor@test",
  cierre: { aprobacion: true },
  aprobacion: { requiere: true, motivo: "propuesta_taller", aprobado_por_email: "zuleika.diaz@cecomunica.com" },
  items: [{
    serial_saliente: SALIENTE, pool_doc_id_saliente: SALIENTE, saliente_en_casa: true,
    modelo: "PNC550-R", modelo_id: M550,
    modelo_solicitado: "HYTERA PNC550-R", modelo_solicitado_id: M550,
    motivo_codigo: "dano_no_reparable", motivo_detalle: "daños físicos",
    elegibilidad: "alquiler", contrato_id: null, contrato_doc_id: null,
  }],
  ...extra,
});
// Lo que escribe Almacén · Asignar (bundle nuevo: modelo de la ficha + motivo).
const conSerial = (serial, modeloId, modeloLabel, motivo, extra = {}) => {
  const g = gestionBase(extra);
  Object.assign(g.items[0], {
    serial_nuevo: serial, pool_doc_id_nuevo: serial, asignado_at: new Date().toISOString(),
    modelo_id_nuevo: modeloId, modelo_nuevo: modeloLabel, cambio_modelo_motivo: motivo,
  });
  return g;
};

const ref = () => db.doc(`gestiones/${GID}`);
// Evento v2 con snapshots reales (memoria reference_emulador_functions_stub_fieldvalue).
async function evento(antes, despues) {
  await ref().set(antes);
  const before = await ref().get();
  await ref().set(despues);
  const after = await ref().get();
  return { data: { before, after }, params: { gid: GID } };
}
// Corre el trigger sobre la escritura más reciente (lo que haría el eco real).
async function correrSobreActual(beforeSnapData) {
  const actual = (await ref().get()).data();
  const ev = await evento(beforeSnapData, actual);
  await trigger.run(ev);
}
const ordenes = async () => (await db.collection("ordenes_de_servicio").where("gestion.id", "==", GID).get())
  .docs.filter(d => !d.data().eliminado).map(d => d.id);
const correos = async (paso) => (await db.collection("mail_queue").where("meta.paso", "==", paso).get()).size;

async function limpiar() {
  for (const c of ["ordenes_de_servicio", "mail_queue", "gestiones"]) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map(d => d.ref.delete()));
  }
  await db.doc(`equipos_pool/${PNC460_SERIAL}`).set({ serial: PNC460_SERIAL, serial_norm: PNC460_SERIAL,
    modelo_id: M460, modelo_label: "HYTERA PNC460-R", estado: "en_bodega", propiedad: "cecomunica", verificado: true });
  await db.doc(`equipos_pool/${PNC550_SERIAL}`).set({ serial: PNC550_SERIAL, serial_norm: PNC550_SERIAL,
    modelo_id: M550, modelo_label: "HYTERA PNC550-R", estado: "en_bodega", propiedad: "cecomunica", verificado: true });
}

async function flujoTrigger() {
  await db.doc("clientes/cli-ligo").set({ nombre: "TRANSPORTE LIGO, S.A.", vendedor_asignado: "vend-1", activo: true });
  await db.doc("usuarios/recep-1").set({ rol: "recepcion", email: "cecrecep@cecomunica.com" });
  await db.doc("usuarios/inv-1").set({ rol: "inventario", email: "bodega@cecomunica.com" });
  await db.doc(`equipos_pool/${SALIENTE}`).set({ serial: SALIENTE, serial_norm: SALIENTE,
    modelo_id: M550, modelo_label: "HYTERA PNC550-R", estado: "devuelto_revision", propiedad: "cecomunica" });

  // ── 1) Otro modelo → vuelve a administración, sin OS ─────────────────────
  await limpiar();
  const asignada = conSerial(PNC460_SERIAL, M460, "HYTERA PNC460-R", "no hay PNC550 en buen estado");
  await trigger.run(await evento(gestionBase(), asignada));
  let g = (await ref().get()).data();
  assert.equal(g.estado, "pendiente_aprobacion", `vuelve a aprobación, quedó ${g.estado}`);
  assert.equal(g.cambio_modelo?.[PNC460_SERIAL]?.estado, "pendiente");
  assert.equal(g.cambio_modelo[PNC460_SERIAL].de_id, M550);
  assert.equal(g.cambio_modelo[PNC460_SERIAL].a_id, M460);
  assert.equal(g.cambio_modelo[PNC460_SERIAL].motivo, "no hay PNC550 en buen estado");
  assert.deepEqual(await ordenes(), [], "no sale OS");
  assert.equal(await correos("cambio_modelo"), 1, "un correo a ventas@");
  assert.equal((await db.doc(`equipos_pool/${PNC460_SERIAL}`).get()).data().estado, "en_bodega", "el radio no se mueve mientras se decide");
  ok("otro modelo → pendiente_aprobacion + cambio_modelo pendiente + 1 correo, sin OS ni movimiento de pool");

  // ── 2) El eco no manda otro correo ───────────────────────────────────────
  await correrSobreActual(asignada);
  await correrSobreActual((await ref().get()).data());
  assert.equal(await correos("cambio_modelo"), 1, "el eco no duplica el correo");
  assert.deepEqual(await ordenes(), []);
  ok("el eco de la escritura no duplica el correo ni programa");

  // ── 3) Aprobar (tarifa se mantiene) → OS, sin el aviso genérico a bodega ──
  const antesDecidir = (await ref().get()).data();
  const aprobada = { ...antesDecidir, estado: "pendiente_bodega",
    cambio_modelo: { [PNC460_SERIAL]: { ...antesDecidir.cambio_modelo[PNC460_SERIAL], estado: "aprobado", tarifa: "se_mantiene",
      decidido_por_email: "alberto.yohros@cecomunica.com" } } };
  await trigger.run(await evento(antesDecidir, aprobada));
  const ids = await ordenes();
  assert.equal(ids.length, 1, `sale una OS, salieron ${ids.length}`);
  const os = (await db.doc(`ordenes_de_servicio/${ids[0]}`).get()).data();
  assert.equal(os.equipos[0].modelo_id, M460, "la OS lleva el modelo REAL del radio");
  assert.equal(await correos("bodega"), 0, "sin el aviso genérico 'asigna seriales'");
  assert.equal((await db.doc(`equipos_pool/${PNC460_SERIAL}`).get()).data().estado, "asignado_contrato", "el pool casa el serial con su ficha");
  ok("aprobado → OS con el modelo real, el pool se asigna y bodega no recibe un aviso repetido");

  // ── 4) Rechazar → sin OS y aviso a bodega; otro radio del modelo → OS ────
  await limpiar();
  await trigger.run(await evento(gestionBase(), asignada));
  const enEspera = (await ref().get()).data();
  const rechazada = { ...enEspera, estado: "pendiente_bodega",
    cambio_modelo: { [PNC460_SERIAL]: { ...enEspera.cambio_modelo[PNC460_SERIAL], estado: "rechazado", nota: "hay PNC550 en Colón" } } };
  await trigger.run(await evento(enEspera, rechazada));
  assert.deepEqual(await ordenes(), [], "rechazado no programa");
  assert.equal(await correos("cambio_modelo_rechazado"), 1, "bodega recibe el aviso");
  g = (await ref().get()).data();
  assert.equal(g.estado, "pendiente_bodega", "no vuelve a escalar lo ya rechazado");
  const bien = conSerial(PNC550_SERIAL, M550, "HYTERA PNC550-R", null, { cambio_modelo: g.cambio_modelo });
  await trigger.run(await evento(g, bien));
  assert.equal((await ordenes()).length, 1, "con un radio del modelo aprobado, la OS sale");
  ok("rechazado → sin OS + aviso a bodega; con el modelo aprobado programa");

  // ── 5) N/R de la misma familia programa directo ─────────────────────────
  await limpiar();
  const base460 = gestionBase();
  Object.assign(base460.items[0], { modelo: "HYTERA PNC460", modelo_id: "m460N", modelo_solicitado: "HYTERA PNC460", modelo_solicitado_id: "m460N" });
  const asig460 = JSON.parse(JSON.stringify(base460));
  Object.assign(asig460.items[0], { serial_nuevo: PNC460_SERIAL, pool_doc_id_nuevo: PNC460_SERIAL, modelo_id_nuevo: M460, modelo_nuevo: "HYTERA PNC460-R" });
  await trigger.run(await evento(base460, asig460));
  assert.equal((await ordenes()).length, 1, "misma familia: sale la OS");
  assert.equal(await correos("cambio_modelo"), 0);
  ok("PNC460 ↔ PNC460-R no pide aprobación (caso SEPROSA)");
}

async function reglas() {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
  const { doc, setDoc, updateDoc } = require("firebase/firestore");
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-rules-cambio-modelo",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  });
  const enEspera = { ...gestionBase(), estado: "pendiente_aprobacion", deleted: false,
    cambio_modelo: { [PNC460_SERIAL]: { estado: "pendiente", serial: PNC460_SERIAL, a_id: M460, de_id: M550 } } };
  const sembrar = () => testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    for (const r of ["administrador", "gerente", "inventario", "vendedor"]) await setDoc(doc(d, `usuarios/${r}`), { rol: r, email: `${r}@test` });
    await setDoc(doc(d, `gestiones/${GID}`), enEspera);
  });
  const as = (rol) => testEnv.authenticatedContext(rol).firestore();
  const decidir = (estado) => ({ estado: "pendiente_bodega", [`cambio_modelo.${PNC460_SERIAL}.estado`]: estado });

  await sembrar();
  await assertFails(updateDoc(doc(as("inventario"), `gestiones/${GID}`), decidir("aprobado")));
  await assertFails(updateDoc(doc(as("inventario"), `gestiones/${GID}`), { [`cambio_modelo.${PNC460_SERIAL}.estado`]: "aprobado" }));
  await assertFails(updateDoc(doc(as("vendedor"), `gestiones/${GID}`), decidir("aprobado")));
  ok("bodega y vendedor no pueden aprobarse el cambio de modelo");

  await assertSucceeds(updateDoc(doc(as("administrador"), `gestiones/${GID}`), decidir("aprobado")));
  await sembrar();
  await assertSucceeds(updateDoc(doc(as("gerente"), `gestiones/${GID}`), decidir("rechazado")));
  ok("administración y gerencia deciden (aprobar / rechazar)");

  await sembrar();
  // Bodega sí puede cambiar el radio mientras se decide (solo items).
  const items = gestionBase().items;
  await assertSucceeds(updateDoc(doc(as("inventario"), `gestiones/${GID}`), { items }));
  ok("bodega puede cambiar el serial mientras se decide (solo items)");
  await testEnv.cleanup();
}

(async () => {
  await flujoTrigger();
  await reglas();
  console.log(`\n${n} PASS — cambio de modelo en reemplazo`);
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
