// qboStatus — estado de la conexión con QuickBooks para la tarjeta del espacio
// Finanzas (propuesta 2026-08, E4). El doc integraciones/quickbooks es CF-only
// (las reglas lo niegan al cliente), así que este callable expone SOLO lo
// operativo: si hay conexión, a qué entorno/realm, y cuándo vence el refresh
// token — el riesgo conocido de que la integración muera en silencio (~100
// días). NO expone tokens. Solo admin/contabilidad.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { db } = require("../lib/admin");

async function requireAdminOrContabilidad(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
  const snap = await db.collection("usuarios").doc(uid).get();
  const d = snap.exists ? snap.data() : null;
  if (!d || !["administrador", "contabilidad"].includes(d.rol) || d.activo === false) {
    throw new HttpsError("permission-denied", "Solo administrador/contabilidad.");
  }
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    await requireAdminOrContabilidad(request.auth?.uid);
    try {
      const snap = await db.collection("integraciones").doc("quickbooks").get();
      const d = snap.exists ? snap.data() : null;
      const ms = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : null);
      return {
        connected: !!(d && d.refresh_token),
        env: (d && d.env) || "sandbox",
        realm_id: (d && d.realmId) || null,
        connected_by: (d && d.connectedBy) || null,
        access_token_expires_at: ms(d && d.access_token_expires_at),
        refresh_token_expires_at: ms(d && d.refresh_token_expires_at),
      };
    } catch (err) {
      logger.error("[qboStatus] error", { error: err.message });
      throw new HttpsError("unavailable", "No se pudo leer el estado de QuickBooks.");
    }
  }
);
