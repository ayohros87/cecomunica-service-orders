// Back-pointer de linaje: contratos/{origen}.renovado_por_ids[]
//
// El vínculo de renovación/reemplazo solo existe en una dirección — el
// contrato NUEVO guarda `contrato_origen_ids` apuntando a los viejos. El
// contrato VIEJO no sabe que fue renovado, y es JUSTO el que tiene los equipos
// todavía con el cliente. Sin este back-pointer la lista de contratos no puede
// marcar "este debería estar devolviendo equipos" en la fila del origen, que es
// la fila que el personal abre cuando busca al cliente.
//
// Este trigger se dispara en CADA escritura de contrato, así que sale de
// inmediato salvo que `contrato_origen_ids`/`contrato_origen_id` hayan
// cambiado. No hay riesgo de bucle: la escritura que hace (renovado_por_ids en
// OTRO doc) no toca los campos de origen, así que la re-invocación para ese
// doc corta en el guard.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { origenIdsDe } = require("../../lib/linaje");

module.exports = onDocumentWritten(
  { document: "contratos/{cid}", region: "us-central1" },
  async (event) => {
    const cid = event.params.cid;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;

    const antes  = origenIdsDe(before);
    const ahora  = origenIdsDe(after);   // borrado del contrato → [] → limpia todo

    const agregar = ahora.filter(id => !antes.includes(id));
    const quitar  = antes.filter(id => !ahora.includes(id));
    if (!agregar.length && !quitar.length) return null;   // el 99.9% de las escrituras

    const batch = db.batch();
    for (const origenId of agregar) {
      if (origenId === cid) continue;    // un contrato no es origen de sí mismo
      batch.set(db.collection("contratos").doc(origenId), {
        renovado_por_ids: admin.firestore.FieldValue.arrayUnion(cid),
      }, { merge: true });
    }
    for (const origenId of quitar) {
      if (origenId === cid) continue;
      batch.set(db.collection("contratos").doc(origenId), {
        renovado_por_ids: admin.firestore.FieldValue.arrayRemove(cid),
      }, { merge: true });
    }

    try {
      await batch.commit();
      logger.info("[onLinajeWrite] Back-pointer sincronizado", { cid, agregar, quitar });
    } catch (e) {
      // No crítico: el contrato nuevo ya quedó guardado con su vínculo; lo que
      // se pierde es la marca en el origen, que el backfill puede rehacer.
      logger.warn("[onLinajeWrite] No se pudo sincronizar el back-pointer", {
        cid, agregar, quitar, error: e.message,
      });
    }
    return null;
  }
);
