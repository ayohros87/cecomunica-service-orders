// Cuadre SEMANAL de verificaciones/ (el espejo público del QR) contra
// contratos/. El trigger onContratoActivado propaga el estado al cambiar;
// esto es la red de seguridad para lo que se le escapó (escritura fallida,
// contrato tocado por un script, backfill pendiente): auditoría de módulos
// 2026-09-30, Contratos R1. Lunes 05:30 hora Panamá, antes de que alguien
// imprima o escanee algo.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { cuadrarVerificaciones } = require("../../lib/cuadreVerificaciones");

module.exports = onSchedule(
  {
    schedule: "every monday 05:30",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
    timeoutSeconds: 300,
  },
  async () => {
    const r = await cuadrarVerificaciones({ dryRun: false, tag: "cuadreVerificaciones" });
    const { detalle, ...resumen } = r;
    logger.info("[cuadreVerificaciones] fin", resumen);
    return null;
  }
);
