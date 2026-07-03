// gestionarFacturacion — acciones de activación/gestión de facturación sobre un
// contrato. Server-side con admin SDK (las escrituras al contrato NO pasan por reglas,
// esquiva el guard touchesCFOwnedFields). Solo admin/contabilidad.
// Acciones: activar | en_espera | reactivar | no_facturable | facturable | confirmar_entrega.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

const TS = admin.firestore.Timestamp;
// OJO: serverTimestamp() NO se permite dentro de arrays → para fechas de línea
// usamos Timestamps reales (toTs/TS.now()).
function toTs(iso) { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : TS.fromDate(d); }

async function requireAdminOrContabilidad(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
  const snap = await db.collection("usuarios").doc(uid).get();
  const d = snap.exists ? snap.data() : null;
  if (!d || !["administrador", "contabilidad"].includes(d.rol) || d.activo === false) {
    throw new HttpsError("permission-denied", "Solo administrador/contabilidad.");
  }
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminOrContabilidad(uid);

    const { contratoId, accion, payload = {} } = request.data || {};
    if (!contratoId || !accion) throw new HttpsError("invalid-argument", "Falta contratoId o acción.");

    const ref = db.collection("contratos").doc(contratoId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Contrato no encontrado.");
    // Nota: el caso "activar" re-lee el contrato FRESCO dentro de su transacción;
    // los demás casos solo estampan campos escalares con merge sobre `ref`.

    const now = admin.firestore.FieldValue.serverTimestamp();
    const audit = { facturacion_gestionado_por: uid, facturacion_gestionado_at: now };

    switch (accion) {
      case "activar": {
        // RMW del array `equipos` dentro de una transacción: leemos el contrato
        // FRESCO y reescribimos equipos atómicamente. Sin esto, si un usuario edita
        // el contrato entre el get() de arriba y este set(), su edición se perdería
        // (lost update), porque el set reescribe el array completo.
        await db.runTransaction(async (t) => {
          const fresh = await t.get(ref);
          if (!fresh.exists) throw new HttpsError("not-found", "Contrato no encontrado.");
          const cc = fresh.data();
          if (cc.facturable === false) throw new HttpsError("failed-precondition", "El contrato está marcado como NO facturable.");
          if (!["activo", "aprobado"].includes(cc.estado)) throw new HttpsError("failed-precondition", "El contrato debe estar vigente (activo/aprobado).");
          const fechaTs = toTs(payload.fecha_inicio) || cc.fecha_entrega_ultima || TS.now();
          const equipos = Array.isArray(cc.equipos)
            ? cc.equipos.map((e) => ({ ...e, fecha_inicio_facturacion: fechaTs, facturacion_estado: "activa" }))
            : [];
          t.set(ref, {
            equipos,
            facturacion_estado: "activa",
            facturacion_fecha_inicio: fechaTs,
            facturacion_activada_por: uid,
            facturacion_activada_at: now,
            ...audit,
          }, { merge: true });
        });
        break;
      }
      case "en_espera":
        await ref.set({ facturacion_estado: "en_espera", ...audit }, { merge: true });
        break;
      case "reactivar":
        await ref.set({ facturacion_estado: "activa", ...audit }, { merge: true });
        break;
      case "no_facturable":
        await ref.set({ facturable: false, facturacion_estado: "no_aplica", facturacion_no_aplica_motivo: payload.motivo || "", ...audit }, { merge: true });
        break;
      case "facturable":
        await ref.set({ facturable: true, facturacion_estado: "pendiente", facturacion_no_aplica_motivo: admin.firestore.FieldValue.delete(), ...audit }, { merge: true });
        break;
      case "confirmar_entrega":
        await ref.set({ entrega_confirmada: true, entrega_confirmada_manual: true, fecha_entrega_ultima: toTs(payload.fecha) || now, ...audit }, { merge: true });
        break;
      default:
        throw new HttpsError("invalid-argument", `Acción desconocida: ${accion}`);
    }

    logger.info("[gestionarFacturacion]", { contratoId, accion, uid });
    return { ok: true, accion };
  }
);
