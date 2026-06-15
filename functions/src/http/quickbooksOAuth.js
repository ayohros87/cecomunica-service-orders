// Flujo OAuth2 de QuickBooks Online. Una sola función HTTP que sirve tres
// rutas vía rewrites de hosting (ver firebase.json):
//
//   /api/quickbooks/connect?key=<SETUP_KEY>[&env=production|sandbox]
//        Inicia el flujo: genera state (CSRF) y redirige a Intuit.
//   /api/quickbooks/callback?code=..&state=..&realmId=..
//        Intuit redirige aquí; validamos state, canjeamos el código y
//        guardamos tokens + realmId.
//   /api/quickbooks/disconnect?key=<SETUP_KEY>
//        Revoca el refresh token y limpia el doc de tokens.
//
// /connect y /disconnect se protegen con QBO_SETUP_KEY (uso one-time del
// admin). /callback se protege validando el state contra Firestore.

const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const { OAUTH_SECRETS, STATE_COLLECTION } = require("../lib/quickbooks/config");
const { buildAuthUrl, exchangeCode, revoke } = require("../lib/quickbooks/auth");
const { saveTokens, getTokens, clearTokens } = require("../lib/quickbooks/tokenStore");

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

function lastSegment(p) {
  return String(p || "").replace(/\/+$/, "").split("/").pop();
}

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
    `<h2>${title}</h2>${body}</body>`;
}

module.exports = onRequest(
  { region: "us-central1", secrets: OAUTH_SECRETS, timeoutSeconds: 30 },
  async (req, res) => {
    const action = lastSegment(req.path);

    try {
      // ---- connect ---------------------------------------------------
      if (action === "connect") {
        if (req.query.key !== process.env.QBO_SETUP_KEY) {
          return res.status(403).send(page("No autorizado", "<p>Llave inválida.</p>"));
        }
        const env = req.query.env === "production" ? "production" : "sandbox";
        const state = crypto.randomBytes(24).toString("hex");
        await db.collection(STATE_COLLECTION).doc(state).set({
          env,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        const url = await buildAuthUrl({ state, env });
        return res.redirect(url);
      }

      // ---- callback --------------------------------------------------
      if (action === "callback") {
        const { code, state, realmId } = req.query;
        if (!code || !state || !realmId) {
          return res.status(400).send(page("Error", "<p>Faltan parámetros del callback.</p>"));
        }
        const stateRef  = db.collection(STATE_COLLECTION).doc(String(state));
        const stateSnap = await stateRef.get();
        if (!stateSnap.exists) {
          return res.status(403).send(page("Error", "<p>State inválido (posible CSRF).</p>"));
        }
        const stateData = stateSnap.data();
        const createdMs = stateData.created_at?.toMillis?.() || 0;
        await stateRef.delete(); // single-use
        if (Date.now() - createdMs > STATE_TTL_MS) {
          return res.status(403).send(page("Error", "<p>El enlace expiró, vuelve a iniciar.</p>"));
        }

        const env = stateData.env || "sandbox";
        const tokens = await exchangeCode({ code: String(code), env });
        await saveTokens({ tokens, realmId: String(realmId), env, connectedBy: "oauth" });
        logger.info("[qbo.oauth] conectado", { env, realmId });
        return res.status(200).send(page(
          "QuickBooks conectado ✓",
          `<p>Entorno: <b>${env}</b><br>Realm ID: <code>${realmId}</code></p>` +
          `<p>Ya puedes cerrar esta ventana.</p>`
        ));
      }

      // ---- disconnect ------------------------------------------------
      if (action === "disconnect") {
        if (req.query.key !== process.env.QBO_SETUP_KEY) {
          return res.status(403).send(page("No autorizado", "<p>Llave inválida.</p>"));
        }
        const t = await getTokens();
        if (t && t.refresh_token) {
          try {
            await revoke({ token: t.refresh_token, env: t.env || "sandbox" });
          } catch (err) {
            logger.warn("[qbo.oauth] revoke falló (se limpia igual)", { error: err.message });
          }
        }
        await clearTokens();
        logger.info("[qbo.oauth] desconectado");
        return res.status(200).send(page("QuickBooks desconectado", "<p>Tokens revocados y borrados.</p>"));
      }

      return res.status(404).send(page("No encontrado", "<p>Ruta desconocida.</p>"));
    } catch (err) {
      logger.error("[qbo.oauth] error", { action, error: err.message, stack: err.stack });
      return res.status(500).send(page("Error", `<pre>${err.message}</pre>`));
    }
  }
);
