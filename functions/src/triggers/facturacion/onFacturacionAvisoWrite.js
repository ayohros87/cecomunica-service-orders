// onFacturacionAvisoWrite — servidor de la bandeja "Facturación pendiente".
//
// El navegador solo escribe pasos/descarte/reenvío sobre el aviso (rules
// acotan los campos). Este trigger hace lo que el navegador no puede:
//   1) Reenviar el correo: `reenvio_solicitado` → re-arma el doc de
//      mail_queue (borrar error/sent_at re-dispara onMailQueued, que es
//      idempotente). Recepción no puede escribir mail_queue por reglas.
//   2) Derivar `estado` de los pasos (autoridad del servidor): 'hecho' cuando
//      todos los que aplican están hechos, 'pendiente' si alguno se deshizo.
// Cada escritura re-dispara el trigger; la segunda pasada es no-op.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const FA = require("../../lib/facturacionAvisos");

module.exports = onDocumentWritten(
  { document: "facturacion_avisos/{avisoId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return null;
    const avisoId = event.params.avisoId;
    const ref = db.collection("facturacion_avisos").doc(avisoId);
    const patch = {};

    // 1) Reenvío del correo
    if (after.reenvio_solicitado) {
      const mailId = after.correo?.mail_queue_id;
      const quien = after.reenvio_solicitado.por_email || null;
      let detalle;
      if (mailId) {
        try {
          await db.collection("mail_queue").doc(mailId).update({
            status: "queued",
            intentos: 0,
            error: admin.firestore.FieldValue.delete(),
            sent_at: admin.firestore.FieldValue.delete(),
            reenviado_at: admin.firestore.FieldValue.serverTimestamp(),
            reenviado_por: quien,
            // Correos anteriores a la bandeja (respaldados) no traen el enlace:
            // sin él, onMailQueued no espeja el resultado en el aviso.
            "meta.aviso_id": avisoId,
          });
          patch.correo = { ...(after.correo || {}), status: "queued", error: null };
          detalle = "Correo reenviado";
        } catch (e) {
          logger.warn("[onFacturacionAvisoWrite] no se pudo re-armar el correo", { avisoId, mailId, message: e.message });
          detalle = `No se pudo reenviar: ${e.message}`;
        }
      } else {
        detalle = "No hay correo que reenviar (el aviso no quedó enlazado a la cola)";
      }
      patch.reenvio_solicitado = null;
      patch.historial = admin.firestore.FieldValue.arrayUnion({
        accion: "reenvio", detalle, fecha_iso: new Date().toISOString(), por_email: quien,
      });
    }

    // 2) Estado derivado de los pasos
    const est = FA.estadoDerivado(after);
    if (est !== after.estado && (after.estado === "pendiente" || after.estado === "hecho")) {
      patch.estado = est;
    }

    if (!Object.keys(patch).length) return null;
    patch.updated_at = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(patch, { merge: true });
    return null;
  }
);
