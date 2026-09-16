// Reglas de Firestore para la gestión CAMBIO DE SERIAL (2026-09-15).
// Replica las escrituras reales de las tres manos que la tocan —quien la abre
// (recepción/vendedor), bodega al confirmar el serial, y quien la corrige o
// anula— y comprueba que firestore.rules las acepta; y que lo que no debe
// pasar, no pasa.
//
// Corre con:
//   firebase emulators:exec --only firestore --project demo-cs-rules \
//     "node functions/test-emulator/cambio-serial-rules.js"
// (o, con un emulador ya levantado, `node` a secas contra el puerto 8080).
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, updateDoc } = require("firebase/firestore");

const BASE = {
  tipo: "cambio_serial", cliente_id: "cli-1", cliente_nombre: "CDP HOLDINGS INC",
  items: [{ serial: "26314A1691", modelo: "HYT-P50", contrato_doc_id: "c1",
    contrato_id: "PROP20260731-03", motivo_codigo: "error_captura", serial_nuevo: null }],
  ordenes: {}, deleted: false,
};

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-cs-rules",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const r of ["administrador", "inventario", "vendedor", "recepcion", "tecnico"]) {
      await setDoc(doc(db, `usuarios/${r}`), { rol: r, email: `${r}@test` });
    }
    // Una gestión ya creada, blanda, para las pruebas de edición.
    await setDoc(doc(db, "gestiones/gc1"), { ...BASE, estado: "pendiente_bodega", cierre: {}, responsable_uid: "vendedor" });
    // Otra ya aplicada: nadie la toca.
    await setDoc(doc(db, "gestiones/gc2"), { ...BASE, estado: "cerrada", cierre: { asignacion: true, derivacion: true } });
  });

  const as = (rol) => testEnv.authenticatedContext(rol).firestore();
  let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

  // ── Crear ──────────────────────────────────────────────────────────────
  await assertSucceeds(setDoc(doc(as("recepcion"), "gestiones/nueva1"), { ...BASE, estado: "pendiente_bodega", cierre: {} }));
  ok("recepción abre una corrección en pendiente_bodega");

  await assertSucceeds(setDoc(doc(as("vendedor"), "gestiones/nueva2"), {
    ...BASE, estado: "pendiente_bodega", cierre: {},
    items: [{ ...BASE.items[0], serial_nuevo: "26314A1687", serial_nuevo_propuesto: true }],
  }));
  ok("el serial real puede venir PROPUESTO por quien la abre");

  await assertFails(setDoc(doc(as("recepcion"), "gestiones/mala1"), { ...BASE, estado: "pendiente_aprobacion", cierre: {} }));
  ok("no nace en otro estado (va directo a bodega, sin aprobación)");

  await assertFails(setDoc(doc(as("recepcion"), "gestiones/mala2"), {
    ...BASE, estado: "pendiente_bodega", cierre: { asignacion: true, derivacion: true },
  }));
  ok("no nace diciendo que ya se aplicó (el cierre lo estampa el trigger)");

  await assertFails(setDoc(doc(as("tecnico"), "gestiones/mala3"), { ...BASE, estado: "pendiente_bodega", cierre: {} }));
  ok("el taller no abre correcciones de serial (solo propone reemplazos)");

  // ── Bodega confirma el serial real ─────────────────────────────────────
  await assertSucceeds(updateDoc(doc(as("inventario"), "gestiones/gc1"), {
    items: [{ ...BASE.items[0], serial_nuevo: "26314A1687", confirmado_por_bodega: true }],
  }));
  ok("bodega escribe el serial confirmado en items");

  await assertFails(updateDoc(doc(as("inventario"), "gestiones/gc1"), { cierre: { asignacion: true, derivacion: true } }));
  ok("bodega NO puede estamparse el cierre por su cuenta");

  await assertFails(updateDoc(doc(as("vendedor"), "gestiones/gc1"), { estado: "cerrada" }));
  ok("nadie cierra la gestión a mano desde el navegador");

  // ── Corregir y anular ──────────────────────────────────────────────────
  await assertSucceeds(updateDoc(doc(as("recepcion"), "gestiones/gc1"), {
    items: [{ ...BASE.items[0], motivo_codigo: "cambiado_mostrador" }],
    contratos_afectados: ["c1"], notas: "ajuste", editada: { por_uid: "recepcion" },
  }));
  ok("se corrige el expediente mientras siga blando");

  await assertSucceeds(updateDoc(doc(as("vendedor"), "gestiones/gc1"), {
    estado: "anulada", anulada_motivo: "duplicada", anulada_por_uid: "vendedor", anulada_at: new Date(),
  }));
  ok("quien la creó la anula mientras siga blanda");

  await assertFails(updateDoc(doc(as("recepcion"), "gestiones/gc2"), { notas: "tarde" }));
  ok("una corrección ya aplicada no se toca");

  await assertFails(doc(as("administrador"), "gestiones/gc1") && updateDoc(doc(as("administrador"), "gestiones/gc1"), { cliente_id: "otro-cliente" }));
  ok("ni siquiera admin le cambia el cliente por la puerta de atrás");

  // ── Bodega corrige seriales ya asignados (2026-09-16) ──────────────────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const dbx = ctx.firestore();
    await setDoc(doc(dbx, "gestiones/gd1"), { tipo: "demo", estado: "en_demo", cliente_id: "cli-1",
      deleted: false, cierre: { asignacion: true, entrega: true },
      demo: { seriales_asignados: [{ serial: "AAA111" }] } });
    await setDoc(doc(dbx, "gestiones/gd2"), { tipo: "demo", estado: "cerrada", cliente_id: "cli-1",
      deleted: false, cierre: { asignacion: true, entrega: true, entrada: true },
      demo: { seriales_asignados: [{ serial: "BBB222" }] } });
  });
  // Cada escritura lleva un valor DISTINTO a propósito: escribir lo mismo deja
  // el diff vacío y `hasOnly([...])` lo acepta en cualquier predicado — la
  // prueba pasaría por una razón que no es la que se está probando.
  const pedido = (n) => ({
    pares: [{ anterior: "AAA111", nuevo: `CCC33${n}`, modelo: "PD606-R", modelo_id: "m1" }],
    por_uid: "inventario", por_email: "inventario@test", at: `2026-09-16T0${n}:00:00.000Z`,
  });

  await assertSucceeds(updateDoc(doc(as("inventario"), "gestiones/gd1"), { correccion_seriales_pendiente: pedido(1) }));
  ok("bodega pide corregir los seriales de una gestión viva");

  await assertSucceeds(updateDoc(doc(as("administrador"), "gestiones/gd1"), { correccion_seriales_pendiente: pedido(2) }));
  ok("administración también");

  await assertFails(updateDoc(doc(as("vendedor"), "gestiones/gd1"), { correccion_seriales_pendiente: pedido(3) }));
  ok("un vendedor no corrige seriales: los declara bodega");

  await assertFails(updateDoc(doc(as("inventario"), "gestiones/gd2"), { correccion_seriales_pendiente: pedido(4) }));
  ok("una gestión CERRADA ya no se corrige");

  await assertFails(updateDoc(doc(as("inventario"), "gestiones/gd1"), {
    correccion_seriales_pendiente: pedido(5),
    demo: { seriales_asignados: [{ serial: "CCC333" }] },
  }));
  ok("bodega deja el pedido, no aplica la corrección ella misma");

  console.log(`\nOK cambio-serial-rules: ${n} comprobaciones`);
  await testEnv.cleanup();
  process.exit(0);
}

main().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
