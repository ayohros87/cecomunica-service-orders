// Reconciliación diaria del resumen del pool. Recalcula `agregados_pool`
// desde cero y corrige la deriva que hayan dejado los deltas del trigger
// (contención en un backfill, un write que no lo disparó, un script en crudo).
//
// Cuesta una lectura por ficha del pool UNA vez al día (~7,600) — contra las
// ~197,000 diarias que costaba que Existencias barriera el pool en cada
// apertura. Corre antes de la jornada para que el día empiece cuadrado.
//
// Con ese MISMO barrido se arma la salud del catálogo (2026-11-11): antes
// tenía su cron a las 06:45 y volvía a leer el pool entero. Si el reporte de
// salud falla, la reconciliación ya quedó hecha y no se repite.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const AG = require("../../domain/agregadoPool");
const SALUD = require("./saludCatalogo");

module.exports = onSchedule(
  {
    schedule: "every day 05:30",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const db = getFirestore();
    const campos = [...new Set([...AG.CAMPOS_POOL, ...SALUD.CAMPOS_POOL])];
    const poolSnap = await db.collection("equipos_pool").select(...campos).get();
    const R = await AG.recalcular(db, { poolSnap });
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
    try { await SALUD.guardarSaludCatalogo({ poolSnap }); }
    catch (e) { logger.error("[agregadoPool] la salud del catálogo falló", { message: e?.message }); }
    return null;
  }
);
