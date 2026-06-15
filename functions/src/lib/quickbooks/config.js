// Configuración compartida de la integración con QuickBooks Online (QBO).
//
// El entorno (sandbox | production) se lee del doc Firestore
// `integraciones/quickbooks.env` en runtime; aquí solo derivamos las URLs
// base de la API a partir de ese valor. Los endpoints de OAuth se obtienen
// del Intuit discovery document (ver auth.js) con estos valores como
// fallback si la red falla.
//
// Secretos (Secret Manager, mismo patrón que SENDMAIL_KEY en sendMail.js):
//   QBO_CLIENT_ID        — Client ID de la app de Intuit
//   QBO_CLIENT_SECRET    — Client Secret de la app de Intuit
//   QBO_SETUP_KEY        — llave para iniciar el flujo /connect (one-time, admin)
//   QBO_WEBHOOK_VERIFIER — verifier token del webhook (para validar la firma)

// Secretos por función (least-privilege): cada CF declara solo lo que usa.
const OAUTH_SECRETS   = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_SETUP_KEY"];
const WEBHOOK_SECRETS = ["QBO_WEBHOOK_VERIFIER"];

// Doc único que guarda tokens + realmId. Solo lo escriben Cloud Functions.
const TOKEN_DOC_PATH = "integraciones/quickbooks";
// Colección de estados CSRF efímeros del flujo OAuth.
const STATE_COLLECTION = "integraciones_qbo_oauth_states";

// Scope mínimo: solo contabilidad (NO payments).
const SCOPE = "com.intuit.quickbooks.accounting";

// Base de la API de datos v3 según entorno.
function apiBaseUrl(env) {
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

// minorversion recomendada al momento de escribir la integración.
const MINOR_VERSION = "73";

// URI de redirección que DEBE estar registrada en la app de Intuit.
// Sirve vía el rewrite de hosting /api/quickbooks/callback -> quickbooksOAuth.
const REDIRECT_URI = "https://app.cecomunica.net/api/quickbooks/callback";

// Fallbacks de endpoints OAuth (auth.js intenta primero el discovery doc).
const OAUTH_FALLBACK = {
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint:         "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint:    "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

// Discovery documents de Intuit (OpenID). Uno por entorno.
const DISCOVERY_URL = {
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
  sandbox:   "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
};

module.exports = {
  OAUTH_SECRETS,
  WEBHOOK_SECRETS,
  TOKEN_DOC_PATH,
  STATE_COLLECTION,
  SCOPE,
  MINOR_VERSION,
  REDIRECT_URI,
  OAUTH_FALLBACK,
  DISCOVERY_URL,
  apiBaseUrl,
};
