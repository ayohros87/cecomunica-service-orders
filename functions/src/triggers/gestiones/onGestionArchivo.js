// Índice del ARCHIVO de gestiones (2026-09-09).
//
// Mantiene `gestiones/{gid}.seriales_norm` — la lista plana de seriales que
// toca el expediente — para que el archivo pueda buscar por serial con
// array-contains. Firestore no busca dentro de items[] ni de
// demo.seriales_asignados[], así que sin este campo la pregunta "¿en qué
// gestión salió este radio?" solo se podía contestar abriendo cliente por
// cliente.
//
// Trigger SEPARADO de onGestionWrite a propósito: aquel es la máquina de
// estados (y se sale temprano para devolución y cambio_serial, que también
// tienen seriales que archivar). Este no decide nada — solo denormaliza.
// Idempotente: escribe únicamente cuando el conjunto cambió, así que su propia
// escritura no se re-dispara.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { serialesDe, mismoConjunto } = require("../../domain/gestionSeriales");

module.exports = onDocumentWritten(
  { document: "gestiones/{gid}", region: "us-central1" },
  async (event) => {
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after) return null;

    const seriales = serialesDe(after);
    if (mismoConjunto(after.seriales_norm, seriales)) return null;

    try {
      await event.data.after.ref.update({ seriales_norm: seriales });
    } catch (e) {
      logger.warn("[gestion-archivo] no se pudo indexar", {
        gid: event.params.gid, message: e.message,
      });
    }
    return null;
  },
);
