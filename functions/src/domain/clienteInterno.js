// Cliente INTERNO: C COMUNICA, S.A. como cliente de sus propias órdenes
// (maquillaje, revisión general, radios para tener en stock).
//
// Esas órdenes no terminan en una entrega: el radio vuelve a bodega y de ahí
// sale a un cliente de verdad. Hasta 2026-11-20 no tenían cierre propio — se
// quedaban en "Completado" para siempre, bodega liberaba los radios uno por
// uno a mano, y la orden estampaba la custodia de C COMUNICA en cada radio
// (caso APMT, 2026-10-28: "Figura con otro cliente: C COMUNICA, S.A.").
//
// El id vive en empresa/config.cliente_interno_id; la constante es el respaldo
// (misma convención que los buzones de mailRecipients: config manda, el
// literal nunca deja la función sin respuesta).
"use strict";

const logger = require("firebase-functions/logger");
const { db } = require("../lib/admin");

const ID_POR_DEFECTO = "6yoaiUMRAhhSMtiC4O0S";
const TTL_MS = 10 * 60 * 1000;
let _cache = { id: null, at: 0 };

async function clienteInternoId() {
  if (_cache.id && Date.now() - _cache.at < TTL_MS) return _cache.id;
  let id = ID_POR_DEFECTO;
  try {
    const s = await db.collection("empresa").doc("config").get();
    const v = s.exists ? String(s.data().cliente_interno_id || "").trim() : "";
    if (v) id = v;
  } catch (e) {
    logger.warn("[clienteInterno] empresa/config no leído; usando el id por defecto", { message: e.message });
  }
  _cache = { id, at: Date.now() };
  return id;
}

/** ¿La orden es del cliente interno? Nunca lanza. */
async function esOrdenInterna(orden) {
  const cid = String((orden && orden.cliente_id) || "").trim();
  if (!cid) return false;
  return cid === await clienteInternoId();
}

module.exports = { clienteInternoId, esOrdenInterna, ID_POR_DEFECTO, _olvidar: () => { _cache = { id: null, at: 0 }; } };
