// Los requisitos de comisión se mantienen solos — F2 de PLAN_COMISIONES.md.
//
// Firma y entrega son HECHOS que ya viven en el contrato o en la gestión.
// Nadie los teclea en la bandeja de comisiones: estos dos triggers los
// re-derivan cuando el hecho se mueve.
//
// POR QUÉ NO ALCANZA CON DERIVARLOS AL NACER EL AVISO
//   `aumento_entregado`: onOrdenWriteGestion crea el aviso y ESCRIBE
//   `cierre.entrega` después (el `gRef.set(patch)` está al final de la
//   función), así que la comisión nace leyendo una gestión que todavía dice
//   "sin entregar".
//   Contratos: un aviso puede nacer con `firmado_pendiente_validacion` (firmó
//   alguien distinto al representante) y la firma solo cuenta cuando
//   administración acepta al firmante — un write posterior.
//
// Lo que NO tocan: el paso `pago`, el período, la base, ni una comisión ya
// `pagada`. Eso vive en lib/facturacionAvisos.refrescarRequisitosComision.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const FA = require("../../lib/facturacionAvisos");

const REGION = "us-central1";

// Contrato: los tres campos que mueven firma o entrega.
const onComisionRequisitosContrato = onDocumentUpdated(
  { document: "contratos/{cid}", region: REGION },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    const cambio = before.firmado !== after.firmado
      || before.firmado_pendiente_validacion !== after.firmado_pendiente_validacion
      || before.entrega_confirmada !== after.entrega_confirmada;
    if (!cambio) return null;

    const cid = event.params.cid;
    try {
      const n = await FA.refrescarRequisitosComision(cid, { contrato: after });
      if (n) logger.info("[onComisionRequisitos] requisitos re-derivados desde el contrato", { cid, avisos: n });
    } catch (e) {
      logger.error("[onComisionRequisitos] contrato: no se pudieron re-derivar", { cid, error: e.message });
    }
    return null;
  }
);

// Gestión: el cierre es lo único que mueve firma o entrega de un aumento.
const onComisionRequisitosGestion = onDocumentUpdated(
  { document: "gestiones/{gid}", region: REGION },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    const cambio = before.cierre?.firma !== after.cierre?.firma
      || before.cierre?.entrega !== after.cierre?.entrega;
    if (!cambio) return null;

    const gid = event.params.gid;
    try {
      const n = await FA.refrescarRequisitosComision(gid, { gestion: after });
      if (n) logger.info("[onComisionRequisitos] requisitos re-derivados desde la gestión", { gid, avisos: n });
    } catch (e) {
      logger.error("[onComisionRequisitos] gestión: no se pudieron re-derivar", { gid, error: e.message });
    }
    return null;
  }
);

module.exports = { onComisionRequisitosContrato, onComisionRequisitosGestion };
