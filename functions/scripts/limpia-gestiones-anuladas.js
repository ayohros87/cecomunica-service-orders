/**
 * limpia-gestiones-anuladas.js — Aplica la limpieza de anulación (la misma
 * del trigger, lib/gestiones.limpiarAnulacion) a las gestiones YA anuladas
 * antes de que existiera (caso P223344, 2026-08-27). Idempotente.
 *
 * USAGE (desde functions/):
 *   node scripts/limpia-gestiones-anuladas.js            # dry-run (lista)
 *   node scripts/limpia-gestiones-anuladas.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const G = require("../src/lib/gestiones");

const dryRun = !process.argv.includes("--write");

(async () => {
  const snap = await db.collection("gestiones").where("estado", "==", "anulada").get();
  console.log(`\n=== limpia-gestiones-anuladas ${dryRun ? "(DRY-RUN)" : "(WRITE)"} ===`);
  console.log(`Gestiones anuladas: ${snap.size}`);
  for (const d of snap.docs) {
    const g = d.data();
    console.log(`\n· ${d.id} (${g.tipo}, ${g.cliente_nombre || "?"}) — ordenes=${JSON.stringify(g.ordenes || {})}`);
    if (dryRun) continue;
    const acciones = await G.limpiarAnulacion(d.id, g);
    acciones.forEach((a) => console.log(`   ✓ ${a}`));
    if (!acciones.length) console.log("   (sin efectos que revertir)");
  }
  if (dryRun) console.log(`\nDry-run: nada escrito. --write para aplicar.`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
