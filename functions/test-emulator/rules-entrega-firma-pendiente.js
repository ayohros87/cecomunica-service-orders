// Entrega con la firma del CONTRATO pendiente — prueba aislada del candado.
//
// Corre con:
//   firebase emulators:exec --only firestore "node functions/test-emulator/rules-entrega-firma-pendiente.js"
//
// Pedido de Brenda (2026-11-11): recepción puede entregar con el contrato sin
// firmar, dejando la firma digital de quien recibe, si el MISMO write declara
// la excepción (`entrega_contrato_sin_firma.contrato_doc_id`).
//
// Por qué aislada (igual que rules-entrega-parcial.js): el match de
// ordenes_de_servicio llega al tope de 1000 expresiones en los caminos de
// DENEGACIÓN, así que un assertFails contra el ruleset completo no prueba el
// candado. Aquí se evalúa el MISMO texto de `contratoFirmadoParaEntregar()`
// con un `allow update` recortado a esa función. Que la entrega legítima
// termina de evaluarse con el ruleset completo lo prueba rules.js.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");
const RULES_AISLADAS = RULES.replace(
  /allow update: if isSignedIn\(\)\s*\n\s*&& userRole\(\) in \["administrador","vendedor","recepcion","tecnico","tecnico_operativo","jefe_taller"\]\s*\n\s*&& \(isAdmin\(\) \|\| \(ordenTransicionLegal\(\)[\s\S]*?&& entregaTandasOk\(\) && eliminadoOk\(\)\)\);/,
  "allow update: if isSignedIn() && (isAdmin() || contratoFirmadoParaEntregar());"
);
if (RULES_AISLADAS === RULES) {
  console.error("FALLO: no se pudo recortar el allow update de ordenes_de_servicio (¿cambió el formato?).");
  process.exit(1);
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-entrega-firma-pendiente",
    firestore: { rules: RULES_AISLADAS, host: "127.0.0.1", port: 8080 },
  });
  await testEnv.clearFirestore();

  const N = 12;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const r of ["recepcion", "vendedor", "tecnico", "jefe_taller", "administrador"]) {
      await db.doc(`usuarios/${r}`).set({ rol: r });
    }
    await db.doc("contratos/sinFirmar").set({ estado: "aprobado", codigo_tipo: "SERV", contrato_id: "SERV-1" });
    await db.doc("contratos/otroSinFirmar").set({ estado: "aprobado", codigo_tipo: "SERV", contrato_id: "SERV-2" });
    await db.doc("contratos/firmado").set({ estado: "activo", firmado: true, codigo_tipo: "SERV", contrato_id: "SERV-3" });
    const base = { estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "PROGRAMACIÓN",
      contrato: { aplica: true, contrato_doc_id: "sinFirmar" } };
    for (let i = 0; i < N; i++) await db.doc(`ordenes_de_servicio/o${i}`).set(base);
    await db.doc("ordenes_de_servicio/oFirmado").set({ ...base, contrato: { aplica: true, contrato_doc_id: "firmado" } });
  });

  const as = (rol) => testEnv.authenticatedContext(rol).firestore();
  const o = (rol, id) => as(rol).doc("ordenes_de_servicio/" + id);
  const ENTREGADO = { estado_reparacion: "ENTREGADO AL CLIENTE" };
  const marca = (cid) => ({ entrega_contrato_sin_firma: { contrato_doc_id: cid, via: "recepcion" } });
  let n = 0;
  const ok = (m) => { n++; console.log("  PASS", m); };

  // ── El candado sigue donde estaba ──────────────────────────────────────
  await assertFails(o("recepcion", "o0").set(ENTREGADO, { merge: true }));
  ok("sin declarar la excepción, el contrato sin firmar NO se entrega (candado de siempre)");
  await assertSucceeds(o("recepcion", "oFirmado").set(ENTREGADO, { merge: true }));
  ok("el contrato firmado se entrega sin marca alguna");

  // ── La excepción ───────────────────────────────────────────────────────
  await assertSucceeds(o("recepcion", "o1").set({ ...ENTREGADO, ...marca("sinFirmar") }, { merge: true }));
  ok("recepción entrega declarando la excepción para ESE contrato");

  await assertFails(o("recepcion", "o2").set({ ...ENTREGADO, ...marca("otroSinFirmar") }, { merge: true }));
  await assertFails(o("recepcion", "o3").set({ ...ENTREGADO, ...marca("") }, { merge: true }));
  await assertFails(o("recepcion", "o4").set({ ...ENTREGADO, entrega_contrato_sin_firma: true }, { merge: true }));
  ok("la marca tiene que nombrar el contrato de la orden: ni otro, ni vacío, ni un booleano");

  for (const rol of ["vendedor", "tecnico", "jefe_taller"]) {
    await assertFails(o(rol, "o5").set({ ...ENTREGADO, ...marca("sinFirmar") }, { merge: true }));
  }
  ok("solo recepción: vendedor, técnico y jefa de taller no usan la excepción");

  // La marca sola no es una entrega: tiene que ir en el write que ENTREGA.
  // (Sirve también para la entrega parcial, que comparte esta función: una
  // tanda deja la orden en COMPLETADO y por eso la excepción no la alcanza.)
  await assertFails(o("recepcion", "o6").set(marca("sinFirmar"), { merge: true }));
  await assertFails(o("recepcion", "o7").set({ ...marca("sinFirmar"), entrega: { tandas: [{ n: 1 }] } }, { merge: true }));
  ok("la marca sin la transición a ENTREGADO no abre nada (ni una entrega parcial)");

  await assertSucceeds(o("administrador", "o8").set(ENTREGADO, { merge: true }));
  ok("admin sigue exento (override de siempre)");

  await testEnv.cleanup();
  console.log(`\nENTREGA CON FIRMA PENDIENTE: TODAS LAS REGLAS PASARON (${n} grupos)`);
}

main().catch((e) => { console.error("FALLO:", e.message || e); process.exit(1); });
