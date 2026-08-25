/**
 * fix-gran-terminal-serial-contrato.js — Paso 2 del saneo GRAN TERMINAL
 * (2026-08-25, sigue a fix-gran-terminal-devolucion.js).
 *
 * Retira el serial 24220A2357 (radio dañado, ya reemplazado por 22806A0313 vía
 * REEMP20260806-01) de la subcolección de seriales del alquiler vigente
 * ALQ20250925-03, para que el contrato refleje los 19 que el cliente tiene.
 *
 * onSerialWrite hace el resto: recuenta seriales_count (20→19) y, como la
 * unidad está en_taller (ENTRADA 2026081116 abierta), NO la manda a bodega —
 * solo suelta la asignación (rama desasignarContrato, con kardex). Se deja
 * registro en seriales_historial con el mismo shape que la UI
 * (contratosService.saveSerialesManual).
 *
 * USAGE (desde functions/): node scripts/fix-gran-terminal-serial-contrato.js [--apply]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const CONTRATO_DOC = "Vf3ppNGjUbYahtVLUEVg"; // ALQ20250925-03
const SERIAL = "24220A2357";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  console.log(APPLY ? "== MODO APPLY ==" : "== DRY-RUN (nada se escribe; --apply para aplicar) ==");

  // ── Guard ──────────────────────────────────────────────────────────────
  const con = await db.collection("contratos").doc(CONTRATO_DOC).get();
  const c = con.data();
  if (!c || c.contrato_id !== "ALQ20250925-03") throw new Error("El contrato no es ALQ20250925-03");
  if (c.estado !== "activo") throw new Error(`El contrato está '${c.estado}', se esperaba activo`);

  const filas = await db.collection("contratos").doc(CONTRATO_DOC).collection("seriales").get();
  const objetivo = filas.docs.filter((d) => norm(d.data().serial) === norm(SERIAL));
  if (objetivo.length !== 1) throw new Error(`Se esperaba 1 fila con el serial ${SERIAL} y hay ${objetivo.length}`);
  const fila = objetivo[0];

  const u = (await db.collection("equipos_pool").doc(SERIAL).get()).data();
  if (!u) throw new Error(`${SERIAL} no existe en el pool`);
  if (u.estado !== "en_taller") throw new Error(`${SERIAL} está '${u.estado}', se esperaba en_taller`);
  if (u.asignacion?.contrato_doc_id !== CONTRATO_DOC) {
    throw new Error(`${SERIAL} está asignado a '${u.asignacion?.contrato_id || "—"}', se esperaba ALQ20250925-03`);
  }

  console.log(`Guard OK: contrato activo con ${filas.size} filas de seriales · fila objetivo ${fila.id} · unidad en_taller asignada al contrato`);

  if (!APPLY) {
    console.log("\nDRY-RUN — acciones que haría:");
    console.log(`  DELETE contratos/${CONTRATO_DOC}/seriales/${fila.id} (${SERIAL})`);
    console.log("  CREATE seriales_historial (eliminados: [" + SERIAL + "])");
    console.log("  → onSerialWrite recuenta a 19 y suelta la asignación de la ficha (queda en_taller)");
    process.exit(0);
  }

  // ── Aplicar: borrar la fila + historial en un batch ────────────────────
  const batch = db.batch();
  batch.delete(fila.ref);
  batch.set(db.collection("contratos").doc(CONTRATO_DOC).collection("seriales_historial").doc(), {
    at: admin.firestore.FieldValue.serverTimestamp(),
    por: "saneo:fix-gran-terminal-serial-contrato",
    estado: c.seriales_estado || null,
    contrato_id: c.contrato_id,
    cliente_id: c.cliente_id || "",
    cliente_nombre: c.cliente_nombre || "",
    agregados: [],
    eliminados: [fila.data()],
    nota: "Saneo 2026-08-25: radio dañado reemplazado por 22806A0313 (REEMP20260806-01); ya entró a taller vía ENTRADA 2026081116.",
  });
  await batch.commit();
  console.log(`Fila ${fila.id} borrada + historial registrado.`);

  // ── Verificación ───────────────────────────────────────────────────────
  console.log("Esperando a que onSerialWrite asiente (25s)...");
  await dormir(25000);
  const cFin = (await db.collection("contratos").doc(CONTRATO_DOC).get()).data();
  const uFin = (await db.collection("equipos_pool").doc(SERIAL).get()).data();
  console.log(`Final: seriales_count=${cFin.seriales_count} · ${SERIAL}: estado=${uFin.estado} asignacion=${uFin.asignacion ? (uFin.asignacion.contrato_id || "?") : "(liberada)"} pend_dev=${!!uFin.pendiente_devolucion}`);
  if (cFin.seriales_count !== 19) console.log("OJO: seriales_count no quedó en 19 — revisar logs de onSerialWrite.");
  if (uFin.asignacion) console.log("OJO: la asignación no se liberó — revisar logs de onSerialWrite (desasignarContrato).");
  console.log("Listo.");
  process.exit(0);
})().catch((e) => { console.error("ABORTADO:", e.message); process.exit(1); });
