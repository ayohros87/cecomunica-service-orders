// Lectura/escritura del doc de tokens de QBO en Firestore.
// Solo lo tocan Cloud Functions (las reglas de Firestore bloquean el frontend).

const { admin, db } = require("../admin");
const { TOKEN_DOC_PATH } = require("./config");

const [coll, docId] = TOKEN_DOC_PATH.split("/");
function tokenRef() {
  return db.collection(coll).doc(docId);
}

async function getTokens() {
  const snap = await tokenRef().get();
  return snap.exists ? snap.data() : null;
}

// Entorno activo; default sandbox hasta que se conecte producción.
async function getEnv() {
  const t = await getTokens();
  return (t && t.env) || "sandbox";
}

// Guarda el resultado de un intercambio/refresh de tokens.
// `tokens` viene del endpoint de Intuit: { access_token, refresh_token,
// expires_in, x_refresh_token_expires_in }.
async function saveTokens({ tokens, realmId, env, connectedBy }) {
  const now = Date.now();
  const patch = {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: admin.firestore.Timestamp.fromMillis(
      now + (Number(tokens.expires_in) || 3600) * 1000
    ),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (tokens.x_refresh_token_expires_in) {
    patch.refresh_token_expires_at = admin.firestore.Timestamp.fromMillis(
      now + Number(tokens.x_refresh_token_expires_in) * 1000
    );
  }
  if (realmId)     patch.realmId = realmId;
  if (env)         patch.env = env;
  if (connectedBy) patch.connected_by = connectedBy;
  if (!(await getTokens())) {
    patch.connected_at = admin.firestore.FieldValue.serverTimestamp();
  }

  await tokenRef().set(patch, { merge: true });
  return patch;
}

// Persiste un refresh de tokens de forma segura ante concurrencia. Intuit ROTA
// el refresh_token en cada refresh, así que dos invocaciones que refresquen a la
// vez no deben ambas guardar: la que persista de último pisaría el token más
// nuevo con uno de linaje viejo → desconexión de la integración.
//
// Compare-and-swap dentro de una transacción: solo escribimos si el refresh_token
// almacenado sigue siendo el que usamos como punto de partida. Si otra invocación
// ya lo rotó, devolvemos { committed:false, current } para que el llamador use el
// token ganador en vez de pisarlo. Preferimos esto a un lock con lease para no
// arriesgar dejar la integración colgada si un titular del lock falla.
async function commitRefreshedTokens({ tokens, env, fromRefreshToken }) {
  const ref = tokenRef();
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const cur = snap.exists ? snap.data() : {};
    if (cur.refresh_token && fromRefreshToken && cur.refresh_token !== fromRefreshToken) {
      return { committed: false, current: cur };
    }
    const now = Date.now();
    const patch = {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: admin.firestore.Timestamp.fromMillis(
        now + (Number(tokens.expires_in) || 3600) * 1000
      ),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (tokens.x_refresh_token_expires_in) {
      patch.refresh_token_expires_at = admin.firestore.Timestamp.fromMillis(
        now + Number(tokens.x_refresh_token_expires_in) * 1000
      );
    }
    if (env) patch.env = env;
    t.set(ref, patch, { merge: true });
    return { committed: true };
  });
}

// Borra credenciales (disconnect). Conserva env como referencia.
async function clearTokens() {
  const env = await getEnv();
  await tokenRef().set({
    env,
    access_token:  admin.firestore.FieldValue.delete(),
    refresh_token: admin.firestore.FieldValue.delete(),
    access_token_expires_at:  admin.firestore.FieldValue.delete(),
    refresh_token_expires_at: admin.firestore.FieldValue.delete(),
    realmId: admin.firestore.FieldValue.delete(),
    disconnected_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = { getTokens, getEnv, saveTokens, commitRefreshedTokens, clearTokens, tokenRef };
