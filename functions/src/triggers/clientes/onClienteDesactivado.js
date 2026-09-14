// El cliente dejó de ser cliente → sus contratos vigentes se CIERRAN.
//
// Regla de negocio (Alberto, 2026-09-14): "asume que todos los clientes que
// desactivo también hay que cerrar sus contratos". Desactivar es el acto de
// cobros que declara que la cuenta terminó; hasta hoy el contrato seguía
// 'activo' detrás, contando para vencimientos, comisiones y la bandeja de
// pendientes, mientras el cliente ya ni aparecía en la lista del Centro (el
// toggle "Solo activos" viene encendido). 24 de los 96 inactivos estaban así.
//
// Corre SERVER-SIDE a propósito: `activo` se toca desde tres pantallas (ficha
// del cliente, casilla en línea del grid y el botón de desactivación masiva) y
// también desde scripts. Un guardarraíl en una sola de ellas se salta solo.
//
// Lo que NO hace:
//   · no toca los equipos. Si quedan radios en campo el cierre los deja como
//     están y lo deja dicho en `cierre_masivo.equipos_en_campo`: recuperarlos
//     es una devolución física, no un cambio de estado.
//   · no reabre nada al reactivar. Volver a marcar `activo` no resucita un
//     contrato cerrado — si el cliente vuelve, se le hace contrato nuevo.
//   · no toca los que están en trámite (pendiente_aprobacion): esos se anulan
//     o se aprueban, no se vencen.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { db } = require("../../lib/admin");
const { VIGENTES, esDesactivacion, buildCierre } = require("../../domain/cierreContrato");

module.exports = onDocumentUpdated(
  { document: "clientes/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const cid = event.params.cid;

    // Solo el CRUCE true → false (la regla vive en domain/cierreContrato.js).
    if (!esDesactivacion(before, after)) return null;

    try {
      const snap = await db.collection("contratos").where("cliente_id", "==", cid).get();
      const cerrados = [];
      for (const d of snap.docs) {
        const c = d.data();
        if (c.deleted === true) continue;
        if (!VIGENTES.has(String(c.estado || "").toLowerCase())) continue;
        try {
          await d.ref.update({
            ...buildCierre(c, {
              motivo: `Cliente desactivado el ${new Date().toISOString().slice(0, 10)}: la cuenta terminó`,
              por_uid: after.updated_by || null,
              FieldValue: admin.firestore.FieldValue,
            }),
            cierre_masivo: {
              origen: "cliente_desactivado",
              cliente_id: cid,
              por_uid: after.updated_by || null,
              at: admin.firestore.FieldValue.serverTimestamp(),
            },
          });
          cerrados.push(c.contrato_id || d.id);
        } catch (e) {
          logger.warn("[onClienteDesactivado] contrato no cerrado", { cid, contrato: d.id, message: e.message });
        }
      }
      if (cerrados.length) {
        // Queda en el MISMO historial que el resto de la ficha, para que quien
        // audite la desactivación vea su consecuencia sin ir a otra colección.
        await db.collection("clientes").doc(cid).collection("historial").add({
          tipo: "cierre_contratos",
          nota: `Cliente desactivado: se cerraron ${cerrados.length} contrato(s) vigente(s) — ${cerrados.join(", ")}`,
          contratos: cerrados,
          por_uid: after.updated_by || null,
          at: admin.firestore.FieldValue.serverTimestamp(),
        }).catch((e) => logger.warn("[onClienteDesactivado] historial no escrito", { cid, message: e.message }));
        logger.info("[onClienteDesactivado] contratos cerrados", { cid, nombre: after.nombre, cerrados });
      }
    } catch (e) {
      logger.error("[onClienteDesactivado] falló", { cid, message: e.message });
    }
    return null;
  },
);
