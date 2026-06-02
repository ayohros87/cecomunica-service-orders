const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

/**
 * purgePIIRetention — manual callable CF that purges customer ID photos
 * older than RETENTION_DAYS days. Closes the PII retention gap in
 * ORDENES_INDEX_IMPROVEMENTS.md §3a.3.
 *
 * Invocation (manual, admin-only):
 *   firebase functions:shell  → purgePIIRetention({ dryRun: true })
 *   or from a future admin button:
 *     firebase.functions().httpsCallable('purgePIIRetention')({ dryRun: false })
 *
 * The function was originally written as an onSchedule cron. It was
 * converted to onCall on 2026-05-18 so the company can review what
 * would be deleted before any first run, and trigger purges explicitly.
 * To revert to scheduled: replace the onCall wrapper with
 *   onSchedule({ schedule: "every day 03:00", timeZone: "America/Panama",
 *                region: "us-central1" }, async () => { ... })
 * The inner logic is unchanged.
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
  if (filename.includes("_id_")) {
    return filename.split("_id_")[0] || null;
  }
  const m = filename.match(/^(.+?)_\d+\.[^.]+$/);
  return m ? m[1] : null;
}

module.exports = onCall(
  {
    region: "us-central1",
    // Tight memory/timeout — listing + per-file metadata fetch is cheap.
    memory: "256MiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    // Auth: admin only. Reject anonymous and non-admin callers.
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const callerUid = request.auth.uid;
    const userDoc = await db.collection("usuarios").doc(callerUid).get();
    const rol = (userDoc.data() || {}).rol || "";
    if (rol !== "administrador") {
      throw new HttpsError("permission-denied", "Admin role required.");
    }

    const dryRun = !!(request.data && request.data.dryRun);
    const retentionDays = Number(request.data?.retentionDays) > 0
      ? Number(request.data.retentionDays)
      : RETENTION_DAYS;

    // Kill-switch in empresa/config: admin can disable destructive purges
    // without code deploy. Preview (dryRun) is always allowed since it's
    // read-only. Only the actual delete is gated.
    if (!dryRun) {
      const cfgSnap = await db.collection("empresa").doc("config").get();
      const enabled = cfgSnap.exists ? cfgSnap.data().pii_purge_enabled : true;
      if (enabled === false) {
        throw new HttpsError(
          "failed-precondition",
          "Purga PII deshabilitada en empresa/config.pii_purge_enabled. Actívala antes de ejecutar."
        );
      }
    }

    const bucket = admin.storage().bucket();
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const cutoffISO = new Date(cutoffMs).toISOString();

    let scanned = 0;
    let candidates = 0;
    let deleted = 0;
    let docsCleared = 0;
    let errors = 0;
    const sampleCandidates = [];

    for (const prefix of PII_PREFIXES) {
      const [files] = await bucket.getFiles({ prefix });
      for (const file of files) {
        scanned++;
        try {
          const [meta] = await file.getMetadata();
          const created = meta?.timeCreated;
          if (!created) continue;
          if (new Date(created).getTime() >= cutoffMs) continue;

          candidates++;
          const ordenId = _parseOrdenId(file.name);

          if (dryRun) {
            if (sampleCandidates.length < 50) {
              sampleCandidates.push({ file: file.name, ordenId, created });
            }
            continue;
          }

          await file.delete();
          deleted++;

          if (ordenId) {
            try {
              await db.collection("ordenes_de_servicio").doc(ordenId).update({
                identificacion_url: null,
                identificacion_purged_at: admin.firestore.FieldValue.serverTimestamp(),
                identificacion_purged_by: callerUid,
                identificacion_retention_days: retentionDays,
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
            invokedBy: callerUid,
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

    const result = {
      retentionDays,
      cutoff: cutoffISO,
      dryRun,
      scanned,
      candidates,
      deleted,
      docsCleared,
      errors,
      invokedBy: callerUid,
      ...(dryRun ? { sample: sampleCandidates } : {}),
    };

    logger.info("[purgePIIRetention] DONE", result);
    return result;
  }
);
