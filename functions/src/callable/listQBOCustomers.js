// listQBOCustomers — discovery read-only de los Customers de QuickBooks para el match
// asistido cliente↔QBO. Devuelve top-level y sub-customers con RUC (PrimaryTaxIdentifier),
// nombre, padre y estado. NO escribe. Solo admin/contabilidad.

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

async function queryAll() {
  const out = [];
  let start = 1;
  const PAGE = 1000;
  for (let i = 0; i < 30; i++) {
    const res = await qboQuery(
      `select Id, DisplayName, CompanyName, PrimaryTaxIdentifier, Job, Active, Balance, ParentRef ` +
      `from Customer startposition ${start} maxresults ${PAGE}`
    );
    const items = (res && res.Customer) || [];
    out.push(...items);
    if (items.length < PAGE) break;
    start += PAGE;
  }
  return out;
}

module.exports = onCall(
  { region: "us-central1", secrets: OAUTH_SECRETS, memory: "256MiB", timeoutSeconds: 120 },
  async (request) => {
    await requireAdminOrContabilidad(request.auth?.uid);
    try {
      const all = await queryAll();
      const customers = all.map((c) => ({
        qbo_customer_id: c.Id,
        display_name: c.DisplayName || "",
        company_name: c.CompanyName || "",
        ruc: c.PrimaryTaxIdentifier || "",
        job: c.Job === true,
        active: c.Active !== false,
        balance: Number(c.Balance || 0),
        parent_id: c.ParentRef ? c.ParentRef.value : "",
        parent_name: c.ParentRef ? c.ParentRef.name : "",
      }));
      return { customers, total: customers.length };
    } catch (err) {
      logger.error("[listQBOCustomers] error", { error: err.message });
      throw new HttpsError("unavailable", `No se pudo consultar QuickBooks: ${err.message}`);
    }
  }
);
