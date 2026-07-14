/**
 * dry-run-seed-pool.js — corre la acción seedPoolEquipos de runBackfill en
 * local (ADC), por defecto en dry-run. Misma lógica que el callable.
 *
 * USAGE (desde functions/):
 *   node scripts/dry-run-seed-pool.js            # dry-run (no escribe)
 *   node scripts/dry-run-seed-pool.js --write    # ejecuta de verdad
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });

const { backfillSeedPoolEquipos } = require("../src/callable/runBackfill");

const dryRun = !process.argv.includes("--write");
console.log(`seedPoolEquipos — ${dryRun ? "DRY-RUN (no escribe)" : "ESCRITURA REAL"}`);

backfillSeedPoolEquipos(dryRun)
  .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error("ERROR:", e); process.exit(1); });
