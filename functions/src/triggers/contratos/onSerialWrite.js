const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

// Mantiene `seriales_count` en el contrato cuando cambia su subcolección de
// seriales. Con admin SDK (esquiva el guard touchesCFOwnedFields). El índice usa
// este conteo + las unidades activas para el estado del botón de seriales.
module.exports = onDocumentWritten(
  { document: "contratos/{cid}/seriales/{sid}", region: "us-central1" },
  async (event) => {
    const cid = event.params.cid;
    try {
      const snap = await db.collection("contratos").doc(cid).collection("seriales").get();
      let count = 0;
      snap.forEach((d) => { const s = d.data()?.serial; if (typeof s === "string" && s.trim()) count++; });
      await db.collection("contratos").doc(cid).set({
        seriales_count: count,
        seriales_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      logger.warn("[onSerialWrite] No se pudo contar seriales", { cid, message: e.message });
    }
    return null;
  }
);
