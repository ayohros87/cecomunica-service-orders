/**
 * cancelacionEntrada — ¿el cierre de una ENTRADA debe marcar el contrato
 * ligado como "por cancelar"?
 *
 * Lógica pura (sin Firestore) para poder probarla. La usa
 * triggers/ordenes/onOrdenWritePool.js al cerrar una ENTRADA, el linaje de
 * reemplazo (triggers/gestiones/onOrdenWriteGestion.js) para retirar una marca
 * que se puso antes de saber del reemplazo, y el script
 * scripts/limpia-marcas-cancelacion-reemplazo.js para las marcas falsas viejas.
 *
 * Por qué existe (caso REEMP20260901-01 / Hotel Gamboa, 2026-09-07): la
 * ENTRADA que nace de un REEMPLAZO va ligada al contrato REEMP porque él
 * disparó la devolución, pero los radios que vuelven son los SUSTITUIDOS —
 * nunca fueron equipo del REEMP. El trigger marcaba el contrato con
 * `cancelacion_pendiente` sin mirar qué volvió, y el home pedía cancelar un
 * reemplazo que estaba perfectamente cumplido.
 *
 * Regla: se marca solo cuando al menos uno de los seriales devueltos es equipo
 * PROPIO del contrato (está en su subcolección `seriales`). Si el contrato
 * tiene seriales y ninguno volvió, lo que entró fue equipo de otro contrato
 * (reemplazo, renovación que cambia de modelo) y el contrato sigue vivo.
 *
 * SUSTITUIDOS (caso ALQ20260902-01 / SilverKing, 2026-09-17): cuando el
 * reemplazo se hace POR GESTIÓN sobre el MISMO contrato de alquiler, el radio
 * saliente SÍ es equipo propio del contrato — y aun así su regreso no termina
 * nada: el cliente se quedó con el entrante. Los salientes declarados por una
 * gestión de reemplazo del contrato no cuentan como devolución.
 *
 * Casos de duda se resuelven a favor de MARCAR — la bandeja es una pregunta a
 * un humano, no una acción; mejor una fila de más que una cancelación perdida:
 *   · contrato sin seriales cargados (legacy): no hay con qué comparar.
 *   · lectura de la subcolección fallida (`propios === null`).
 */
const { normSerial } = require("./equiposPool");

/**
 * @param {Object} p
 * @param {Array<string|{serial:string}>} p.devueltos  seriales que entraron en la ENTRADA
 * @param {Array<string>|null} p.propios  seriales del contrato (subcolección); null si no se pudo leer
 * @param {Array<string>} [p.sustituidos]  salientes declarados por gestiones de
 *   reemplazo de ESTE contrato: vuelven porque se cambiaron, no porque el
 *   contrato termine.
 * @returns {{ marcar: boolean, motivo: string, propiosDevueltos: string[] }}
 *   motivo: 'equipo_propio' | 'sin_seriales_contrato' | 'lectura_fallida'
 *         | 'equipo_ajeno' | 'reemplazo_sustituido'
 */
function decidirMarcaCancelacion({ devueltos, propios, sustituidos }) {
  const setSustituidos = new Set((sustituidos || []).map(normSerial).filter(Boolean));
  const dev = (devueltos || [])
    .map((e) => (typeof e === "string" ? e : e?.serial))
    .filter((s) => typeof s === "string" && s.trim());
  // Los salientes de un reemplazo salen de la cuenta ANTES de cualquier otra
  // pregunta: da igual que el contrato no tenga seriales cargados o que la
  // lectura fallara — si todo lo que entró fue sustituido, no hay devolución.
  const sinSustituidos = dev.filter((s) => !setSustituidos.has(normSerial(s)));
  if (dev.length && !sinSustituidos.length) {
    return { marcar: false, motivo: "reemplazo_sustituido", propiosDevueltos: [] };
  }

  if (propios === null || propios === undefined) {
    return { marcar: true, motivo: "lectura_fallida", propiosDevueltos: [] };
  }
  const setPropios = new Set((propios || []).map(normSerial).filter(Boolean));
  if (!setPropios.size) {
    return { marcar: true, motivo: "sin_seriales_contrato", propiosDevueltos: [] };
  }
  const propiosDevueltos = sinSustituidos.filter((s) => setPropios.has(normSerial(s)));
  if (propiosDevueltos.length) {
    return { marcar: true, motivo: "equipo_propio", propiosDevueltos };
  }
  return { marcar: false, motivo: "equipo_ajeno", propiosDevueltos: [] };
}

module.exports = { decidirMarcaCancelacion };
