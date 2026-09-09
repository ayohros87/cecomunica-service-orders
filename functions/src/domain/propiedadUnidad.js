// De quién es una unidad: se deriva de la LÍNEA del contrato a la que
// pertenece, no del tipo del contrato.
//
// Antes (hasta 2026-09-09) `onSerialWrite` preguntaba
// `tipo_contrato === "Propio" || codigo_tipo === "PROP"`. Desde que todo
// contrato nuevo es de tipo Servicio esa pregunta responde SIEMPRE que no, así
// que un serial asignado a una línea "del cliente" nacía marcado como flota —
// y esa `propiedad` es justo la que imprime el Anexo A del contrato y la que
// usa la devolución para decidir qué se reclama y qué no.
//
// El pareo serial↔línea es el mismo de ModeloFamilia: fila exacta del catálogo
// primero y familia después. La modalidad NO se puede usar para filtrar las
// líneas candidatas (es lo que se está derivando), así que aquí se parea SOLO
// por modelo — a diferencia de `ModeloFamilia.lineasCompatibles`.
//
// Devuelve { propiedad, origen }:
//   · propiedad 'cliente' | 'cecomunica' → estampar
//   · propiedad null (origen 'ambigua')  → NO estampar: el mismo modelo aparece
//     en dos modalidades y adivinar sería repetir el error viejo. La unidad
//     queda 'desconocida' y sale como "Sin clasificar" en el Centro, que es
//     visible y corregible.
"use strict";

const ModeloFamilia = require("./modeloFamilia");

const MODALIDADES = ["propio", "alquiler"];

function lineasDelModelo(unidad, lineas) {
  const ls = Array.isArray(lineas) ? lineas : [];
  const exactas = [];
  const porFamilia = [];
  const modeloId = unidad && unidad.modelo_id;
  for (const l of ls) {
    if (!l) continue;
    if (modeloId && l.modelo_id && l.modelo_id === modeloId) exactas.push(l);
    else if (ModeloFamilia.mismaFamilia(unidad, l)) porFamilia.push(l);
  }
  return exactas.length ? exactas : porFamilia;
}

function propiedadDeUnidad(unidad, lineas, contrato) {
  const cands = lineasDelModelo(unidad || {}, lineas);
  const mods = [];
  for (const l of cands) {
    if (MODALIDADES.includes(l.modalidad) && !mods.includes(l.modalidad)) mods.push(l.modalidad);
  }
  if (mods.length === 1) {
    return { propiedad: mods[0] === "propio" ? "cliente" : "cecomunica", origen: "linea" };
  }
  if (mods.length > 1) return { propiedad: null, origen: "ambigua" };
  // Ninguna línea compatible declara modalidad: contrato anterior a la
  // modalidad por línea (410 de 415 líneas vigentes al 2026-09-09). Se cae al
  // criterio viejo, que para esos contratos sí es correcto.
  const c = contrato || {};
  const esPropio = c.tipo_contrato === "Propio" || c.codigo_tipo === "PROP";
  return { propiedad: esPropio ? "cliente" : "cecomunica", origen: "tipo_contrato" };
}

module.exports = { propiedadDeUnidad, lineasDelModelo };
