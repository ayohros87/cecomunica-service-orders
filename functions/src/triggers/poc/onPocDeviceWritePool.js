const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const pool = require("../../domain/equiposPool");

// Pool de equipos ↔ inventario POC ("migración por contacto", plan
// docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md §3.6): cuando un poc_device se crea o
// se le registra serial, la unidad se refleja en el pool como en_poc (si ya
// está rastreada por un contrato/orden solo se enlaza poc_device_id sin tocar
// su estado). El pool nunca escribe de vuelta a poc_devices.
module.exports = onDocumentWritten(
  { document: "poc_devices/{deviceId}", region: "us-central1" },
  async (event) => {
    const deviceId = event.params.deviceId;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after || after.deleted === true) return null;

    const serial = (after.serial || "").toString().trim();
    if (!serial) return null;
    // Solo cuando el serial aparece o cambia (no en cada edición del device).
    if (before && pool.normSerial(before.serial) === pool.normSerial(serial)) return null;

    try {
      const r = await pool.upsertContacto({
        serial,
        modelo_id: after.modelo_id || null,
        modelo_label: after.modelo_label || after.modelo || "",
        estado: pool.ESTADOS.EN_POC,
        // Si el contrato/orden ya rastrea esta unidad, el registro POC no le
        // cambia el estado — solo enlaza el device.
        noTocarDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.EN_TALLER],
        tipo: "prestamo_poc",
        refMov: { tipo: "poc", id: deviceId, label: after.radio_name || after.unit_id || "" },
        origen: "migracion_poc",
        extra: {
          poc_device_id: deviceId, propiedad: "cecomunica",
          // Custodia: el device sabe con qué cliente está — y desde 2026-07-16
          // puede traer también el CONTRATO al que pertenece el batch
          // (poc_devices.contrato_doc_id, vínculo POC↔contrato). Solo si la
          // unidad no tiene ya una asignación de contrato.
          ...((after.cliente_nombre || after.cliente || after.cliente_id) ? {
            asignacionSiFalta: {
              contrato_doc_id: after.contrato_doc_id || null,
              contrato_id: after.contrato_id || "",
              cliente_id: after.cliente_id || "",
              cliente_nombre: after.cliente_nombre || after.cliente || "",
            },
          } : {}),
        },
      });
      if (r === "creado") logger.info("[onPocDeviceWritePool] Serial nuevo en pool desde POC", { deviceId, serial });
    } catch (e) {
      logger.warn("[onPocDeviceWritePool] Pool sync falló (no crítico)", { deviceId, message: e.message });
    }
    return null;
  }
);
