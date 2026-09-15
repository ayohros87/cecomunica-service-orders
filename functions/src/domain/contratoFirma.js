// ¿Este contrato lleva firma del cliente? — espejo de
// public/js/domain/contratoFirma.js (si cambia uno, cambia el otro) y de
// contratoLlevaFirma() en firestore.rules. El porqué completo está en el
// archivo del front.
//
// En resumen: un REEMPLAZO sustituye una unidad por otra bajo el contrato que
// el cliente YA firmó. No pacta nada nuevo, así que no se firma — ni se le
// persigue la firma al vendedor, ni traba la entrega de los radios.

// Tipos de contrato que NO llevan firma del cliente.
const SIN_FIRMA = ["REEMP"];

function codigoTipo(c) {
  const x = c || {};
  if (x.codigo_tipo) return x.codigo_tipo;
  const porNombre = { Servicio: "SERV", Alquiler: "ALQ", Propio: "PROP", Reemplazo: "REEMP", Demo: "DEMO", Temporal: "TEMP" };
  if (porNombre[x.tipo_contrato]) return porNombre[x.tipo_contrato];
  const m = String(x.contrato_id || "").match(/^[A-Z]+/);
  return m ? m[0] : null;
}

/** ¿Este contrato lleva la firma del cliente? */
function llevaFirma(c) { return !SIN_FIRMA.includes(codigoTipo(c)); }

/** ¿Está esperando esa firma AHORA? */
function esperandoFirma(c) { return llevaFirma(c) && c?.estado === "aprobado" && c.firmado !== true; }

module.exports = { SIN_FIRMA, codigoTipo, llevaFirma, esperandoFirma };
