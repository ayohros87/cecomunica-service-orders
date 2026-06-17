// listQBOItems — callable para poblar los desplegables del panel de modelos.
// Devuelve los items "Alquiler - *" (Service) y "Mensualidad - *" (Group/bundle)
// de QuickBooks, para que contabilidad elija el mapeo por modelo sin teclear IDs
// ni que el token de QBO toque el navegador. Solo admin/contabilidad.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { db } = require("../lib/admin");
const { OAUTH_SECRETS } = require("../lib/quickbooks/config");
const { qboQuery } = require("../lib/quickbooks/client");

async function requireAdminOrContabilidad(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
  const snap = await db.collection("usuarios").doc(uid).get();
  const d = snap.exists ? snap.data() : null;
  if (!d || !["administrador", "contabilidad"].includes(d.rol) || d.activo === false) {
    throw new HttpsError("permission-denied", "Solo administrador/contabilidad.");
  }
}

module.exports = onCall(
  { region: "us-central1", secrets: OAUTH_SECRETS, memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    await requireAdminOrContabilidad(request.auth?.uid);
    try {
      const [svc, men] = await Promise.all([
        qboQuery("select Id, Name from Item where Type='Service' maxresults 1000"),
        qboQuery("select Id, Name from Item where Type='Group' and Name like 'Mensualidad%' maxresults 500"),
      ]);
      const map = (arr) => (arr || [])
        .map((i) => ({ id: i.Id, name: i.Name }))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      const allSvc = map(svc.Item);
      const esAlquiler = (n) => /^alquiler\b/i.test(n);
      return {
        alquileres: allSvc.filter((i) => esAlquiler(i.name)),   // "Alquiler - <modelo>"
        servicios:  allSvc.filter((i) => !esAlquiler(i.name)),  // resto (Activacion, etc.) → cargos
        bundles:    map(men.Item),                              // "Mensualidad - <modelo>"
      };
    } catch (err) {
      logger.error("[listQBOItems] error", { error: err.message });
      throw new HttpsError("unavailable", `No se pudo consultar QuickBooks: ${err.message}`);
    }
  }
);
