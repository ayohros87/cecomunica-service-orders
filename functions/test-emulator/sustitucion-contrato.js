// Integración de traspasarASustituto contra el emulador de Firestore.
// Corre con: firebase emulators:exec --only firestore "node test-emulator/sustitucion-contrato.js"
// (emulators:exec exporta FIRESTORE_EMULATOR_HOST). Vive FUERA de test/ para
// que `node --test` (npm test) no lo levante — requiere el emulador.
//
// Qué protege: `traspasarASustituto` escribe en un contrato que NO es el que se
// está anulando —le copia seriales, le hereda la entrega y le mueve el pool por
// vía de onSerialWrite—. Es la operación con más filo de la anulación por
// sustitución, así que lo que se prueba aquí son sobre todo los CANDADOS: cada
// forma de equivocarse de contrato debe terminar en un "no hago nada" con su
// motivo, nunca en una escritura a medias.
//
// El caso que lo origina: ALQ20260715-01 → ALQ20260806-03 (SOCIEDAD ISRAELITA,
// 32 radios, 2026-08-06). Ver test/anulacionSustitucion.test.js para la lógica
// de clasificación, que no necesita emulador.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-sustitucion-contrato" });

// Requerir DESPUÉS de initializeApp (lib/admin llama admin.firestore()).
const { traspasarASustituto } = require("../src/lib/sustitucionContrato");
const db = admin.firestore();

const ORIGEN = {
  cliente_id: "cli-1", cliente_nombre: "CLIENTE PRUEBA",
  contrato_id: "ALQ-VIEJO", entrega_confirmada: true,
  fecha_entrega_ultima: admin.firestore.Timestamp.fromDate(new Date("2026-07-24T15:24:02Z")),
};
const UNIDADES = [
  { serial: "AAA111", modelo: "PNC360S-R", modelo_id: "m1", pool_doc_id: "AAA111" },
  { serial: "BBB222", modelo: "PNC360S-R", modelo_id: "m1", pool_doc_id: "BBB222" },
];
const DOCS = ["c-origen", "c-sust", "c-otro-cliente", "c-anulado", "c-confirmado",
  "c-borrado", "c-crecido", "c-sin-renglon"];

async function limpiar() {
  for (const c of DOCS) {
    const ref = db.collection("contratos").doc(c);
    for (const d of (await ref.collection("seriales").get()).docs) await d.ref.delete();
    for (const d of (await ref.collection("seriales_estado").get()).docs) await d.ref.delete();
    await ref.delete();
  }
  for (const d of (await db.collection("mail_queue").get()).docs) await d.ref.delete();
}
const traspasar = (sustitutoId, over = {}) => traspasarASustituto({
  origenId: "c-origen", origen: { ...ORIGEN, ...over }, sustitutoId, unidades: UNIDADES,
});

(async () => {
  await limpiar();
  await db.collection("contratos").doc("c-origen").set({ ...ORIGEN });

  // ── Candados: cada uno debe rechazar SIN escribir nada ──────────────────
  let r = await traspasarASustituto({ origenId: "c-origen", origen: ORIGEN, sustitutoId: null, unidades: UNIDADES });
  assert.equal(r.ok, false); assert.match(r.motivo, /sin contrato sustituto/);

  r = await traspasar("c-origen");
  assert.equal(r.ok, false); assert.match(r.motivo, /mismo contrato/);

  r = await traspasarASustituto({ origenId: "c-origen", origen: ORIGEN, sustitutoId: "c-sust", unidades: [] });
  assert.equal(r.ok, false); assert.match(r.motivo, /sin unidades/);

  r = await traspasar("no-existe");
  assert.equal(r.ok, false); assert.match(r.motivo, /no existe/);

  await db.collection("contratos").doc("c-borrado").set({ cliente_id: "cli-1", deleted: true, estado: "aprobado" });
  r = await traspasar("c-borrado");
  assert.equal(r.ok, false); assert.match(r.motivo, /borrado/);

  await db.collection("contratos").doc("c-anulado").set({ cliente_id: "cli-1", estado: "anulado" });
  r = await traspasar("c-anulado");
  assert.equal(r.ok, false); assert.match(r.motivo, /también está anulado/);

  // Traspasar a otro cliente no es una sustitución, es un traslado de equipo.
  await db.collection("contratos").doc("c-otro-cliente").set({ cliente_id: "cli-2", estado: "aprobado" });
  r = await traspasar("c-otro-cliente");
  assert.equal(r.ok, false); assert.match(r.motivo, /otro cliente/);

  // Seriales ya CONFIRMADOS en el sustituto: alguien cerró esa pantalla y el
  // contrato quedó bajo el candado de solo-lectura. No se pisa.
  await db.collection("contratos").doc("c-confirmado").set({
    cliente_id: "cli-1", estado: "aprobado", contrato_id: "ALQ-CS",
    seriales_estado: "asignados",
  });
  await db.collection("contratos").doc("c-confirmado").collection("seriales").add({ serial: "ZZZ999" });
  r = await traspasar("c-confirmado");
  assert.equal(r.ok, false); assert.match(r.motivo, /seriales confirmados/);
  assert.equal((await db.collection("contratos").doc("c-confirmado").collection("seriales").get()).size, 1,
    "un rechazo no puede haber tocado el sustituto");

  // ── Camino feliz ────────────────────────────────────────────────────────
  await db.collection("contratos").doc("c-sust").set({ cliente_id: "cli-1", estado: "aprobado", contrato_id: "ALQ-NUEVO" });
  r = await traspasar("c-sust");
  assert.equal(r.ok, true);
  assert.equal(r.copiados, 2);

  const s = (await db.collection("contratos").doc("c-sust").get()).data();
  // Hereda la entrega: el cliente ya tiene los radios en la mano. Sin esto
  // onSerialWrite los degradaría a `asignado_contrato` (apartados en bodega).
  assert.equal(s.entrega_confirmada, true);
  assert.ok(s.fecha_entrega_ultima, "hereda la fecha de la entrega real");
  // Candado contra onEntregaTransicion: sin él, confirmar la entrega haría que
  // el sustituto reclamara como devolución el equipo del origen — el mismo
  // tiquete falso que la sustitución existe para evitar.
  assert.ok(s.transicion_auto_at);
  assert.equal(s.transicion_auto_motivo, "sustitucion_de_contrato");
  assert.equal(s.seriales_estado, "asignados");
  assert.equal(s.sustituye_a_id, "c-origen");
  assert.equal(r.completo, true);

  const filas = await db.collection("contratos").doc("c-sust").collection("seriales").get();
  assert.equal(filas.size, 2);
  const f0 = filas.docs[0].data();
  assert.equal(f0.contrato_doc_id, "c-sust");
  assert.equal(f0.migrado_de_contrato, "c-origen", "la fila recuerda de dónde vino");
  assert.equal(f0.cliente_id, "cli-1");

  // Contrato completo → se escribe la SEÑAL, que es la que dispara el correo de
  // aprobación a activaciones (onSerialesAsignadasSendPdf). Decisión de negocio
  // del 2026-08-14: si con la sustitución el contrato queda con todos sus
  // seriales, para activaciones está listo, vinieran de donde vinieran.
  const senal = await db.collection("contratos").doc("c-sust")
    .collection("seriales_estado").doc("current").get();
  assert.ok(senal.exists, "el contrato completo debe emitir la señal a activaciones");
  assert.equal(senal.data().estado, "asignados");
  assert.equal(senal.data().origen_sustitucion, "ALQ-VIEJO");

  // Y bodega se entera del traspaso automático, completo o no.
  let correos = (await db.collection("mail_queue").where("meta.contrato_doc_id", "==", "c-sust").get()).docs
    .map((d) => d.data());
  assert.equal(correos.length, 1, "un aviso a bodega por traspaso");
  assert.equal(correos[0].meta.completo, true);
  assert.match(correos[0].bodyContent, /COMPLETO/);

  // ── Idempotencia: el reintento del trigger no duplica filas ─────────────
  // Aquí lo frena el candado de "seriales confirmados" (el traspaso completo
  // acaba de marcarlo). La idempotencia por serial se prueba en c-crecido.
  r = await traspasar("c-sust");
  assert.equal(r.ok, false); assert.match(r.motivo, /seriales confirmados/);
  assert.equal((await db.collection("contratos").doc("c-sust").collection("seriales").get()).size, 2);

  // ── El sustituto CRECIÓ: traspaso parcial por modelo ────────────────────
  // Caso REEMP20260811-01 → ALQ20260812-01 (MAGEN DAVID, 2026-08-14): el
  // contrato se rehizo por 10 unidades donde el anulado tenía 5. Las 2 del
  // origen entran por su renglón; el contrato NO se cierra, porque quedan
  // renglones sin cargar y la pantalla de seriales tiene que seguir abierta.
  await db.collection("contratos").doc("c-crecido").set({
    cliente_id: "cli-1", estado: "aprobado", contrato_id: "ALQ-CRECIDO",
    equipos: [
      { modelo_id: "m1", modelo: "PNC360S-R", cantidad: 2 },
      { modelo_id: "m2", modelo: "HYT-P50",   cantidad: 3 },
    ],
  });
  r = await traspasar("c-crecido");
  assert.equal(r.ok, true);
  assert.equal(r.copiados, 2, "las 2 del origen entran por su renglón");
  assert.equal(r.completo, false);
  assert.equal(r.faltan, 3, "los 3 HYT-P50 los carga inventario a mano");
  assert.deepEqual(r.restantes, [{ modelo: "HYT-P50", cantidad: 3 }]);
  const sc = (await db.collection("contratos").doc("c-crecido").get()).data();
  assert.notEqual(sc.seriales_estado, "asignados",
    "un contrato a medio llenar NO puede quedar bajo el candado de solo-lectura");
  assert.equal(sc.sustitucion_seriales_faltan, 3);
  // Incompleto: NO se emite la señal (no hay nada que aprobar todavía) pero
  // bodega sí recibe el aviso con lo que falta, por modelo.
  assert.ok((await db.collection("contratos").doc("c-crecido").collection("seriales_estado").get()).empty,
    "sin el contrato completo no se le pide aprobación a activaciones");
  correos = (await db.collection("mail_queue").where("meta.contrato_doc_id", "==", "c-crecido").get()).docs
    .map((d) => d.data());
  assert.equal(correos.length, 1);
  assert.equal(correos[0].meta.completo, false);
  assert.match(correos[0].bodyContent, /Faltan 3 serial/);
  assert.match(correos[0].bodyContent, /HYT-P50/);

  // Re-ejecutar no duplica: el serial ya cargado se salta.
  r = await traspasar("c-crecido");
  assert.equal(r.copiados, 0);
  assert.equal((await db.collection("contratos").doc("c-crecido").collection("seriales").get()).size, 2);

  // ── Modelo sin renglón en el sustituto: se reporta, no se cuela ─────────
  await db.collection("contratos").doc("c-sin-renglon").set({
    cliente_id: "cli-1", estado: "aprobado", contrato_id: "ALQ-OTRO-MODELO",
    equipos: [{ modelo_id: "m9", modelo: "TK-3000-R", cantidad: 2 }],
  });
  r = await traspasar("c-sin-renglon");
  assert.equal(r.copiados, 0);
  assert.equal(r.pendientes.length, 2);
  assert.match(r.pendientes[0].motivo, /no tiene renglón/);
  assert.equal((await db.collection("contratos").doc("c-sin-renglon").collection("seriales").get()).size, 0,
    "el equipo no entra a un contrato que no lo contempla");

  // ── Origen que nunca se entregó: el sustituto no hereda entrega ─────────
  await limpiar();
  await db.collection("contratos").doc("c-sust").set({ cliente_id: "cli-1", estado: "aprobado", contrato_id: "ALQ-NUEVO" });
  r = await traspasar("c-sust", { entrega_confirmada: false });
  assert.equal(r.ok, true);
  const s2 = (await db.collection("contratos").doc("c-sust").get()).data();
  assert.equal(s2.entrega_confirmada, undefined, "no inventa una entrega que no ocurrió");
  assert.equal(s2.transicion_auto_at, undefined, "sin entrega no hace falta el candado");

  await limpiar();
  console.log("OK — sustitucion-contrato: candados, traspaso parcial por modelo, "
    + "idempotencia y herencia de entrega");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
