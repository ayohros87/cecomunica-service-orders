// Reconciliación diaria del resumen del pool. Recalcula `agregados_pool`
// desde cero y corrige la deriva que hayan dejado los deltas del trigger
// (contención en un backfill, un write que no lo disparó, un script en crudo).
//
// Cuesta una lectura por ficha del pool UNA vez al día (~7,600) — contra las
// ~197,000 diarias que costaba que Existencias barriera el pool en cada
// apertura. Corre antes de la jornada para que el día empiece cuadrado.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const AG = require("../../domain/agregadoPool");

module.exports = onSchedule(
  {
    schedule: "every day 05:30",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
    memory: "512MiB",
  },
  async () => {
    const R = await AG.recalcular(getFirestore());
    // La deriva se reporta SIEMPRE, aunque ya esté corregida: si aparece cada
    // día hay un camino de escritura que no pasa por el trigger, y eso es un
    // defecto que hay que buscar, no un número que basta con reescribir.
    if (R.ok) {
      logger.info("[agregadoPool] reconciliado sin deriva", { fichas: R.fichas, modelos: R.modelos });
    } else {
      logger.warn("[agregadoPool] habia deriva — corregida", {
        fichas: R.fichas, modelos: R.modelos,
        difs: R.difs.length, sobrantes: R.sobrantes.length,
        muestra: R.difs.slice(0, 20),
      });
    }
    return null;
  }
);
