// Entrega parcial por TANDAS — lado servidor.
//
// Una orden de REPARACIÓN puede entregarse por partes: el cliente se lleva
// los radios listos y el resto se queda en el taller. Cada tanda vive en
// `entrega.tandas[]` con su receptor y su firma. La orden NO cambia de estado
// por una tanda — sigue COMPLETADO (EN OFICINA) — así que el pool es el único
// que se entera de que esos radios ya salieron.
//
// El espejo en el navegador es public/js/domain/entregaTandas.js, que tiene
// además los predicados de UI (pendientes, resumen, numeración). Aquí solo
// vive lo que necesita el trigger: QUÉ unidades entrega esta escritura.
//
// Consumidor: triggers/ordenes/onOrdenWritePool.js.

function _tandas(data) {
  const t = data && data.entrega && data.entrega.tandas;
  return Array.isArray(t) ? t : [];
}

/**
 * Las tandas que APARECEN en esta escritura, en orden.
 *
 * El array es append-only (lo exigen las rules), así que el prefijo que ya
 * estaba en `before` corresponde a unidades ya movidas: reprocesarlas sería
 * inofensivo —`soloDesde`/`condicion` las rebotarían— pero dejaría intentos
 * basura en el kardex de cada radio.
 *
 * Si el array ENCOGIÓ (corrección manual de admin, que las rules sí permiten)
 * no hay nada nuevo que entregar: devuelve vacío en vez de recorrer un
 * prefijo que ya no cuadra.
 *
 * @param {object|null} before
 * @param {object|null} after
 * @returns {Array<{numero:string, equipos:Array<{serial:string}>}>}
 */
function tandasNuevas(before, after) {
  if (!after) return [];
  const antes = _tandas(before).length;
  const despues = _tandas(after);
  if (despues.length <= antes) return [];
  return despues.slice(antes).map((t) => ({
    numero: t.numero || ("E" + (t.n || "?")),
    equipos: (Array.isArray(t.equipos) ? t.equipos : [])
      .map((u) => ({ serial: String((u && u.serial) || "").trim() }))
      .filter((u) => u.serial),
  }));
}

/** Seriales que esta escritura entrega, aplanados y sin repetir. */
function serialesEntregadosAhora(before, after) {
  const vistos = new Set();
  for (const t of tandasNuevas(before, after)) {
    for (const u of t.equipos) vistos.add(u.serial);
  }
  return [...vistos];
}

module.exports = { tandasNuevas, serialesEntregadosAhora };
