// Sello sync_at de poc_devices — la regla pura que usa onPocDeviceSello.
//
// Eco: el sello es una escritura más y vuelve a disparar el trigger. Se
// reconoce porque `sync_at` cambió y es RECIENTE. No basta con "cambió": una
// copia de datos viejos (traslado, dedup) trae un `sync_at` antiguo distinto
// del anterior y igual hay que sellarla.
const RECIENTE_MS = 2 * 60 * 1000;

function esSelloPropio(before, after, eventoMs) {
  const a = after?.sync_at;
  if (!a || typeof a.toMillis !== "function") return false;
  const b = before?.sync_at;
  const cambio = !b || typeof b.isEqual !== "function" || !a.isEqual(b);
  return cambio && a.toMillis() >= eventoMs - RECIENTE_MS;
}

module.exports = { esSelloPropio, RECIENTE_MS };
