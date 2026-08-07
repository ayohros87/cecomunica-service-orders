// Linaje de contratos: quién renovó/reemplazó a quién.
//
// El vínculo lo escribe la pantalla de contrato nuevo (nc-guardar.js) o la de
// transición (contrato-transicion-page.js) en el contrato NUEVO, apuntando
// hacia atrás. Existen dos campos por compatibilidad: `contrato_origen_id`
// (uno solo, el original) y `contrato_origen_ids` (array, multi-origen). Leer
// los dos a mano estaba duplicado en onEntregaTransicion y en la UI; esta es
// la lectura canónica.
"use strict";

/**
 * Doc-ids de los contratos ORIGEN de este contrato (los que se renuevan o
 * reemplazan). Array vacío si el contrato no nació de otro, o si el vínculo
 * nunca se registró — que hoy es el caso de la enorme mayoría.
 * @param {Object} contrato — doc del contrato NUEVO
 * @returns {string[]} sin duplicados, sin vacíos, orden estable
 */
function origenIdsDe(contrato) {
  const c = contrato || {};
  const crudos = (Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length)
    ? c.contrato_origen_ids
    : (c.contrato_origen_id ? [c.contrato_origen_id] : []);
  const vistos = new Set();
  const out = [];
  for (const raw of crudos) {
    const id = String(raw == null ? "" : raw).trim();
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    out.push(id);
  }
  return out;
}

module.exports = { origenIdsDe };
