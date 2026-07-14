/**
 * backfill-search-tokens.js
 *
 * Populates the `searchTokens` array on existing `ordenes_de_servicio`
 * documents. Once this runs, new orders get tokens automatically via
 * the `onOrdenWriteSearchTokens` Cloud Function trigger.
 *
 * PURPOSE:
 *   The frontend's OrdenesService.searchOrders is migrating from a
 *   full-collection scan to a `where('searchTokens', 'array-contains-
 *   any', ...)` indexed query. Without tokens, existing orders are
 *   invisible to the new query path. Run this once after deploying
 *   the trigger.
 *
 *   See ORDENES_INDEX_IMPROVEMENTS.md §1.1 for context.
 *
 * USAGE (from the `functions/` directory):
 *   node backfill-search-tokens.js --dry-run    # preview, no writes
 *   node backfill-search-tokens.js              # actually write
 *
 * SAFETY:
 *   - Skips orders whose computed tokens already match what's stored
 *     (idempotent — safe to re-run).
 *   - Soft-deleted orders (`eliminado === true`) are skipped: stale
 *     tokens on a deleted doc cost nothing and avoid a needless write.
 *   - Batches at 400 ops to stay well under Firestore's 500-op limit.
 *
 * AFTER RUNNING:
 *   - The trigger maintains tokens automatically; this script is
 *     a one-shot. Re-running is a no-op (idempotent check).
 */

const admin = require("firebase-admin");
const { buildOrderSearchTokens, tokensEqual } = require("../src/lib/searchTokens");

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 400;
const LOG_EVERY = 100;

admin.initializeApp();
const db = admin.firestore();

async function run() {
  console.log(`[backfill-search-tokens] DRY_RUN=${DRY_RUN}`);
  const startedAt = Date.now();

  const snapshot = await db.collection("ordenes_de_servicio").get();
  console.log(`[backfill-search-tokens] scanning ${snapshot.size} orders`);

  let scanned = 0;
  let skippedDeleted = 0;
  let skippedUnchanged = 0;
  let toWrite = 0;
  let written = 0;
  let errors = 0;

  let batch = db.batch();
  let opsInBatch = 0;

  const flushBatch = async () => {
    if (opsInBatch === 0) return;
    if (DRY_RUN) {
      console.log(`[backfill-search-tokens] DRY_RUN: would commit ${opsInBatch} updates`);
      written += opsInBatch;
      batch = db.batch();
      opsInBatch = 0;
      return;
    }
    try {
      await batch.commit();
      written += opsInBatch;
    } catch (err) {
      console.error(`[backfill-search-tokens] batch commit failed: ${err.message}`);
      errors += opsInBatch;
    }
    batch = db.batch();
    opsInBatch = 0;
  };

  for (const doc of snapshot.docs) {
    scanned++;
    if (scanned % LOG_EVERY === 0) {
      console.log(`[backfill-search-tokens] progress: scanned=${scanned} toWrite=${toWrite} skippedUnchanged=${skippedUnchanged}`);
    }

    const data = doc.data();
    if (data.eliminado === true) {
      skippedDeleted++;
      continue;
    }

    const newTokens = buildOrderSearchTokens(doc.id, data);
    const currentTokens = Array.isArray(data.searchTokens) ? data.searchTokens : [];

    if (tokensEqual(newTokens, currentTokens)) {
      skippedUnchanged++;
      continue;
    }

    toWrite++;
    batch.update(doc.ref, { searchTokens: newTokens });
    opsInBatch++;
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("──────────────────────────────────────────");
  console.log(`[backfill-search-tokens] DONE in ${elapsed}s`);
  console.log(`  scanned          : ${scanned}`);
  console.log(`  skipped deleted  : ${skippedDeleted}`);
  console.log(`  skipped unchanged: ${skippedUnchanged}`);
  console.log(`  needed update    : ${toWrite}`);
  console.log(`  written          : ${written}`);
  if (errors) console.log(`  ERRORS           : ${errors}`);
  console.log(DRY_RUN ? "  mode: DRY-RUN (no writes performed)" : "  mode: APPLIED");
  console.log("──────────────────────────────────────────");
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[backfill-search-tokens] FATAL", err);
    process.exit(1);
  });
