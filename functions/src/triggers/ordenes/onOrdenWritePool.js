const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const pool = require("../../domain/equiposPool");

// Pool de equipos ↔ órdenes de servicio ("migración por contacto", plan
// docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md §3.4):
//   · equipo agregado a una orden viva → la unidad pasa a en_taller (si el
//     serial no existe en el pool se crea con origen migracion_orden).
//   · orden pasa a "ENTREGADO AL CLIENTE" (o se soft-elimina) → sus unidades
//     en_taller regresan a en_cliente.
//   · equipo removido de la orden → su unidad sale del taller (en_cliente).
// El serial de la orden es texto libre: nunca bloquea, solo registra.
const ENTREGADO = "ENTREGADO AL CLIENTE";
const norm = (s) => String(s || "").trim().toUpperCase();

function equiposDe(data) {
  if (!data || data.eliminado === true) return [];
  return (data.equipos || [])
    .filter((e) => e && !e.eliminado)
    .map((e) => ({
      serial: (e.serial || e.SERIAL || e.numero_de_serie || "").toString().trim(),
      modelo_id: e.modelo_id || null,
      modelo: (e.modelo || e.MODEL || e.modelo_nombre || "").toString().trim(),
    }))
    .filter((e) => e.serial);
}

module.exports = onDocumentWritten(
  { document: "ordenes_de_servicio/{ordenId}", region: "us-central1" },
  async (event) => {
    const ordenId = event.params.ordenId;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after && !before) return null;

    try {
      const antes   = equiposDe(before);
      const despues = after ? equiposDe(after) : [];
      const keysDespues = new Set(despues.map((e) => pool.normSerial(e.serial)));
      const keysAntes   = new Set(antes.map((e) => pool.normSerial(e.serial)));

      const entregadaAhora = after && norm(after.estado_reparacion) === ENTREGADO
        && norm(before?.estado_reparacion) !== ENTREGADO;
      const yaEntregada = after && norm(after.estado_reparacion) === ENTREGADO;
      const eliminada = !after || after.eliminado === true;

      const refMov = { tipo: "orden", id: ordenId, label: after?.numero_orden || before?.numero_orden || ordenId };
      // Custodia del cliente de la orden — se estampa solo si la unidad no
      // tiene ya una asignación (nunca pisa la de un contrato).
      const fuente = after || before || {};
      const custodiaCliente = (fuente.cliente_nombre || fuente.cliente_id) ? {
        contrato_doc_id: null, contrato_id: "",
        cliente_id: fuente.cliente_id || "", cliente_nombre: fuente.cliente_nombre || "",
      } : null;

      // Salida de taller: entrega de la orden, soft-delete, o borrado del doc.
      if (entregadaAhora || (eliminada && before?.eliminado !== true)) {
        const equiposFuente = despues.length ? despues : antes;
        for (const e of equiposFuente) {
          await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
            aEstado: pool.ESTADOS.EN_CLIENTE,
            soloDesde: [pool.ESTADOS.EN_TALLER],
            condicion: (d) => d.orden_actual_id === ordenId,
            tipo: "salida_taller",
            refMov,
            notas: entregadaAhora ? "" : "Orden eliminada",
            extra: { orden_actual_id: null, ...(custodiaCliente ? { asignacionSiFalta: custodiaCliente } : {}) },
          });
        }
        return null;
      }
      if (yaEntregada || eliminada) return null;

      // Equipos removidos de una orden viva → salen del taller.
      for (const e of antes.filter((x) => !keysDespues.has(pool.normSerial(x.serial)))) {
        await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
          aEstado: pool.ESTADOS.EN_CLIENTE,
          soloDesde: [pool.ESTADOS.EN_TALLER],
          condicion: (d) => d.orden_actual_id === ordenId,
          tipo: "salida_taller",
          refMov,
          notas: "Equipo removido de la orden",
          extra: { orden_actual_id: null, ...(custodiaCliente ? { asignacionSiFalta: custodiaCliente } : {}) },
        });
      }

      // Equipos nuevos en la orden → entran al taller (upsert por contacto).
      const nuevos = despues.filter((x) => !keysAntes.has(pool.normSerial(x.serial)));
      for (const e of nuevos) {
        const contrato = after.contrato || {};
        // Serial que aparece por primera vez en una orden SIN contrato: es
        // equipo del cliente (la flota propia ya existiría en el pool vía POC
        // o contrato). Con contrato vinculado, onSerialWrite refina después.
        const extra = { orden_actual_id: ordenId };
        if (!(contrato.aplica && contrato.contrato_doc_id)) {
          extra.propiedad = "cliente";
          if (custodiaCliente) extra.asignacionSiFalta = custodiaCliente;
        }
        if (contrato.aplica && contrato.contrato_doc_id) {
          extra.asignacion = {
            contrato_doc_id: contrato.contrato_doc_id,
            contrato_id:     contrato.contrato_id || "",
            cliente_id:      after.cliente_id || "",
            cliente_nombre:  after.cliente_nombre || "",
          };
        }
        const r = await pool.upsertContacto({
          serial: e.serial,
          modelo_id: e.modelo_id,
          modelo_label: e.modelo,
          estado: pool.ESTADOS.EN_TALLER,
          tipo: "ingreso_taller",
          refMov,
          origen: "migracion_orden",
          extra,
        });
        if (r === "creado") logger.info("[onOrdenWritePool] Serial nuevo en pool desde orden", { ordenId, serial: e.serial });
      }
    } catch (e) {
      logger.warn("[onOrdenWritePool] Pool sync falló (no crítico)", { ordenId, message: e.message });
    }
    return null;
  }
);
