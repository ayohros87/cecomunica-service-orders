// Cierra las ÓRDENES DE SERVICIO de un contrato anulado — la ESCRITURA.
// La decisión (qué se anula, qué se repunta, qué no se toca) y el porqué
// completo viven en domain/ordenesAnulacion.js, que es lógica pura y se prueba
// sin emulador. Aquí solo está lo que habla con Firestore.
"use strict";

const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { planOrdenes, ANULADA } = require("../domain/ordenesAnulacion");

/**
 * Aplica el plan sobre Firestore. Idempotente: una orden ya ANULADA queda fuera
 * por `estaViva`, y repuntar dos veces al mismo contrato escribe lo mismo. Un
 * fallo por orden no aborta el resto — se registra y se sigue.
 *
 * @returns {{anuladas:string[], repuntadas:string[], intactas:number}}
 */
async function cerrarOrdenesDeContratoAnulado(contratoDocId, contrato = {}, opts = {}) {
  const numero = contrato.contrato_id || contratoDocId;
  const motivo = String(contrato.anulado_motivo || "").trim();
  const snap = await db.collection("ordenes_de_servicio")
    .where("contrato.contrato_doc_id", "==", contratoDocId).get();
  const ordenes = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));

  const plan = planOrdenes(ordenes, {
    sustitutoId: contrato.sustituido_por_id || null,
    sustitutoNumero: contrato.sustituido_por_contrato_id || "",
    ...opts,
  });

  const res = { anuladas: [], repuntadas: [], revisar: [], intactas: plan.intactas.length };

  for (const o of plan.repuntar) {
    try {
      await db.collection("ordenes_de_servicio").doc(o.id).set({
        contrato: {
          aplica: true,
          contrato_doc_id: o.sustitutoId,
          contrato_id: o.sustitutoNumero || "",
          motivo_no_aplica: null,
        },
        contrato_repuntado_desde: numero,
        contrato_repuntado_at: admin.firestore.FieldValue.serverTimestamp(),
        // Si la orden venía SEÑALADA de una anulación anterior sin sustituto
        // (declararSustitutoContrato la repunta después), la marca se apaga.
        contrato_anulado_revisar: admin.firestore.FieldValue.delete(),
        os_logs: admin.firestore.FieldValue.arrayUnion({
          action: "REPUNTAR_CONTRATO", by: "system:anulacion",
          nota: `El contrato ${numero} se anuló por SUSTITUCIÓN: esta orden pasa a ${o.sustitutoNumero || o.sustitutoId}.`,
        }),
      }, { merge: true });
      res.repuntadas.push(o.id);
    } catch (e) {
      logger.error("[ordenesContratoAnulado] no se pudo repuntar la orden",
        { orden: o.id, contrato: numero, message: e.message });
    }
  }

  for (const o of plan.anular) {
    try {
      await db.collection("ordenes_de_servicio").doc(o.id).set({
        estado_reparacion: ANULADA,
        estado_previo: o.data.estado_reparacion || null,
        anulada_por_contrato: numero,
        anulada_motivo: motivo || "contrato anulado",
        anulada_at: admin.firestore.FieldValue.serverTimestamp(),
        os_logs: admin.firestore.FieldValue.arrayUnion({
          action: "ANULAR", by: "system:anulacion",
          nota: `Contrato ${numero} ANULADO${motivo ? ` — ${motivo}` : ""}: no hay contrato bajo el cual entregar estos equipos.`,
        }),
      }, { merge: true });
      res.anuladas.push(o.id);
    } catch (e) {
      logger.error("[ordenesContratoAnulado] no se pudo anular la orden",
        { orden: o.id, contrato: numero, message: e.message });
    }
  }

  // Ni se anula ni se repunta: se SEÑALA. La orden sigue exactamente donde
  // estaba —su estado no se toca— y queda con el aviso encima para que la
  // bandeja y quien la abra vean que su contrato murió y falta decidir.
  for (const o of plan.revisar) {
    try {
      await db.collection("ordenes_de_servicio").doc(o.id).set({
        contrato_anulado_revisar: {
          contrato: numero, contrato_doc_id: contratoDocId,
          motivo: motivo || "contrato anulado",
          equipos_n: o.equipos_n,
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
        os_logs: admin.firestore.FieldValue.arrayUnion({
          action: "CONTRATO_ANULADO", by: "system:anulacion",
          nota: `El contrato ${numero} fue ANULADO${motivo ? ` — ${motivo}` : ""} y esta orden ya tiene `
            + `${o.equipos_n} equipo(s) preparados: decide si pasa al contrato nuevo o se anula.`,
        }),
      }, { merge: true });
      res.revisar.push({ id: o.id, equipos_n: o.equipos_n });
    } catch (e) {
      logger.error("[ordenesContratoAnulado] no se pudo señalar la orden",
        { orden: o.id, contrato: numero, message: e.message });
    }
  }

  if (res.anuladas.length || res.repuntadas.length || res.revisar.length) {
    logger.info("[ordenesContratoAnulado] ordenes resueltas", { contrato: numero, ...res });
  }
  return res;
}

module.exports = { cerrarOrdenesDeContratoAnulado };
