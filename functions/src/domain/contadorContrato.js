// Lógica PURA del contador de contratos (sin I/O ni firebase-admin), aislada
// para poder testearla en unidad. Dado el arreglo de datos de los docs de caché
// (contratos/{id}/ordenes/*), cuenta las órdenes vigentes (no eliminadas) y suma
// sus equipos. Es la definición única del contador; la usa
// contractCache.recomputarContadorTx (el dueño único transaccional).
function contarDesdeCache(docsData) {
  let osCount = 0;
  let equiposTotal = 0;
  for (const c of (docsData || [])) {
    if (!c || c.eliminado === true) continue;
    osCount += 1;
    // NaN-safe: un equipos_count no numérico (p.ej. "x") daría NaN y envenenaría
    // todo el total. Los valores inválidos cuentan como 0.
    const n = Number(c.equipos_count);
    equiposTotal += Number.isFinite(n) ? n : 0;
  }
  return { osCount, equiposTotal, tieneOs: osCount > 0 };
}

module.exports = { contarDesdeCache };
