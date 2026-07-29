/**
 * ajusta-conteo-inventario.js — Fija el conteo físico de una fila del catálogo.
 *
 * Escribe con la misma forma que InventarioService.guardarInventario: conserva
 * la trazabilidad (`penultima_actualizacion`, `cantidad_anterior`) y AGREGA un
 * registro a `ultimo_inventario`, para que la corrección quede en el kardex y
 * no aparezca como si el número siempre hubiera sido ese.
 *
 * USAGE (desde functions/):
 *   node scripts/ajusta-conteo-inventario.js <modelo_id> <cantidad> [--write] [--nota="..."]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const MODELO_ID = process.argv[2];
const CANTIDAD  = Number(process.argv[3]);
const dryRun    = !process.argv.includes("--write");
const NOTA      = (process.argv.find((a) => a.startsWith("--nota=")) || "").slice(7);

(async () => {
  if (!MODELO_ID || !Number.isFinite(CANTIDAD) || CANTIDAD < 0) {
    throw new Error("USAGE: <modelo_id> <cantidad> [--write] [--nota=\"...\"]");
  }
  const m = await db.collection("modelos").doc(MODELO_ID).get();
  if (!m.exists) throw new Error(`El modelo ${MODELO_ID} no existe`);
  const mv = m.data();
  if (mv.activo === false) throw new Error("El modelo está INACTIVO — el conteo quedaría huérfano");
  console.log(`Modelo: ${`${mv.marca || ""} ${mv.modelo || ""}`.trim()} (${MODELO_ID}) · estado ${mv.estado}`);

  const actRef = db.collection("inventario_actual").doc(MODELO_ID);
  const prev = await actRef.get();
  const antes = prev.exists ? prev.data().cantidad : null;
  console.log(`conteo actual: ${antes === null ? "(sin doc)" : antes}  →  ${CANTIDAD}`);
  if (antes === CANTIDAD) { console.log("Ya está en ese valor. Nada que hacer."); process.exit(0); }

  if (!dryRun) {
    const now = admin.firestore.Timestamp.now();
    const batch = db.batch();
    batch.set(db.collection("ultimo_inventario").doc(), {
      modelo_id: MODELO_ID, cantidad: CANTIDAD, timestamp: now,
      ...(NOTA ? { nota: NOTA } : {}),
    });
    batch.set(actRef, {
      modelo_id: MODELO_ID, cantidad: CANTIDAD,
      ultima_actualizacion: now,
      penultima_actualizacion: prev.exists ? (prev.data().ultima_actualizacion ?? null) : null,
      cantidad_anterior: antes,
    });
    await batch.commit();
    console.log("listo: conteo ajustado y registrado en el historial");
  } else {
    console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  }
  process.exit(0);
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
