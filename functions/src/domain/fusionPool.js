// Fusión de fichas duplicadas de un serial — qué hereda la ficha conservada.
//
// La persona elige la ficha por IDENTIDAD (el modelo correcto, la propiedad):
// eso no dice nada de DÓNDE está el radio. Si la ficha absorbida es la que
// venía siguiendo un flujo vivo (una orden en taller, una asignación, el
// cliente) y la conservada está en reposo, la conservada tiene que tomar ese
// flujo; si no, la ubicación se pierde en silencio.
//
// Caso 2026-09-29 (GR20260923-01, TRANSPORTE LIGO): la OS de programación
// partió una ficha fantasma 23905A0437__<PNC550-R> en taller; Solís conservó
// la real (PNC460-R, en bodega). La fantasma se borró con la orden y el
// cliente adentro, la entrega rebotó (el trigger solo mueve desde en_taller
// con orden_actual_id == la orden) y el radio quedó "en bodega" estando con
// el cliente.
const { ESTADOS } = require("./equiposPool");

// Sin ubicación real que defender: bodega (nadie la pidió) o "hay que buscarla".
const REPOSO = new Set([ESTADOS.EN_BODEGA, ESTADOS.POR_CLASIFICAR]);

// Estados que llevan un flujo en curso — una orden, un contrato, un cliente.
const VIVOS = new Set([
  ESTADOS.EN_TALLER, ESTADOS.ASIGNADO, ESTADOS.EN_CLIENTE, ESTADOS.DEVUELTO,
  ESTADOS.PENDIENTE_COBRO, ESTADOS.NO_RETIRADO,
].filter(Boolean));

/**
 * @param {object} keeper     ficha conservada (datos)
 * @param {object[]} absorbidas fichas que se absorben (datos, con `id`)
 * @returns {null | {de_ficha, estado, orden_actual_id, asignacion, poc_device_id}}
 *   null si la conservada no está en reposo o ninguna absorbida trae flujo.
 *   Con varias vivas gana la que tiene orden abierta (es la que un trigger
 *   va a buscar), y entre iguales la más recientemente tocada.
 */
function flujoAHeredar(keeper, absorbidas) {
  if (!REPOSO.has(keeper?.estado)) return null;
  const ms = (t) => (t && typeof t.toMillis === "function") ? t.toMillis()
    : (t && t._seconds) ? t._seconds * 1000 : 0;
  const vivas = (absorbidas || []).filter((g) => VIVOS.has(g?.estado));
  if (!vivas.length) return null;
  vivas.sort((a, b) => (!!b.orden_actual_id - !!a.orden_actual_id) || (ms(b.updated_at) - ms(a.updated_at)));
  const g = vivas[0];
  return {
    de_ficha: g.id || null,
    estado: g.estado,
    orden_actual_id: g.orden_actual_id || null,
    asignacion: g.asignacion || null,
    poc_device_id: keeper.poc_device_id || g.poc_device_id || null,
  };
}

module.exports = { flujoAHeredar, REPOSO, VIVOS };
