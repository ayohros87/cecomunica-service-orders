// Reglas de la ENTREGA PARCIAL por tandas — prueba aislada del presupuesto.
//
// Corre con:
//   firebase emulators:exec --only firestore "node functions/test-emulator/rules-entrega-parcial.js"
//
// POR QUÉ ESTE ARCHIVO EXISTE, aparte de rules.js:
// el match de ordenes_de_servicio ya llega al tope de evaluación de Firestore
// ("maximum of 1000 expressions") en los caminos de DENEGACIÓN — pasa incluso
// con una transición ilegal que falla en el primer guard, sin tocar nada de la
// entrega parcial. Es una condición PREVIA a esta función y falla cerrado
// (deniega), así que no rompe nada; pero significa que un assertFails contra
// el ruleset completo no prueba nada: la escritura habría sido rechazada
// igual aunque el candado no existiera.
//
// Para probar el candado de verdad se evalúa el MISMO texto de
// `entregaTandasOk()` con un `allow update` recortado, que deja presupuesto de
// sobra. Si alguien borra la función, este archivo se cae — que es el punto.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");

// El allow update real, recortado a lo que se quiere probar. Se falla ruidoso
// si el ancla no aparece: es la señal de que el allow cambió de forma y esta
// prueba dejó de estar mirando lo que cree.
const ANCLA = "&& entregaTandasOk() && eliminadoOk()));";
if (!RULES.includes(ANCLA)) {
  console.error("FALLO: no se encontró el allow update de ordenes_de_servicio.\n" +
    "Si cambiaste la cadena de guards, actualiza ANCLA en este archivo.");
  process.exit(1);
}
const RULES_AISLADAS = RULES.replace(
  /allow update: if isSignedIn\(\)\s*\n\s*&& userRole\(\) in \["administrador","vendedor","recepcion","tecnico","tecnico_operativo","jefe_taller"\]\s*\n\s*&& \(isAdmin\(\) \|\| \(ordenTransicionLegal\(\)[\s\S]*?&& entregaTandasOk\(\) && eliminadoOk\(\)\)\);/,
  "allow update: if isSignedIn() && (isAdmin() || entregaTandasOk());"
);
if (RULES_AISLADAS === RULES) {
  console.error("FALLO: no se pudo recortar el allow update (¿cambió el formato?).");
  process.exit(1);
}

const EQ = (n) => Array.from({ length: n }, (_, i) => ({
  id: "e" + i, serial: "S" + i, numero_de_serie: "S" + i, modelo: "NX-420-R",
}));
const T = (n) => ({
  n, numero: "oT-E" + n, receptor_nombre: "Ana", firma_url: "https://x/y.png",
  equipos: [{ id: "e" + n, serial: "S" + n }],
});

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-entrega-parcial",
    firestore: { rules: RULES_AISLADAS, host: "127.0.0.1", port: 8080 },
  });

  const base = {
    tipo_de_servicio: "REPARACIÓN", equipos: EQ(3), qc_requerido: false,
    cliente_id: "cli1", cliente_nombre: "ACME",
  };
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("usuarios/recepcion").set({ rol: "recepcion" });
    await db.doc("usuarios/administrador").set({ rol: "administrador" });
    await db.doc("contratos/sinFirmar").set({ firmado: false, estado: "borrador" });
    await db.doc("contratos/firmado").set({ firmado: true, estado: "activo" });

    const completada = { ...base, estado_reparacion: "COMPLETADO (EN OFICINA)" };
    await db.doc("ordenes_de_servicio/ok").set(completada);
    await db.doc("ordenes_de_servicio/asignada").set({ ...base, estado_reparacion: "ASIGNADO" });
    await db.doc("ordenes_de_servicio/entregada").set({ ...base, estado_reparacion: "ENTREGADO AL CLIENTE" });
    await db.doc("ordenes_de_servicio/conTandas").set({ ...completada, entrega: { tandas: [T(1), T(2)] } });
    await db.doc("ordenes_de_servicio/qcPendiente").set({ ...completada, qc_requerido: true });
    await db.doc("ordenes_de_servicio/qcAprobado").set({
      ...completada, qc_requerido: true, qc: { resultado: "aprobado", equipos_n: 3 },
    });
    await db.doc("ordenes_de_servicio/qcRechazado").set({
      ...completada, qc_requerido: true, qc: { resultado: "rechazado" },
    });
    await db.doc("ordenes_de_servicio/contratoSinFirmar").set({
      ...completada, contrato: { aplica: true, contrato_doc_id: "sinFirmar" },
    });
    await db.doc("ordenes_de_servicio/contratoFirmado").set({
      ...completada, contrato: { aplica: true, contrato_doc_id: "firmado" },
    });
  });

  const as = (rol) => testEnv.authenticatedContext(rol).firestore();
  const doc = (id) => as("recepcion").doc("ordenes_de_servicio/" + id);
  let n = 0;
  const ok = (m) => { n++; console.log("  PASS", m); };

  // ── Lo que debe pasar ──────────────────────────────────────────────────
  await assertSucceeds(doc("ok").update({ "entrega.tandas": [T(1)] }));
  await assertSucceeds(doc("conTandas").update({ "entrega.tandas": [T(1), T(2), T(3)] }));
  ok("una tanda nueva sobre una orden COMPLETADA entra (primera y siguientes)");

  await assertSucceeds(doc("ok").update({ nota_tecnica: "sin tocar tandas" }));
  await assertSucceeds(doc("asignada").update({ nota_tecnica: "el taller sigue trabajando" }));
  ok("las escrituras que NO tocan tandas pasan igual que antes");

  await assertSucceeds(doc("qcAprobado").update({ "entrega.tandas": [T(1)] }));
  await assertSucceeds(doc("contratoFirmado").update({ "entrega.tandas": [T(1)] }));
  ok("con QC aprobado y contrato firmado, la parcial sale");

  // ── Lo que NO debe pasar ───────────────────────────────────────────────
  await assertFails(doc("conTandas").update({ "entrega.tandas": [T(1)] }));
  await assertFails(doc("conTandas").update({ "entrega.tandas": [] }));
  await assertFails(doc("conTandas").update({ entrega: {} }));
  ok("append-only: no se borra una entrega firmada (ni vaciando el objeto)");

  await assertFails(doc("asignada").update({ "entrega.tandas": [T(1)] }));
  await assertFails(doc("entregada").update({ "entrega.tandas": [T(1)] }));
  ok("solo desde COMPLETADO: ni en el banco del técnico ni después de cerrada");

  await assertFails(doc("qcPendiente").update({ "entrega.tandas": [T(1)] }));
  await assertFails(doc("qcRechazado").update({ "entrega.tandas": [T(1)] }));
  ok("el candado de QC vale igual para la entrega parcial");

  await assertFails(doc("contratoSinFirmar").update({ "entrega.tandas": [T(1)] }));
  ok("no salen radios de un contrato sin firmar, ni de a poquitos");

  // El atajo evidente: cerrar la orden Y sumar la tanda en la misma escritura
  // para que el estado resultante ya no sea COMPLETADO.
  await assertFails(doc("ok").update({
    estado_reparacion: "ENTREGADO AL CLIENTE", "entrega.tandas": [T(1), T(2)],
  }));
  ok("no se cuela una tanda escondida en el mismo write que cierra la orden");

  await assertSucceeds(as("administrador").doc("ordenes_de_servicio/conTandas")
    .update({ "entrega.tandas": [] }));
  ok("admin sigue pudiendo corregir a mano");

  await testEnv.cleanup();
  console.log(`\nENTREGA PARCIAL: TODAS LAS REGLAS PASARON (${n} grupos)`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("FALLO:", e && e.message ? e.message : e);
  process.exit(1);
});
