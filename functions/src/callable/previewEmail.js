const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../lib/admin");
const {
  buildEmailFromBase,
  buildBodyOrdenCompletada,
  buildBodyNotaEntrega,
  renderByTemplate,
} = require("../domain/emailRenderer");

/**
 * previewEmail — admin-only callable that renders an email template with
 * dummy data and returns the HTML (does NOT send).
 *
 * Used by public/admin/email-preview.html to verify template changes
 * without spamming real recipients.
 *
 * Two paths:
 *   1. template registered in renderByTemplate (single source via the
 *      mail_queue pipeline) → identical output to what onMailQueued
 *      would send.
 *   2. legacy helper renderers exposed individually (orden_completada
 *      isn't routed through renderByTemplate yet but is used by
 *      onOrdenCompletada via the html path).
 */

const HELPERS = {
  // Routed via renderByTemplate (production path)
  nota_entrega: (data) => renderByTemplate({ template: "nota_entrega", data }),

  // Helpers not yet registered as templates — render direct + wrap base.
  orden_completada: (data) => buildEmailFromBase({
    preheader: `Orden completada — ${data.orden_id || data.id || "—"}`,
    bodyHtml:  buildBodyOrdenCompletada(data),
    ctaUrl:    "#",
    ctaLabel:  "Ver orden",
  }),
};

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Sign in required.");
    const userDoc = await db.collection("usuarios").doc(callerUid).get();
    if (!userDoc.exists || userDoc.data().rol !== "administrador") {
      throw new HttpsError("permission-denied", "Solo administradores.");
    }

    const { template, data } = request.data || {};
    if (!template || typeof template !== "string") {
      throw new HttpsError("invalid-argument", "Falta 'template'.");
    }
    const renderer = HELPERS[template];
    if (!renderer) {
      throw new HttpsError(
        "invalid-argument",
        `Template desconocido: ${template}. Disponibles: ${Object.keys(HELPERS).join(", ")}`
      );
    }

    let html;
    try {
      html = renderer(data || {});
    } catch (err) {
      throw new HttpsError("internal", `Error renderizando: ${err?.message || err}`);
    }
    if (!html) {
      throw new HttpsError("internal", "El renderer devolvió HTML vacío.");
    }

    return {
      template,
      html,
      length: html.length,
    };
  }
);
