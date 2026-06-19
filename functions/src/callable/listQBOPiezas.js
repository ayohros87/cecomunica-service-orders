// listQBOPiezas — callable read-only para previsualizar la importación de piezas
// desde QuickBooks. Devuelve los items de tipo Inventory y NonInventory (productos
// = piezas/repuestos) con su precio de venta, costo, SKU e Id, para que
// contabilidad revise y apruebe antes de ingresarlos a inventario_piezas.
// NO escribe nada. Solo admin/contabilidad.

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

// Trae TODOS los items de un tipo paginando de a 1000 (límite de QBO).
async function queryAllByType(tipo) {
  const out = [];
  let start = 1;
  const PAGE = 1000;
  for (let i = 0; i < 20; i++) { // tope de seguridad: 20k items
    const res = await qboQuery(
      `select Id, Name, Sku, Description, UnitPrice, PurchaseCost, Active from Item ` +
      `where Type='${tipo}' startposition ${start} maxresults ${PAGE}`
    );
    const items = (res && res.Item) || [];
    out.push(...items);
    if (items.length < PAGE) break;
    start += PAGE;
  }
  return out;
}

module.exports = onCall(
  { region: "us-central1", secrets: OAUTH_SECRETS, memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    await requireAdminOrContabilidad(request.auth?.uid);
    try {
      const [inv, non] = await Promise.all([
        queryAllByType("Inventory"),
        queryAllByType("NonInventory"),
      ]);
      const map = (arr, tipo) => (arr || []).map((i) => ({
        qbo_item_id: i.Id,
        name: i.Name || "",
        sku: i.Sku || "",
        descripcion: i.Name || "",
        notas: i.Description || "",
        precio_venta: Number(i.UnitPrice || 0),
        costo_unitario: Number(i.PurchaseCost || 0),
        tipo,
        active: i.Active !== false,
      }));
      const piezas = [...map(inv, "Inventory"), ...map(non, "NonInventory")]
        .filter((p) => p.active)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      return { piezas, total: piezas.length };
    } catch (err) {
      logger.error("[listQBOPiezas] error", { error: err.message });
      throw new HttpsError("unavailable", `No se pudo consultar QuickBooks: ${err.message}`);
    }
  }
);
