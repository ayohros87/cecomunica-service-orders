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

module.exports = { pendientesDevolucion };
