// declararSustitutoContrato — el vendedor (o administración) declara DESPUÉS
// de anular cuál contrato sustituye al anulado, y el sistema hace el traspaso
// que onAnnulment habría hecho si el sustituto se hubiera indicado a tiempo.
//
// Por qué existe (plan de autoservicio 2026-10-07, P2/B3): onAnnulment corre
// UNA vez, al pasar a `anulado`. Si el sustituto no existía todavía o no se
// indicó (INNOVACIÓN SERV20260918-01 "sin contrato sustituto indicado";
// MAGEN DAVID rehecho sin anular; SHEVET repuntado a mano sin la señal), el
// contrato anulado queda con `sustitucion_vinculo_pendiente` (chip rojo en el
// archivo) y la única salida era functions/scripts/reparar-sustitucion.js.
//
// Es callable y no escritura del navegador porque el traspaso toca campos del
// backend en el sustituto (`seriales_estado`, `entrega_confirmada`…) y mueve
// el pool. Hace, en orden:
//   1. valida (origen anulado, sustituto vivo, MISMO cliente, sin devolución
//      abierta del origen);
//   2. estampa el vínculo en el origen (`sustituido_por_id`, tipo sustitución);
//   3. traspasa los seriales que siguen colgando del origen (o en custodia de
//      la cuenta) con lib/sustitucionContrato.traspasarASustituto — copia
//      filas, señal `seriales_estado/current`, PoC, aviso a bodega. Si el
//      sustituto ya tiene sus seriales `asignados` (caso SHEVET), solo
//      reapunta las fichas PoC y confirma el vínculo;
//   4. repunta las órdenes que la anulación dejó señaladas "revisar";
//   5. cierra o deja explicada la marca `sustitucion_vinculo_pendiente`.
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const pool = require("../domain/equiposPool");
const { traspasarASustituto, reapuntarPoc } = require("../lib/sustitucionContrato");
const { cerrarOrdenesDeContratoAnulado } = require("../lib/ordenesDeContratoAnulado");
const { TERMINALES } = require("../domain/ordenesAnulacion");

const ROLES = new Set(["administrador", "gerente", "vendedor", "recepcion"]);
const EN_CONTRATO = new Set([pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.EN_TALLER]);

async function resolverUnidades(origenId, origen) {
  const snap = await db.collection("contratos").doc(origenId).collection("seriales").get();
  const unidades = [];
  const omitidas = [];
  const yaEnSustituto = [];
  for (const d of snap.docs) {
    const s = d.data() || {};
    const serial = String(s.serial || "").trim();
    if (!serial) continue;
    let data = null; let ref = null;
    try { ({ ref, data } = await pool.resolver(serial, s.modelo_id, s.modelo, { adoptarSiExiste: true })); }
    catch (e) { omitidas.push({ serial, motivo: `error: ${e.message}` }); continue; }
    if (!data) { omitidas.push({ serial, motivo: "sin ficha en el pool" }); continue; }
    const cdi = data.asignacion?.contrato_doc_id || null;
    if (cdi === origen.sustituido_por_id) { yaEnSustituto.push(serial); continue; }
    const enCustodiaDeLaCuenta = !cdi && data.asignacion?.cliente_id && data.asignacion.cliente_id === origen.cliente_id;
    if (cdi !== origenId && !enCustodiaDeLaCuenta) {
      omitidas.push({ serial, motivo: cdi ? `asignada a otro contrato (${data.asignacion?.contrato_id || cdi})` : `está ${data.estado || "?"} sin custodia de la cuenta` });
      continue;
    }
    if (!EN_CONTRATO.has(data.estado)) { omitidas.push({ serial, motivo: `está ${data.estado || "?"} (no cuelga del contrato)` }); continue; }
    unidades.push({ serial, modelo: s.modelo || data.modelo_label || "", modelo_id: s.modelo_id || data.modelo_id || null, pool_doc_id: ref.id });
  }
  return { unidades, omitidas, yaEnSustituto };
}

// El núcleo, separado del onCall para probarlo contra el emulador
// (test-emulator/declarar-sustituto.js). `usuario` es quien firma el rastro.
async function ejecutar({ usuario, origenId, sustitutoId, motivo = "" }) {
    if (!origenId || typeof origenId !== "string") throw new HttpsError("invalid-argument", "Falta el contrato anulado.");
    if (!sustitutoId || typeof sustitutoId !== "string") throw new HttpsError("invalid-argument", "Falta el contrato sustituto.");
    if (origenId === sustitutoId) throw new HttpsError("invalid-argument", "El sustituto no puede ser el mismo contrato.");

    const [oSnap, sSnap] = await Promise.all([
      db.collection("contratos").doc(origenId).get(),
      db.collection("contratos").doc(sustitutoId).get(),
    ]);
    if (!oSnap.exists) throw new HttpsError("not-found", "El contrato anulado no existe.");
    if (!sSnap.exists) throw new HttpsError("not-found", "El contrato sustituto no existe.");
    const origen = oSnap.data() || {};
    const sust = sSnap.data() || {};
    if (origen.estado !== "anulado") throw new HttpsError("failed-precondition", `El contrato ${origen.contrato_id || origenId} no está anulado (está ${origen.estado || "?"}).`);
    if (sust.deleted === true || sust.estado === "anulado") throw new HttpsError("failed-precondition", `El sustituto ${sust.contrato_id || sustitutoId} está anulado o borrado.`);
    if (!["aprobado", "activo"].includes(String(sust.estado || ""))) throw new HttpsError("failed-precondition", `El sustituto ${sust.contrato_id || sustitutoId} tiene que estar aprobado o activo (está ${sust.estado || "?"}).`);
    if (sust.cliente_id !== origen.cliente_id) throw new HttpsError("failed-precondition", "El sustituto es de otro cliente. Trasladar equipos a otra cuenta no es una sustitución.");
    if (origen.orden_devolucion_id) {
      const dev = await db.collection("ordenes_de_servicio").doc(String(origen.orden_devolucion_id)).get();
      const est = dev.exists ? String(dev.data().estado_reparacion || "") : "";
      if (dev.exists && !TERMINALES.has(est) && est !== "ANULADA") {
        throw new HttpsError("failed-precondition", `La anulación abrió la DEVOLUCIÓN ${origen.orden_devolucion_id} y sigue abierta. Anúlala o ciérrala antes de declarar el sustituto.`);
      }
    }
    const now = admin.firestore.FieldValue.serverTimestamp();

    // 2) El vínculo en el origen. A partir de aquí la anulación ES por
    //    sustitución aunque se haya registrado como terminación.
    await oSnap.ref.set({
      anulacion_tipo: "sustitucion",
      sustituido_por_id: sustitutoId,
      sustituido_por_contrato_id: sust.contrato_id || "",
      sustitucion_declarada_at: now,
      sustitucion_declarada_por: usuario,
      sustitucion_declarada_motivo: String(motivo || "").slice(0, 300),
    }, { merge: true });
    const origenConVinculo = { ...origen, anulacion_tipo: "sustitucion", sustituido_por_id: sustitutoId, sustituido_por_contrato_id: sust.contrato_id || "" };

    // 3) Seriales.
    const { unidades, omitidas, yaEnSustituto } = await resolverUnidades(origenId, origenConVinculo);
    let traspaso = { ok: true, copiados: 0, faltan: 0, completo: null, pendientes: [], motivo: "" };
    let poc = { reapuntados: 0 };
    if (sust.seriales_estado === "asignados") {
      // El sustituto ya tiene sus seriales: no se copia nada. Las fichas PoC
      // que nombren al origen pasan al sustituto (solo las que él lista).
      poc = await reapuntarPoc({ origenId, origen: origenConVinculo, sustitutoId, sustituto: sust });
      if (unidades.length) traspaso = { ...traspaso, ok: false, motivo: "el sustituto ya tiene sus seriales asignados", pendientes: unidades.map((x) => ({ serial: x.serial, motivo: "el sustituto ya cerró sus seriales; agrégalo por aumento o corrige los seriales del sustituto" })) };
    } else if (unidades.length) {
      traspaso = await traspasarASustituto({ origenId, origen: origenConVinculo, sustitutoId, unidades });
      if (!traspaso.ok) {
        throw new HttpsError("failed-precondition", `El traspaso no procedió: ${traspaso.motivo}`);
      }
    } else {
      // Nada que traspasar (ya se repuntó a mano): las fichas PoC igual.
      poc = await reapuntarPoc({ origenId, origen: origenConVinculo, sustitutoId, sustituto: sust });
    }

    // 4) Órdenes señaladas "revisar" en la anulación: ahora sí hay a dónde.
    let ordenes = { repuntadas: [], anuladas: [], revisar: [] };
    try { ordenes = await cerrarOrdenesDeContratoAnulado(origenId, origenConVinculo); }
    catch (e) { logger.warn("[declararSustitutoContrato] órdenes", { origenId, message: e.message }); }

    // 5) La marca.
    const sinResolver = [...(traspaso.pendientes || []), ...omitidas];
    const patch = {
      sustitucion_traspasados: (origen.sustitucion_traspasados || 0) + (traspaso.copiados || 0),
      sustitucion_reparado_at: now,
      sustitucion_reparado_por: usuario,
    };
    if (sinResolver.length) {
      patch.sustitucion_vinculo_pendiente = true;
      patch.sustitucion_vinculo_motivo = `${sinResolver.length} unidad(es) sin traspasar`;
      patch.sustitucion_pendientes = sinResolver.slice(0, 50);
    } else {
      patch.sustitucion_vinculo_pendiente = admin.firestore.FieldValue.delete();
      patch.sustitucion_vinculo_motivo = admin.firestore.FieldValue.delete();
      patch.sustitucion_pendientes = admin.firestore.FieldValue.delete();
    }
    await oSnap.ref.set(patch, { merge: true });

    logger.info("[declararSustitutoContrato]", { origenId, sustitutoId, usuario, copiados: traspaso.copiados, pendientes: sinResolver.length, poc: poc.reapuntados, ordenes: ordenes.repuntadas?.length });
    return {
      ok: true,
      origen: origen.contrato_id || origenId, sustituto: sust.contrato_id || sustitutoId,
      copiados: traspaso.copiados || 0, completo: traspaso.completo, faltan: traspaso.faltan || 0,
      ya_en_sustituto: yaEnSustituto.length, poc_reapuntados: poc.reapuntados || 0,
      ordenes_repuntadas: ordenes.repuntadas || [],
      pendientes: sinResolver,
    };
}

module.exports = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) {
      throw new HttpsError("permission-denied", "Tu rol no declara sustitutos de contrato.");
    }
    const { origenId, sustitutoId, motivo = "" } = request.data || {};
    return ejecutar({ usuario: u.email || uid, origenId, sustitutoId, motivo });
  },
);
module.exports.ejecutar = ejecutar;
