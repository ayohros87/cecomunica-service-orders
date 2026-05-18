const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { buildOrderSearchTokens, tokensEqual } = require("../../lib/searchTokens");

/**
 * onOrdenWriteSearchTokens — maintains the `searchTokens` array on
 * each `ordenes_de_servicio` doc.
 *
 * Replaces the previous full-collection scan in the frontend's
 * OrdenesService.searchOrders (ORDENES_INDEX_IMPROVEMENTS.md §1.1).
 *
 * Idempotence: the trigger fires on its own writes. We detect that
 * by comparing the freshly-computed tokens against the doc's existing
 * `searchTokens` array; if they match exactly, we skip the write.
 * Sort order matters here — buildOrderSearchTokens returns sorted
 * output and the comparison is element-wise.
 *
 * Skipped:
 *   - Soft-deleted orders (`eliminado === true`) — leave tokens stale;
 *     the search service filters them out client-side anyway, and we
 *     avoid an extra write when a doc is being deleted.
 *   - Hard-deleted (after === null) — handled by onOrdenHardDelete.
 */
module.exports = onDocumentWritten(
  {
    document: "ordenes_de_servicio/{ordenId}",
    region: "us-central1",
  },
  async (event) => {
    const ordenId = event.params.ordenId;
    const after = event.data?.after?.data();
    if (!after) return; // hard delete

    if (after.eliminado === true) {
      logger.debug("[onOrdenWriteSearchTokens] eliminado, skipping", { ordenId });
      return;
    }

    const newTokens = buildOrderSearchTokens(ordenId, after);
    const currentTokens = Array.isArray(after.searchTokens) ? after.searchTokens : [];

    if (tokensEqual(newTokens, currentTokens)) {
      // No-op write would recurse forever — bail before mutating.
      return;
    }

    try {
      await event.data.after.ref.update({ searchTokens: newTokens });
      logger.info("[onOrdenWriteSearchTokens] updated", {
        ordenId,
        tokenCount: newTokens.length,
      });
    } catch (err) {
      logger.error("[onOrdenWriteSearchTokens] update failed", {
        ordenId,
        err: err?.message,
      });
      throw err;
    }
  }
);
