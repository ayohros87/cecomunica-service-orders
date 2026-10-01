const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");
const G = require("../../lib/gestiones");

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
      // Los sustituidos por un reemplazo NO se entregaron: se quitaron de la
      // orden y salió su entrante (SERV20260918-01, 2026-09-18 — la entrega
      // marcó en_cliente a 22806A0291/0294 cuando estaban en el taller). Si la
      // lectura falla (null) se sigue como antes.
      const sustituidos = new Set(((await G.salientesDeReemplazo(cid)) || []).map(pool.normSerial));
      let movidos = 0;
      for (const d of snap.docs) {
        const s = d.data();
        if (!s.serial) continue;
        if (sustituidos.has(pool.normSerial(s.serial))) continue;
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
