// Diario 05:45 Panamá: los contratos aprobados —y desde el 2-oct-2026 los
// anexos de aumento en 'pendiente_firma'— que llevan 45 días desde su
// APROBACIÓN (o su reactivación) sin la firma del cliente se DUERMEN
// (decisión de Alberto, 1-oct-2026): caduca la
// solicitud y el enlace de firma, el contrato sale de "Contratos por firmar"
// y deja de contar como trámite de la cuenta; lo reactiva el vendedor desde
// el Centro. Regla en domain/contratoDormido; recorrido en lib/dormirContratos.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { dormirContratosSinFirma } = require("../../lib/dormirContratos");

module.exports = onSchedule(
  {
    schedule: "every day 05:45",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
    timeoutSeconds: 300,
  },
  async () => {
    const r = await dormirContratosSinFirma({ dryRun: false });
    logger.info("[dormirContratosSinFirma] fin", r);
    return null;
  }
);
