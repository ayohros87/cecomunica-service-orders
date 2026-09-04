// El vendedor CORRIGE el plan de seriales de una renovación ya aprobada
// (Centro → "Seriales de la cuenta", 2026-09-04): antes de la firma puede
// quitar y poner seriales para regularizar la cuenta — el Anexo A que el
// cliente firma tiene que ser el bueno. Al aprobarse, onContratoActivado
// aplica el plan; este trigger aplica las CORRECCIONES posteriores mientras
// el contrato siga aprobado o activo. Idempotente por hash del plan
// (lib/planRenovacion.js): un write que no cambia el plan no hace nada.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { aplicarPlanRenovacion, hashPlan } = require("../../lib/planRenovacion");

module.exports = onDocumentUpdated(
  { document: "contratos/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    if (after.deleted) return null;
    if (after.accion !== "Renovación") return null;
    if (!["aprobado", "activo"].includes(after.estado)) return null;
    // Solo cuando el PLAN cambió (no en cada escritura del contrato). La
    // primera aplicación —al aprobar— la hace onContratoActivado; aquí solo
    // interesa un plan distinto al que ya está aplicado.
    const hAntes = hashPlan(before.transicion_plan);
    const hAhora = hashPlan(after.transicion_plan);
    if (hAntes === hAhora) return null;
    if (after.plan_aplicado?.hash === hAhora) return null;
    try {
      const r = await aplicarPlanRenovacion(event.data.after.ref, after, event.params.cid, { motivo: "correccion" });
      if (r) logger.info("[onPlanRenovacion] corrección del plan aplicada", { cid: event.params.cid, ...r });
    } catch (e) {
      logger.error("[onPlanRenovacion] no se pudo aplicar la corrección del plan", { cid: event.params.cid, message: e.message });
    }
    return null;
  }
);
