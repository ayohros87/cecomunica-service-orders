// Historial de cambios de la ficha del cliente (2026-09-02).
//
// Escribe clientes/{cid}/historial/{autoId} en cada escritura que toque un
// campo auditado (ver domain/clientesHistorial). Corre server-side para
// capturar a TODOS los escritores — grid de edición masiva, formulario,
// fusiones de duplicados, scripts admin — y la subcolección es inmutable
// desde el cliente (rules): el rastro no se puede maquillar.
//
// Costo: un invoke por escritura de clientes (volumen bajo) y UNA lectura de
// usuarios/{uid} para resolver el email del editor. Sin cambios auditados
// (p. ej. arrayUnion de searchTokens) no escribe nada.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { db } = require("../../lib/admin");
const { diffCliente, atribucion } = require("../../domain/clientesHistorial");

async function emailDeUsuario(uid) {
  if (!uid) return null;
  try {
    const snap = await db.collection("usuarios").doc(uid).get();
    return (snap.exists && snap.data().email) || null;
  } catch (e) {
    return null;
  }
}

module.exports = onDocumentWritten(
  { document: "clientes/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after  = event.data?.after?.exists  ? event.data.after.data()  : null;
    const cid = event.params.cid;
    const histRef = db.collection("clientes").doc(cid).collection("historial");
    const ahora = admin.firestore.FieldValue.serverTimestamp();

    try {
      // Alta: registrar quién creó (el snapshot completo ya vive en el doc).
      if (!before && after) {
        const uid = after.created_by || after.updated_by || null;
        await histRef.add({
          tipo: "alta",
          nombre: after.nombre || null,
          por_uid: uid,
          por_email: await emailDeUsuario(uid),
          at: ahora,
        });
        return null;
      }

      // Borrado FÍSICO (la UI solo soft-borra; esto captura deletes directos).
      // La subcolección sobrevive al doc padre, así que el rastro queda.
      if (before && !after) {
        await histRef.add({
          tipo: "borrado_fisico",
          nombre: before.nombre || null,
          por_uid: null,
          por_email: null,
          at: ahora,
        });
        return null;
      }

      const cambios = diffCliente(before, after);
      if (!cambios) return null;

      const uid = atribucion(before, after);
      await histRef.add({
        tipo: "edicion",
        cambios,
        campos: Object.keys(cambios),
        por_uid: uid,
        por_email: await emailDeUsuario(uid),
        at: ahora,
      });
    } catch (e) {
      // El historial nunca debe tumbar la escritura de negocio: log y listo.
      logger.error("[onClienteHistorial] No se pudo registrar el cambio", { cid, message: e.message });
    }
    return null;
  }
);
