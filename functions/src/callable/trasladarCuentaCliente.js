// trasladarCuentaCliente — cambio de razón social / traslado de cuenta: todo
// lo VIVO de una ficha de cliente pasa a otra ficha (plan de autoservicio
// 2026-10-07, P3/C1; casos MORENO → ASESORÍA y SECURITY MANAGEMENT → CVP).
//
// No es una fusión: la ficha vieja queda inactiva con `trasladado_a` y la
// historia (órdenes cerradas, facturas, contratos anulados) se queda con el
// nombre que tenía. Mueve contratos vivos (con sus seriales, pool, PoC,
// órdenes y avisos), fichas PoC ACTIVAS, la custodia del pool que esas fichas
// respaldan, gestiones y avisos abiertos, y el catálogo de grupos PoC. Lo que
// no se puede afirmar (ficha PoC inactiva, radio en custodia sin ficha activa
// ni contrato) NO se mueve: vuelve en `por_confirmar` para bodega.
//
// Lo hace administración o gerencia. La ficha destino tiene que existir
// (se crea en Clientes con su RUC): un traslado no inventa clientes.
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { db } = require("../lib/admin");
const { trasladarCuenta } = require("../lib/trasladoCliente");

const ROLES = new Set(["administrador", "gerente"]);

async function ejecutar({ usuario, uid = null, origenClienteId, destinoClienteId, motivo = "" }) {
  if (!origenClienteId || typeof origenClienteId !== "string") throw new HttpsError("invalid-argument", "Falta la ficha de origen.");
  if (!destinoClienteId || typeof destinoClienteId !== "string") throw new HttpsError("invalid-argument", "Falta la ficha destino.");
  if (origenClienteId === destinoClienteId) throw new HttpsError("invalid-argument", "Origen y destino son la misma ficha.");
  const [oSnap, dSnap] = await Promise.all([
    db.collection("clientes").doc(origenClienteId).get(),
    db.collection("clientes").doc(destinoClienteId).get(),
  ]);
  if (!oSnap.exists) throw new HttpsError("not-found", "La ficha de origen no existe.");
  if (!dSnap.exists) throw new HttpsError("not-found", "La ficha destino no existe.");
  const origen = oSnap.data() || {};
  const destino = dSnap.data() || {};
  if (destino.deleted === true || destino.merged_into) throw new HttpsError("failed-precondition", "La ficha destino está borrada o fusionada en otra.");
  if (destino.activo === false) throw new HttpsError("failed-precondition", "La ficha destino está inactiva: actívala primero.");
  if (origen.merged_into) throw new HttpsError("failed-precondition", "La ficha de origen ya fue fusionada en otra.");
  if (origen.trasladado_a) throw new HttpsError("failed-precondition", `La ficha de origen ya se trasladó a ${origen.trasladado_a_nombre || origen.trasladado_a}.`);

  const r = await trasladarCuenta({ origenId: origenClienteId, origen, destinoId: destinoClienteId, destino, usuario, uid, motivo });
  logger.info("[trasladarCuentaCliente]", { origenClienteId, destinoClienteId, usuario, contratos: r.contratos.length, poc: r.poc, pool: r.pool, porConfirmar: r.por_confirmar.length });
  return { ok: true, origen: origen.nombre || origenClienteId, destino: destino.nombre || destinoClienteId, ...r };
}

module.exports = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) {
      throw new HttpsError("permission-denied", "Trasladar una cuenta lo hace administración o gerencia.");
    }
    const { origenClienteId, destinoClienteId, motivo = "" } = request.data || {};
    return ejecutar({ usuario: u.email || uid, uid, origenClienteId, destinoClienteId, motivo });
  },
);
module.exports.ejecutar = ejecutar;
