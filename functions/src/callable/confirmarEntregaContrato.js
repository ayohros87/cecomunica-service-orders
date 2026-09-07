// confirmarEntregaContrato — recepción confirma que el equipo de un contrato
// ya está con el cliente, desde el formulario de devolución.
//
// Por qué existe (caso Gamboa, 2026-08-14): en un REEMPLAZO el vendedor entrega
// el radio nuevo primero y el viejo llega después. Cuando recepción tiene el
// radio viejo en el mostrador, la entrega del contrato nuevo todavía no está
// confirmada en el sistema, así que el tiquete de devolución no existe y
// recepción lo abre a mano; horas después se confirma la entrega y el trigger
// abre otro (duplicado). Confirmar la entrega AQUÍ, en el momento en que se
// descubre el desfase, hace que onEntregaTransicion cree el tiquete correcto
// al instante.
//
// `entrega_confirmada` es campo del backend (touchesCFOwnedFields en rules):
// el navegador no puede escribirlo, y el callable existente
// (gestionarFacturacion) es solo admin/contabilidad. Este es el piso de rol de
// quien opera el mostrador: recepción, jefe de taller, vendedor, admin, gerente.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

const ROLES = new Set(["administrador", "recepcion", "jefe_taller", "vendedor", "gerente"]);
const VIGENTES = new Set(["aprobado", "activo"]);

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) {
      throw new HttpsError("permission-denied", "Tu rol no puede confirmar entregas.");
    }

    const { contratoDocId, nota } = request.data || {};
    if (!contratoDocId || typeof contratoDocId !== "string") {
      throw new HttpsError("invalid-argument", "Falta el contrato.");
    }
    const ref = db.collection("contratos").doc(contratoDocId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Contrato no encontrado.");
    const c = snap.data();
    if (c.deleted === true || !VIGENTES.has(String(c.estado || "").toLowerCase())) {
      throw new HttpsError("failed-precondition", "El contrato no está vigente (aprobado/activo).");
    }
    if (c.entrega_confirmada === true) {
      return { ok: true, yaEstaba: true, contrato_id: c.contrato_id || contratoDocId };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({
      entrega_confirmada: true,
      entrega_confirmada_manual: true,
      entrega_confirmada_fuente: "recepcion_devolucion",
      entrega_confirmada_por: uid,
      entrega_confirmada_nota: String(nota || "").slice(0, 300),
      fecha_entrega_ultima: now,
      facturacion_entrega_at: now,
    }, { merge: true });
    logger.info("[confirmarEntregaContrato] entrega confirmada desde recepción",
      { contratoDocId, contrato: c.contrato_id, uid, rol: u.rol });
    return { ok: true, yaEstaba: false, contrato_id: c.contrato_id || contratoDocId };
  }
);
