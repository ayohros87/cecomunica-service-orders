const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const pool = require("../../domain/equiposPool");

// Pool de equipos ↔ inventario POC ("migración por contacto", plan
// docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md §3.6). POC es la PLATAFORMA (base de
// datos de airtime), no una ubicación física — decisión 2026-07-24: el estado
// en_poc se eliminó del pool. El registro POC ahora solo:
//   · enlaza poc_device_id (y custodia del cliente si la unidad no tenía) en la
//     ficha existente, SIN tocar su estado; si el serial nunca tocó el sistema,
//     la ficha nace en_cliente (device activo con cliente = radio colocado).
//   · al borrarse el device (soft-delete o borrado), desenlaza poc_device_id.
// El pool nunca escribe de vuelta a poc_devices.
module.exports = onDocumentWritten(
  { document: "poc_devices/{deviceId}", region: "us-central1" },
  async (event) => {
    const deviceId = event.params.deviceId;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after && !before) return null;

    // Desenlaza del pool la ficha de un serial que este device ya no lleva.
    // El estado NO cambia — dónde está el radio lo dicen contratos/órdenes.
    const desenlazar = async (serialViejo, datos, motivo) => {
      const s = (serialViejo || "").toString().trim();
      if (!s) return;
      try {
        const { ref, data } = await pool.resolver(
          s, datos.modelo_id || null, datos.modelo_label || datos.modelo || "",
          { adoptarSiExiste: true });
        if (data && data.poc_device_id === deviceId) {
          await ref.set({ poc_device_id: null }, { merge: true });
          logger.info("[onPocDeviceWritePool] Ficha desenlazada", { deviceId, serial: s, motivo });
        }
      } catch (e) {
        logger.warn("[onPocDeviceWritePool] Desenlace falló (no crítico)", { deviceId, message: e.message });
      }
    };

    // Device eliminado (soft-delete o borrado del doc): desenlazar la ficha.
    const borradoAhora = (!after || after.deleted === true) && before && before.deleted !== true;
    if (borradoAhora) {
      await desenlazar(before.serial, before, "device eliminado");
      return null;
    }
    if (!after || after.deleted === true) return null;

    const serial = (after.serial || "").toString().trim();
    if (!serial) return null;
    // Solo cuando el serial aparece o cambia (no en cada edición del device)…
    const mismoSerial = before && pool.normSerial(before.serial) === pool.normSerial(serial);
    // …o cuando el device REVIVE: el borrado soltó el enlace y restaurarlo desde
    // la lista POC tiene que rehacerlo, o la ficha queda sin su device (lo que
    // deja el chequeo C2 de la conciliación marcando drift para siempre).
    const revivido = !!before && before.deleted === true;
    if (mismoSerial && !revivido) return null;

    // El serial CAMBIÓ (corrección de un batch mal tecleado): la ficha del
    // serial viejo se quedaba apuntando a este device, así que el mismo device
    // acababa enlazado desde DOS fichas y la vieja parecía un radio colocado
    // más. Los 12 fantasma de PROP20260731-01 arrastraban justo eso.
    if (before && !mismoSerial) await desenlazar(before.serial, before, "serial corregido en el device");

    try {
      const r = await pool.upsertContacto({
        serial,
        modelo_id: after.modelo_id || null,
        modelo_label: after.modelo_label || after.modelo || "",
        // Ficha nueva → en_cliente. Ficha existente → cualquier estado real se
        // respeta (el contacto POC solo enlaza el device, nunca mueve el radio).
        estado: pool.ESTADOS.EN_CLIENTE,
        noTocarDesde: [pool.ESTADOS.EN_BODEGA, pool.ESTADOS.ASIGNADO,
          pool.ESTADOS.EN_TALLER, pool.ESTADOS.DEVUELTO, pool.ESTADOS.VENDIDO],
        tipo: "registro_poc",
        refMov: { tipo: "poc", id: deviceId, label: after.radio_name || after.unit_id || "" },
        origen: "migracion_poc",
        // EL CONTRATO MANDA SOBRE POC (decisión 2026-07-27): el texto de modelo
        // del device POC no es autoridad sobre la unidad física — cuando
        // discrepa con el contrato/orden se adopta la ficha existente en vez de
        // partirla. Antes cada desacuerdo minaba una ficha sufijada: 35 de los
        // 64 conflictos vivos eran exactamente eso (el mismo radio del mismo
        // cliente, "PNC360S-R" vs "PNC460-R" vs "HYT-P50"). El modelo de la
        // ficha no se pisa: upsertContacto solo rellena vacíos.
        adoptarSiExiste: true,
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
