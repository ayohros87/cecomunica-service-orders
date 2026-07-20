// Aplica al pool las resoluciones del check-in de una orden de DEVOLUCIÓN
// (ordenes-devolucion.js escribe devolucion.esperados[].resolucion; aquí,
// con Admin SDK, se mueve la unidad):
//   recibido    → devuelto_revision (cuarentena de inspección)
//   nunca_salio → en_bodega directo (anulación por error: jamás salió)
//   no_devuelve → devolucion_excepcion en la unidad (sin cambio de estado);
//                 se limpia pendiente_devolucion (dejamos de perseguirla)
// ENTRADA POR TANDA (2026-07-20): el taller revisa lo recibido según va
// llegando — al PRIMER check-in "recibido" se crea la orden de ENTRADA y las
// tandas siguientes se le AGREGAN (mismo doc, sin órdenes duplicadas por
// tanda). Si la ENTRADA ya avanzó a un estado terminal cuando llega otra
// tanda, se crea una nueva. El cierre de la devolución conserva un fallback
// por si ninguna tanda alcanzó a crearla.
// Idempotente: procesa solo resoluciones que CAMBIARON en esta escritura;
// las transiciones del pool tienen guards (sin-cambio) por si se repite.
const crypto = require("crypto");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");
const { crearOrdenEntrada } = require("../../lib/ordenEntrada");

const ESTADOS_TERMINALES_ORDEN = ["COMPLETADO (EN OFICINA)", "ENTREGADO AL CLIENTE", "CERRADA (VISITA)", "CERRADA (DEVOLUCION)"];

// Crea la ENTRADA (si no existe o la anterior ya cerró) o agrega las unidades
// de la tanda a la existente. Devuelve el id de la ENTRADA usada, o null.
async function crearOAlimentarEntrada(ordenId, after, unidades) {
  const devRef = db.collection("ordenes_de_servicio").doc(ordenId);
  // Releer el doc: otra tanda concurrente pudo haber creado la ENTRADA ya.
  const fresh = (await devRef.get()).data() || {};
  const entradaId = fresh.orden_entrada_id || null;

  if (entradaId) {
    const entradaRef = db.collection("ordenes_de_servicio").doc(entradaId);
    const usada = await db.runTransaction(async (tx) => {
      const snap = await tx.get(entradaRef);
      if (!snap.exists) return false;
      const e = snap.data();
      if (ESTADOS_TERMINALES_ORDEN.includes((e.estado_reparacion || "").toUpperCase())) return false;
      const actuales = Array.isArray(e.equipos) ? e.equipos : [];
      const seriales = new Set(actuales.map(x => (x.numero_de_serie || x.serial || "").toUpperCase()));
      const nuevos = unidades
        .filter(u => !seriales.has((u.serial || "").toUpperCase()))
        .map(u => ({
          id: crypto.randomUUID(),
          modelo_id: u.modelo_id || null,
          modelo: u.modelo || "",
          serial: u.serial, numero_de_serie: u.serial,
          bateria: false, clip: false, cargador: false, fuente: false, antena: false, cubrepolvo: false,
          observaciones: `Tanda de devolución ${ordenId} — pendiente de inspección.`,
          eliminado: false,
        }));
      if (nuevos.length) {
        tx.update(entradaRef, {
          equipos: [...actuales, ...nuevos],
          fecha_modificacion: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return true;
    });
    if (usada) {
      logger.info("[onOrdenDevolucionWrite] Tanda agregada a ENTRADA existente", { ordenId, entradaId, unidades: unidades.length });
      return entradaId;
    }
    // La ENTRADA anterior ya cerró: cae a crear una nueva.
  }

  const nuevaId = await crearOrdenEntrada({
    clienteId: after.cliente_id || null,
    clienteNombre: after.cliente_nombre || "",
    contratoDocId: after.contrato?.contrato_doc_id || null,
    contratoId: after.contrato?.contrato_id || null,
    unidades,
    motivo: `Devolución ${ordenId} (${after.devolucion?.origen?.tipo || "devolución"})`,
    refEntrada: { tipo: "devolucion", id: ordenId },
  });
  if (nuevaId) {
    await devRef.set({ orden_entrada_id: nuevaId }, { merge: true });
  }
  return nuevaId;
}

module.exports = onDocumentWritten(
  { document: "ordenes_de_servicio/{ordenId}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after || after.tipo_de_servicio !== "DEVOLUCION") return null;

    const ordenId = event.params.ordenId;
    const dev = after.devolucion || {};
    const antes = new Map(((before?.devolucion?.esperados) || []).map(e => [e.id, e.resolucion || null]));
    const tandaRecibida = []; // recibidos NUEVOS de esta escritura → ENTRADA por tanda

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
          tandaRecibida.push({ serial: e.serial, modelo: e.modelo, modelo_id: e.modelo_id });
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

    // ENTRADA por tanda: cada lote de recibidos alimenta la inspección del
    // taller de inmediato (crea la ENTRADA en la primera tanda, agrega en las
    // siguientes) — no espera al cierre de la devolución.
    if (tandaRecibida.length) {
      try {
        await crearOAlimentarEntrada(ordenId, after, tandaRecibida);
      } catch (e) {
        logger.warn("[onOrdenDevolucionWrite] ENTRADA por tanda falló (no crítico)", { ordenId, message: e.message });
      }
    }

    // Fallback al cierre: si por alguna razón ninguna tanda creó la ENTRADA
    // (p.ej. fallos transitorios), se crea aquí con TODOS los recibidos.
    const cerroAhora = before?.estado_reparacion !== "CERRADA (DEVOLUCION)"
      && after.estado_reparacion === "CERRADA (DEVOLUCION)";
    if (cerroAhora && !after.orden_entrada_id && !tandaRecibida.length) {
      const recibidos = (dev.esperados || []).filter(e => e.resolucion === "recibido");
      if (recibidos.length) {
        try {
          await crearOAlimentarEntrada(ordenId, after,
            recibidos.map(e => ({ serial: e.serial, modelo: e.modelo, modelo_id: e.modelo_id })));
        } catch (e) {
          logger.warn("[onOrdenDevolucionWrite] ENTRADA de cierre falló (no crítico)", { ordenId, message: e.message });
        }
      } else {
        logger.info("[onOrdenDevolucionWrite] Cerrada sin recibidos — no se crea ENTRADA", { ordenId });
      }
    }

    return null;
  }
);
