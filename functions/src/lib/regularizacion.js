// Regularización de la flota al activarse una RENOVACIÓN (Ola 7, decisión
// 2026-08-28): las unidades del cliente que están EN CAMPO SIN contrato
// (custodia) quedan cubiertas por el contrato nuevo — este módulo decide, de
// forma PURA y testeable, cuáles se amarran a qué línea.
//
// Regla: cada unidad busca una línea del contrato de su MISMO MODELO
// (pool.mismoModelo — el matching tolerante de todo el sistema) con CUPO
// libre: cantidad de la línea − filas de serial ya registradas de ese modelo.
// Lo que no quepa (sin_cupo) o no tenga línea (sin_linea) se REPORTA en el
// contrato — nunca se amarra de más ni en silencio.
//
// El documento impreso NO se toca: el contrato muestra cantidades por modelo
// (regla de Alberto: seriales jamás inferidos en el papel); este amarre es
// interno — pool, tarifa por línea y semáforo.
const pool = require("../domain/equiposPool");

/**
 * @param {Object} contrato — doc del contrato (usa equipos[]).
 * @param {Array}  unidades — fichas del pool en_cliente SIN contrato del
 *   cliente: [{serial, serial_norm, modelo_id, modelo_label, ...}].
 * @param {Array}  filasExistentes — filas de contratos/{cid}/seriales ya
 *   registradas: [{serial_norm, modelo_id, modelo}].
 * @returns {{asignar: Array<{unidad, linea_idx}>, sin_cupo: Array, sin_linea: Array, ya_listadas: Array}}
 */
function planAmarre(contrato, unidades, filasExistentes) {
  const filas = filasExistentes || [];
  const lineas = (contrato.equipos || []);

  const cupo = lineas.map((l) => {
    const filasModelo = filas.filter((f) =>
      (f.modelo_id && l.modelo_id && f.modelo_id === l.modelo_id) ||
      (String(f.modelo || "").trim().toUpperCase() !== "" &&
       String(f.modelo || "").trim().toUpperCase() === String(l.modelo || "").trim().toUpperCase())).length;
    return Math.max(0, Number(l.cantidad || 0) - filasModelo);
  });

  const listadas = new Set(filas.map((f) => f.serial_norm).filter(Boolean));
  const res = { asignar: [], sin_cupo: [], sin_linea: [], ya_listadas: [] };

  for (const u of unidades) {
    const norm = u.serial_norm || pool.normSerial(u.serial || "");
    if (norm && listadas.has(norm)) { res.ya_listadas.push(u); continue; }
    // TODAS las líneas compatibles, con el match EXACTO por modelo_id primero:
    // "PNC460" debe preferir la línea PNC460 aunque la tolerante PNC460-R
    // aparezca antes — y si su línea preferida se llena, cae a la siguiente
    // compatible con cupo (el bug que la simulación de SEPROSA destapó:
    // first-match dejaba 91 unidades sin_cupo con 96 cupos libres al lado).
    const matches = [];
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      const exacto = !!(u.modelo_id && l.modelo_id && u.modelo_id === l.modelo_id);
      if (exacto || pool.mismoModelo(u, l.modelo_id || null, l.modelo || "")) matches.push({ i, exacto });
    }
    if (!matches.length) { res.sin_linea.push(u); continue; }
    matches.sort((a, b) => (b.exacto ? 1 : 0) - (a.exacto ? 1 : 0));
    const destino = matches.find((m) => cupo[m.i] > 0);
    if (!destino) { res.sin_cupo.push(u); continue; }
    cupo[destino.i]--;
    res.asignar.push({ unidad: u, linea_idx: destino.i });
  }
  return res;
}

module.exports = { planAmarre };
