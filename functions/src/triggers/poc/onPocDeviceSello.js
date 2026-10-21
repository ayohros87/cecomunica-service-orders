const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../../lib/admin");
const { esSelloPropio } = require("../../domain/pocSello");

// Sello de sincronización de poc_devices (auditoría de lecturas 2026-10-21).
//
// El buscador del PoC necesita el conjunto ENTERO de fichas vivas (~3,900) y
// lo bajaba completo cada vez que la página se abría pasados 30 min — el 15%
// de las lecturas del día. Ahora el navegador arma el conjunto desde su caché
// local y solo pide al servidor lo que cambió: `sync_at > última marca`.
// Eso solo es seguro si TODA escritura deja `sync_at` al día, y a poc_devices
// escriben ~20 lugares (front, functions, scripts). Por eso lo sella este
// trigger y no cada escritor: uno que se olvide no puede dejar la búsqueda
// incompleta. Las altas y bajas de membresía las valida además un count() en
// el cliente (pocService.escuchar). La regla del eco: domain/pocSello.js.

module.exports = onDocumentWritten(
  { document: "poc_devices/{deviceId}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after) return null; // borrado del doc: lo detecta el count() del cliente
    const eventoMs = Date.parse(event.time) || Date.now();
    if (esSelloPropio(before, after, eventoMs)) return null;
    try {
      await db.collection("poc_devices").doc(event.params.deviceId)
        .update({ sync_at: FieldValue.serverTimestamp() });
    } catch (e) {
      if (e?.code !== 5) logger.warn("[onPocDeviceSello] no se pudo sellar", { id: event.params.deviceId, error: e?.message });
    }
    return null;
  }
);
