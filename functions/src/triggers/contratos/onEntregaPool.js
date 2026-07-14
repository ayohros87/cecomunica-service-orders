const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");

// Pool de equipos: cuando el contrato recibe la señal de ENTREGA
// (`entrega_confirmada` pasa a true — la estampa onOrdenEntregada o el callable
// gestionarFacturacion:confirmar_entrega), las unidades del pool asignadas a
// este contrato pasan de asignado_contrato → en_cliente.
// Plan: docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md (§3.3).
module.exports = onDocumentUpdated(
  { document: "contratos/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    if (before.entrega_confirmada === true || after.entrega_confirmada !== true) return null;

    const cid = event.params.cid;
    try {
      const snap = await db.collection("contratos").doc(cid).collection("seriales").get();
      let movidos = 0;
      for (const d of snap.docs) {
        const s = d.data();
        if (!s.serial) continue;
        const r = await pool.transicionar(s.serial, s.modelo_id, s.modelo, {
          aEstado: pool.ESTADOS.EN_CLIENTE,
          soloDesde: [pool.ESTADOS.ASIGNADO],
          condicion: (doc) => doc.asignacion?.contrato_doc_id === cid,
          tipo: "entrega",
          refMov: { tipo: "contrato", id: cid, label: s.contrato_id || after.contrato_id || "" },
        });
        if (r === "transicion") movidos++;
      }
      if (movidos) logger.info("[onEntregaPool] Unidades entregadas en el pool", { cid, movidos });
    } catch (e) {
      logger.warn("[onEntregaPool] Pool sync falló (no crítico)", { cid, message: e.message });
    }
    return null;
  }
);
