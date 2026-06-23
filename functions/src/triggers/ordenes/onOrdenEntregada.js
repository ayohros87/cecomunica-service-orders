const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

// Propaga la ENTREGA al contrato (señal de readiness para facturación). Cuando una
// orden vinculada pasa a "ENTREGADO AL CLIENTE", estampa en el contrato
// `entrega_confirmada` + `fecha_entrega_ultima`. NO activa facturación — solo
// registra la señal para que el módulo calcule readiness sin leer subcolecciones.
// La activación es una acción explícita aparte (callable gestionarFacturacion).
const ENTREGADO = "ENTREGADO AL CLIENTE";
const norm = (s) => String(s || "").trim().toUpperCase();

module.exports = onDocumentWritten(
  { document: "ordenes_de_servicio/{ordenId}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after) return null;

    // Solo en la TRANSICIÓN a ENTREGADO (no en cada escritura ya entregada).
    if (norm(before?.estado_reparacion) === ENTREGADO || norm(after.estado_reparacion) !== ENTREGADO) {
      return null;
    }

    const contrato = after.contrato || {};
    if (!contrato.aplica || !contrato.contrato_doc_id) return null; // orden sin contrato

    const contratoDocId = contrato.contrato_doc_id;
    try {
      await db.collection("contratos").doc(contratoDocId).set({
        entrega_confirmada: true,
        fecha_entrega_ultima: after.fecha_entrega || admin.firestore.FieldValue.serverTimestamp(),
        facturacion_entrega_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info("[onOrdenEntregada] Entrega propagada al contrato", {
        ordenId: event.params.ordenId, contratoDocId,
      });
    } catch (e) {
      logger.warn("[onOrdenEntregada] No se pudo propagar la entrega", {
        contratoDocId, message: e.message,
      });
    }
    return null;
  }
);
