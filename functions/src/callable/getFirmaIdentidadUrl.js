const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

/**
 * getFirmaIdentidadUrl — callable solo-staff que emite una URL firmada de
 * corta vida para la evidencia de identidad de una firma digital (foto de la
 * cédula y selfie del firmante, capturadas en /firmar/).
 *
 * Mismo endurecimiento que getIdentificacionUrl / getClienteDocUrl: los bytes
 * viven en `firmas_identidad/{sid}/` con read:false; el doc de la solicitud
 * guarda solo los paths. Datos biométricos = sensibles (Ley 81 de 2019):
 * acceso gated por rol (quienes validan firmantes), URL que expira en minutos
 * y auditoría de cada vista.
 *
 * Input:  { sid, cual: 'cedula'|'selfie' }
 * Output: { status:'ok', url, expiresAt } | { status:'missing' }
 */

const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
// Quienes validan firmantes (botón "Aceptar firmante" del Centro).
const ALLOWED_ROLES = new Set(["administrador", "gerente"]);

async function writeAudit({ actorUid, sid, cual, status }) {
  try {
    await db.collection("usuarios_audit").add({
      actor_uid:  actorUid,
      target_uid: null,
      action:     "PII_FIRMA_IDENTIDAD_VIEW",
      meta:       { sid, cual, status },
      ts:         admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.warn("[getFirmaIdentidadUrl] audit write failed", { err: err?.message, sid, cual });
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
      throw new HttpsError("permission-denied", "No tienes permiso para ver la evidencia de identidad.");
    }
    if (userData.activo === false) {
      throw new HttpsError("permission-denied", "Tu cuenta está desactivada.");
    }

    const sid  = (request.data?.sid || "").trim();
    const cual = (request.data?.cual || "").trim();
    if (!sid || !["cedula", "selfie"].includes(cual)) {
      throw new HttpsError("invalid-argument", "sid y cual ('cedula'|'selfie') requeridos.");
    }

    const sSnap = await db.collection("firma_solicitudes").doc(sid).get();
    if (!sSnap.exists) {
      await writeAudit({ actorUid: callerUid, sid, cual, status: "missing" });
      return { status: "missing" };
    }
    const path = sSnap.data()?.firma?.[`${cual}_path`];
    // Solo paths del propio sid: nada de firmar rutas arbitrarias.
    if (!path || !String(path).startsWith(`firmas_identidad/${sid}/`)) {
      await writeAudit({ actorUid: callerUid, sid, cual, status: "missing" });
      return { status: "missing" };
    }

    const expiresMs = Date.now() + SIGNED_URL_TTL_MS;
    let url;
    try {
      const [signed] = await admin.storage().bucket().file(path).getSignedUrl({
        version: "v4", action: "read", expires: expiresMs,
      });
      url = signed;
    } catch (err) {
      logger.error("[getFirmaIdentidadUrl] getSignedUrl failed", { err: err?.message, sid, cual, path });
      throw new HttpsError("internal", "No se pudo generar el enlace de la evidencia.");
    }

    await writeAudit({ actorUid: callerUid, sid, cual, status: "ok" });
    return { status: "ok", url, expiresAt: new Date(expiresMs).toISOString() };
  }
);
