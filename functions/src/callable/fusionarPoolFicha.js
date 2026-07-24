const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

/**
 * fusionarPoolFicha — fusiona fichas duplicadas de un MISMO serial en la que
 * el humano eligió como real (cola "Conflictos" de Inventario · Equipos por
 * serial, P4b de la auditoría 2026-07-24).
 *
 * A diferencia del script merge-pool-duplicados (que solo fusiona cuando
 * mismoModelo() converge), aquí la identidad la decide una persona viendo el
 * radio — por eso el callable NO exige que los labels concuerden, solo que
 * todos los docs compartan serial_norm.
 *
 * input:  { keeperId: string, absorbidosIds: string[] }
 * output: { fusionados: number, compartidoLimpiado: boolean }
 * Roles: administrador | inventario (los mismos que operan la página).
 */

async function requireInventario(callerUid) {
  if (!callerUid) throw new HttpsError("unauthenticated", "Inicia sesión.");
  const snap = await db.collection("usuarios").doc(callerUid).get();
  const rol = snap.exists ? snap.data().rol : null;
  if (!["administrador", "inventario"].includes(rol)) {
    throw new HttpsError("permission-denied", "Solo administración o inventario pueden fusionar fichas.");
  }
  return { uid: callerUid, email: snap.data().email || null };
}

// El keeper adopta del fantasma solo lo que le falta (== merge-pool-duplicados).
function rellenar(keeper, otro) {
  const upd = {};
  if (!keeper.modelo_id && otro.modelo_id) upd.modelo_id = otro.modelo_id;
  if (!(keeper.modelo_label || "").trim() && (otro.modelo_label || "").trim()) upd.modelo_label = otro.modelo_label;
  if ((keeper.propiedad || "desconocida") === "desconocida" && otro.propiedad && otro.propiedad !== "desconocida") upd.propiedad = otro.propiedad;
  const cargaAsignacion = !["en_bodega", "devuelto_revision", "baja"].includes(keeper.estado);
  if (cargaAsignacion && !keeper.poc_device_id && otro.poc_device_id) upd.poc_device_id = otro.poc_device_id;
  if (cargaAsignacion && !keeper.asignacion && otro.asignacion) upd.asignacion = otro.asignacion;
  if (!keeper.ingreso_bodega_at && otro.ingreso_bodega_at) upd.ingreso_bodega_at = otro.ingreso_bodega_at;
  if (keeper.verificado !== true && otro.verificado === true) upd.verificado = true;
  return upd;
}

module.exports = onCall({ region: "us-central1" }, async (request) => {
  const quien = await requireInventario(request.auth?.uid || null);
  const keeperId = String(request.data?.keeperId || "").trim();
  const absorbidosIds = Array.isArray(request.data?.absorbidosIds)
    ? request.data.absorbidosIds.map((s) => String(s || "").trim()).filter(Boolean) : [];
  if (!keeperId || !absorbidosIds.length) {
    throw new HttpsError("invalid-argument", "Falta keeperId o absorbidosIds.");
  }
  if (absorbidosIds.includes(keeperId)) {
    throw new HttpsError("invalid-argument", "La ficha conservada no puede estar entre las absorbidas.");
  }
  if (absorbidosIds.length > 5) {
    throw new HttpsError("invalid-argument", "Máximo 5 fichas por fusión.");
  }

  const col = db.collection("equipos_pool");
  const keeperSnap = await col.doc(keeperId).get();
  if (!keeperSnap.exists) throw new HttpsError("not-found", `No existe la ficha ${keeperId}.`);
  const keeper = { id: keeperSnap.id, ref: keeperSnap.ref, ...keeperSnap.data() };

  let fusionados = 0;
  for (const gid of absorbidosIds) {
    const gSnap = await col.doc(gid).get();
    if (!gSnap.exists) continue;
    const g = { id: gSnap.id, ref: gSnap.ref, ...gSnap.data() };
    if ((g.serial_norm || "") !== (keeper.serial_norm || "")) {
      throw new HttpsError("failed-precondition",
        `${gid} no comparte serial con ${keeperId} — no se puede fusionar.`);
    }

    const movs = await g.ref.collection("movimientos").get();
    const batch = db.batch();
    movs.forEach((m) => {
      batch.set(keeper.ref.collection("movimientos").doc(), { ...m.data(), fusionado_de: g.id });
      batch.delete(m.ref);
    });
    batch.set(keeper.ref.collection("movimientos").doc(), {
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: quien.uid, por_email: quien.email,
      tipo: "fusion_duplicado", de_estado: null, a_estado: null, ref: null,
      notas: `Fusión manual desde la cola de conflictos: absorbida la ficha ${g.id} `
        + `("${g.modelo_label || "sin modelo"}", ${g.estado}`
        + `${g.asignacion?.cliente_nombre ? ` con ${g.asignacion.cliente_nombre}` : ""}).`,
    });
    const upd = rellenar(keeper, g);
    batch.set(keeper.ref, {
      ...upd,
      conflicto_revisado: admin.firestore.FieldValue.delete(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_by: quien.uid, updated_by_email: quien.email,
    }, { merge: true });
    batch.delete(g.ref);
    await batch.commit();
    fusionados++;
  }

  // ¿El serial quedó con una sola ficha? → deja de ser compartido.
  let compartidoLimpiado = false;
  const restantes = await col.where("serial_norm", "==", keeper.serial_norm || keeperId).get();
  if (restantes.size === 1 && restantes.docs[0].data().serial_compartido) {
    await restantes.docs[0].ref.set({ serial_compartido: false }, { merge: true });
    compartidoLimpiado = true;
  }

  logger.info("[fusionarPoolFicha]", { keeperId, absorbidosIds, fusionados, por: quien.uid });
  return { fusionados, compartidoLimpiado };
});
