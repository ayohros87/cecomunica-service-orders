// Auto-registro de la transición de equipos al CONFIRMARSE LA ENTREGA del
// contrato nuevo (renovación / adición / reemplazo con origen vinculado).
//
// Regla de negocio (2026-07-20): en una renovación, TODO equipo de ALQUILER
// de los contratos originales se devuelve — la acción humana es la excepción,
// no la devolución. Momento elegido: la entrega del contrato nuevo (el
// cliente ya recibió los radios nuevos; ahora debe entregar los viejos).
//
// Qué hace: por cada contrato de origen vinculado, toma sus unidades del pool
// aún con el cliente (asignado_contrato / en_cliente) cuya propiedad NO sea
// del cliente, y crea mapeos de devolución en contratos/{cid}/mapeos.
// onMapeoWrite hace el resto (pendiente_devolucion + contador + kardex) y el
// recordatorio semanal de transiciones engancha solo. Se avisa por correo al
// vendedor del cliente + recepción con la lista a recuperar.
//
// La página de transición queda para las EXCEPCIONES (justificar no
// devoluciones, linaje opcional) y para contratos sin origen vinculado.
//
// Idempotencia: `transicion_auto_at` en el contrato + solo corre si aún no
// hay mapeos (transicion_mapeos_count == 0). Los equipos PROPIOS del cliente
// se omiten (son suyos). Contratos legacy quedan fuera (mismo corte que la CTA).

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { crearOrdenDevolucion } = require("../../lib/ordenDevolucion");

module.exports = onDocumentUpdated(
  { document: "contratos/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data();
    const after  = event.data.after?.data();
    if (!before || !after) return null;

    const entregaConfirmada = !before.entrega_confirmada && after.entrega_confirmada === true;
    if (!entregaConfirmada) return null;

    const cid = event.params.cid;
    const contratoId = after.contrato_id || cid;

    // Solo transicionables con origen vinculado, sin mapeos previos, no legacy.
    const esTransicionable = !after.renovacion_sin_equipo
      && (after.accion === "Renovación" || after.accion === "Adición" || after.codigo_tipo === "REEMP");
    const origenIds = (Array.isArray(after.contrato_origen_ids) && after.contrato_origen_ids.length)
      ? after.contrato_origen_ids
      : (after.contrato_origen_id ? [after.contrato_origen_id] : []);
    if (!esTransicionable || !origenIds.length) return null;
    if (after.seriales_estado === "legacy") return null;
    if (Number(after.transicion_mapeos_count || 0) > 0) return null; // ya hay registro manual
    if (after.transicion_auto_at) return null;                        // ya corrió

    // Unidades de los orígenes aún con el cliente; alquiler solamente
    // (propiedad 'cliente' = equipos propios, no se devuelven).
    const unidades = [];
    for (const origenId of origenIds) {
      try {
        const snap = await db.collection("equipos_pool")
          .where("asignacion.contrato_doc_id", "==", origenId).get();
        snap.forEach((d) => {
          const u = d.data();
          if (!["asignado_contrato", "en_cliente"].includes(u.estado)) return;
          if (u.propiedad === "cliente") return;
          if (unidades.some(x => x.id === d.id)) return;
          unidades.push({ id: d.id, origenId, ...u });
        });
      } catch (e) {
        logger.warn("[onEntregaTransicion] No se pudo leer el pool del origen", { cid, origenId, message: e.message });
      }
    }

    if (!unidades.length) {
      // Origen vinculado pero sin unidades rastreadas (p.ej. origen legacy sin
      // seriales) — no se auto-cierra: la revisión queda manual en la página.
      logger.info("[onEntregaTransicion] Origen sin unidades en el pool; sin auto-registro", { contratoId, origenIds });
      return null;
    }

    // Mapeos de devolución (batch). onMapeoWrite marca pendiente_devolucion,
    // incrementa el contador y escribe el kardex de cada unidad.
    const batch = db.batch();
    const col = db.collection("contratos").doc(cid).collection("mapeos");
    unidades.forEach((u) => batch.set(col.doc(), {
      saliente: u.serial || u.serial_norm || u.id,
      saliente_pool_id: u.id,
      entrante: null,
      entrante_pool_id: null,
      modelo: u.modelo_label || "",
      modelo_id: u.modelo_id || null,
      contrato_id: contratoId,
      contrato_origen_id: u.origenId,
      auto: true,
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system",
    }));
    batch.set(db.collection("contratos").doc(cid), {
      transicion_auto_at: admin.firestore.FieldValue.serverTimestamp(),
      transicion_auto_unidades: unidades.length,
    }, { merge: true });
    await batch.commit();
    logger.info("[onEntregaTransicion] Devolución auto-registrada", { contratoId, unidades: unidades.length });

    // Tiquete de trabajo: orden de DEVOLUCIÓN (modo recuperación) con las
    // unidades a recuperar — asignable, medible (aging) y con check-in por
    // serial. El correo a vendedor+recepción lo encola el propio creador.
    try {
      const ordenId = await crearOrdenDevolucion({
        clienteId: after.cliente_id || null,
        clienteNombre: after.cliente_nombre || "",
        contratoDocId: cid,
        contratoId,
        modo: "recuperacion",
        origen: { tipo: "renovacion", ref_id: cid },
        unidades: unidades.map(u => ({
          serial: u.serial || u.serial_norm || u.id,
          modelo: u.modelo_label || "",
          modelo_id: u.modelo_id || null,
          pool_doc_id: u.id,
        })),
        motivo: `Renovación ${contratoId} entregada — recuperar los equipos del contrato anterior`,
      });
      if (ordenId) {
        await db.collection("contratos").doc(cid).set({ orden_devolucion_id: ordenId }, { merge: true });
      }
    } catch (e) {
      logger.warn("[onEntregaTransicion] No se pudo crear la orden de devolución (no crítico)", { contratoId, message: e.message });
    }

    return null;
  }
);
