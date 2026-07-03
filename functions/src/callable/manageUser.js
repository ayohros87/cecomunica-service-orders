const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const { admin, db } = require("../lib/admin");

/**
 * manageUser — admin-only callable for the users portal (admin/usuarios.html).
 *
 * Single entry point with action discrimination so the frontend has one
 * callable to wire and one set of permissions to reason about. Every
 * action validates that the caller is an active administrador and that
 * the operation can't lock the system out (no removing the last admin,
 * no self-deactivation).
 *
 * Actions:
 *   { action: "create",        email, nombre, rol }                    → { uid, resetLink }
 *   { action: "updateRol",     uid, rol }                              → { ok: true }
 *   { action: "deactivate",    uid }                                   → { ok: true }
 *   { action: "reactivate",    uid }                                   → { ok: true }
 *   { action: "resetPassword", uid }                                   → { resetLink }
 *
 * Audit: every successful mutation writes to usuarios_audit/{autoId} so
 * admin/auditoria.html can render it alongside órdenes / contratos / PII.
 */

// Canonical role enum — keep in sync with public/js/core/roles.js.
const VALID_ROLES = new Set([
  "administrador", "gerente", "vendedor", "recepcion",
  "tecnico", "tecnico_operativo", "jefe_taller", "inventario", "vista",
  "contabilidad",
]);

async function requireAdmin(callerUid) {
  if (!callerUid) throw new HttpsError("unauthenticated", "Sign in required.");
  const snap = await db.collection("usuarios").doc(callerUid).get();
  const data = snap.exists ? snap.data() : null;
  if (!data || data.rol !== "administrador") {
    throw new HttpsError("permission-denied", "Solo administradores.");
  }
  if (data.activo === false) {
    throw new HttpsError("permission-denied", "Tu cuenta está desactivada.");
  }
  return data;
}

// Counts active admins NOT counting the optional excludeUid (used to predict
// whether deactivating or demoting a user would leave the system without admins).
async function activeAdminCount(excludeUid = null) {
  const snap = await db.collection("usuarios").where("rol", "==", "administrador").get();
  let n = 0;
  snap.forEach((doc) => {
    if (excludeUid && doc.id === excludeUid) return;
    const d = doc.data() || {};
    if (d.activo !== false) n++;
  });
  return n;
}

async function writeAudit({ actorUid, targetUid, action, before, after, meta }) {
  try {
    await db.collection("usuarios_audit").add({
      actor_uid:  actorUid,
      target_uid: targetUid || null,
      action:     action,
      before:     before || null,
      after:      after || null,
      meta:       meta || null,
      ts:         admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.warn("[manageUser] audit write failed", { err: err?.message, action });
  }
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    await requireAdmin(callerUid);

    const data   = request.data || {};
    const action = data.action;

    switch (action) {

      // ─────────────── CREATE ───────────────
      case "create": {
        const email  = (data.email  || "").trim().toLowerCase();
        const nombre = (data.nombre || "").trim();
        const rol    = data.rol;

        if (!email || !email.includes("@"))      throw new HttpsError("invalid-argument", "Email inválido.");
        if (!nombre)                              throw new HttpsError("invalid-argument", "Nombre requerido.");
        if (!VALID_ROLES.has(rol))                throw new HttpsError("invalid-argument", "Rol fuera del enum.");

        // Reject duplicate email in Auth.
        try {
          const existing = await admin.auth().getUserByEmail(email);
          if (existing) {
            throw new HttpsError("already-exists", `Ya existe un usuario con email ${email}.`);
          }
        } catch (err) {
          if (err instanceof HttpsError) throw err;
          if (err.code !== "auth/user-not-found") {
            throw new HttpsError("internal", `Lookup falló: ${err.message}`);
          }
        }

        // Random password — user resets via the link we return. Usa CSPRNG
        // (crypto) en vez de Math.random, que no es criptográficamente seguro.
        const randomPw = "tmp" + crypto.randomBytes(18).toString("base64url") + "A1!";
        const userRecord = await admin.auth().createUser({
          email,
          emailVerified: false,
          password: randomPw,
          displayName: nombre,
          disabled: false,
        });

        await db.collection("usuarios").doc(userRecord.uid).set({
          email,
          nombre,
          rol,
          activo: true,
          created_at:  admin.firestore.FieldValue.serverTimestamp(),
          created_by:  callerUid,
        });

        let resetLink = null;
        try {
          resetLink = await admin.auth().generatePasswordResetLink(email);
        } catch (err) {
          logger.warn("[manageUser.create] reset link failed", { err: err?.message });
        }

        await writeAudit({
          actorUid:  callerUid,
          targetUid: userRecord.uid,
          action:    "USUARIO_CREATE",
          after:     { email, nombre, rol },
        });

        return { uid: userRecord.uid, resetLink };
      }

      // ─────────────── UPDATE ROL ───────────────
      case "updateRol": {
        const uid = data.uid;
        const rol = data.rol;
        if (!uid)                  throw new HttpsError("invalid-argument", "uid requerido.");
        if (!VALID_ROLES.has(rol)) throw new HttpsError("invalid-argument", "Rol fuera del enum.");

        const ref = db.collection("usuarios").doc(uid);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");
        const current = snap.data();

        // Safety: prevent self-demotion (admin removes own admin rol).
        if (uid === callerUid && current.rol === "administrador" && rol !== "administrador") {
          throw new HttpsError("failed-precondition",
            "No puedes quitarte el rol de administrador a ti mismo.");
        }

        // Safety: prevent leaving the system without active admins.
        if (current.rol === "administrador" && rol !== "administrador") {
          const remaining = await activeAdminCount(uid);
          if (remaining < 1) {
            throw new HttpsError("failed-precondition",
              "Es el último administrador activo. Crea o promueve otro admin primero.");
          }
        }

        await ref.update({
          rol,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: callerUid,
        });

        await writeAudit({
          actorUid:  callerUid,
          targetUid: uid,
          action:    "USUARIO_UPDATE_ROL",
          before:    { rol: current.rol },
          after:     { rol },
        });

        return { ok: true };
      }

      // ─────────────── DEACTIVATE ───────────────
      case "deactivate": {
        const uid = data.uid;
        if (!uid) throw new HttpsError("invalid-argument", "uid requerido.");
        if (uid === callerUid) {
          throw new HttpsError("failed-precondition", "No puedes desactivarte a ti mismo.");
        }

        const ref = db.collection("usuarios").doc(uid);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");
        const current = snap.data();

        if (current.rol === "administrador") {
          const remaining = await activeAdminCount(uid);
          if (remaining < 1) {
            throw new HttpsError("failed-precondition",
              "Es el último administrador activo. Crea o promueve otro admin primero.");
          }
        }

        try {
          await admin.auth().updateUser(uid, { disabled: true });
        } catch (err) {
          if (err.code !== "auth/user-not-found") {
            throw new HttpsError("internal", `Auth update falló: ${err.message}`);
          }
        }

        await ref.update({
          activo: false,
          deactivated_at: admin.firestore.FieldValue.serverTimestamp(),
          deactivated_by: callerUid,
        });

        await writeAudit({
          actorUid:  callerUid,
          targetUid: uid,
          action:    "USUARIO_DEACTIVATE",
          before:    { activo: current.activo !== false },
          after:     { activo: false },
        });

        return { ok: true };
      }

      // ─────────────── REACTIVATE ───────────────
      case "reactivate": {
        const uid = data.uid;
        if (!uid) throw new HttpsError("invalid-argument", "uid requerido.");

        const ref = db.collection("usuarios").doc(uid);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");

        try {
          await admin.auth().updateUser(uid, { disabled: false });
        } catch (err) {
          if (err.code !== "auth/user-not-found") {
            throw new HttpsError("internal", `Auth update falló: ${err.message}`);
          }
        }

        await ref.update({
          activo: true,
          reactivated_at: admin.firestore.FieldValue.serverTimestamp(),
          reactivated_by: callerUid,
          deactivated_at: admin.firestore.FieldValue.delete(),
          deactivated_by: admin.firestore.FieldValue.delete(),
        });

        await writeAudit({
          actorUid:  callerUid,
          targetUid: uid,
          action:    "USUARIO_REACTIVATE",
          after:     { activo: true },
        });

        return { ok: true };
      }

      // ─────────────── RESET PASSWORD ───────────────
      case "resetPassword": {
        const uid = data.uid;
        if (!uid) throw new HttpsError("invalid-argument", "uid requerido.");

        const userRecord = await admin.auth().getUser(uid).catch(() => null);
        if (!userRecord) throw new HttpsError("not-found", "Usuario no existe en Auth.");
        if (!userRecord.email) throw new HttpsError("failed-precondition", "Usuario sin email.");

        const link = await admin.auth().generatePasswordResetLink(userRecord.email);

        await writeAudit({
          actorUid:  callerUid,
          targetUid: uid,
          action:    "USUARIO_RESET_PASSWORD",
          meta:      { email: userRecord.email },
        });

        return { resetLink: link };
      }

      default:
        throw new HttpsError("invalid-argument", `Acción desconocida: ${action}`);
    }
  }
);
