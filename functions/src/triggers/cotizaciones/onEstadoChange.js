// Candado de materiales del taller: cuando una cotización nacida de una orden
// (origen='orden') se ENVÍA o APRUEBA, la orden se marca cotizacion_emitida →
// el modal de materiales (ordenes-equipos) y el flujo de consumos quedan
// bloqueados para que lo cotizado no diverja de lo registrado. Si la
// cotización se RECHAZA o VENCE, el candado se reabre (equivale al viejo
// "desbloquear cotización" de trabajar-orden, eliminada en b4cefac).
// Server-side y con dueño único porque el estado cambia por varios caminos:
// aprobación por deep-link, edición, y el scheduled markCotizacionesVencidas.

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { db } = require("../../lib/admin");

const ESTADOS_BLOQUEAN = ["enviada", "aprobada"];
const ESTADOS_REABREN  = ["rechazada", "vencida"];

module.exports = onDocumentUpdated(
  {
    document: "cotizaciones/{docId}",
    region: "us-central1",
  },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};

    if ((after.origen || "") !== "orden" || !after.orden_id) return null;

    const estadoAntes   = String(before.estado || "");
    const estadoDespues = String(after.estado  || "");
    if (estadoAntes === estadoDespues) return null;

    let emitida = null;
    if (ESTADOS_BLOQUEAN.includes(estadoDespues)) emitida = true;
    else if (ESTADOS_REABREN.includes(estadoDespues)) emitida = false;
    if (emitida === null) return null; // borrador/convertida no tocan el candado

    try {
      await db.collection("ordenes_de_servicio").doc(String(after.orden_id)).set(
        { cotizacion_emitida: emitida },
        { merge: true }
      );
      logger.info("[onCotizacionEstadoChange] candado actualizado", {
        ordenId: after.orden_id,
        cotizacionId: event.params.docId,
        estado: estadoDespues,
        emitida,
      });
    } catch (e) {
      logger.error("[onCotizacionEstadoChange] error actualizando la orden", {
        message: e.message,
        ordenId: after.orden_id,
        cotizacionId: event.params.docId,
      });
    }
    return null;
  }
);
