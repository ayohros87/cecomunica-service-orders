// Traspaso de equipo entre un contrato ANULADO y el contrato que lo SUSTITUYE.
//
// Una anulación por sustitución (el papel se rehace: precio mal calculado,
// representante legal equivocado, modelo mal escrito) no mueve un solo radio.
// Lo único que cambia es de qué contrato cuelga la ficha. Sin este traspaso las
// unidades se quedan colgando de un contrato muerto y el contrato vivo nace sin
// equipos ligados — que es exactamente como quedó ALQ20260715-01 /
// ALQ20260806-03 (SOCIEDAD ISRAELITA, 32 radios) el 2026-08-06.
//
// El traspaso NO escribe el pool a mano: copia las filas de serial a la
// subcolección del contrato nuevo y deja que onSerialWrite haga el resto
// (upsertContacto → asignación nueva + movimiento `reasignacion` en el kardex).
// Un solo camino, y el historial queda contado por el mismo código que cuenta
// todos los demás.
"use strict";

const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");

/**
 * Pasa al contrato sustituto las unidades que siguen con el cliente.
 *
 * Es deliberadamente cobarde: ante cualquier duda no hace nada y devuelve el
 * motivo, porque escribir en un contrato que NO es el que se está anulando es
 * una acción con consecuencias (dispara onSerialWrite, mueve el pool, habilita
 * facturación). Prefiere dejar el trabajo a la vista de un humano antes que
 * adivinar.
 *
 * @param {Object} p
 * @param {string} p.origenId — doc id del contrato anulado
 * @param {Object} p.origen — datos del contrato anulado
 * @param {string} p.sustitutoId — doc id del contrato que lo sustituye
 * @param {Array}  p.unidades — fichas que continúan con el cliente
 *        [{ serial, modelo, modelo_id, pool_doc_id }]
 * @returns {Promise<{ok:boolean, motivo?:string, copiados?:number}>}
 */
async function traspasarASustituto({ origenId, origen, sustitutoId, unidades }) {
  if (!sustitutoId)        return { ok: false, motivo: "sin contrato sustituto indicado" };
  if (sustitutoId === origenId) return { ok: false, motivo: "el sustituto es el mismo contrato" };
  if (!unidades || !unidades.length) return { ok: false, motivo: "sin unidades que traspasar" };

  const ref  = db.collection("contratos").doc(sustitutoId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, motivo: "el contrato sustituto no existe" };
  const s = snap.data() || {};

  // Candados. Cada uno tapa una forma distinta de hacer daño:
  if (s.deleted === true)  return { ok: false, motivo: "el sustituto está borrado" };
  if (s.estado === "anulado") return { ok: false, motivo: "el sustituto también está anulado" };
  // Traspasar a OTRO cliente no es una sustitución, es un traslado de equipo —
  // y ese sí necesita decisión humana (y probablemente otro contrato).
  if (s.cliente_id !== origen.cliente_id) {
    return { ok: false, motivo: "el sustituto es de otro cliente" };
  }
  // Si el sustituto YA tiene seriales, alguien los cargó a mano: sus decisiones
  // mandan sobre las nuestras. Volver a escribir encima podría duplicar filas o
  // pisar una corrección deliberada.
  const yaTiene = await ref.collection("seriales").limit(1).get();
  if (!yaTiene.empty) return { ok: false, motivo: "el sustituto ya tiene seriales cargados" };

  // El sustituto hereda la ENTREGA del original: el cliente ya tiene los radios
  // en la mano, y sin esta marca onSerialWrite los degradaría a
  // `asignado_contrato` — diciendo que están apartados en bodega.
  const patch = {
    sustituye_a_id: origenId,
    sustituye_a_contrato_id: origen.contrato_id || origenId,
    sustitucion_at: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (origen.entrega_confirmada === true) {
    patch.entrega_confirmada = true;
    patch.fecha_entrega_ultima = origen.fecha_entrega_ultima || null;
    // Candado contra onEntregaTransicion: si el sustituto quedó vinculado al
    // anulado como contrato ORIGEN (el flujo de contrato nuevo lo hace desde el
    // 2026-08-11), confirmar la entrega le haría reclamar como devolución el
    // equipo del origen — el mismo tiquete falso que esta rama existe para
    // evitar, entrando por la puerta de atrás. `transicion_auto_at` es el guard
    // que ese trigger ya consulta.
    patch.transicion_auto_at = admin.firestore.FieldValue.serverTimestamp();
    patch.transicion_auto_motivo = "sustitucion_de_contrato";
  }
  await ref.set(patch, { merge: true });

  // Las filas de serial, una por una: cada `set` dispara onSerialWrite, que
  // reapunta la ficha del pool. En lote sería igual de correcto pero mucho más
  // difícil de leer en los logs cuando algo falla.
  let copiados = 0;
  for (const u of unidades) {
    const serial = String(u.serial || "").trim();
    if (!serial) continue;
    await ref.collection("seriales").add({
      serial,
      modelo: u.modelo || "",
      modelo_id: u.modelo_id || null,
      contrato_doc_id: sustitutoId,
      contrato_id: s.contrato_id || "",
      cliente_id: origen.cliente_id || "",
      cliente_nombre: origen.cliente_nombre || "",
      source: "sustitucion_contrato",
      migrado_de_contrato: origenId,
      created_by: "system:sustitucion",
      updated_by: "system:sustitucion",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    copiados++;
  }

  // La señal de seriales del PADRE, no la subcolección `seriales_estado`: esa
  // dispara el correo con el PDF del contrato a activaciones. El cliente ya
  // tiene sus radios y ya recibió el PDF del contrato original; reenviarlo por
  // una corrección de papeleo es ruido.
  await ref.set({
    seriales_estado: "asignados",
    seriales_asignados_at: admin.firestore.FieldValue.serverTimestamp(),
    seriales_asignados_por: "system:sustitucion",
    seriales_omitidos_count: 0,
  }, { merge: true });

  logger.info("[sustitucionContrato] Equipo traspasado al contrato sustituto", {
    origenId, sustitutoId, copiados,
  });
  return { ok: true, copiados };
}

module.exports = { traspasarASustituto };
