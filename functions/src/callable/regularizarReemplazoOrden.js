// regularizarReemplazoOrden — el taller cambió el radio del cliente en una
// orden de PROGRAMACIÓN/REPARACIÓN sin abrir gestión de reemplazo (LIGO
// 23905A0437, CEMENTO BAYANO 22610A4066) y después nadie podía ligar saliente
// y entrante: el entrante quedaba "en bodega" estando con el cliente y el
// saliente seguía en el contrato. Aquí se crea la gestión REEMP a posteriori
// con la orden ya hecha como su orden de programación, y el pool queda como
// lo habría dejado la entrega normal (plan de autoservicio 2026-10-07, P4/E1).
//
// Qué escribe:
//   · gestiones/{GR…}: tipo reemplazo, estado cerrada, origen regularizacion,
//     items[{serial_saliente, serial_nuevo, modelo…}], ordenes.programacion_id,
//     cierre completo, cambio_modelo aprobado "se mantiene" si cambió la familia;
//   · gestiones/{gid}/mapeos + eventos;
//   · la orden: gestion {id, tipo, regularizada};
//   · pool: entrante → en_cliente con la asignación del saliente (contrato) o
//     la custodia del cliente de la orden, reemplaza_a + reemplazo_origen,
//     kardex `reemplazo`; saliente → a revisión si quedó en casa (sale del
//     contrato), o pendiente_devolucion si el cliente se lo quedó.
// No manda correos ni crea órdenes: la entrega ya ocurrió.
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const pool = require("../domain/equiposPool");
const { catalogo, ModeloFamilia } = require("../domain/modeloCatalogo");

const ROLES = new Set(["administrador", "recepcion", "jefe_taller", "inventario", "gerente"]);
const FV = admin.firestore.FieldValue;

function fechaStrPanama(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Panama" }).replace(/-/g, "");
}
async function reservarNumero() {
  const fechaStr = fechaStrPanama();
  const ref = db.collection("contadores").doc(`gestiones_GR_${fechaStr}`);
  const seq = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const siguiente = (snap.exists ? Number(snap.data().seq || 0) : 0) + 1;
    t.set(ref, { seq: siguiente, prefijo: "GR", fecha: fechaStr, actualizado_en: FV.serverTimestamp() }, { merge: true });
    return siguiente;
  });
  return `GR${fechaStr}-${String(seq).padStart(2, "0")}`;
}
const equipoDe = (orden, serial) => (orden.equipos || []).find((e) => e && !e.eliminado
  && pool.normSerial(e.numero_de_serie || e.serial || "") === pool.normSerial(serial));

async function ejecutar({ usuario, uid = null, ordenId, serialSaliente, serialEntrante, salienteEnCasa = true, motivo = "" }) {
  if (!ordenId || typeof ordenId !== "string") throw new HttpsError("invalid-argument", "Falta la orden.");
  const sal = String(serialSaliente || "").trim(); const ent = String(serialEntrante || "").trim();
  if (!sal || !ent) throw new HttpsError("invalid-argument", "Falta el serial saliente o el entrante.");
  if (pool.normSerial(sal) === pool.normSerial(ent)) throw new HttpsError("invalid-argument", "Saliente y entrante son el mismo serial.");
  const oSnap = await db.collection("ordenes_de_servicio").doc(ordenId).get();
  if (!oSnap.exists) throw new HttpsError("not-found", "La orden no existe.");
  const orden = oSnap.data() || {};
  if (orden.eliminado === true || String(orden.estado_reparacion || "") === "ANULADA") throw new HttpsError("failed-precondition", "La orden está anulada o eliminada.");
  if (orden.gestion?.id) throw new HttpsError("failed-precondition", `La orden ya pertenece a la gestión ${orden.gestion.id}: el reemplazo se registra allá.`);
  if (!orden.cliente_id) throw new HttpsError("failed-precondition", "La orden no tiene cliente registrado.");
  const eSal = equipoDe(orden, sal); const eEnt = equipoDe(orden, ent);
  if (!eSal) throw new HttpsError("failed-precondition", `El saliente ${sal} no está en la orden.`);
  if (!eEnt) throw new HttpsError("failed-precondition", `El entrante ${ent} no está en la orden.`);

  await catalogo();
  const rSal = await pool.resolver(sal, eSal.modelo_id || null, eSal.modelo || "", { adoptarSiExiste: true });
  const rEnt = await pool.resolver(ent, eEnt.modelo_id || null, eEnt.modelo || "", { adoptarSiExiste: true });
  if (!rSal.data) throw new HttpsError("failed-precondition", `El saliente ${sal} no existe en el inventario.`);
  if (!rEnt.data) throw new HttpsError("failed-precondition", `El entrante ${ent} no existe en el inventario (recíbelo primero en Almacén).`);
  if (rEnt.data.reemplaza_a) throw new HttpsError("failed-precondition", `${ent} ya figura como reemplazo de ${rEnt.data.reemplaza_a}.`);
  if ([pool.ESTADOS.BAJA, pool.ESTADOS.VENDIDO].includes(rEnt.data.estado)) throw new HttpsError("failed-precondition", `El entrante está ${rEnt.data.estado}.`);
  const entConOtro = rEnt.data.asignacion?.cliente_id && rEnt.data.asignacion.cliente_id !== orden.cliente_id && rEnt.data.estado === pool.ESTADOS.EN_CLIENTE;
  if (entConOtro) throw new HttpsError("failed-precondition", `El entrante ${ent} figura con ${rEnt.data.asignacion.cliente_nombre || "otro cliente"}. Corrige su ubicación primero.`);

  const asigSal = rSal.data.asignacion || {};
  const contratoDocId = asigSal.cliente_id === orden.cliente_id ? (asigSal.contrato_doc_id || null) : null;
  const contratoId = contratoDocId ? (asigSal.contrato_id || "") : "";
  const modSal = { modelo_id: rSal.data.modelo_id || eSal.modelo_id || null, modelo: rSal.data.modelo_label || eSal.modelo || "" };
  const modEnt = { modelo_id: rEnt.data.modelo_id || eEnt.modelo_id || null, modelo: rEnt.data.modelo_label || eEnt.modelo || "" };
  const cambioModelo = (modSal.modelo_id || modSal.modelo) && (modEnt.modelo_id || modEnt.modelo) && !pool.mismoModelo(modSal, modEnt.modelo_id, modEnt.modelo)
    && !ModeloFamilia.mismaFamilia(modSal, modEnt);
  const entregada = /^ENTREGAD/.test(String(orden.estado_reparacion || "").toUpperCase());
  const gid = await reservarNumero();
  const now = FV.serverTimestamp();
  const serialKey = pool.normSerial(sal);
  const item = {
    serial_saliente: sal, pool_doc_id_saliente: rSal.ref.id, modelo: modSal.modelo, modelo_id: modSal.modelo_id,
    contrato_doc_id: contratoDocId, contrato_id: contratoId,
    serial_nuevo: ent, pool_doc_id_nuevo: rEnt.ref.id, modelo_id_nuevo: modEnt.modelo_id, modelo_nuevo: modEnt.modelo,
    saliente_en_casa: !!salienteEnCasa, elegibilidad: "regularizacion", motivo_codigo: "regularizacion",
    motivo_detalle: String(motivo || "").slice(0, 300),
  };
  const g = {
    tipo: "reemplazo", numero: gid, estado: "cerrada", regularizada: true,
    cliente_id: orden.cliente_id, cliente_nombre: orden.cliente_nombre || orden.cliente || "",
    causa: "regularizacion", notas: String(motivo || "").slice(0, 500),
    origen: { tipo: "regularizacion", orden_id: ordenId, por_uid: uid, por_email: usuario, at: now },
    aprobacion: { requiere: false, aprobado_por_email: usuario, at: now, motivo: "Regularización: el reemplazo ya se hizo en el taller" },
    items: [item], contratos_afectados: contratoDocId ? [contratoDocId] : [],
    ordenes: { programacion_id: ordenId, programacion_ids: [ordenId] },
    cierre: { aprobacion: true, asignacion: true, programacion: true, entrega: entregada, entrada: !!salienteEnCasa || !entregada },
    cerrada_at: now, cerrada_por: usuario, cerrada_motivo: "regularizacion",
    responsable_uid: uid, creado_por_uid: uid, creado_por_email: usuario, fecha_creacion: now, updated_at: now,
  };
  if (cambioModelo) {
    g.cambio_modelo = { [serialKey]: { estado: "aprobado", serial: ent, saliente: sal, de: modSal.modelo, de_id: modSal.modelo_id, a: modEnt.modelo, a_id: modEnt.modelo_id,
      motivo: "Regularizado a posteriori", tarifa: "se_mantiene", contrato_doc_id: contratoDocId, decidido_por_email: usuario, decidido_at: now, regularizado: true } };
  }
  const gref = db.collection("gestiones").doc(gid);
  await gref.set(g);
  await gref.collection("mapeos").add({ saliente: sal, entrante: ent, modelo: modEnt.modelo, modelo_id: modEnt.modelo_id, contrato_doc_id: contratoDocId, contrato_id: contratoId, auto: false, regularizado: true, at: now, por: usuario });
  await gref.collection("eventos").add({ accion: "regularizacion", detalle: `Reemplazo registrado a posteriori desde la orden ${ordenId}: ${sal} → ${ent}${cambioModelo ? ` (cambio de modelo ${modSal.modelo} → ${modEnt.modelo}, tarifa se mantiene)` : ""}. ${motivo || ""}`.trim(), at: now, por_uid: uid, por_email: usuario });

  // La orden.
  await oSnap.ref.set({
    gestion: { id: gid, tipo: "reemplazo", regularizada: true },
    [`reemplazos_regularizados.${serialKey}`]: { gestion_id: gid, saliente: sal, entrante: ent, at: now, por_email: usuario },
    os_logs: FV.arrayUnion({ action: "REGULARIZAR_REEMPLAZO", by: uid || usuario, at: admin.firestore.Timestamp.now(), nota: `${sal} → ${ent} (gestión ${gid})` }),
  }, { merge: true });

  // Pool: entrante.
  const refMov = { tipo: "gestion", id: gid, label: gid };
  const asignacionEnt = contratoDocId
    ? { contrato_doc_id: contratoDocId, contrato_id: contratoId, cliente_id: orden.cliente_id, cliente_nombre: orden.cliente_nombre || orden.cliente || "", gestion_doc_id: gid }
    : { contrato_doc_id: null, contrato_id: "", cliente_id: orden.cliente_id, cliente_nombre: orden.cliente_nombre || orden.cliente || "", gestion_doc_id: gid };
  const linaje = { reemplaza_a: pool.normSerial(sal), reemplazo_origen: { gestion_id: gid, saliente: pool.normSerial(sal), orden_entrega_id: ordenId, contrato_doc_id: contratoDocId, contrato_id: contratoId, at: now, regularizado: true } };
  let entRes = "sin-cambio";
  if (entregada && rEnt.data.estado !== pool.ESTADOS.EN_CLIENTE) {
    entRes = await pool.transicionarPorId(rEnt.ref.id, { aEstado: pool.ESTADOS.EN_CLIENTE, tipo: "reemplazo", refMov,
      notas: `Reemplaza a ${sal} (gestión ${gid}) — regularizado: entregado con la orden ${ordenId}`,
      extra: { asignacion: asignacionEnt, orden_actual_id: null, verificado: false, ...linaje } });
  } else {
    await rEnt.ref.set({ ...linaje, ...(rEnt.data.asignacion?.cliente_id ? {} : { asignacion: asignacionEnt }), updated_at: now }, { merge: true });
    await rEnt.ref.collection("movimientos").add({ at: now, por: usuario, por_email: usuario, tipo: "reemplazo", de_estado: null, a_estado: null, ref: refMov, notas: `Reemplaza a ${sal} (gestión ${gid}) — regularizado desde la orden ${ordenId}` });
  }
  // Pool: saliente.
  let salRes = "sin-cambio";
  if (salienteEnCasa) {
    salRes = await pool.transicionarPorId(rSal.ref.id, { aEstado: pool.ESTADOS.DEVUELTO, soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.EN_TALLER, pool.ESTADOS.EN_BODEGA],
      tipo: "reemplazo", refMov, notas: `Sustituido por ${ent} en la orden ${ordenId} (gestión ${gid}): quedó en CECOMUNICA — sale del contrato y queda por revisar`,
      extra: { asignacion: null, orden_actual_id: null } });
  } else {
    await rSal.ref.set({ pendiente_devolucion: true, updated_at: now }, { merge: true });
    await rSal.ref.collection("movimientos").add({ at: now, por: usuario, por_email: usuario, tipo: "reemplazo", de_estado: null, a_estado: null, ref: refMov, notas: `Reemplazado por ${ent} (gestión ${gid}) — el cliente se lo quedó: pendiente de devolución` });
  }
  logger.info("[regularizarReemplazoOrden]", { ordenId, gid, sal, ent, usuario, entRes, salRes, cambioModelo: !!cambioModelo });
  return { ok: true, gestion_id: gid, entrante: entRes, saliente: salRes, cambio_modelo: !!cambioModelo, contrato: contratoId || null };
}

module.exports = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) throw new HttpsError("permission-denied", "Tu rol no registra reemplazos a posteriori.");
    const { ordenId, serialSaliente, serialEntrante, salienteEnCasa = true, motivo = "" } = request.data || {};
    return ejecutar({ usuario: u.email || uid, uid, ordenId, serialSaliente, serialEntrante, salienteEnCasa: !!salienteEnCasa, motivo });
  },
);
module.exports.ejecutar = ejecutar;
