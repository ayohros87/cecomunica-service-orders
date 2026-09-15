// ¿Este contrato lleva firma del cliente? — espejo de
// public/js/domain/contratoFirma.js (si cambia uno, cambia el otro) y de
// contratoLlevaFirma() en firestore.rules. El porqué completo está en el
// archivo del front.
//
// En resumen: un REEMPLAZO sustituye una unidad por otra bajo el contrato que
// el cliente YA firmó, y un DEMO es un préstamo de evaluación. Ninguno pacta
// nada nuevo, así que no se firman — ni se les persigue la firma al vendedor,
// ni traban la entrega de los radios.

// Tipos de contrato que NO llevan firma del cliente, con el motivo pegado a la
// regla (el front lo pinta en pantalla).
//   REEMP — sustituye una unidad bajo el contrato que el cliente ya firmó.
//   DEMO  — préstamo de evaluación: 14 de 14 demos entregados nunca se firmaron
//           y la GESTIÓN demo ya no tenía paso de firma; el contrato sí la
//           exigía para entregar, y esa contradicción es la que se cierra.
const SIN_FIRMA = {
  REEMP: { nombre: "reemplazo", porQue: "un reemplazo no lleva firma: sustituye una unidad por otra bajo el contrato que el cliente ya firmó" },
  DEMO:  { nombre: "demo",      porQue: "un demo no lleva firma: es un préstamo de evaluación — la custodia la documentan la nota de entrega y el retorno" },
};

function codigoTipo(c) {
  const x = c || {};
  if (x.codigo_tipo) return x.codigo_tipo;
  const porNombre = { Servicio: "SERV", Alquiler: "ALQ", Propio: "PROP", Reemplazo: "REEMP", Demo: "DEMO", Temporal: "TEMP" };
  if (porNombre[x.tipo_contrato]) return porNombre[x.tipo_contrato];
  const m = String(x.contrato_id || "").match(/^[A-Z]+/);
  return m ? m[0] : null;
}

/** ¿Este contrato lleva la firma del cliente? */
function llevaFirma(c) { return !SIN_FIRMA[codigoTipo(c)]; }

/** ¿Está esperando esa firma AHORA? */
function esperandoFirma(c) { return llevaFirma(c) && c?.estado === "aprobado" && c.firmado !== true; }

/** Cómo llamarlo en una frase ("tu demo fue aprobado"). */
function nombreContrato(c) { return SIN_FIRMA[codigoTipo(c)]?.nombre || "contrato"; }

/** Por qué no lleva firma, para escribirlo en el correo. */
function porQueSinFirma(c) { return SIN_FIRMA[codigoTipo(c)]?.porQue || ""; }

module.exports = { SIN_FIRMA, codigoTipo, llevaFirma, esperandoFirma, nombreContrato, porQueSinFirma };
