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
// tanda) SOLO mientras el taller no la haya tomado (sigue POR ASIGNAR /
// RECIBIDO EN MOSTRADOR y sin técnico asignado, 2026-07-21): una orden que un
// técnico ya tiene en mano no debe crecer debajo de él. Si el taller ya la
// tomó o la cerró, la tanda siguiente abre una ENTRADA nueva. El cierre de la
// devolución conserva un fallback por si ninguna tanda alcanzó a crearla.
// ACUSE FIRMADO (2026-07-21): el check-in captura por unidad los accesorios
// entregados y el daño visible, y por tanda la firma del cliente
// (devolucion.acuses[]); todo viaja a la ENTRADA, que nace RECIBIDO EN
// MOSTRADOR (los equipos ya están en el taller) con el acuse como recepción.
// SIN CONTRATO (2026-07-22): devoluciones de contratos de papel
// (devolucion.modo == 'sin_contrato', creadas a mano) — los recibidos entran
// al pool vía upsertContacto (crea el doc si el serial nunca tocó el sistema).
// Idempotente: procesa solo resoluciones que CAMBIARON en esta escritura;
// las transiciones del pool tienen guards (sin-cambio) por si se repite.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");
const { crearOrdenEntrada, equipoDeEntrada } = require("../../lib/ordenEntrada");

// Estados en los que la ENTRADA aún acepta tandas (el taller no la ha tomado).
const ESTADOS_APPEND_ENTRADA = ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR"];

// Crea la ENTRADA (si no existe o el taller ya tomó/cerró la anterior) o
// agrega las unidades de la tanda a la existente mientras siga sin tomar.
// Devuelve el id de la ENTRADA usada, o null.
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
      const estado = (e.estado_reparacion || "POR ASIGNAR").toUpperCase();
      if (!ESTADOS_APPEND_ENTRADA.includes(estado) || e.tecnico_asignado) return false;
      const actuales = Array.isArray(e.equipos) ? e.equipos : [];
      const seriales = new Set(actuales.map(x => (x.numero_de_serie || x.serial || "").toUpperCase()));
      const nuevos = unidades
        .filter(u => !seriales.has((u.serial || "").toUpperCase()))
        .map(u => equipoDeEntrada(u,
          `Tanda de devolución ${ordenId} — pendiente de inspección.` +
          (u.dano ? ` Daño visible al recibir: ${u.dano}.` : "")));
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
    // La ENTRADA anterior ya fue tomada por el taller (o cerró): nueva orden.
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
          let r;
          if (dev.modo === "sin_contrato") {
            // Contrato de papel (fuera del sistema): el serial puede no existir
            // en el pool, o estar en un estado sembrado que no refleja la
            // realidad. upsertContacto (alta por contacto) crea el doc si falta
            // — con el failsafe de colisión — o lo transiciona desde cualquier
            // estado: la devolución física manda. Excepciones: baja (terminal,
            // guard del pool) y vendido (una devolución de algo vendido amerita
            // revisión manual, no un pisotón automático).
            r = await pool.upsertContacto({
              serial: e.serial, modelo_id: e.modelo_id || null, modelo_label: e.modelo || "",
              estado: pool.ESTADOS.DEVUELTO,
              noTocarDesde: [pool.ESTADOS.VENDIDO],
              tipo: "devolucion", refMov,
              notas: "Recibido en devolución sin contrato (contrato de papel) — pendiente de inspección",
              origen: "devolucion_sin_contrato",
              extra: { verificado: false, propiedad: "cecomunica" },
            });
          } else {
            r = e.pool_doc_id
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
          }
          logger.info("[onOrdenDevolucionWrite] recibido", { ordenId, serial: e.serial, r, modo: dev.modo || "recuperacion" });
          tandaRecibida.push({
            serial: e.serial, modelo: e.modelo, modelo_id: e.modelo_id,
            accesorios: e.accesorios || null,
            dano: e.dano_visible || "",
          });
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

    // Acuse firmado del check-in (devolucion.acuses[]): el cliente firmó la
    // condición/accesorios de lo que entregó. Se copia a la ENTRADA como su
    // recepción en mostrador (mismos campos que receiveAtCounter) para que
    // "Ver recepción" lo muestre desde la orden del taller. Solo el primer
    // acuse llena los campos; los siguientes quedan en la DEVOLUCIÓN.
    const acusesAntes = (before?.devolucion?.acuses || []).length;
    const acusesNuevos = (dev.acuses || []).slice(acusesAntes);
    if (acusesNuevos.length) {
      try {
        // El acuse suele firmarse segundos después del check-in: si la tanda
        // aún no terminó de estampar orden_entrada_id en este snapshot,
        // releer el doc fresco antes de rendirse (best-effort).
        let entradaId = after.orden_entrada_id || null;
        if (!entradaId) {
          entradaId = ((await db.collection("ordenes_de_servicio").doc(ordenId).get()).data() || {}).orden_entrada_id || null;
        }
        if (!entradaId) throw new Error("sin orden_entrada_id todavía — el acuse queda en la devolución");
        const eRef = db.collection("ordenes_de_servicio").doc(entradaId);
        const eSnap = await eRef.get();
        const ent = eSnap.exists ? eSnap.data() : null;
        if (ent && !ent.firma_recepcion_url && !ent.receptor_recepcion_nombre) {
          const a = acusesNuevos[0];
          await eRef.set({
            firma_recepcion_url: a.firma_url || null,
            receptor_recepcion_nombre: a.nombre_entrega || "",
            recepcion_sin_firma: !!a.sin_firma,
            recepcion_sin_firma_motivo: a.sin_firma ? (a.sin_firma_motivo || "") : null,
            fecha_recepcion: a.at || admin.firestore.FieldValue.serverTimestamp(),
            recepcion_por_uid: a.por_uid || "system",
          }, { merge: true });
          logger.info("[onOrdenDevolucionWrite] Acuse copiado a la ENTRADA", { ordenId, entradaId });
        }
      } catch (e) {
        logger.warn("[onOrdenDevolucionWrite] No se pudo copiar el acuse a la ENTRADA (no crítico)", { ordenId, message: e.message });
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
            recibidos.map(e => ({
              serial: e.serial, modelo: e.modelo, modelo_id: e.modelo_id,
              accesorios: e.accesorios || null, dano: e.dano_visible || "",
            })));
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
