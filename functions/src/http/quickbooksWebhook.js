// Webhook entrante de QuickBooks Online (stub).
//
// Sirve vía rewrite /api/quickbooks/webhook -> esta función. Intuit firma
// cada POST con el header `intuit-signature` = base64(HMAC-SHA256(body,
// verifierToken)). Validamos la firma, persistimos el evento crudo en
// `qbo_webhook_events` y respondemos 200. El procesamiento por entidad
// (Customer / Invoice / Payment -> contratos/clientes) se conecta en una
// fase posterior; por ahora dejamos la recepción lista y verificable.

const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const { WEBHOOK_SECRETS } = require("../lib/quickbooks/config");

function signatureValid(rawBody, header) {
  const verifier = process.env.QBO_WEBHOOK_VERIFIER;
  if (!verifier || !header || !rawBody) return false;
  const expected = crypto.createHmac("sha256", verifier).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = onRequest(
  { region: "us-central1", secrets: WEBHOOK_SECRETS, timeoutSeconds: 30 },
  async (req, res) => {
    // Intuit hace POSTs; un GET sirve como ping de salud del endpoint.
    if (req.method === "GET") return res.status(200).send("qbo webhook ok");
    if (req.method !== "POST") return res.status(405).send("method not allowed");

    const raw = req.rawBody; // Buffer con el cuerpo exacto firmado
    const sig = req.headers["intuit-signature"];

    if (!signatureValid(raw, sig)) {
      logger.warn("[qbo.webhook] firma inválida", { hasSig: !!sig });
      return res.status(401).send("invalid signature");
    }

    const rawText = raw.toString("utf8") || "{}";

    // Persistimos crudo primero para no perder nada (aunque el parse falle).
    const evtRef = await db.collection("qbo_webhook_events").add({
      raw: rawText,
      received_at: admin.firestore.FieldValue.serverTimestamp(),
      processed: false,
    });

    try {
      const payload = JSON.parse(rawText);
      const notifications = payload.eventNotifications || [];
      await evtRef.set({ payload }, { merge: true });

      const summary = notifications.map((n) => ({
        realmId: n.realmId,
        entities: (n.dataChangeEvent?.entities || []).map((e) => `${e.name}:${e.operation}`),
      }));
      logger.info("[qbo.webhook] evento recibido", { summary });

      // Responder 200 rápido; el procesamiento real será asíncrono luego.
      return res.status(200).send("ok");
    } catch (err) {
      logger.error("[qbo.webhook] error", { error: err.message, evtId: evtRef.id });
      // 200 igual: Intuit reintenta ante !=200 y no queremos loops por un
      // cuerpo malformado. El crudo ya quedó persistido arriba.
      return res.status(200).send("ok");
    }
  }
);
