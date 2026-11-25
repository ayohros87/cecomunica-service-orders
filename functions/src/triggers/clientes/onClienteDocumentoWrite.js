// Estado del expediente legal en la ficha del cliente (2026-11-25).
//
// Cada vez que se sube, revisa, rechaza o elimina un documento
// (clientes/{cid}/documentos/{docId}) se recalcula clientes/{cid}.expediente:
// qué hay de los tres documentos que pide administración, cuántos esperan la
// revisión de Cobros y si el expediente está completo.
//
// Para qué: el directorio del Centro ya baja la ficha de cada cliente; con el
// resumen ahí, "a quién le falta qué" y "qué hay por revisar" son un filtro
// sin lecturas extra, y el vendedor —que no puede abrir los documentos— ve
// igual qué le falta pedir. La regla vive en domain/expedienteCliente.
//
// Corre server-side para capturar a todos los que escriben: la ficha, el
// enlace del cliente (documentosClientePublico), la copia que deja la firma
// (onFirmaContrato) y los scripts. Si el resumen no cambia, no escribe.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const E = require("../../domain/expedienteCliente");

// Separado del wrapper para correrlo desde el script de backfill y las pruebas.
async function recalcular(cid, deps = {}) {
  const fdb = deps.db || db;
  const fadmin = deps.admin || admin;
  const cRef = fdb.collection("clientes").doc(cid);
  const [cSnap, dSnap] = await Promise.all([cRef.get(), cRef.collection("documentos").get()]);
  if (!cSnap.exists) return { escrito: false, motivo: "sin_cliente" };
  const resumen = E.resumen(dSnap.docs.map((d) => d.data() || {}));
  const actual = cSnap.data().expediente;
  if (actual && E.mismoResumen(actual, resumen)) return { escrito: false, motivo: "igual", resumen };
  // Un cliente sin documentos y sin campo ya se lee como "faltan los tres":
  // no hace falta escribirle nada.
  if (!actual && !dSnap.size) return { escrito: false, motivo: "vacio", resumen };
  await cRef.update({
    expediente: { ...resumen, actualizado_at: fadmin.firestore.FieldValue.serverTimestamp() },
  });
  return { escrito: true, resumen };
}

const fn = onDocumentWritten(
  { document: "clientes/{cid}/documentos/{docId}", region: "us-central1" },
  async (event) => {
    const cid = event.params.cid;
    try {
      await recalcular(cid);
    } catch (e) {
      logger.error("[onClienteDocumentoWrite] expediente no recalculado", { cid, error: e.message });
    }
    return null;
  }
);

fn._interno = { recalcular };
module.exports = fn;
