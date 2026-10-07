// La línea del contrato le pone el modelo a la ficha (2026-10-07).
//
// Caso real ACODECO (SERV20261007-02): 22 radios de la migración POC sin
// modelo en su ficha trababan la renovación con "agrega su modelo" — y el
// modelo ya estaba en la línea (HYTERA PNC360S-R). El wizard ahora deja pasar
// esos seriales con el modelo de la línea (avisándole al vendedor) y
// aplicarPlanRenovacion corrige la ficha ANTES de crear la fila del contrato.
//
// Congela, contra Firestore real:
//   1) ficha sin modelo → toma el de la línea, condición de la fila, kardex;
//   2) ficha con modelo de una migración sin verificar → se corrige igual;
//   3) ficha con modelo VERIFICADO → no se pisa ('protegida') y la fila del
//      contrato sale con el modelo de la ficha (no parte el serial).
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-modelo-linea \
//     "node functions/test-emulator/plan-renovacion-modelo-linea.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-modelo-linea";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const { aplicarPlanRenovacion } = require("../src/lib/planRenovacion");

const CID = "cto-acodeco";
const R = { id: "x7hlVuYhyf22JhzR4hqz", label: "HYTERA PNC360S-R" };
let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const leer = async (s) => (await db.doc(`equipos_pool/${s}`).get()).data();
const kardex = async (s) => (await db.collection(`equipos_pool/${s}/movimientos`).get()).docs.map((d) => d.data());

(async () => {
  await db.doc(`modelos/${R.id}`).set({ marca: "HYTERA", modelo: "PNC360S-R", estado: "R" });
  await db.doc("modelos/k1").set({ marca: "KENWOOD", modelo: "TK-3000", estado: "N" });
  const asig = { cliente_id: "cli-acodeco", cliente_nombre: "ACODECO" };
  await db.doc("equipos_pool/25219A0970").set({ serial: "25219A0970", serial_norm: "25219A0970",
    modelo_id: null, modelo_label: "", condicion: "nuevo", estado: "en_cliente", origen: "migracion_poc",
    verificado: false, asignacion: asig });
  await db.doc("equipos_pool/25219A0971").set({ serial: "25219A0971", serial_norm: "25219A0971",
    modelo_id: "k1", modelo_label: "KENWOOD TK-3000", condicion: "nuevo", estado: "en_cliente",
    origen: "migracion_poc", verificado: false, asignacion: asig });
  await db.doc("equipos_pool/25219A0972").set({ serial: "25219A0972", serial_norm: "25219A0972",
    modelo_id: "k1", modelo_label: "KENWOOD TK-3000", condicion: "nuevo", estado: "en_cliente",
    origen: "migracion_poc", verificado: true, asignacion: asig });

  const u = (serial, de_id, de) => ({ pool_id: serial, serial, serial_norm: serial, modelo_id: R.id, modelo: R.label,
    destino: "continua", fuente: "custodia", modalidad: "alquiler", modelo_corregido: { de_id, de } });
  const contrato = {
    contrato_id: "SERV20261007-02", accion: "Renovación", cliente_id: "cli-acodeco", cliente_nombre: "ACODECO",
    transicion_plan: { nivel: "serial", unidades: [
      u("25219A0970", null, ""), u("25219A0971", "k1", "KENWOOD TK-3000"), u("25219A0972", "k1", "KENWOOD TK-3000"),
    ] },
  };
  const ref = db.doc(`contratos/${CID}`);
  await ref.set(contrato);
  const r = await aplicarPlanRenovacion(ref, contrato, CID);
  assert.equal(r.creadas, 3);

  let f = await leer("25219A0970");
  assert.equal(f.modelo_id, R.id); assert.equal(f.modelo_label, R.label); assert.equal(f.condicion, "reuso");
  assert.equal(f.estado, "en_cliente");
  assert.ok((await kardex("25219A0970")).some((m) => m.tipo === "correccion_modelo" && /sin modelo → HYTERA PNC360S-R/.test(m.notas)));
  ok("1) sin modelo → toma el de la línea, condición reuso, en el kardex");

  f = await leer("25219A0971");
  assert.equal(f.modelo_id, R.id);
  assert.ok((await kardex("25219A0971")).some((m) => /KENWOOD TK-3000 \(de migracion_poc, sin verificar\)/.test(m.notas)));
  ok("2) modelo de migración sin verificar → corregido");

  f = await leer("25219A0972");
  assert.equal(f.modelo_id, "k1");
  assert.equal((await kardex("25219A0972")).length, 0);
  const filas = (await ref.collection("seriales").get()).docs.map((d) => d.data());
  assert.equal(filas.find((x) => x.serial === "25219A0972").modelo_id, "k1");
  assert.equal(filas.find((x) => x.serial === "25219A0970").modelo_id, R.id);
  assert.equal((await ref.get()).data().plan_aplicado.modelos_corregidos, 2);
  ok("3) modelo verificado → protegido; la fila sale con el modelo de la ficha");

  console.log(`\n${n} PASS`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
