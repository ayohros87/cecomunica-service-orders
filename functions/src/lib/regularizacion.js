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
const ModeloFamilia = require("../domain/modeloFamilia");

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

  // "Una familia, dos filas" (2026-09-07): el pareo unidad↔línea lo decide
  // ModeloFamilia — misma fila del catálogo primero, luego misma familia
  // (PNC360S ≡ PNC360S-R) — con la modalidad como filtro (SERV mixto: un
  // equipo del cliente solo cae en líneas 'propio'; una línea sin modalidad es
  // legacy y acepta cualquiera). Si el catálogo no está cargado, ModeloFamilia
  // cae al texto (marca por delante, -R por detrás).
  //
  // Las filas ya registradas consumen cupo con el MISMO criterio (antes se
  // contaban por id/texto exacto y una fila -R no restaba a la línea base):
  // se colocan primero, sin filtro de modalidad porque una fila no la sabe.
  const cupo = lineas.map((l) => Math.max(0, Number(l.cantidad || 0)));
  const lineasSinModalidad = lineas.map((l) => ({ modelo_id: l.modelo_id || null, modelo: l.modelo || "" }));
  for (const f of filas) {
    const i = ModeloFamilia.lineaPara({ modelo_id: f.modelo_id || null, modelo: f.modelo || "" }, lineasSinModalidad, cupo);
    if (i >= 0) cupo[i]--;
  }

  const listadas = new Set(filas.map((f) => f.serial_norm).filter(Boolean));
  const res = { asignar: [], sin_cupo: [], sin_linea: [], ya_listadas: [] };

  for (const u of unidades) {
    const norm = u.serial_norm || pool.normSerial(u.serial || "");
    if (norm && listadas.has(norm)) { res.ya_listadas.push(u); continue; }
    // TODAS las líneas compatibles, exactas primero: "PNC460" prefiere la
    // línea PNC460 aunque PNC460-R aparezca antes — y si su preferida se
    // llena, cae a la siguiente compatible con cupo (SEPROSA: first-match
    // dejaba 91 unidades sin_cupo con 96 cupos libres al lado).
    const matches = ModeloFamilia.lineasCompatibles(
      { modelo_id: u.modelo_id || null, modelo: u.modelo_label || u.modelo || "", propiedad: u.propiedad }, lineas);
    if (!matches.length) { res.sin_linea.push(u); continue; }
    const destino = matches.find((m) => cupo[m.idx] > 0);
    if (!destino) { res.sin_cupo.push(u); continue; }
    cupo[destino.idx]--;
    res.asignar.push({ unidad: u, linea_idx: destino.idx });
  }
  return res;
}

module.exports = { planAmarre };
