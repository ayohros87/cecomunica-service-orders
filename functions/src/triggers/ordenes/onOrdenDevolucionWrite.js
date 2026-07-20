// Aplica al pool las resoluciones del check-in de una orden de DEVOLUCIÓN
// (ordenes-devolucion.js escribe devolucion.esperados[].resolucion; aquí,
// con Admin SDK, se mueve la unidad):
//   recibido    → devuelto_revision (cuarentena de inspección)
//   nunca_salio → en_bodega directo (anulación por error: jamás salió)
//   no_devuelve → devolucion_excepcion en la unidad (sin cambio de estado);
//                 se limpia pendiente_devolucion (dejamos de perseguirla)
// Al cerrar la orden (estado → CERRADA (DEVOLUCION)) crea UNA orden de
// ENTRADA con los recibidos para la cola de inspección del taller.
// Idempotente: procesa solo resoluciones que CAMBIARON en esta escritura;
// las transiciones del pool tienen guards (sin-cambio) por si se repite.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");
const { crearOrdenEntrada } = require("../../lib/ordenEntrada");

module.exports = onDocumentWritten(
  { document: "ordenes_de_servicio/{ordenId}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after || after.tipo_de_servicio !== "DEVOLUCION") return null;

    const ordenId = event.params.ordenId;
    const dev = after.devolucion || {};
    const antes = new Map(((before?.devolucion?.esperados) || []).map(e => [e.id, e.resolucion || null]));

    for (const e of (dev.esperados || [])) {
      const res = e.resolucion || null;
      if (!res || antes.get(e.id) === res) continue; // sin cambio en esta escritura

      const refMov = { tipo: "orden", id: ordenId, label: `DEVOLUCIÓN ${ordenId}` };
      try {
        if (res === "recibido") {
          const r = e.pool_doc_id
            ? await pool.transicionarPorId(e.pool_doc_id, {
                aEstado: pool.ESTADOS.DEVUELTO,
                soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE],
                tipo: "devolucion", refMov,
                notas: "Recibido en devolución — pendiente de inspección",
                extra: { verificado: false },
              })
            : await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
                aEstado: pool.ESTADOS.DEVUELTO,
                soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE],
                tipo: "devolucion", refMov,
                notas: "Recibido en devolución — pendiente de inspección",
                extra: { verificado: false },
              });
          logger.info("[onOrdenDevolucionWrite] recibido", { ordenId, serial: e.serial, r });
        } else if (res === "nunca_salio") {
          // Anulación por error: el equipo jamás salió del taller — vuelve a
          // bodega directo, sin cuarentena ni inspección (no hay qué revisar).
          const opts = {
            aEstado: pool.ESTADOS.EN_BODEGA,
            soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE],
            tipo: "liberacion", refMov,
            notas: "Confirmado: nunca salió del taller (anulación por error) — vuelve a bodega",
            extra: { asignacion: null },
          };
          const r = e.pool_doc_id
            ? await pool.transicionarPorId(e.pool_doc_id, opts)
            : await pool.transicionar(e.serial, e.modelo_id, e.modelo, opts);
          logger.info("[onOrdenDevolucionWrite] nunca_salio", { ordenId, serial: e.serial, r });
        } else if (res === "no_devuelve") {
          const { ref, data } = await pool.resolver(e.serial, e.modelo_id, e.modelo);
          const unidadRef = e.pool_doc_id ? db.collection("equipos_pool").doc(e.pool_doc_id) : (data ? ref : null);
          if (unidadRef) {
            await unidadRef.set({
              devolucion_excepcion: {
                motivo_codigo: e.motivo_codigo || "otro",
                motivo_detalle: e.motivo_detalle || "",
                orden_id: ordenId,
                at: admin.firestore.FieldValue.serverTimestamp(),
              },
              pendiente_devolucion: admin.firestore.FieldValue.delete(),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            await unidadRef.collection("movimientos").add({
              at: admin.firestore.FieldValue.serverTimestamp(),
              por: "system", por_email: null, tipo: "devolucion",
              de_estado: null, a_estado: null, ref: refMov,
              notas: `NO se devuelve (${e.motivo_codigo || "otro"}${e.motivo_detalle ? `: ${e.motivo_detalle}` : ""})`,
            });
          }
          logger.info("[onOrdenDevolucionWrite] no_devuelve", { ordenId, serial: e.serial });
        }
      } catch (err) {
        logger.warn("[onOrdenDevolucionWrite] No se pudo aplicar la resolución (no crítico)", {
          ordenId, serial: e.serial, res, message: err.message,
        });
      }
    }

    // Cierre → orden de ENTRADA con los recibidos (una sola vez).
    const cerroAhora = before?.estado_reparacion !== "CERRADA (DEVOLUCION)"
      && after.estado_reparacion === "CERRADA (DEVOLUCION)";
    if (cerroAhora && !after.orden_entrada_id) {
      const recibidos = (dev.esperados || []).filter(e => e.resolucion === "recibido");
      if (recibidos.length) {
        try {
          const entradaId = await crearOrdenEntrada({
            clienteId: after.cliente_id || null,
            clienteNombre: after.cliente_nombre || "",
            contratoDocId: after.contrato?.contrato_doc_id || null,
            contratoId: after.contrato?.contrato_id || null,
            unidades: recibidos.map(e => ({ serial: e.serial, modelo: e.modelo, modelo_id: e.modelo_id })),
            motivo: `Devolución ${ordenId} (${dev.origen?.tipo || "devolución"})`,
            refEntrada: { tipo: "devolucion", id: ordenId },
          });
          if (entradaId) {
            await db.collection("ordenes_de_servicio").doc(ordenId)
              .set({ orden_entrada_id: entradaId }, { merge: true });
          }
        } catch (e) {
          logger.warn("[onOrdenDevolucionWrite] No se pudo crear la ENTRADA (no crítico)", { ordenId, message: e.message });
        }
      } else {
        logger.info("[onOrdenDevolucionWrite] Cerrada sin recibidos — no se crea ENTRADA", { ordenId });
      }
    }

    return null;
  }
);
