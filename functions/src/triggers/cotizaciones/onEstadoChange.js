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
const admin = require("firebase-admin");
const { db } = require("../../lib/admin");
const { avisarPiezasABodega } = require("../../lib/piezasBodega");
const { gestionesDe } = require("../../lib/cotizacionServicio");

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

    // La reposición de un equipo NO DEVUELTO (lib/reposicionNoDevuelto) es de
    // taller pero puede no tener orden (el renglón nació de un contrato de
    // papel): entra igual.
    if ((after.origen || "") !== "orden" || (!after.orden_id && !after.cobro_equipo_id)) return null;

    // Reposición por daño: una cotización puede cobrar varias (gestion_ids).
    const esReposicion = gestionesDe(after).length > 0;

    const estadoAntes   = String(before.estado || "");
    const estadoDespues = String(after.estado  || "");
    if (estadoAntes === estadoDespues) return null;

    // ── El cliente ACEPTÓ (2026-09-25, pedido de Solangel) ────────────────
    // En el taller 'convertida' es "el cliente aceptó → a facturar". El mismo
    // clic abre la fila en Facturación pendiente, aunque el equipo siga en el
    // taller (decisión de Alberto): la fila dice dónde está. Si la cotización
    // cobra la REPOSICIÓN de un radio dañado, además libera a bodega.
    if (estadoDespues === "convertida") {
      try {
        const { abrirFacturacionCotizacion } = require("../../lib/facturacionCotizacion");
        await abrirFacturacionCotizacion(event.data.after, { momento: "aceptacion" });
      } catch (e) {
        logger.error("[onCotizacionEstadoChange] cotización aceptada NO enviada a facturar", {
          error: e.message, cotizacionId: event.params.docId,
        });
      }
      if (esReposicion) {
        try { await require("../../lib/reposicionDano").alAceptarseTodas(event.params.docId, after); }
        catch (e) {
          logger.error("[onCotizacionEstadoChange] reposición aceptada: la gestión no avanzó", {
            error: e.message, cotizacionId: event.params.docId, gestiones: gestionesDe(after),
          });
        }
      }
      // Equipo NO DEVUELTO (2026-10-15): el renglón de cobro se entera.
      if (after.cobro_equipo_id) {
        try { await require("../../lib/reposicionNoDevuelto").alAceptarse(event.params.docId, after); }
        catch (e) {
          logger.error("[onCotizacionEstadoChange] no devuelto aceptado: el renglón no se marcó", {
            error: e.message, cotizacionId: event.params.docId, cobro: after.cobro_equipo_id,
          });
        }
      }
    }
    if (estadoDespues === "rechazada" && after.cobro_equipo_id) {
      try { await require("../../lib/reposicionNoDevuelto").alRechazarse(event.params.docId, after); }
      catch (e) {
        logger.error("[onCotizacionEstadoChange] no devuelto rechazado: el renglón no pasó a cobranza", {
          error: e.message, cotizacionId: event.params.docId, cobro: after.cobro_equipo_id,
        });
      }
    }
    // El cliente NO aceptó la reposición → la gestión se cierra y el daño
    // pasa a cobranza (lib/reposicionDano). Una reparación normal rechazada
    // solo reabre el candado de materiales, más abajo.
    if (estadoDespues === "rechazada" && esReposicion) {
      try { await require("../../lib/reposicionDano").alRechazarseTodas(event.params.docId, after); }
      catch (e) {
        logger.error("[onCotizacionEstadoChange] reposición rechazada: la gestión no se cerró", {
          error: e.message, cotizacionId: event.params.docId, gestiones: gestionesDe(after),
        });
      }
    }
    // La cotización de una REPOSICIÓN no es de piezas: no bloquea los
    // materiales de la orden ni manda resumen a bodega (el radio de
    // reposición lo pide la gestión, no esta cotización).
    if (esReposicion || after.cobro_equipo_id) return null;

    let emitida = null;
    if (ESTADOS_BLOQUEAN.includes(estadoDespues)) emitida = true;
    else if (ESTADOS_REABREN.includes(estadoDespues)) emitida = false;
    // Una VENCIDA que el taller pasa a facturar (2026-10-01, "sin respuesta
    // del cliente"): el vencimiento reabrió los materiales, y lo que se va a
    // facturar tiene que volver a quedar fijo.
    else if (estadoDespues === "convertida" && ESTADOS_REABREN.includes(estadoAntes)) emitida = true;
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

    // Aviso de piezas a bodega (lib/piezasBodega), en el mismo momento en que
    // se cierra el consumo de la orden. Va en su propio try: si falla, el
    // candado de arriba —que protege la integridad de la orden— ya quedó.
    // Si la orden no tiene consumos (cotización escrita a mano) el detalle
    // sale de los renglones de la cotización. La marca `resumen_bodega_at`
    // evita el reintento en borrador→enviada→aprobada; el duplicado real lo
    // corta la huella de la orden (el cierre de la visita pudo avisar antes).
    if (emitida === true && !after.resumen_bodega_at) {
      try {
        const r = await avisarPiezasABodega({ ordenId: String(after.orden_id), cot: after, momento: "cotizacion" });
        if (r.enviado || /^ya_avisado/.test(r.motivo || "")) {
          // Escribir aquí no recursa: el guard `estadoAntes === estadoDespues`
          // de arriba corta la re-entrada porque este update no toca `estado`.
          await event.data.after.ref.set(
            { resumen_bodega_at: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        } else {
          logger.info("[onCotizacionEstadoChange] sin aviso de piezas a bodega", { ordenId: after.orden_id, motivo: r.motivo });
        }
      } catch (e) {
        logger.error("[onCotizacionEstadoChange] resumen a bodega falló", {
          message: e.message,
          ordenId: after.orden_id,
          cotizacionId: event.params.docId,
        });
      }
    }
    return null;
  }
);
