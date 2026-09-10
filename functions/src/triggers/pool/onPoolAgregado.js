// Mantiene `agregados_pool` al día — el resumen por modelo que Almacén ·
// Existencias lee en vez de barrer las 7,592 fichas del pool.
// La lógica vive en src/domain/agregadoPool.js (se re-corre a demanda con
// functions/scripts/backfill-agregado-pool.js).
//
// NUNCA lanza: un delta perdido es un número corrido hasta la reconciliación
// del día siguiente, mientras que reintentar en bucle contra un doc en
// contención multiplica las escrituras. Falla → se anota la deriva y sigue.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const AG = require("../../domain/agregadoPool");

module.exports = onDocumentWritten(
  { document: "equipos_pool/{id}", region: "us-central1" },
  async (event) => {
    const antes = event.data?.before?.exists ? event.data.before.data() : null;
    const despues = event.data?.after?.exists ? event.data.after.data() : null;
    try {
      await AG.aplicarDelta(getFirestore(), { antes, despues });
    } catch (e) {
      logger.error("[agregadoPool] delta falló; lo corrige la reconciliación", {
        id: event.params?.id, err: e?.message,
      });
      try {
        await AG.marcarDeriva(getFirestore(), `delta ${event.params?.id}: ${e?.message}`);
      } catch { /* la marca es best-effort: no vale tumbar el trigger */ }
    }
    return null;
  }
);
