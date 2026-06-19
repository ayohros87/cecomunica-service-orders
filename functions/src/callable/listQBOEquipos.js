// listQBOEquipos — callable read-only para previsualizar la importación de modelos
// (equipos) desde QuickBooks. Cada modelo vive en QBO como item Service
// "Alquiler - <modelo>" (con su precio) y bundle Group "Mensualidad - <modelo>".
// Devuelve candidatos: modelo, precio_alquiler (UnitPrice del Alquiler) y el mapeo
// a QBO (item de alquiler + bundle emparejado por nombre de modelo). NO escribe.
// Solo admin/contabilidad.

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

const norm = (s) => String(s || "").trim().toLowerCase();
const stripPrefix = (n, pref) =>
  String(n || "").replace(new RegExp(`^${pref}\\s*[-–:]?\\s*`, "i"), "").trim();

module.exports = onCall(
  { region: "us-central1", secrets: OAUTH_SECRETS, memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    await requireAdminOrContabilidad(request.auth?.uid);
    try {
      const [alq, men] = await Promise.all([
        qboQuery("select Id, Name, UnitPrice from Item where Type='Service' and Name like 'Alquiler%' maxresults 1000"),
        qboQuery("select Id, Name from Item where Type='Group' and Name like 'Mensualidad%' maxresults 1000"),
      ]);

      // Mapa de bundles por nombre de modelo normalizado.
      const bundleByModelo = {};
      ((men && men.Item) || []).forEach((b) => {
        const modelo = stripPrefix(b.Name, "mensualidad");
        if (modelo) bundleByModelo[norm(modelo)] = { id: b.Id, name: b.Name };
      });

      const equipos = ((alq && alq.Item) || [])
        .map((i) => {
          const modelo = stripPrefix(i.Name, "alquiler");
          const bundle = bundleByModelo[norm(modelo)] || null;
          return {
            modelo,
            precio_alquiler: Number(i.UnitPrice || 0),
            qbo_item_alquiler_id: i.Id,
            qbo_item_alquiler_name: i.Name || "",
            qbo_bundle_id: bundle ? bundle.id : "",
            qbo_bundle_name: bundle ? bundle.name : "",
          };
        })
        .filter((e) => e.modelo)
        .sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));

      return { equipos, total: equipos.length };
    } catch (err) {
      logger.error("[listQBOEquipos] error", { error: err.message });
      throw new HttpsError("unavailable", `No se pudo consultar QuickBooks: ${err.message}`);
    }
  }
);
