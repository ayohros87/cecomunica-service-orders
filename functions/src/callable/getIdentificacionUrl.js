const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

/**
 * getIdentificacionUrl — admin-only callable that mints a short-lived signed
 * URL for a delivery's customer-ID photo.
 *
 * Why this exists: the ID photo is sensitive PII. Historically the entrega
 * flow stored a *tokenized download URL* (`getDownloadURL()`) on the order
 * doc. That URL bypasses Storage rules and is readable by anyone who can read
 * the order doc — which is every authenticated user (catch-all rule). This
 * callable is the hardened replacement: the order doc now stores only the
 * Storage *path* (`identificacion_path`); the bytes are reachable only through
 * here, gated on `rol === 'administrador'`, and the returned URL expires in
 * minutes.
 *
 * Input:  { ordenId }
 * Output: { url, expiresAt }                         on success
 *         { status: 'sin_id'|'purged'|'missing' }    when no viewable photo
 *
 * Storage paths gated to `read:false` in storage.rules; only the admin SDK
 * (this function) can produce a URL.
 *
 * IAM NOTE: signed-URL v4 generation requires the function's runtime service
 * account to have `roles/iam.serviceAccountTokenCreator` on itself (to sign
 * blobs). If signing fails with an IAM/permission error, grant it once:
 *   gcloud iam service-accounts add-iam-policy-binding <RUNTIME_SA> \
 *     --member="serviceAccount:<RUNTIME_SA>" \
 *     --role="roles/iam.serviceAccountTokenCreator"
 */

const SIGNED_URL_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Derive a Storage object path from a legacy Firebase download URL, so orders
 * not yet migrated (still holding `identificacion_url`) keep working.
 * Format: https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<ENC_PATH>?...
 * @param {string} url
 * @returns {string|null}
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

async function writeAudit({ actorUid, ordenId, status }) {
  try {
    await db.collection("usuarios_audit").add({
      actor_uid:  actorUid,
      target_uid: null,
      action:     "PII_ID_VIEW",
      meta:       { ordenId, status },
      ts:         admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.warn("[getIdentificacionUrl] audit write failed", { err: err?.message, ordenId });
  }
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Sign in required.");

    const userSnap = await db.collection("usuarios").doc(callerUid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userData || userData.rol !== "administrador") {
      throw new HttpsError("permission-denied", "Solo administradores pueden ver la identificación.");
    }
    if (userData.activo === false) {
      throw new HttpsError("permission-denied", "Tu cuenta está desactivada.");
    }

    const ordenId = (request.data?.ordenId || "").trim();
    if (!ordenId) throw new HttpsError("invalid-argument", "ordenId requerido.");

    const ordenSnap = await db.collection("ordenes_de_servicio").doc(ordenId).get();
    if (!ordenSnap.exists) throw new HttpsError("not-found", "Orden no encontrada.");
    const orden = ordenSnap.data() || {};

    // No photo to show: customer waived ID, or it was purged by retention.
    if (orden.sin_id === true) {
      await writeAudit({ actorUid: callerUid, ordenId, status: "sin_id" });
      return { status: "sin_id", motivo: orden.sin_id_motivo || null };
    }
    if (orden.identificacion_purged_at) {
      await writeAudit({ actorUid: callerUid, ordenId, status: "purged" });
      return { status: "purged", purgedAt: null };
    }

    // Prefer the hardened path field; fall back to deriving it from a legacy
    // tokenized URL for orders not yet migrated.
    const path = orden.identificacion_path || _pathFromDownloadUrl(orden.identificacion_url);
    if (!path) {
      await writeAudit({ actorUid: callerUid, ordenId, status: "missing" });
      return { status: "missing" };
    }

    const expiresMs = Date.now() + SIGNED_URL_TTL_MS;
    let url;
    try {
      const [signed] = await admin.storage().bucket().file(path).getSignedUrl({
        version: "v4",
        action:  "read",
        expires: expiresMs,
      });
      url = signed;
    } catch (err) {
      logger.error("[getIdentificacionUrl] getSignedUrl failed", { err: err?.message, ordenId, path });
      throw new HttpsError(
        "internal",
        "No se pudo generar el enlace de la identificación. Verifica el permiso de firma (Token Creator) del service account."
      );
    }

    await writeAudit({ actorUid: callerUid, ordenId, status: "ok" });
    return { status: "ok", url, expiresAt: new Date(expiresMs).toISOString() };
  }
);
