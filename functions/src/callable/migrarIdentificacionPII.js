const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

/**
 * migrarIdentificacionPII — one-shot, admin-only migration that closes the
 * legacy PII leak for customer-ID photos.
 *
 * Before: the entrega flow stored a tokenized download URL
 * (`identificacion_url`) on the order doc. That URL bypasses Storage rules and
 * is readable by anyone who can read the order doc.
 *
 * This migration, per order that still holds `identificacion_url`:
 *   1. Derives the Storage object path from the URL.
 *   2. Revokes the object's download token (empties
 *      `firebaseStorageDownloadTokens`) so the leaked URL stops working.
 *   3. Rewrites the doc: sets `identificacion_path`, deletes
 *      `identificacion_url`, stamps `identificacion_migrated_at` / `_by`.
 *
 * After this runs, the photo is reachable only via `getIdentificacionUrl`
 * (admin-only, short-lived signed URLs) with `ordenes_identificacion/` and
 * `entregas_identificacion/` locked to `read:false` in storage.rules.
 *
 * Run preview first:  migrarIdentificacionPII({ dryRun: true })
 * Then for real:      migrarIdentificacionPII({ dryRun: false })
 */

function _pathFromDownloadUrl(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 540 },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Sign in required.");
    const userSnap = await db.collection("usuarios").doc(callerUid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userData || userData.rol !== "administrador") {
      throw new HttpsError("permission-denied", "Solo administradores.");
    }

    const dryRun = !!(request.data && request.data.dryRun);
    const bucket = admin.storage().bucket();

    let scanned = 0;
    let migrated = 0;
    let tokensRevoked = 0;
    let missingFile = 0;
    let noPath = 0;
    let errors = 0;
    const sample = [];

    // Orders that still carry a tokenized URL. `!= null` excludes docs where
    // the field is absent or explicitly null (no photo / already migrated).
    const snap = await db.collection("ordenes_de_servicio")
      .where("identificacion_url", "!=", null)
      .get();

    for (const doc of snap.docs) {
      scanned++;
      const ordenId = doc.id;
      const url = doc.data().identificacion_url;
      const path = _pathFromDownloadUrl(url);

      if (!path) {
        noPath++;
        if (sample.length < 50) sample.push({ ordenId, result: "no_path", url });
        continue;
      }

      if (dryRun) {
        if (sample.length < 50) sample.push({ ordenId, path, result: "would_migrate" });
        continue;
      }

      try {
        // Revoke the download token so the leaked URL stops resolving.
        try {
          await bucket.file(path).setMetadata({
            metadata: { firebaseStorageDownloadTokens: "" },
          });
          tokensRevoked++;
        } catch (metaErr) {
          // File may have been purged/moved; still migrate the doc field.
          missingFile++;
          logger.warn("[migrarIdentificacionPII] token revoke failed", {
            ordenId, path, err: metaErr?.message,
          });
        }

        await doc.ref.update({
          identificacion_path: path,
          identificacion_url: admin.firestore.FieldValue.delete(),
          identificacion_migrated_at: admin.firestore.FieldValue.serverTimestamp(),
          identificacion_migrated_by: callerUid,
        });
        migrated++;
      } catch (err) {
        errors++;
        logger.warn("[migrarIdentificacionPII] migrate failed", { ordenId, path, err: err?.message });
      }
    }

    const result = { dryRun, scanned, migrated, tokensRevoked, missingFile, noPath, errors,
                     ...(dryRun ? { sample } : {}) };
    logger.info("[migrarIdentificacionPII] DONE", result);
    return result;
  }
);
