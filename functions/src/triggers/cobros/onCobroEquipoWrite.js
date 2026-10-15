// onCobroEquipoWrite — servidor de la bandeja "Equipos no devueltos".
//
// Hoy hace UNA cosa (2026-10-15, pedido de Solangel): cuando alguien pide la
// cotización de la reposición de un equipo no devuelto (`cotizacion_pedida`
// en el renglón), arma la cotización de taller y la deja en borrador para que
// la jefatura de taller la envíe. El navegador no puede numerarla ni firmarla
// (el correlativo y el firmante viven en el servidor), así que el renglón
// solo lleva la marca y este trigger hace el resto.
//
// Idempotente: lib/reposicionNoDevuelto reserva `cotizacion_en_curso` en
// transacción ANTES de crear nada; el eco de este mismo trigger al escribir
// cotizacion_doc_id no vuelve a entrar (ver memoria: eco de triggers).
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

module.exports = onDocumentWritten(
  { document: "cobros_equipos/{rowId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return null;
    if (!after.cotizacion_pedida || after.cotizacion_doc_id || after.cotizacion_en_curso) return null;
    const rowId = event.params.rowId;
    try {
      const r = await require("../../lib/reposicionNoDevuelto").crearCotizacionNoDevuelto(rowId);
      if (r) logger.info("[onCobroEquipoWrite] cotización de reposición creada", { rowId, ...r });
    } catch (e) {
      logger.error("[onCobroEquipoWrite] cotización de reposición NO creada", { rowId, error: e.message });
    }
    return null;
  }
);
