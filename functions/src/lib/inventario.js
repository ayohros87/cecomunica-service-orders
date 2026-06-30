// Helpers del flujo de seriales de inventario, compartidos entre el trigger de
// aprobación (onApproval) y el recordatorio programado (recordatorioSeriales).
const logger = require("firebase-functions/logger");
const { db } = require("./admin");

// URL base de la app (para los enlaces "Agregar seriales" en los correos).
const APP_BASE_URL = "https://app.cecomunica.net";

// Fallback del buzón de inventario cuando empresa/config no tiene destinatarios.
const INVENTARIO_EMAIL_FALLBACK = "inventario@cecomunica.com";

// Destinatarios de los correos a inventario: empresa/config.email_solicitud_seriales
// (configurable por admin) o el fallback constante. Nunca lanza.
async function inventarioEmailTo() {
  try {
    const snap = await db.collection("empresa").doc("config").get();
    const arr = snap.exists ? snap.data().email_solicitud_seriales : null;
    if (Array.isArray(arr) && arr.length) return arr.join(", ");
  } catch (e) {
    logger.warn("[inventario] No se pudo leer empresa/config; usando fallback.", { message: e.message });
  }
  return INVENTARIO_EMAIL_FALLBACK;
}

module.exports = { APP_BASE_URL, INVENTARIO_EMAIL_FALLBACK, inventarioEmailTo };
