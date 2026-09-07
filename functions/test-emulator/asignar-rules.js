// Reglas de Firestore contra el emulador para Almacén · Asignar (2026-09-07).
// Replica EXACTAMENTE las escrituras que hace la pestaña con el rol
// `inventario` (js/pages/almacen-asignar.js + contratosService.saveSerialesManual
// + gestionesService) y comprueba que firestore.rules las acepta — y que
// los roles que no deben, no pueden.
// Corre con:
//   firebase emulators:exec --only firestore --project demo-rules-test "node functions/test-emulator/asignar-rules.js"
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { serverTimestamp, writeBatch, doc, collection, addDoc, setDoc, updateDoc, getDoc, getDocs, query, where } = require("firebase/firestore");

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const r of ["administrador", "inventario", "vendedor", "recepcion", "tecnico"]) await setDoc(doc(db, `usuarios/${r}`), { rol: r, email: `${r}@test` });
    await setDoc(doc(db, "contratos/c1"), { contrato_id: "CT-1", cliente_id: "cli-1", cliente_nombre: "CLIENTE", estado: "aprobado",
      seriales_estado: "pendiente", firma_codigo: "ABC12", equipos: [{ modelo: "PNC360S", modelo_id: "m1", cantidad: 2 }] });
    await setDoc(doc(db, "contratos/c1/seriales/viejo"), { serial: "VIEJO1", modelo: "PNC360S", modelo_id: "m1", contrato_doc_id: "c1" });
    await setDoc(doc(db, "contratos/c2"), { contrato_id: "CT-2", cliente_id: "cli-1", estado: "activo", seriales_estado: "asignados", seriales_cambio_pendiente: true });
    await setDoc(doc(db, "contratos/c2/seriales_cambios/req1"), { estado: "pendiente", items: [{ serial: "A1" }], solicitado_at: new Date() });
    await setDoc(doc(db, "equipos_pool/23905A0401"), { serial: "23905A0401", serial_norm: "23905A0401", modelo_id: "m1", modelo_label: "PNC360S", estado: "en_bodega" });
    await setDoc(doc(db, "gestiones/g1"), { tipo: "aumento", estado: "pendiente_bodega", cliente_id: "cli-3", cliente_nombre: "GT", deleted: false,
      aumento: { contrato_id: "CT-9", lineas: [{ modelo: "HP786", modelo_id: "m2", cantidad: 2 }], seriales_asignados: [] }, cierre: {} });
    await setDoc(doc(db, "gestiones/g2"), { tipo: "reemplazo", estado: "pendiente_bodega", cliente_id: "cli-3", deleted: false,
      items: [{ serial_saliente: "S1", modelo: "HP786", serial_nuevo: null }], cierre: {} });
    await setDoc(doc(db, "gestiones/g3"), { tipo: "demo", estado: "pendiente_bodega", cliente_id: "cli-3", deleted: false,
      demo: { lineas: [{ modelo: "HP786", modelo_id: "m2", cantidad: 1 }], seriales_asignados: [] }, cierre: {} });
  });

  const as = (rol) => testEnv.authenticatedContext(rol).firestore();
  let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };
  const inv = as("inventario");
  const TS = serverTimestamp();
  const meta = { contrato_doc_id: "c1", contrato_id: "CT-1", cliente_id: "cli-1", cliente_nombre: "CLIENTE", source: "manual", updated_at: TS, updated_by: "inventario" };

  // ── Lecturas de la cola y del trabajo ─────────────────────────────────
  await assertSucceeds(getDocs(query(collection(inv, "contratos"), where("seriales_estado", "==", "pendiente"), where("estado", "in", ["aprobado", "activo"]))));
  await assertSucceeds(getDocs(query(collection(inv, "gestiones"), where("estado", "in", ["pendiente_firma", "pendiente_bodega", "en_proceso"]))));
  await assertSucceeds(getDocs(query(collection(inv, "equipos_pool"), where("estado", "==", "en_bodega"))));
  await assertSucceeds(getDocs(query(collection(inv, "equipos_pool"), where("serial_norm", "==", "23905A0401"))));
  await assertSucceeds(getDoc(doc(inv, "contratos/c1")));
  await assertSucceeds(getDocs(collection(inv, "contratos/c1/seriales")));
  await assertSucceeds(getDoc(doc(inv, "contratos/c1/seriales_estado/current")));
  await assertSucceeds(getDocs(query(collection(inv, "contratos/c2/seriales_cambios"), where("estado", "==", "pendiente"))));
  ok("inventario lee la cola (contratos, gestiones), el pool y las subcolecciones de seriales");

  // ── Guardar avance / Listo para programar (saveSerialesManual + seriales_estado) ──
  {
    const b = writeBatch(inv);
    b.set(doc(inv, "contratos/c1/seriales/viejo"), { serial: "VIEJO1", modelo: "PNC360S", modelo_id: "m1", ...meta }, { merge: true });
    b.set(doc(collection(inv, "contratos/c1/seriales")), { serial: "23905A0401", modelo: "PNC360S", modelo_id: "m1", ...meta, created_at: TS, created_by: "inventario" });
    b.set(doc(collection(inv, "contratos/c1/seriales_historial")), { at: TS, por: "inventario", estado: "pendiente", contrato_id: "CT-1", cliente_id: "cli-1", cliente_nombre: "CLIENTE",
      agregados: [{ serial: "23905A0401", modelo: "PNC360S" }], eliminados: [] });
    await assertSucceeds(b.commit());
  }
  ok("inventario: batch de contratos/c1/seriales (alta + merge) + seriales_historial");
  await assertSucceeds(setDoc(doc(inv, "contratos/c1/seriales_estado/current"), { estado: "pendiente", omisiones: [{ modelo: "PNC360S", modelo_id: "m1", motivo: "sin stock" }], por: "inventario", at: TS }, { merge: true }));
  await assertSucceeds(setDoc(doc(inv, "contratos/c1/seriales_estado/current"), { estado: "asignados", omisiones: [], por: "inventario", at: TS }, { merge: true }));
  ok("inventario: seriales_estado/current pendiente → asignados");
  {
    const b = writeBatch(inv);
    b.delete(doc(inv, "contratos/c1/seriales/viejo"));
    await assertSucceeds(b.commit());
  }
  ok("inventario: reconciliación borra el serial que salió del set");
  // Excepción de modelo → doc propio en seriales_historial (tipo + nota).
  await assertSucceeds(addDoc(collection(inv, "contratos/c1/seriales_historial"), { at: TS, por: "inventario", por_email: "inventario@test",
    tipo: "excepcion_modelo", nota: "el contrato dice HP786 pero el cliente pidió PNC460", seriales: ["23905A0441"],
    contrato_id: "CT-1", cliente_id: "cli-1", cliente_nombre: "CLIENTE", agregados: [], eliminados: [] }));
  ok("inventario: la excepción de modelo se registra en seriales_historial");
  // La página NUNCA toca el doc del contrato, y desde 2026-09-07 las reglas
  // tampoco lo dejan: el circuito de seriales del contrato es de los triggers
  // (touchesCFOwnedFields). Antes cualquier autenticado podía marcarlo
  // "asignados" por la puerta de atrás.
  for (const campo of ["seriales_estado", "seriales_count", "seriales_cambio_pendiente", "seriales_asignados_at"]) {
    await assertFails(updateDoc(doc(inv, "contratos/c1"), { [campo]: "x" }));
    await assertFails(updateDoc(doc(as("administrador"), "contratos/c1"), { [campo]: "x" }));
  }
  ok("nadie (ni admin) escribe el circuito de seriales del doc del contrato: es de los triggers");
  // Otros campos del contrato siguen editables por quien corresponde.
  await assertSucceeds(updateDoc(doc(as("recepcion"), "contratos/c1"), { observaciones: "ok" }));
  ok("los demás campos del contrato siguen editables");

  // ── Cambio de serial: resolver la solicitud ────────────────────────────
  await assertSucceeds(setDoc(doc(inv, "contratos/c2/seriales_cambios/req1"), { estado: "resuelto", resuelto_por: "inventario", resuelto_at: TS,
    reemplazos: [{ anterior: "A1", nuevo: "A2", modelo: "PNC360S" }] }, { merge: true }));
  ok("inventario: marca la solicitud de cambio como resuelta");

  // ── Gestiones: aumento / reemplazo / demo + bitácora ──────────────────
  await assertSucceeds(updateDoc(doc(inv, "gestiones/g1"), { "aumento.seriales_asignados": [{ serial: "HP7860001", pool_doc_id: "HP7860001", modelo: "HP786", modelo_id: "m2" }] }));
  await assertSucceeds(updateDoc(doc(inv, "gestiones/g2"), { items: [{ serial_saliente: "S1", modelo: "HP786", serial_nuevo: "HP7860001", pool_doc_id_nuevo: "HP7860001", asignado_at: new Date().toISOString() }] }));
  await assertSucceeds(updateDoc(doc(inv, "gestiones/g3"), { "demo.seriales_asignados": [{ serial: "HP7860001", pool_doc_id: "HP7860001", modelo: "HP786", modelo_id: "m2" }] }));
  await assertSucceeds(addDoc(collection(inv, "gestiones/g1/eventos"), { accion: "asignar", detalle: "Bodega asignó al aumento: HP7860001", at: TS, por_uid: "inventario", por_email: "inventario@test" }));
  await assertSucceeds(addDoc(collection(inv, "gestiones/g1/eventos"), { accion: "asignar", detalle: "Excepción de modelo (23905A0441): motivo", at: TS, por_uid: "inventario", por_email: "inventario@test" }));
  ok("inventario: asigna aumento, reemplazo y demo, y escribe la bitácora");
  await assertFails(updateDoc(doc(inv, "gestiones/g1"), { estado: "en_proceso" }));
  ok("inventario NO puede avanzar el estado de la gestión (lo hace el trigger)");

  // ── Quién más puede y quién no ────────────────────────────────────────
  await assertSucceeds(setDoc(doc(as("recepcion"), "contratos/c1/seriales_estado/current"), { estado: "pendiente", por: "recepcion", at: TS }, { merge: true }));
  await assertSucceeds(setDoc(doc(as("vendedor"), "contratos/c1/seriales/v1"), { serial: "V1", modelo: "PNC360S", ...meta }));
  ok("recepción y vendedor siguen pudiendo registrar seriales (contratos/seriales.html)");
  await assertFails(updateDoc(doc(as("vendedor"), "gestiones/g1"), { "aumento.seriales_asignados": [] }));
  await assertFails(updateDoc(doc(as("recepcion"), "gestiones/g3"), { "demo.seriales_asignados": [] }));
  await assertFails(setDoc(doc(as("tecnico"), "contratos/c1/seriales/t1"), { serial: "T1" }));
  ok("vendedor/recepción NO asignan gestiones; técnico NO registra seriales");

  await testEnv.cleanup();
  console.log(`\nOK — ${n} comprobaciones de reglas para Almacén · Asignar`);
}

main().catch((e) => { console.error("FALLO:", e.message || e); process.exit(1); });
