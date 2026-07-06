const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db }               = require("../../lib/admin");
const { buildBodyOrdenCompletada } = require("../../domain/emailRenderer");
const { getISOWeekKey }           = require("../../domain/contractCache");
const { atencionClienteEmailTo, tallerEmailTo } = require("../../lib/mailRecipients");

module.exports = onDocumentUpdated(
  { document: "ordenes_de_servicio/{ordenId}" },
  async (event) => {
    const before  = event.data.before?.data() || {};
    const after   = event.data.after?.data()  || {};
    const ordenId = event.params.ordenId;

    const estadoAntes   = String(before?.estado_reparacion || "");
    const estadoDespues = String(after?.estado_reparacion  || "");
    if (estadoAntes === estadoDespues) return null;

    if (!/COMPLETADO/i.test(estadoDespues)) return null;

    // Llavea las estadísticas por UID (identidad estable). Las órdenes sin
    // `tecnico_uid` (viejas) caen al nombre como fallback. NOTA: el lector
    // (usuariosService.getTecnicoStats) suma ambas claves uid+nombre, así que
    // los docs históricos por-nombre se siguen contando durante la transición.
    const tecnicoNombre = after?.tecnico_asignado || null;
    const tecnicoKey    = after?.tecnico_uid || tecnicoNombre || null;
    const actorUid      = after?.actualizado_por || null;

    if (tecnicoKey) {
      const now    = new Date();
      const year   = now.getFullYear();
      const month  = now.getMonth() + 1;
      const yyyyMM = `${year}-${String(month).padStart(2, "0")}`;
      const isoWeek = getISOWeekKey(now);

      const statDoc    = db.collection("tecnico_stats").doc(tecnicoKey);
      const mensualDoc = statDoc.collection("mensual").doc(yyyyMM);
      const semanalDoc = statDoc.collection("semanal").doc(isoWeek);
      const eventoDoc  = statDoc.collection("eventos").doc(ordenId);
      // Anti-doble-conteo: si esta orden ya fue contada bajo el doc viejo
      // (clave = nombre) antes de migrar a UID, no la vuelvas a contar.
      const legacyEventoDoc = (tecnicoNombre && tecnicoNombre !== tecnicoKey)
        ? db.collection("tecnico_stats").doc(tecnicoNombre).collection("eventos").doc(ordenId)
        : null;

      try {
        await db.runTransaction(async (t) => {
          const [eventoSnap, legacySnap] = await Promise.all([
            t.get(eventoDoc),
            legacyEventoDoc ? t.get(legacyEventoDoc) : Promise.resolve(null),
          ]);
          if (eventoSnap.exists) return;
          if (legacySnap && legacySnap.exists) return;

          t.set(eventoDoc, {
            ordenId,
            tecnicoKey,
            tecnicoNombre,
            actorUid: actorUid || null,
            fecha: admin.firestore.Timestamp.fromDate(now),
            estado: "COMPLETADO",
            year,
            month,
            isoWeek
          });

          t.set(statDoc, {
            total:     admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          t.set(mensualDoc, {
            count:     admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          t.set(semanalDoc, {
            count:     admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        });
      } catch (e) {
        logger.error("[onOrdenCompletada] Error en transaction de stats", { message: e.message, ordenId });
      }
    }

    try {
      // Deep-link al índice de órdenes, que abre el modal de Entrega/Recepción
      // (firma + receptor + equipos).
      const ordenLink   = `https://app.cecomunica.net/ordenes/index.html?entrega=${encodeURIComponent(ordenId)}`;
      const bodyContent = buildBodyOrdenCompletada(after);
      const preheader   = `Orden ${after.orden_id || ordenId} completada · ${after.cliente_nombre || "Cliente"}`;

      const vendedorUid = after?.vendedor_asignado || null;
      let vendedorEmail = "";
      if (vendedorUid) {
        const vSnap = await db.collection("usuarios").doc(vendedorUid).get();
        vendedorEmail = vSnap.exists ? (vSnap.data().email || "") : "";
      }

      const toList = [await atencionClienteEmailTo()];
      const tallerEmail = await tallerEmailTo();
      if (tallerEmail) toList.push(tallerEmail);
      if (vendedorEmail) toList.push(vendedorEmail);

      await db.collection("mail_queue").add({
        to:       toList.join(","),
        subject:  `Orden COMPLETADA: ${after.orden_id || ordenId} – ${after.cliente_nombre || "Cliente"}`,
        preheader,
        bodyContent,
        ctaUrl:   ordenLink,
        ctaLabel: "Ver orden",
        status:   "queued",
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      logger.error("[onOrdenCompletada] No se pudo encolar correo", { message: e.message, ordenId });
    }

    return null;
  }
);
