const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

/**
 * purgePIIRetention — scheduled CF that purges customer ID photos
 * older than RETENTION_DAYS days. Closes the PII retention gap in
 * ORDENES_INDEX_IMPROVEMENTS.md §3a.3.
 *
 * Scope:
 *   - Storage paths: `ordenes_identificacion/` (current) and
 *     `entregas_identificacion/` (legacy from firmar-entrega.html).
 *   - Signatures in `ordenes_firmas/` are intentionally NOT purged —
 *     they're legal-adjacent evidence of delivery.
 *
 * For each old file:
 *   1. Parse the ordenId from the filename (e.g. `ABC-001_id_…ext`).
 *   2. Delete the Storage object.
 *   3. Clear `identificacion_url` on the order doc and stamp
 *      `identificacion_purged_at` so the audit trail records the purge.
 *
 * Cost: GCS object listing is ~$0.04 per 10k operations. Running once
 * a day with <10k objects in the namespace is ~free.
 *
 * Retention is hardcoded for now; bump RETENTION_DAYS as the policy
 * evolves. A future iteration can read from `empresa/pii_retention`
 * if the value needs to vary per customer or per region.
 */
const RETENTION_DAYS = 90;
const PII_PREFIXES = ["ordenes_identificacion/", "entregas_identificacion/"];

/**
 * Parse the order ID from a file name following either of:
 *   - ordenes_identificacion/{ordenId}_id_{ts}.{ext}
 *   - entregas_identificacion/{ordenId}_{ts}.{ext}
 * @param {string} fullPath
 * @returns {string|null}
 */
function _parseOrdenId(fullPath) {
  const filename = fullPath.split("/").pop() || "";
  // "_id_" appears only in the current path; legacy uses a single "_".
  if (filename.includes("_id_")) {
    return filename.split("_id_")[0] || null;
  }
  // Legacy: split off the trailing _<ts>.<ext>
  const m = filename.match(/^(.+?)_\d+\.[^.]+$/);
  return m ? m[1] : null;
}

module.exports = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "America/Panama",
    region: "us-central1",
  },
  async () => {
    const bucket = admin.storage().bucket();
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoffISO = new Date(cutoffMs).toISOString();

    let scanned = 0;
    let deleted = 0;
    let docsCleared = 0;
    let errors = 0;

    for (const prefix of PII_PREFIXES) {
      const [files] = await bucket.getFiles({ prefix });
      for (const file of files) {
        scanned++;
        try {
          // metadata.timeCreated is set by GCS at upload time and is
          // immutable — exactly the right field for retention age.
          const [meta] = await file.getMetadata();
          const created = meta?.timeCreated;
          if (!created) continue;
          if (new Date(created).getTime() >= cutoffMs) continue;

          const ordenId = _parseOrdenId(file.name);

          await file.delete();
          deleted++;

          if (ordenId) {
            try {
              await db.collection("ordenes_de_servicio").doc(ordenId).update({
                identificacion_url: null,
                identificacion_purged_at: admin.firestore.FieldValue.serverTimestamp(),
                identificacion_retention_days: RETENTION_DAYS,
              });
              docsCleared++;
            } catch (docErr) {
              logger.warn("[purgePIIRetention] failed to clear order doc", {
                ordenId,
                file: file.name,
                err: docErr?.message,
              });
            }
          }

          logger.info("[purgePIIRetention] purged", {
            file: file.name,
            ordenId,
            created,
          });
        } catch (err) {
          errors++;
          logger.warn("[purgePIIRetention] failed for file", {
            file: file.name,
            err: err?.message,
          });
        }
      }
    }

    logger.info("[purgePIIRetention] DONE", {
      retentionDays: RETENTION_DAYS,
      cutoff: cutoffISO,
      scanned,
      deleted,
      docsCleared,
      errors,
    });
  }
);
