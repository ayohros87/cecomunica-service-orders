// Accesorios sin serial (fuentes, cargadores…) en las filas de una orden.
//
// La orden obliga a escribir algo en el serial, así que recepción pone el
// nombre ("FUENTE DE NIPPON"). El pool lo tomaba por un serial de radio: la
// REPARACIÓN creaba una ficha fantasma con ese texto y el cierre de la ENTRADA
// lo reportaba como "no existe en inventario" en el correo diario — CEMENTO
// BAYANO, orden 2026100103, consulta de recepción 2026-10-05.
//
// Un modelo con `sin_serial: true` en el catálogo NO es una unidad del pool:
// sus filas se apartan antes de cualquier movimiento de inventario.
"use strict";

function esSinSerial(modeloId, porId) {
  if (!modeloId || !porId) return false;
  const m = porId.get(modeloId);
  return !!m && m.sin_serial === true;
}

// Parte las filas en las que el pool debe seguir y las que ignora.
function separarSinSerial(equipos, porId) {
  const conSerial = [];
  const sinSerial = [];
  for (const e of equipos || []) (esSinSerial(e.modelo_id, porId) ? sinSerial : conSerial).push(e);
  return { conSerial, sinSerial };
}

module.exports = { esSinSerial, separarSinSerial };
