// Reglas de negocio compartidas de las órdenes de DEVOLUCIÓN.
//
// `pendientesDevolucion` la consumen el trigger (onOrdenDevolucionWrite, para
// el aviso de cierre con faltantes) y el cron (recordatorioOperativo §C, para
// el digest diario). Existe una copia en el navegador —
// public/js/pages/ordenes-state.js— porque no hay build step que comparta
// código entre browser y functions; test/devolucionPendientes.test.js compara
// las dos sobre el mismo corpus y falla si divergen.
"use strict";

/**
 * Equipos que el cliente todavía NO ha devuelto en una orden de DEVOLUCIÓN.
 * Tres orígenes según cómo nació la orden:
 *   · esperados[]            — lista por serial (contrato en el sistema)
 *   · esperados_por_modelo[] — la baja no registró seriales: faltan por modelo
 *   · total_esperado         — contrato de PAPEL: no hay lista previa, solo la
 *     cantidad que el cliente declaró al abrir el tiquete. Sin este dato la
 *     devolución sin contrato siempre daba 0 pendientes (todo lo que existe
 *     está recibido), así que nada avisaba de los que faltaban.
 * @param {Object} dev — el subdocumento `devolucion` de la orden
 * @returns {number}
 */
function pendientesDevolucion(dev) {
  const esperados = (dev && dev.esperados) || [];
  const porSerial = esperados.filter(e => !e.resolucion).length;
  const porModelo = ((dev && dev.esperados_por_modelo) || [])
    .reduce((s, m) => s + Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0)), 0);
  let papel = 0;
  if (dev && dev.modo === "sin_contrato") {
    const total = Number(dev.total_esperado || 0);
    const recibidos = esperados.filter(e => e.resolucion === "recibido").length;
    if (total > 0) papel = Math.max(0, total - recibidos);
  }
  return porSerial + porModelo + papel;
}

// Estados del pool en los que una unidad todavía cuelga de su contrato. Copia
// deliberada de equiposPool.ESTADOS (este módulo se mantiene sin dependencias
// de Firestore); bajaPropioRecuperacion.test.js compara ambas y falla si
// divergen.
const ESTADOS_COLGANDO = ["asignado_contrato", "en_cliente"];

const _tight = (s) => String(s == null ? "" : s).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Unidades de una baja que SÍ deben recuperarse, decidido ficha por ficha.
 *
 * El criterio es la propiedad de cada unidad, no el tipo del contrato: un
 * contrato "Propio" (venta con servicio) normalmente lleva equipos del cliente
 * —que no se recuperan— pero puede llevar unidades de la flota CeComunica
 * mezcladas. Decidir por tipo de contrato dejaba esas unidades colgadas del
 * contrato muerto y fuera del inventario (caso PROP20260805-02, 2026-08-06:
 * 4 radios salidos de bodega que la baja no reclamó). `desconocida` se
 * recupera a propósito: si resulta ser del cliente, el check-in tiene la
 * excepción "no se devuelve"; al revés el equipo se pierde en silencio.
 *
 * @param {Object} p
 * @param {Array}  p.fichas — [{ serial, modelo, modelo_id, pool_doc_id,
 *        propiedad, estado, contrato_doc_id }] (una por serial del contrato)
 * @param {string} p.contratoDocId — solo cuentan las fichas que siguen
 *        apuntando a ESTE contrato (una reasignada ya es de otro)
 * @param {Array}  [p.items] — [{ modelo, modelo_id, cantidad }] de la enmienda
 * @param {string} [p.tipo] — 'terminacion_total' recupera todo lo elegible;
 *        cualquier otro valor (baja parcial) respeta el cupo de `items`
 * @returns {Array} subconjunto de `fichas`, ordenado por serial (determinista)
 */
function unidadesRecuperablesDeBaja({ fichas = [], contratoDocId = null, items = [], tipo = "" } = {}) {
  const elegibles = fichas
    .filter(f => f && (f.serial || "").toString().trim())
    .filter(f => !contratoDocId || f.contrato_doc_id === contratoDocId)
    .filter(f => ESTADOS_COLGANDO.includes(f.estado))
    .filter(f => f.propiedad !== "cliente")
    .sort((a, b) => String(a.serial).localeCompare(String(b.serial)));

  if (tipo === "terminacion_total") return elegibles;

  // Baja parcial: la enmienda cancela cantidades por modelo, no seriales. Se
  // toman las primeras unidades elegibles de cada modelo hasta su cupo.
  const cupo = new Map();
  for (const it of items || []) {
    const n = Number(it && it.cantidad || 0);
    if (n <= 0) continue;
    const k = it.modelo_id || _tight(it.modelo);
    if (!k) continue;
    cupo.set(k, Number(cupo.get(k) || 0) + n);
  }
  return elegibles.filter((f) => {
    const k = (f.modelo_id && cupo.has(f.modelo_id)) ? f.modelo_id : _tight(f.modelo);
    const libre = Number(cupo.get(k) || 0);
    if (libre <= 0) return false;
    cupo.set(k, libre - 1);
    return true;
  });
}

module.exports = { pendientesDevolucion, unidadesRecuperablesDeBaja, ESTADOS_COLGANDO };
