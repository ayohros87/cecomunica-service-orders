// Adenda a un contrato EN PAPEL (2026-09-07, caso Falcon Servicios).
//
// Hay clientes viejos cuyo contrato marco existe solo en papel: no hay doc en
// `contratos` y a veces la cuenta NO se puede regularizar en el momento (el
// cliente no firma un contrato nuevo hoy, pero sí quiere un radio más). La
// salida para poder seguir es la adenda con el NÚMERO DE CONTRATO MANUAL:
//
//   · gestiones.aumento.contrato_doc_id = null           (no hay contrato interno)
//   · gestiones.aumento.contrato_id     = "<número manual>"
//   · gestiones.aumento.contrato_papel  = true
//
// Decisión de Alberto: NO se crea un contrato "de papel" en el sistema para
// colgarle el anexo — la adenda vive sola. El circuito es el mismo del aumento
// (aprobación → firma → bodega → OS → entrega); lo que cambia es el DESTINO
// de lo que el aumento normal escribe en el contrato:
//
//   · al firmarse: no hay líneas que aplicar a ningún doc — cierre.derivacion
//     se marca igual para que la OS salga (sección C exige ese flag);
//   · al entregarse: la vigencia del tramo se estampa EN CADA UNIDAD del pool
//     (mismo campo `vigencia{}` que dejó asigna-custodia-por-ordenes) — así el
//     semáforo por equipo corre y la renovación la ve;
//   · las unidades quedan en CUSTODIA (asignacion.contrato_doc_id null): la
//     cuenta sigue "sin contrato formal" y el Centro sigue pidiendo la
//     regularización — "igual hay que regularizar la cuenta" — cuando se pueda.
//
// Helpers PUROS (test/adendaPapel.test.js); los triggers ponen los Timestamps.
"use strict";

/** ¿Este aumento es una adenda a contrato en papel (sin contrato interno)? */
function esAdendaPapel(aumento) {
  const a = aumento || {};
  return a.contrato_papel === true && !a.contrato_doc_id;
}

/**
 * Número manual del contrato en papel, normalizado para guardarlo: sin
 * espacios sobrantes, sin comillas, en mayúsculas. Vacío si no sirve.
 */
function normalizarRefPapel(texto) {
  return String(texto == null ? "" : texto)
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Vigencia del tramo para estampar en una unidad del pool al entregarse.
 * Devuelve fechas como Date (el trigger las convierte a Timestamp) más el
 * rastro de dónde salió el período.
 */
function vigenciaAdenda({ inicio, meses, gid, contratoRef, ordenId }) {
  const m = Number(meses || 0);
  if (!(m > 0)) return null;
  const ini = inicio instanceof Date ? new Date(inicio.getTime()) : new Date();
  const fv = new Date(ini.getTime());
  fv.setMonth(fv.getMonth() + m);
  return {
    fecha_inicio: ini,
    duracion_meses: m,
    fecha_vencimiento: fv,
    fuente_inicio: "entrega_adenda_papel",
    orden_id: ordenId || null,
    enmienda_id: gid || null,
    contrato_papel_ref: contratoRef || "",
    estampado_por: "onOrdenWriteGestion:adenda_papel",
  };
}

module.exports = { esAdendaPapel, normalizarRefPapel, vigenciaAdenda };
