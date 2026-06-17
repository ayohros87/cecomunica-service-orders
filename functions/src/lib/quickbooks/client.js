// Cliente QBO reutilizable: obtiene un access token válido (refresca si está por
// expirar) y consulta la API. Lo usarán los callables y el facturador.
// Requiere los secrets OAUTH (QBO_CLIENT_ID/SECRET) en la función que lo invoque.

const { getTokens, saveTokens } = require("./tokenStore");
const { refreshTokens } = require("./auth");
const { apiBaseUrl, MINOR_VERSION } = require("./config");

async function getValidContext() {
  const t = await getTokens();
  if (!t || !t.access_token || !t.realmId) {
    throw new Error("QuickBooks no está conectado (sin tokens en integraciones/quickbooks).");
  }
  const env = t.env || "sandbox";
  const expMs = t.access_token_expires_at?.toMillis?.() || 0;
  let accessToken = t.access_token;

  // Refresca con 60s de margen.
  if (Date.now() > expMs - 60000) {
    const tokens = await refreshTokens({ refreshToken: t.refresh_token, env });
    await saveTokens({ tokens, env });
    accessToken = tokens.access_token;
  }
  return { accessToken, realmId: t.realmId, env };
}

async function qboGet(pathAndQuery) {
  const { accessToken, realmId, env } = await getValidContext();
  const url = `${apiBaseUrl(env)}/v3/company/${realmId}/${pathAndQuery}` +
    `${pathAndQuery.includes("?") ? "&" : "?"}minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`QBO GET ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function qboQuery(statement) {
  const r = await qboGet(`query?query=${encodeURIComponent(statement)}`);
  return r.QueryResponse || {};
}

module.exports = { getValidContext, qboGet, qboQuery };
