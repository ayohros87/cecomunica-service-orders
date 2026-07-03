const { onDocumentWritten, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db }               = require("../../lib/admin");
const { recalcularCacheContrato, recomputarContadorTx } = require("../../domain/contractCache");

const onContratoOrdenWrite = onDocumentWritten(
  {
    document: "contratos/{contratoId}/ordenes/{ordenId}",
    region: "us-central1"
  },
  async (event) => {
    const contratoId = event.params.contratoId;
    const ordenId    = event.params.ordenId;

    const beforeData = event.data.before?.data() || null;
    const afterData  = event.data.after?.data()  || null;

    if (!beforeData && !afterData) {
      logger.warn("[onContratoOrdenWrite] Caso inesperado: ambos null", { contratoId, ordenId });
      return null;
    }

    // Solo recomputa el contador cuando el cambio en el doc de caché PODRÍA
    // afectarlo: alta, baja, cambio de equipos_count, o del flag `eliminado`.
    // Un update que solo toca serials/updated_at no mueve el contador → se omite
    // para no re-leer la subcolección en vano.
    const equiposBefore   = Number(beforeData?.equipos_count || 0);
    const equiposAfter    = Number(afterData?.equipos_count  || 0);
    const eliminadoBefore = beforeData?.eliminado === true;
    const eliminadoAfter  = afterData?.eliminado === true;

    const esCreate = !beforeData && !!afterData;
    const esDelete = !!beforeData && !afterData;
    const cambioRelevante = esCreate || esDelete
      || equiposBefore !== equiposAfter
      || eliminadoBefore !== eliminadoAfter;

    if (!cambioRelevante) {
      logger.info("[onContratoOrdenWrite] Cambio sin impacto en el contador, salir", { contratoId, ordenId });
      return null;
    }

    // DUEÑO ÚNICO del contador: recompute transaccional desde la subcolección.
    // Reemplaza el delta incremental que competía con recalcularCacheContrato.
    await recomputarContadorTx(contratoId);
    logger.info("[onContratoOrdenWrite] Contador recomputado", { contratoId, ordenId, esCreate, esDelete });
    return null;
  }
);

const onOrdenWriteSyncContratoCache = onDocumentWritten(
  {
    document: "ordenes_de_servicio/{ordenId}",
    region: "us-central1"
  },
  async (event) => {
    const ordenId    = event.params.ordenId;
    const beforeData = event.data.before?.data() || null;
    const afterData  = event.data.after?.data()  || null;

    logger.info("[onOrdenWriteSyncContratoCache] Triggered", {
      ordenId, hasBefore: !!beforeData, hasAfter: !!afterData
    });

    function normalizeSerial(equipo) {
      if (!equipo) return "";
      return (equipo.serial || equipo.SERIAL || equipo.numero_de_serie || "").toString().trim();
    }

    function extractCacheData(ordenData) {
      if (!ordenData) return null;

      const equipos = (ordenData.equipos || []).filter(e => !e.eliminado);
      const serials = equipos.map(normalizeSerial).filter(Boolean);

      return {
        numero_orden:       ordenId,
        cliente_id:         ordenData.cliente_id         || null,
        cliente_nombre:     ordenData.cliente_nombre     || null,
        tipo_de_servicio:   ordenData.tipo_de_servicio   || null,
        estado_reparacion:  ordenData.estado_reparacion  || null,
        fecha_creacion:     ordenData.fecha_creacion     || null,
        equipos: equipos.map(e => ({
          serial:        normalizeSerial(e),
          modelo:        e.modelo || e.MODEL || e.modelo_nombre || "",
          observaciones: e.observaciones || e.descripcion || e.nombre || "",
          unit_id:       e.unit_id || e.unitId || "",
          sim:           e.sim || e.simcard || ""
        })),
        equipos_count: equipos.length,
        serials,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      };
    }

    function getApplicableContract(ordenData) {
      if (!ordenData) return null;
      const contrato = ordenData.contrato;
      if (!contrato || !contrato.aplica || !contrato.contrato_doc_id) return null;
      return contrato.contrato_doc_id;
    }

    const beforeContratoId = getApplicableContract(beforeData);
    const afterContratoId  = getApplicableContract(afterData);
    const wasSoftDeleted   = !beforeData?.eliminado && afterData?.eliminado === true;

    logger.info("[onOrdenWriteSyncContratoCache] Contract analysis", {
      ordenId, beforeContratoId, afterContratoId,
      hasChange: beforeContratoId !== afterContratoId, wasSoftDeleted
    });

    if (wasSoftDeleted && afterContratoId) {
      logger.info("[onOrdenWriteSyncContratoCache] Soft delete detected", { ordenId, contratoId: afterContratoId });
      try {
        await db.collection("contratos").doc(afterContratoId)
          .collection("ordenes").doc(ordenId)
          .update({ eliminado: true, updated_at: admin.firestore.FieldValue.serverTimestamp() });

        await recalcularCacheContrato(afterContratoId);
        logger.info("[onOrdenWriteSyncContratoCache] Soft delete processed", { ordenId, contratoId: afterContratoId });
        return null;
      } catch (err) {
        logger.error("[onOrdenWriteSyncContratoCache] Error processing soft delete", {
          ordenId, contratoId: afterContratoId, error: err.message
        });
      }
    }

    if (beforeContratoId && beforeContratoId !== afterContratoId) {
      try {
        await db.collection("contratos").doc(beforeContratoId)
          .collection("ordenes").doc(ordenId).delete();

        logger.info("[onOrdenWriteSyncContratoCache] Cleaned old contract cache", {
          ordenId, oldContratoId: beforeContratoId
        });

        await recalcularCacheContrato(beforeContratoId);
      } catch (err) {
        logger.error("[onOrdenWriteSyncContratoCache] Error cleaning old cache", {
          ordenId, oldContratoId: beforeContratoId, error: err.message
        });
      }
    }

    if (afterContratoId && afterData) {
      try {
        const cacheData = extractCacheData(afterData);

        if (!cacheData) {
          logger.warn("[onOrdenWriteSyncContratoCache] No cache data extracted", { ordenId });
          return null;
        }

        await db.collection("contratos").doc(afterContratoId)
          .collection("ordenes").doc(ordenId)
          .set(cacheData, { merge: true });

        logger.info("[onOrdenWriteSyncContratoCache] Updated cache", {
          ordenId, contratoId: afterContratoId,
          equiposCount: cacheData.equipos_count, serialsCount: cacheData.serials.length
        });

        const resumenUpdate = {
          os_linked:             true,
          os_last_orden_id:      ordenId,
          os_last_updated_at:    admin.firestore.FieldValue.serverTimestamp(),
          os_equipos_count_last: cacheData.equipos_count,
          os_serials_preview:    cacheData.serials.slice(0, 3),
          os_has_equipos:        cacheData.equipos_count > 0,
          updated_at:            admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection("contratos").doc(afterContratoId).update(resumenUpdate);

        logger.info("[onOrdenWriteSyncContratoCache] Updated contract summary", {
          ordenId, contratoId: afterContratoId, resumen: resumenUpdate
        });
      } catch (err) {
        logger.error("[onOrdenWriteSyncContratoCache] Error updating cache", {
          ordenId, contratoId: afterContratoId, error: err.message, stack: err.stack
        });
      }
    }

    if (!afterContratoId && beforeContratoId) {
      try {
        await db.collection("contratos").doc(beforeContratoId)
          .collection("ordenes").doc(ordenId).delete();

        logger.info("[onOrdenWriteSyncContratoCache] Removed cache (no longer linked)", {
          ordenId, oldContratoId: beforeContratoId
        });

        await recalcularCacheContrato(beforeContratoId);
      } catch (err) {
        logger.error("[onOrdenWriteSyncContratoCache] Error removing cache", {
          ordenId, contratoId: beforeContratoId, error: err.message
        });
      }
    }

    return null;
  }
);

const onOrdenHardDelete = onDocumentDeleted(
  {
    document: "ordenes_de_servicio/{ordenId}",
    region: "us-central1"
  },
  async (event) => {
    const ordenId     = event.params.ordenId;
    const deletedData = event.data.data();

    logger.info("[onOrdenHardDelete] Hard delete detected", { ordenId, hadData: !!deletedData });

    if (!deletedData) {
      logger.warn("[onOrdenHardDelete] No data available for deleted order", { ordenId });
      return null;
    }

    const contrato   = deletedData.contrato;
    const contratoId = contrato?.contrato_doc_id;

    if (!contratoId) {
      logger.info("[onOrdenHardDelete] No contract linked, nothing to clean", { ordenId });
      return null;
    }

    logger.info("[onOrdenHardDelete] Processing deletion for contract", { ordenId, contratoId });

    try {
      await db.collection("contratos").doc(contratoId)
        .collection("ordenes").doc(ordenId).delete();

      logger.info("[onOrdenHardDelete] Cache deleted", { ordenId, contratoId });

      await recalcularCacheContrato(contratoId);

      logger.info("[onOrdenHardDelete] Contract cache recalculated", { ordenId, contratoId });
    } catch (err) {
      logger.error("[onOrdenHardDelete] Error processing hard delete", {
        ordenId, contratoId, error: err.message, stack: err.stack
      });
    }

    return null;
  }
);

module.exports = { onContratoOrdenWrite, onOrdenWriteSyncContratoCache, onOrdenHardDelete };
