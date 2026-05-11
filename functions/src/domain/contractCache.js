const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

function getISOWeekKey(d) {
  const date   = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo    = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function recalcularCacheContrato(contratoId) {
  try {
    logger.info("[recalcularCacheContrato] Iniciando recálculo", { contratoId });

    const ordenesSnap = await db.collection("contratos")
      .doc(contratoId)
      .collection("ordenes")
      .orderBy("updated_at", "desc")
      .get();

    const ordenesVigentes = [];

    for (const doc of ordenesSnap.docs) {
      const cacheData = doc.data();
      const ordenId   = doc.id;

      if (cacheData.eliminado === true) {
        logger.info("[recalcularCacheContrato] Orden marcada eliminada en cache", { contratoId, ordenId });
        continue;
      }

      try {
        const osRef = await db.collection("ordenes_de_servicio").doc(ordenId).get();

        if (!osRef.exists) {
          logger.info("[recalcularCacheContrato] Orden no existe (hard delete detectado)", { contratoId, ordenId });
          await doc.ref.delete();
          continue;
        }

        const osData = osRef.data();
        if (osData.eliminado === true) {
          logger.info("[recalcularCacheContrato] Orden soft-deleted detectada", { contratoId, ordenId });
          await doc.ref.update({ eliminado: true });
          continue;
        }

        ordenesVigentes.push({ ordenId, data: cacheData });

      } catch (err) {
        logger.error("[recalcularCacheContrato] Error verificando orden", {
          contratoId, ordenId, error: err.message
        });
      }
    }

    logger.info("[recalcularCacheContrato] Órdenes vigentes encontradas", {
      contratoId, total: ordenesSnap.size, vigentes: ordenesVigentes.length
    });

    const os_count = ordenesVigentes.length;
    let updateData = {};

    if (os_count === 0) {
      updateData = {
        os_count: 0,
        os_linked: false,
        os_has_equipos: false,
        os_serials_preview: [],
        os_equipos_count_last: 0,
        tiene_os: false,
        os_dirty: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      };
      logger.info("[recalcularCacheContrato] Sin órdenes vigentes, limpiando campos", { contratoId });
    } else {
      const allSerials = [];
      let hasEquipos       = false;
      let lastEquiposCount = 0;

      for (const orden of ordenesVigentes.slice(0, 10)) {
        const serials = orden.data.serials || [];
        allSerials.push(...serials);
        if (orden.data.equipos_count > 0) hasEquipos = true;
      }

      if (ordenesVigentes.length > 0) {
        lastEquiposCount = ordenesVigentes[0].data.equipos_count || 0;
      }

      const serialsPreview = [...new Set(allSerials)].slice(0, 3);

      updateData = {
        os_count,
        os_linked: true,
        os_has_equipos: hasEquipos,
        os_serials_preview: serialsPreview,
        os_equipos_count_last: lastEquiposCount,
        tiene_os: true,
        os_dirty: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      };
      logger.info("[recalcularCacheContrato] Campos recalculados", { contratoId, os_count, hasEquipos, serialsPreview });
    }

    await db.collection("contratos").doc(contratoId).update(updateData);
    logger.info("[recalcularCacheContrato] Contrato actualizado exitosamente", { contratoId, os_count: updateData.os_count });
    return true;

  } catch (err) {
    logger.error("[recalcularCacheContrato] Error general", { contratoId, error: err.message, stack: err.stack });
    return false;
  }
}

module.exports = { getISOWeekKey, recalcularCacheContrato };
