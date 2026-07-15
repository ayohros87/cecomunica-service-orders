/**
 * fix-condicion-modelo.js — Corrige la CONDICIÓN (nuevo/reuso) de las unidades
 * del pool creadas por migración: la siembra las marcó todas 'reuso' a ciegas.
 * La condición real viene de la variante del modelo:
 *   1. modelo_id en el catálogo → estado de la fila ('R' → reuso, 'N' → nuevo)
 *   2. sin FK → convención del label: sufijo -R → reuso, si no → nuevo
 * Solo toca docs de origen migracion_* (lo capturado a mano en bodega respeta
 * lo que eligió el humano). Idempotente.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-condicion-modelo.js            # dry-run
 *   node scripts/fix-condicion-modelo.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const ORIGENES = ["migracion_contrato", "migracion_poc", "migracion_orden"];

(async () => {
  const [poolSnap, modelosSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("modelos").get(),
  ]);
  const estadoModelo = new Map(); // modelo_id → 'N' | 'R'
  modelosSnap.forEach((d) => estadoModelo.set(d.id, (d.data().estado || "").toUpperCase()));

  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  const r = { revisados: poolSnap.size, noMigracion: 0, aNuevo: 0, aReuso: 0, sinCambio: 0 };
  for (const doc of poolSnap.docs) {
    const v = doc.data();
    if (!ORIGENES.includes(v.origen)) { r.noMigracion++; continue; }

    let condicion;
    const est = v.modelo_id ? estadoModelo.get(v.modelo_id) : null;
    if (est === "R") condicion = "reuso";
    else if (est === "N") condicion = "nuevo";
    else condicion = /[\s-]r$/i.test((v.modelo_label || "").trim()) ? "reuso" : "nuevo";

    if ((v.condicion || "") === condicion) { r.sinCambio++; continue; }
    if (condicion === "nuevo") r.aNuevo++; else r.aReuso++;
    batch.update(doc.ref, { condicion, updated_at: admin.firestore.FieldValue.serverTimestamp() });
    ops++;
    if (ops >= 400) await flush();
  }
  await flush();

  console.log(`fix-condicion-modelo — ${dryRun ? "DRY-RUN" : "ESCRITURA REAL"}`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
