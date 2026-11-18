// salidaRadiosVisita — bodega le entrega al técnico los radios que se lleva a
// una VISITA, y los recibe de vuelta si no los usó (Alberto, 2026-11-18, tras
// el caso MACELLO: Jesús cambió 3 radios en sitio con radios que seguían
// "en bodega"; bodega no sabía que habían salido, y Solangel preguntó "¿y
// bodega cómo está anuente de este cambio?").
//
// Acciones (solo bodega y administración):
//   · sacar:    en_bodega → con_tecnico. Estampa `salida_visita` en la ficha y
//               `radios_salida.{serial}` (estado "llevado") en la visita.
//   · devolver: con_tecnico de ESA visita → en_bodega. La línea de la visita
//               pasa a "devuelto".
// La tercera salida (se dejó con el cliente) la hace regularizarReemplazoOrden
// al registrar el cambio en sitio: con_tecnico → en_cliente, línea "dejado".
//
// Candados de la salida (revisión del 2026-11-18): la visita tiene que estar
// ABIERTA — no basta con que no diga "CERRADA": las visitas viejas terminaron
// en "ENTREGADO AL CLIENTE" o "COMPLETADO" y un número mal escrito les sacaba
// radios — y tener TÉCNICO asignado (si no, el radio queda "con el técnico"
// sin decir cuál). Recibir de vuelta sí se puede con la visita ya cerrada: es
// justo cuando sobran radios.
//
// Todo o nada en la validación: si un serial no sirve no se mueve ninguno,
// para que bodega corrija la lista y no quede media salida registrada.
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const pool = require("../domain/equiposPool");

const ROLES = new Set(["administrador", "inventario"]);
const MAX_SERIALES = 30;
const FV = admin.firestore.FieldValue;
const esVisitaOrden = (o) => String(o?.tipo_de_servicio || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().includes("VISITA");

// Estados en los que una visita ya terminó (los tres últimos son de visitas
// anteriores a CERRADA (VISITA)).
const visitaTerminada = (estado) => /^(CERRADA|ENTREGAD|COMPLETAD|ANULAD)/.test(String(estado || "").toUpperCase());

function tecnicoDe(orden) {
  return String(orden.tecnico_asignado || orden.tecnico_nombre || orden.tecnico || orden.tecnico_email || "").trim();
}

async function ejecutar({ usuario, accion, ordenId, seriales }) {
  if (!["sacar", "devolver"].includes(accion)) throw new HttpsError("invalid-argument", "Acción desconocida.");
  if (!ordenId || typeof ordenId !== "string") throw new HttpsError("invalid-argument", "Falta la visita.");
  const lista = [...new Map((Array.isArray(seriales) ? seriales : [])
    .map((s) => String(s || "").trim()).filter(Boolean)
    .map((s) => [pool.normSerial(s), s])).entries()];
  if (!lista.length) throw new HttpsError("invalid-argument", "Escribe al menos un serial.");
  if (lista.length > MAX_SERIALES) throw new HttpsError("invalid-argument", `Máximo ${MAX_SERIALES} radios por vez.`);

  const oRef = db.collection("ordenes_de_servicio").doc(ordenId);
  const oSnap = await oRef.get();
  if (!oSnap.exists) throw new HttpsError("not-found", `La orden ${ordenId} no existe.`);
  const orden = oSnap.data() || {};
  if (!esVisitaOrden(orden)) throw new HttpsError("failed-precondition", `La orden ${ordenId} no es una visita técnica.`);
  const estadoOrden = String(orden.estado_reparacion || "").toUpperCase();
  if (orden.eliminado === true || estadoOrden === "ANULADA") throw new HttpsError("failed-precondition", "La visita está anulada.");
  if (accion === "sacar" && visitaTerminada(estadoOrden)) throw new HttpsError("failed-precondition", `La visita ya está cerrada (${orden.estado_reparacion}): no se le pueden sacar radios.`);
  if (accion === "sacar" && !tecnicoDe(orden)) throw new HttpsError("failed-precondition", "La visita no tiene técnico asignado. Pídele al taller que la asigne y registra la salida después.");

  // Validar todo antes de mover nada.
  const fichas = [];
  const errores = [];
  for (const [norm, crudo] of lista) {
    if (!pool.esSerialValido(norm)) { errores.push(`${crudo}: no parece un serial`); continue; }
    const r = await pool.resolver(crudo, null, "", { adoptarSiExiste: true });
    if (!r.data) { errores.push(`${crudo}: no existe en el inventario`); continue; }
    const est = r.data.estado;
    if (accion === "sacar") {
      if (est === pool.ESTADOS.CON_TECNICO) {
        errores.push(`${crudo}: ya salió con la visita ${r.data.salida_visita?.orden_id || "?"}`);
      } else if (est !== pool.ESTADOS.EN_BODEGA) {
        errores.push(`${crudo}: figura "${est}", no en bodega`);
      } else fichas.push({ norm, crudo, r });
    } else {
      if (est !== pool.ESTADOS.CON_TECNICO) errores.push(`${crudo}: figura "${est}", no con el técnico`);
      else if (r.data.salida_visita?.orden_id !== ordenId) errores.push(`${crudo}: salió con la visita ${r.data.salida_visita?.orden_id || "?"}, no con esta`);
      else fichas.push({ norm, crudo, r });
    }
  }
  if (errores.length) throw new HttpsError("failed-precondition", `No se movió ningún radio. ${errores.join(" · ")}`);

  const cliente = orden.cliente_nombre || orden.cliente || "";
  const tecnico = tecnicoDe(orden);
  const refMov = { tipo: "orden", id: ordenId, label: `Visita ${ordenId}` };
  const lineas = {};
  const res = [];
  for (const { norm, crudo, r } of fichas) {
    let out;
    if (accion === "sacar") {
      out = await pool.transicionarPorId(r.ref.id, {
        aEstado: pool.ESTADOS.CON_TECNICO, soloDesde: [pool.ESTADOS.EN_BODEGA], tipo: "salida_visita", refMov,
        notas: `Salió de bodega con ${tecnico || "el técnico"} para la visita ${ordenId}${cliente ? ` (${cliente})` : ""} — entregó ${usuario}`,
        extra: { salida_visita: { orden_id: ordenId, cliente_id: orden.cliente_id || null, cliente_nombre: cliente, tecnico, at: FV.serverTimestamp(), por_email: usuario } },
      });
      lineas[norm] = { serial: crudo, pool_doc_id: r.ref.id, modelo: r.data.modelo_label || "", estado: "llevado", at: FV.serverTimestamp(), por_email: usuario };
    } else {
      out = await pool.transicionarPorId(r.ref.id, {
        aEstado: pool.ESTADOS.EN_BODEGA, soloDesde: [pool.ESTADOS.CON_TECNICO], tipo: "regreso_visita", refMov,
        notas: `Volvió sin usar de la visita ${ordenId} — recibió ${usuario}`,
        extra: { salida_visita: FV.delete() },
      });
      lineas[norm] = { estado: "devuelto", devuelto_at: FV.serverTimestamp(), devuelto_por_email: usuario };
    }
    res.push({ serial: crudo, resultado: out });
  }
  await oRef.set({
    radios_salida: lineas,
    os_logs: FV.arrayUnion({ action: accion === "sacar" ? "SALIDA_RADIOS_VISITA" : "REGRESO_RADIOS_VISITA", by: usuario, at: admin.firestore.Timestamp.now(),
      nota: fichas.map((f) => f.crudo).join(", ") }),
  }, { merge: true });
  logger.info("[salidaRadiosVisita]", { accion, ordenId, usuario, res });
  return { ok: true, accion, orden_id: ordenId, tecnico, cliente, radios: res };
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) throw new HttpsError("permission-denied", "Solo bodega y administración entregan radios a una visita.");
    const { accion, ordenId, seriales } = request.data || {};
    return ejecutar({ usuario: u.email || uid, accion, ordenId, seriales });
  },
);
module.exports.ejecutar = ejecutar;
module.exports.visitaTerminada = visitaTerminada;
