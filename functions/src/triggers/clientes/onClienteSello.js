const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../../lib/admin");
const { esSelloPropio } = require("../../domain/pocSello");

// Sello de sincronización de clientes (auditoría de lecturas 2026-10-28).
//
// Los formularios con selector de clientes (nueva orden, cotización, lotes,
// asistentes de venta) bajan la lista ENTERA de clientes vivos en páginas de
// 500 cada vez que revalidan contra el servidor — el 21% de las lecturas del
// 27-oct. Ahora el navegador arma la lista desde su caché local y solo pide lo
// que cambió: `sync_at > última marca` (ClientesService.getAllClientes).
// Mismo esquema que onPocDeviceSello: a clientes escriben el front, el grid,
// la regularización, las firmas y los scripts, así que lo sella el trigger y
// no cada escritor. El sello no es campo auditado: onClienteHistorial lo
// ignora. La regla del eco es la misma: domain/pocSello.js.

module.exports = onDocumentWritten(
  { document: "clientes/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after) return null; // borrado del doc: lo detecta el count() del cliente
    const eventoMs = Date.parse(event.time) || Date.now();
    if (esSelloPropio(before, after, eventoMs)) return null;
    try {
      await db.collection("clientes").doc(event.params.cid)
        .update({ sync_at: FieldValue.serverTimestamp() });
    } catch (e) {
      if (e?.code !== 5) logger.warn("[onClienteSello] no se pudo sellar", { id: event.params.cid, error: e?.message });
    }
    return null;
  }
);
