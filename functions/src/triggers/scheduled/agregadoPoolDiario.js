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
    const db = getFirestore();
    const R = await AG.recalcular(db);
    // La deriva se reporta SIEMPRE, aunque ya esté corregida: si aparece cada
    // día hay un camino de escritura que no pasa por el trigger, y eso es un
    // defecto que hay que buscar, no un número que basta con reescribir.
    // El log es para enterarse; el registro que aguanta vive en
    // admin_reportes/agregado_pool (lo escribe recalcular), porque los logs
    // caducan y nadie los mira por su cuenta.
    const rep = (await db.collection(AG.REPORTE).doc(AG.REPORTE_DOC).get()).data() || {};
    if (R.ok && !rep.venia_marcado) {
      logger.info("[agregadoPool] reconciliado sin deriva", {
        fichas: R.fichas, modelos: R.modelos,
        limpias_seguidas: rep.corridas_limpias_seguidas,
      });
    } else {
      logger.warn("[agregadoPool] habia deriva — corregida y registrada", {
        fichas: R.fichas, modelos: R.modelos,
        difs: R.difs.length, sobrantes: R.sobrantes.length,
        venia_marcado: rep.venia_marcado, motivo_previo: rep.motivo_previo,
        derivas_registradas: rep.derivas_registradas,
        muestra: R.difs.slice(0, 20),
      });
    }
    return null;
  }
);
