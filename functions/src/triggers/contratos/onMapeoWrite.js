const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");

// Mapeos de transición de equipos (renovación / reemplazo / adición) —
// contratos/{cid}/mapeos/{mid}. El doc lo escribe la pantalla de transición
// (contratos/transicion.html) y aquí se aplica el LINAJE al pool de equipos
// con Admin SDK (PLAN_CICLO_VIDA_EQUIPOS.md C.2/C.3):
//   · entrante → `reemplaza_a` = serial_norm del saliente (hilo del equipo)
//   · saliente → `pendiente_devolucion: true` (el cliente aún lo tiene; el
//     chip solo se muestra mientras siga en_cliente/asignado — la ENTRADA
//     posterior lo lleva a devuelto_revision y el flag deja de aplicar)
// El mapeo es ASIMÉTRICO (§3.4): saliente sin entrante = se devuelve sin
// sustituto (solo flag); entrante sin saliente no genera mapeo. Solo reacciona
// a la CREACIÓN (registro append-only); el borrado (corrección admin) revierte
// los campos.
//
// Shape del doc: { saliente, saliente_pool_id?, entrante?, entrante_pool_id?,
//                  modelo?, modelo_id?, contrato_origen_id?, at, por }
// Doc MARCADOR { sin_reemplazos: true, saliente: null, entrante: null, … }:
// cierra la transición de una adición pura — solo incrementa el contador
// (las secciones de linaje no aplican al no traer seriales).
// Doc EXCEPCIÓN { tipo: 'no_devuelve', saliente, motivo_codigo, motivo_detalle }:
// el saliente NO se devuelve (renovación parcial / vendido / perdido…). No se
// marca pendiente_devolucion; se estampa `devolucion_excepcion` en la unidad
// para que el kardex y las conciliaciones sepan por qué sigue con el cliente.
module.exports = onDocumentWritten(
  { document: "contratos/{cid}/mapeos/{mid}", region: "us-central1" },
  async (event) => {
    const cid = event.params.cid;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;

    const creado  = !before && !!after;
    const borrado = !!before && !after;
    if (!creado && !borrado) return null; // updates no soportados (append-only)
    const m = creado ? after : before;

    // Resuelve la unidad del pool: por doc ID si la pantalla lo mandó, si no
    // por serial (query canónica serial_norm + match tolerante de modelo).
    const resolverUnidad = async (poolId, serial) => {
      if (poolId) {
        const s = await db.collection("equipos_pool").doc(String(poolId)).get();
        if (s.exists) return s.ref;
      }
      if (serial) {
        const r = await pool.resolver(serial, m.modelo_id || null, m.modelo || "");
        if (r.data) return r.ref;
      }
      return null;
    };

    const movimiento = (tipo, notas) => ({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system",
      por_email: null,
      tipo,
      de_estado: null,
      a_estado: null,
      ref: { tipo: "contrato", id: cid, label: m.contrato_id || "" },
      notas,
    });

    const serialSaliente = (m.saliente || "").toString().trim();
    const serialEntrante = (m.entrante || "").toString().trim();

    // ── Entrante: linaje reemplaza_a ─────────────────────────────────────
    if (serialEntrante && serialSaliente) {
      try {
        const ref = await resolverUnidad(m.entrante_pool_id, serialEntrante);
        if (ref) {
          await ref.set({
            reemplaza_a: creado ? pool.normSerial(serialSaliente) : admin.firestore.FieldValue.delete(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          await ref.collection("movimientos").add(movimiento("reemplazo", creado
            ? `Reemplaza a ${serialSaliente} (transición de contrato)`
            : `Mapeo eliminado: ya no reemplaza a ${serialSaliente}`));
        } else {
          logger.info("[onMapeoWrite] Entrante no está en el pool aún", { cid, serial: serialEntrante });
        }
      } catch (e) {
        logger.warn("[onMapeoWrite] No se pudo estampar el linaje del entrante", { cid, serial: serialEntrante, message: e.message });
      }
    }

    // ── Señal en el contrato para la lista ───────────────────────────────
    // `transicion_mapeos_count` alimenta la CTA "Transición de equipos" de la
    // lista de contratos: con 0 mapeos la CTA insiste (ámbar); con 1+ deja de
    // ser el siguiente paso. Admin SDK: esquiva el guard touchesCFOwnedFields.
    try {
      await db.collection("contratos").doc(cid).set({
        transicion_mapeos_count: admin.firestore.FieldValue.increment(creado ? 1 : -1),
        transicion_ultimo_mapeo_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      logger.warn("[onMapeoWrite] No se pudo estampar el contador en el contrato", { cid, message: e.message });
    }

    // ── Saliente: pendiente de devolución o excepción justificada ────────
    if (serialSaliente) {
      const esExcepcion = m.tipo === "no_devuelve";
      try {
        const ref = await resolverUnidad(m.saliente_pool_id, serialSaliente);
        if (ref && esExcepcion) {
          await ref.set({
            devolucion_excepcion: creado ? {
              motivo_codigo: m.motivo_codigo || "otro",
              motivo_detalle: m.motivo_detalle || "",
              contrato_id: m.contrato_id || cid,
              at: admin.firestore.FieldValue.serverTimestamp(),
            } : admin.firestore.FieldValue.delete(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          await ref.collection("movimientos").add(movimiento("reemplazo", creado
            ? `NO se devuelve (${m.motivo_codigo || "otro"}${m.motivo_detalle ? `: ${m.motivo_detalle}` : ""}) — transición de contrato`
            : "Excepción de devolución eliminada"));
        } else if (ref) {
          await ref.set({
            pendiente_devolucion: creado ? true : admin.firestore.FieldValue.delete(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          await ref.collection("movimientos").add(movimiento("reemplazo", creado
            ? (serialEntrante
                ? `Reemplazada por ${serialEntrante} — pendiente de devolución (entrada)`
                : "Sale del servicio sin sustituto — pendiente de devolución (entrada)")
            : "Mapeo eliminado: ya no está pendiente de devolución"));
        } else {
          logger.info("[onMapeoWrite] Saliente no está en el pool", { cid, serial: serialSaliente });
        }
      } catch (e) {
        logger.warn("[onMapeoWrite] No se pudo marcar el saliente", { cid, serial: serialSaliente, message: e.message });
      }
    }

    return null;
  }
);
