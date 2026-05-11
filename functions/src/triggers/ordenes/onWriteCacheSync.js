const { onDocumentWritten, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db }               = require("../../lib/admin");
const { recalcularCacheContrato } = require("../../domain/contractCache");

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

    let deltaOrdenes = 0;
    let deltaEquipos = 0;

    const equiposCountBefore = Number(beforeData?.equipos_count || 0);
    const equiposCountAfter  = Number(afterData?.equipos_count  || 0);

    if (!beforeData && afterData) {
      deltaOrdenes = 1;
      deltaEquipos = equiposCountAfter;
      logger.info("[onContratoOrdenWrite] CREATE", { contratoId, ordenId, equiposCountAfter, deltaOrdenes, deltaEquipos });
    } else if (beforeData && afterData) {
      deltaOrdenes = 0;
      deltaEquipos = equiposCountAfter - equiposCountBefore;
      logger.info("[onContratoOrdenWrite] UPDATE", { contratoId, ordenId, equiposCountBefore, equiposCountAfter, deltaEquipos });
    } else if (beforeData && !afterData) {
      deltaOrdenes = -1;
      deltaEquipos = -equiposCountBefore;
      logger.info("[onContratoOrdenWrite] DELETE", { contratoId, ordenId, equiposCountBefore, deltaOrdenes, deltaEquipos });
    } else {
      logger.warn("[onContratoOrdenWrite] Caso inesperado: ambos null", { contratoId, ordenId });
      return null;
    }

    if (deltaOrdenes === 0 && deltaEquipos === 0) {
      logger.info("[onContratoOrdenWrite] Sin cambios, salir", { contratoId, ordenId });
      return null;
    }

    const contratoRef = db.collection("contratos").doc(contratoId);

    try {
      await db.runTransaction(async (t) => {
        const contratoSnap = await t.get(contratoRef);
        if (!contratoSnap.exists) {
          logger.error("[onContratoOrdenWrite] Contrato no existe", { contratoId });
          return;
        }

        const contratoData     = contratoSnap.data();
        const osCountActual    = Number(contratoData.os_count     || 0);
        const equiposActual    = Number(contratoData.equipos_total || 0);
        const nuevoOsCount     = Math.max(0, osCountActual + deltaOrdenes);
        const nuevoEquiposTotal = Math.max(0, equiposActual + deltaEquipos);

        t.update(contratoRef, {
          os_count:      nuevoOsCount,
          equipos_total: nuevoEquiposTotal,
          tiene_os:      nuevoOsCount > 0,
          updated_at:    admin.firestore.FieldValue.serverTimestamp()
        });

        logger.info("[onContratoOrdenWrite] Actualizado", {
          contratoId,
          antes:   { os_count: osCountActual,  equipos_total: equiposActual },
          despues: { os_count: nuevoOsCount, equipos_total: nuevoEquiposTotal }
        });
      });
    } catch (err) {
      logger.error("[onContratoOrdenWrite] Error en transaction", {
        contratoId, ordenId, message: err.message, stack: err.stack
      });
    }

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
