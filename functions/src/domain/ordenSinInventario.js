// Órdenes que NO mueven inventario (VISITA TÉCNICA e inspección de entrada):
// lo único que hacen en el pool es poner o quitar `orden_actual_id` en la
// ficha de cada radio. Esto decide qué filas hay que ir a buscar al pool en
// UNA escritura de la orden.
//
// Por qué existe (tripwire de backend, 2026-11-24, visita 2026111905 de
// DECAMERON): el trigger buscaba TODAS las filas en cada escritura. Marcos
// registró el trabajo de 146 radios uno por uno — 60 guardados en 45 minutos,
// 146 consultas cada uno = 8,760 consultas para no cambiar nada, porque el
// enlace ya estaba puesto desde que se armó la orden.
//
// La regla: se revisa todo cuando la orden cambia de MOMENTO (nace, cambia de
// estado, se cierra, se reabre, se elimina, o recién se vuelve visita); si
// sigue en el mismo momento, solo las filas con un serial que antes no estaba.
// Guardar el trabajo, los accesorios o una observación no toca el pool.
//
//   antes / despues  filas con serial ({ serial, ... }) de la orden
//   mismoMomento     había orden, era de este tipo y no cambió de estado
//   cerrada          la orden ya terminó (o se eliminó)
//   clave            normalizador de serial
function filasARevisar({ antes = [], despues = [], mismoMomento, cerrada, clave }) {
  const todas = despues.length ? despues : antes;
  if (!mismoMomento) return todas;
  const habia = new Set(antes.map((e) => clave(e.serial)));
  const nuevas = despues.filter((e) => !habia.has(clave(e.serial)));
  // Cerrada y sin serial nuevo: no hay enlace que poner ni que quitar.
  if (cerrada) return nuevas.length ? todas : [];
  return nuevas;
}

module.exports = { filasARevisar };
