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
const { crearOrdenEntrada, equipoDeEntrada, frasePiezas, RE_OBS_AUTO } = require("../../lib/ordenEntrada");
const { recepcionEmails } = require("../../lib/mailRecipients");
const { APP_BASE_URL } = require("../../lib/inventario");
const { pendientesDevolucion, resumenDevolucion, derivarEstadoDevolucion } = require("../../lib/devolucion");

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

// Recepción + el vendedor asignado del cliente. Nunca lanza.
async function _destinatariosPendientes(clienteId) {
  const emails = new Set();
  try { (await recepcionEmails()).forEach(e => emails.add(e)); } catch (e) { /* sin recepción */ }
  try {
    if (clienteId) {
      const cli = await db.collection("clientes").doc(clienteId).get();
      const vendUid = cli.exists ? cli.data().vendedor_asignado : null;
      if (vendUid) {
        const v = await db.collection("usuarios").doc(vendUid).get();
        const e = v.exists ? v.data().email : null;
        if (isEmail(e)) emails.add(String(e).trim().toLowerCase());
      }
    }
  } catch (e) {
    logger.warn("[onOrdenDevolucionWrite] vendedor del cliente no resuelto", { clienteId, error: e.message });
  }
  return [...emails];
}

// Aviso inmediato al cerrar una devolución con equipos SIN devolver. El
// digest diario (recordatorioOperativo §C) solo mira órdenes ABIERTAS, así
// que sin este correo el faltante se cerraba en silencio y nadie volvía a
// perseguirlo — justo el caso "devolvió 6 de 9".
async function avisarCierreConPendientes(ordenId, after, pendientes) {
  const dev = after.devolucion || {};
  const esperados = dev.esperados || [];
  const recibidos = esperados.filter(e => e.resolucion === "recibido").length;
  const excepciones = esperados.filter(e => e.resolucion === "no_devuelve");
  const destinatarios = await _destinatariosPendientes(after.cliente_id || null);
  if (!destinatarios.length) {
    logger.warn("[onOrdenDevolucionWrite] cierre con pendientes sin destinatarios", { ordenId, pendientes });
    return;
  }

  const refPapel = dev.origen?.ref_papel || after.contrato?.contrato_id || "—";
  const filasExc = excepciones.map(e => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${escapeHtml(e.serial)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(e.modelo || "—")}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(e.motivo_codigo || "—")}${e.motivo_detalle ? `: ${escapeHtml(e.motivo_detalle)}` : ""}</td>
    </tr>`).join("");

  await db.collection("mail_queue").add({
    to: destinatarios[0],
    cc: destinatarios.length > 1 ? destinatarios.slice(1).join(", ") : null,
    subject: `Devolución ${ordenId} cerrada con ${pendientes} equipo${pendientes === 1 ? "" : "s"} SIN devolver – ${after.cliente_nombre || "Cliente"}`,
    preheader: `${pendientes} equipo(s) siguen con el cliente`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Equipos que no regresaron</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La devolución <b>${escapeHtml(ordenId)}</b> de <b>${escapeHtml(after.cliente_nombre || "—")}</b>
        (${escapeHtml(refPapel)}) se cerró con <b>${pendientes} equipo(s) sin devolver</b>.
        Se recibieron <b>${recibidos}</b>. Coordinar la recuperación o el cobro con el cliente —
        la orden ya está cerrada y no volverá a salir en el recordatorio diario.
      </p>
      ${filasExc ? `
      <p style="margin:12px 0 4px;font:14px/1.5 Arial,sans-serif;">Excepciones registradas:</p>
      <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:4px 0;">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Motivo</th>
        </tr></thead>
        <tbody>${filasExc}</tbody>
      </table>` : ""}`,
    ctaUrl: `${APP_BASE_URL}/ordenes/index.html`,
    ctaLabel: "Ver la orden",
    meta: {
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      source: "devolucion-cierre-pendientes",
      orden_id: ordenId,
      pendientes,
    },
    status: "queued",
  });
  logger.info("[onOrdenDevolucionWrite] Aviso de cierre con pendientes encolado", { ordenId, pendientes, to: destinatarios[0] });
}

// ── Espejo del tiquete en el contrato ────────────────────────────────────
// La lista de contratos no puede abrir la orden por cada fila para saber si
// quedan equipos afuera, así que el conteo se denormaliza en el contrato —
// mismo patrón que `seriales_count` (onSerialWrite) o `baja_cancelado_total`
// (onCancelacionWrite).
//
// El mapa `devolucion_tiquetes` está indexado por id de orden porque un
// contrato puede ser reclamado por VARIOS tiquetes (multi-origen, o una baja
// parcial y luego una renovación). Escribir solo la clave de esta orden hace
// la operación idempotente sin tener que consultar todas las órdenes del
// contrato. La transacción protege el caso —raro pero real— de dos check-ins
// simultáneos sobre tiquetes distintos del mismo contrato.
//
// Se marcan DOS clases de contrato: el titular (`contrato.contrato_doc_id`) y
// cada ORIGEN de una renovación (`contrato.contrato_origen_ids`). Los equipos
// que el tiquete reclama son físicamente de los orígenes, y esa es la fila que
// el personal abre cuando busca al cliente.
async function estamparEspejo(ordenId, orden) {
  const c = orden.contrato || {};
  const destinos = [];
  if (c.contrato_doc_id) destinos.push({ id: c.contrato_doc_id, rol: "titular" });
  for (const origenId of (Array.isArray(c.contrato_origen_ids) ? c.contrato_origen_ids : [])) {
    if (origenId && origenId !== c.contrato_doc_id) destinos.push({ id: origenId, rol: "origen" });
  }
  if (!destinos.length) return;

  // Orden borrada (soft delete): deja de reclamar equipo. Sin esto el chip
  // sobrevivía a la orden — la limpieza de las devoluciones falsas de Adición
  // (2026-08-10) borró la orden y el propio trigger volvió a estampar el
  // tiquete al reaccionar a esa misma escritura.
  const borrada = orden.eliminado === true;
  const resumen = borrada ? null : resumenDevolucion(orden);

  for (const destino of destinos) {
    try {
      await db.runTransaction(async (tx) => {
        const ref  = db.collection("contratos").doc(destino.id);
        const snap = await tx.get(ref);
        if (!snap.exists) return;               // contrato borrado: nada que marcar

        const tiquetes = { ...(snap.data().devolucion_tiquetes || {}) };
        if (borrada) {
          if (!(ordenId in tiquetes)) return;   // nada que quitar
          delete tiquetes[ordenId];
        } else {
          tiquetes[ordenId] = { ...resumen, rol: destino.rol };
        }

        // Sin tiquetes no quedan campos a medias: la fila vuelve a no mostrar
        // chip, en vez de quedarse en "completa · 0 de 0".
        if (!Object.keys(tiquetes).length) {
          const del = admin.firestore.FieldValue.delete();
          tx.set(ref, {
            devolucion_tiquetes: del, devolucion_pendientes: del,
            devolucion_esperado: del, devolucion_estado: del,
            devolucion_actualizado_at: del,
          }, { merge: true });
          return;
        }

        const { pendientes, esperado, estado } = derivarEstadoDevolucion(tiquetes);
        tx.set(ref, {
          devolucion_tiquetes:       tiquetes,
          devolucion_pendientes:     pendientes,
          devolucion_esperado:       esperado,
          devolucion_estado:         estado,
          devolucion_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    } catch (e) {
      // No crítico: el pool ya quedó aplicado y la orden es la fuente de
      // verdad. Lo que se pierde es el chip de la lista, que el backfill rehace.
      logger.warn("[onOrdenDevolucionWrite] No se pudo estampar el espejo en el contrato", {
        ordenId, contrato: destino.id, rol: destino.rol, error: e.message,
      });
    }
  }
}

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
        const equipos = [...actuales, ...nuevos];
        const update = {
          equipos,
          fecha_modificacion: admin.firestore.FieldValue.serverTimestamp(),
        };
        // El conteo de la observación auto-generada tiene que seguir al array
        // de equipos. Sin esto la ENTRADA se queda con el número de la PRIMERA
        // tanda (casi siempre 1) aunque termine con 6 unidades, y así lo
        // imprime la orden de servicio. Solo se reescribe si nadie la editó.
        const obs = String(e.observaciones || "");
        if (RE_OBS_AUTO.test(obs)) {
          const total = equipos.filter(x => !x.eliminado).length;
          update.observaciones = obs.replace(RE_OBS_AUTO,
            `Orden creada automáticamente: inspección de ${frasePiezas(total)}.`);
        }
        tx.update(entradaRef, update);
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

    // Orden borrada: no se aplica nada al pool ni se crea ENTRADA — solo se
    // suelta el chip del contrato. Una orden eliminada no reclama equipo.
    if (after.eliminado === true) {
      await estamparEspejo(ordenId, after);
      return null;
    }

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
          ordenId, serial: e.serial, res, error: err.message,
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
        logger.warn("[onOrdenDevolucionWrite] ENTRADA por tanda falló (no crítico)", { ordenId, error: e.message });
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
        logger.warn("[onOrdenDevolucionWrite] No se pudo copiar el acuse a la ENTRADA (no crítico)", { ordenId, error: e.message });
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
          logger.warn("[onOrdenDevolucionWrite] ENTRADA de cierre falló (no crítico)", { ordenId, error: e.message });
        }
      } else {
        logger.info("[onOrdenDevolucionWrite] Cerrada sin recibidos — no se crea ENTRADA", { ordenId });
      }
    }

    // Cierre con equipos que el cliente NO devolvió: aviso a recepción + el
    // vendedor del cliente. Se calcula aquí (no se confía en el
    // devolucion.cierre_pendientes que escribe la UI) para que también cubra
    // los cierres hechos desde otro camino.
    if (cerroAhora) {
      const pendientes = pendientesDevolucion(dev);
      if (pendientes > 0) {
        try {
          await avisarCierreConPendientes(ordenId, after, pendientes);
        } catch (e) {
          logger.warn("[onOrdenDevolucionWrite] Aviso de cierre con pendientes falló (no crítico)", { ordenId, error: e.message });
        }
      }
    }

    // Espejo en el/los contrato(s). Corre SIEMPRE, no solo cuando hubo
    // resoluciones: la creación del tiquete es justo cuando el chip debe
    // aparecer, y el cierre es cuando debe volverse verde.
    await estamparEspejo(ordenId, after);

    return null;
  }
);
