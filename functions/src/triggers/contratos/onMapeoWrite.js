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

    // ── Saliente: pendiente de devolución ────────────────────────────────
    if (serialSaliente) {
      try {
        const ref = await resolverUnidad(m.saliente_pool_id, serialSaliente);
        if (ref) {
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
