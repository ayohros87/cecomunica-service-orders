// Cliente QBO reutilizable: obtiene un access token válido (refresca si está por
// expirar) y consulta la API. Lo usarán los callables y el facturador.
// Requiere los secrets OAUTH (QBO_CLIENT_ID/SECRET) en la función que lo invoque.

const { getTokens, commitRefreshedTokens } = require("./tokenStore");
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

  // Refresca con 60s de margen. El commit es compare-and-swap sobre el
  // refresh_token de partida: si otra invocación concurrente ya refrescó y rotó
  // el token, usamos SU access_token en vez de pisarlo con el nuestro (evita
  // desconectar la integración). Ver tokenStore.commitRefreshedTokens.
  if (Date.now() > expMs - 60000) {
    const fromRefreshToken = t.refresh_token;
    const tokens = await refreshTokens({ refreshToken: fromRefreshToken, env });
    const res = await commitRefreshedTokens({ tokens, env, fromRefreshToken });
    accessToken = res.committed ? tokens.access_token : (res.current?.access_token || tokens.access_token);
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
