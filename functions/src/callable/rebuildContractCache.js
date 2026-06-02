const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { db } = require("../lib/admin");
const { recalcularCacheContrato } = require("../domain/contractCache");

/**
 * rebuildContractCache — admin-only callable to manually re-sync the
 * order-count caches on a contract doc (os_count, os_linked,
 * os_serials_preview, etc.). Used from admin/integridad.html when a
 * mismatch between os_count and the actual subcollection is detected.
 *
 * Accepts either:
 *   { contratoId: "abc123" }      → single contract
 *   { contratoIds: ["a", "b"] }   → batch (up to 50)
 *
 * Returns { ok: boolean, results: [{ contratoId, success, error? }] }.
 *
 * The underlying recalcularCacheContrato lives in domain/contractCache.js
 * and is shared with the existing onContratoOrdenWrite trigger.
 */
module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 300 },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Sign in required.");
    const userDoc = await db.collection("usuarios").doc(callerUid).get();
    const rol = (userDoc.data() || {}).rol || "";
    if (rol !== "administrador") {
      throw new HttpsError("permission-denied", "Solo administradores.");
    }

    const data = request.data || {};
    let ids;
    if (Array.isArray(data.contratoIds)) {
      if (!data.contratoIds.length || data.contratoIds.length > 50) {
        throw new HttpsError("invalid-argument", "contratoIds debe tener entre 1 y 50 elementos.");
      }
      ids = data.contratoIds;
    } else if (typeof data.contratoId === "string" && data.contratoId.length) {
      ids = [data.contratoId];
    } else {
      throw new HttpsError("invalid-argument", "Falta contratoId o contratoIds.");
    }

    const results = [];
    for (const id of ids) {
      try {
        const ok = await recalcularCacheContrato(id);
        results.push({ contratoId: id, success: !!ok });
        if (ok) {
          logger.info("[rebuildContractCache] recomputed", { contratoId: id, by: callerUid });
        }
      } catch (err) {
        logger.warn("[rebuildContractCache] error", { contratoId: id, err: err?.message });
        results.push({ contratoId: id, success: false, error: err?.message || String(err) });
      }
    }

    const okCount = results.filter(r => r.success).length;
    return { ok: okCount === ids.length, results, recomputed: okCount, total: ids.length };
  }
);
