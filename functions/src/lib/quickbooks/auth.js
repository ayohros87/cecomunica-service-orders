// Mecánica OAuth2 de QuickBooks Online: discovery, authorize URL,
// intercambio de código, refresh y revocación. Sin estado: cada función
// recibe el `env` y lee QBO_CLIENT_ID / QBO_CLIENT_SECRET de process.env
// (Secret Manager, mismo patrón que el resto de funciones HTTP).

const logger = require("firebase-functions/logger");
const {
  SCOPE, REDIRECT_URI, OAUTH_FALLBACK, DISCOVERY_URL,
} = require("./config");

// Cache en memoria del discovery doc por entorno (se repuebla en cold start).
const _discoveryCache = {};

// Honra el "Yes" del cuestionario: usamos el Intuit discovery document para
// resolver endpoints; si la red falla, caemos a los valores conocidos.
async function getEndpoints(env) {
  if (_discoveryCache[env]) return _discoveryCache[env];
  try {
    const url = DISCOVERY_URL[env] || DISCOVERY_URL.sandbox;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`discovery HTTP ${res.status}`);
    const doc = await res.json();
    _discoveryCache[env] = {
      authorization_endpoint: doc.authorization_endpoint || OAUTH_FALLBACK.authorization_endpoint,
      token_endpoint:         doc.token_endpoint         || OAUTH_FALLBACK.token_endpoint,
      revocation_endpoint:    doc.revocation_endpoint    || OAUTH_FALLBACK.revocation_endpoint,
    };
  } catch (err) {
    logger.warn("[qbo.auth] discovery falló, usando fallback", { env, error: err.message });
    _discoveryCache[env] = { ...OAUTH_FALLBACK };
  }
  return _discoveryCache[env];
}

function basicAuthHeader() {
  const id     = process.env.QBO_CLIENT_ID;
  const secret = process.env.QBO_CLIENT_SECRET;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function buildAuthUrl({ state, env }) {
  const { authorization_endpoint } = await getEndpoints(env);
  const params = new URLSearchParams({
    client_id:     process.env.QBO_CLIENT_ID,
    response_type: "code",
    scope:         SCOPE,
    redirect_uri:  REDIRECT_URI,
    state,
  });
  return `${authorization_endpoint}?${params.toString()}`;
}

// Llama al token endpoint con Basic auth y cuerpo form-encoded.
async function tokenRequest(env, bodyParams) {
  const { token_endpoint } = await getEndpoints(env);
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      Authorization:  basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:         "application/json",
    },
    body: new URLSearchParams(bodyParams).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`token endpoint HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

function exchangeCode({ code, env }) {
  return tokenRequest(env, {
    grant_type:   "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });
}

function refreshTokens({ refreshToken, env }) {
  return tokenRequest(env, {
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
  });
}

async function revoke({ token, env }) {
  const { revocation_endpoint } = await getEndpoints(env);
  const res = await fetch(revocation_endpoint, {
    method: "POST",
    headers: {
      Authorization:  basicAuthHeader(),
      "Content-Type": "application/json",
      Accept:         "application/json",
    },
    body: JSON.stringify({ token }),
  });
  // 200 = revocado; Intuit puede devolver 200 con cuerpo vacío.
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`revoke HTTP ${res.status}: ${t}`);
  }
}

module.exports = { getEndpoints, buildAuthUrl, exchangeCode, refreshTokens, revoke };
