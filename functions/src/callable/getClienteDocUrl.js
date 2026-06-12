const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

/**
 * getClienteDocUrl — staff-only callable that mints a short-lived signed URL
 * for a client's legal document (registro público, cédula del representante,
 * comprobante de dirección, poderes, etc.).
 *
 * Why this exists: these documents all carry personal data or legally
 * sensitive material, so they are treated as PII. The bytes live under
 * Storage path `clientes_documentos/{clienteId}/...` which is locked to
 * `read:false` in storage.rules; the Firestore doc stores only the path
 * (`storage_path`), never a tokenized download URL. This is the same
 * hardening getIdentificacionUrl applied to the delivery ID photo: a
 * persisted download URL is readable by anyone who can read the doc (the
 * catch-all rule grants every authenticated user), which we don't want for
 * legal documents. The bytes are reachable only through here, gated on role,
 * and the returned URL expires in minutes.
 *
 * Input:  { clienteId, docId }
 * Output: { status: 'ok', url, expiresAt }            on success
 *         { status: 'deleted'|'missing' }             when no viewable file
 *
 * IAM NOTE: signed-URL v4 generation requires the function's runtime service
 * account to have `roles/iam.serviceAccountTokenCreator` on itself. Already
 * granted for getIdentificacionUrl; the same SA signs here.
 */

const SIGNED_URL_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Alineado con el guard del módulo de clientes (clientes-index.js): admin +
// recepción. Vendedores NO tienen acceso al directorio de clientes, así que
// tampoco a sus documentos legales (el dato más sensible). Recepción es un
// acceso considerado temporal — a revisar cuando exista el módulo restrictivo.
const ALLOWED_ROLES = new Set(["administrador", "recepcion"]);

async function writeAudit({ actorUid, clienteId, docId, status }) {
  try {
    await db.collection("usuarios_audit").add({
      actor_uid:  actorUid,
      target_uid: null,
      action:     "PII_CLIENTE_DOC_VIEW",
      meta:       { clienteId, docId, status },
      ts:         admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.warn("[getClienteDocUrl] audit write failed", { err: err?.message, clienteId, docId });
  }
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Sign in required.");

    const userSnap = await db.collection("usuarios").doc(callerUid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userData || !ALLOWED_ROLES.has(userData.rol)) {
      throw new HttpsError("permission-denied", "No tienes permiso para ver documentos del cliente.");
    }
    if (userData.activo === false) {
      throw new HttpsError("permission-denied", "Tu cuenta está desactivada.");
    }

    const clienteId = (request.data?.clienteId || "").trim();
    const docId     = (request.data?.docId || "").trim();
    if (!clienteId || !docId) throw new HttpsError("invalid-argument", "clienteId y docId requeridos.");

    const docSnap = await db
      .collection("clientes").doc(clienteId)
      .collection("documentos").doc(docId)
      .get();
    if (!docSnap.exists) {
      await writeAudit({ actorUid: callerUid, clienteId, docId, status: "missing" });
      return { status: "missing" };
    }
    const docData = docSnap.data() || {};

    if (docData.deleted === true) {
      await writeAudit({ actorUid: callerUid, clienteId, docId, status: "deleted" });
      return { status: "deleted" };
    }

    const path = docData.storage_path;
    if (!path) {
      await writeAudit({ actorUid: callerUid, clienteId, docId, status: "missing" });
      return { status: "missing" };
    }

    const expiresMs = Date.now() + SIGNED_URL_TTL_MS;
    let url;
    try {
      const [signed] = await admin.storage().bucket().file(path).getSignedUrl({
        version: "v4",
        action:  "read",
        expires: expiresMs,
      });
      url = signed;
    } catch (err) {
      logger.error("[getClienteDocUrl] getSignedUrl failed", { err: err?.message, clienteId, docId, path });
      throw new HttpsError(
        "internal",
        "No se pudo generar el enlace del documento. Verifica el permiso de firma (Token Creator) del service account."
      );
    }

    await writeAudit({ actorUid: callerUid, clienteId, docId, status: "ok" });
    return { status: "ok", url, expiresAt: new Date(expiresMs).toISOString() };
  }
);
