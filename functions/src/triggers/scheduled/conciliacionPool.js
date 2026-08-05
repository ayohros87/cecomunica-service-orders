// Cron de la conciliación semanal del pool. La lógica vive en
// src/domain/conciliacionPool.js para poder re-correrla a demanda tras una
// limpieza (functions/scripts/correr-conciliacion.js) sin esperar al lunes.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const conciliacion = require("../../domain/conciliacionPool");

module.exports = onSchedule(
  {
    schedule: "every monday 06:40",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
    memory: "512MiB",
  },
  async () => {
    const R = await conciliacion.ejecutar();
    logger.info("[conciliacionPool] reporte semanal", {
      total: R.total, A: R.A_contrato_sin_ficha, B: R.B_taller_orden_cerrada,
      C1: R.C_poc_sin_ficha, C2: R.C_poc_sin_enlace, D: R.D_asignada_a_anulado,
      E: R.E_vendido_orden_cerrada, F: R.F_serial_dos_clientes,
      G: R.G_asignada_sin_serial,
      pocApagadosIgnorados: R.poc_apagados_ignorados,
    });
    return null;
  }
);
