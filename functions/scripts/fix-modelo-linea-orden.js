/**
 * fix-modelo-linea-orden.js — Corrige el MODELO de una línea concreta de una
 * orden de servicio (por serial), dejando `modelo_id` y el texto `modelo` de
 * acuerdo con la fila del catálogo.
 *
 * Existe porque en las órdenes el modelo se guarda DOS veces —el FK
 * (`modelo_id`) y la etiqueta (`modelo`)— y se ven casos donde discrepan: la
 * etiqueta dice una cosa y el FK apunta a otra fila. La siembra del pool cree
 * al FK, así que la unidad nace con el modelo equivocado y el conteo físico lo
 * descubre meses después. El conteo del 2026-08-10 encontró tres
 * (`20919D0750`, `20323A0116`, `20323A0127`).
 *
 * NO toca el pool: para eso está repunta-modelo-lista.js. Cambiar el modelo de
 * una línea existente tampoco dispara movimientos en onOrdenWritePool — ese
 * trigger solo reacciona a seriales AGREGADOS o QUITADOS de la orden, y este
 * script no altera el serial.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-modelo-linea-orden.js <ordenId> <serial> <modelo_id> [--write]
 * Idempotente.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ORDEN_ID  = process.argv[2];
const SERIAL    = process.argv[3];
const MODELO_ID = process.argv[4];
const dryRun    = !process.argv.includes("--write");
const EMAIL     = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:fix-modelo-linea-orden";

(async () => {
  if (!ORDEN_ID || !SERIAL || !MODELO_ID) {
    throw new Error("USAGE: <ordenId> <serial> <modelo_id> [--write]");
  }

  const ms = await db.collection("modelos").doc(MODELO_ID).get();
  if (!ms.exists) throw new Error(`El modelo ${MODELO_ID} no existe en el catálogo`);
  const mv = ms.data();
  // La etiqueta de las líneas de orden va SIN marca (así la escribe la captura:
  // "PD686-R", no "HYTERA PD686-R"); el label con marca vive en el pool.
  const LABEL = (mv.modelo || "").toString().trim();
  console.log(`Destino: ${LABEL} (${MODELO_ID})`);

  const ref  = db.collection("ordenes_de_servicio").doc(ORDEN_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`La orden ${ORDEN_ID} no existe`);
  const o = snap.data();

  const norm = pool.normSerial(SERIAL);
  const equipos = (o.equipos || []).map((e) => ({ ...e }));
  let tocadas = 0, yaOk = 0;
  for (const e of equipos) {
    const s = pool.normSerial(e.numero_de_serie || e.serial || "");
    if (s !== norm) continue;
    if (e.modelo_id === MODELO_ID && (e.modelo || "").trim() === LABEL) { yaOk++; continue; }
    console.log(`  ${s}: ${e.modelo || "(sin)"} (${e.modelo_id || "-"})  →  ${LABEL} (${MODELO_ID})`);
    e.modelo_id = MODELO_ID;
    e.modelo = LABEL;
    tocadas++;
  }

  if (!tocadas && !yaOk) throw new Error(`El serial ${SERIAL} no aparece en la orden ${ORDEN_ID}`);
  console.log(`\n=== ${tocadas} línea(s) a corregir · ${yaOk} ya estaban bien ===`);

  if (!tocadas) { console.log("Nada que hacer."); process.exit(0); }
  if (dryRun) { console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***"); process.exit(0); }

  await ref.update({
    equipos,
    actualizado_en: admin.firestore.FieldValue.serverTimestamp(),
    actualizado_por_email: EMAIL,
  });
  console.log("\n*** APLICADO ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
