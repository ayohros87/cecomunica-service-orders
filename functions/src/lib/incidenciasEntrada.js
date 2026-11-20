// ¿Una incidencia del cierre de una ENTRADA ya la resolvió la vida del radio?
//
// Caso 23905A0441 (ENTRADA 2026082605, GOLY → SEPROSA, 2026-09-30). La fila de
// la entrada quedó con el modelo_id de PNC360S-R y la ficha era PNC460-R: el
// cierre no la encontró ("sin_ficha"). Veinte minutos después José Solís la
// mandó a bodega a mano, un mes más tarde bodega la asignó a un reemplazo y se
// entregó a SEPROSA — y el correo diario seguía diciendo que el radio "no
// existe en el inventario", porque la incidencia solo se limpiaba si el
// reintento lograba aterrizarlo.
//
// Peor: el reintento corre con cualquier escritura de la orden vieja. Si
// alguien corregía ese modelo_id, el radio que ya estaba con SEPROSA volvía a
// "en bodega". Una ENTRADA cerrada hace semanas no dice dónde está hoy el
// equipo; su kardex sí.
//
// Regla: la incidencia está SUPERADA cuando la ficha de ese serial tiene un
// movimiento POSTERIOR al cierre que no viene de esta misma orden — alguien la
// ubicó después. Se busca por serial solo (el modelo mal puesto es justo lo que
// hizo fallar al cierre). Con un serial compartido entre modelos no se puede
// saber cuál es el radio: no se da por superada.
const { db } = require("./admin");
const pool = require("../domain/equiposPool");

const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis()
  : t instanceof Date ? t.getTime() : (typeof t === "number" ? t : 0));

// Pura: movimientos del kardex de UNA ficha → ¿alguno la ubicó después del cierre?
function movidaDespues(movimientos, { ordenId, desdeMs }) {
  if (!desdeMs) return false;
  return (movimientos || []).some((m) => m
    && ms(m.at) > desdeMs
    && !(m.ref && m.ref.id === ordenId));
}

// `abierta` (2026-11-20, correo de Brenda): la ENTRADA 2026071304 de MUNICIPIO
// estuvo abierta cuatro meses. En ese tiempo sus radios se fueron a otro
// contrato y uno volvió a bodega; cuando por fin se cerró, todo eso era
// ANTERIOR al cierre y la incidencia no se daba nunca por superada. Lo que
// alguien ubicó desde que la ENTRADA abrió también la supera.
async function incidenciaSuperada(serial, { ordenId, desde, abierta = null }) {
  const desdeMs = ms(desde);
  const abiertaMs = ms(abierta);
  if (!desdeMs && !abiertaMs) return false;
  const snap = await db.collection("equipos_pool")
    .where("serial_norm", "==", pool.normSerial(serial)).get();
  if (snap.size !== 1) return false;
  const movs = (await snap.docs[0].ref.collection("movimientos").get()).docs.map((d) => d.data());
  return movidaDespues(movs, { ordenId, desdeMs })
    || ubicadaTrasEntrada(movs, { ordenId, desdeMs: abiertaMs });
}

// Las fichas del pool que llevan ese serial, sin mirar el modelo.
//
// El modelo de la fila de una orden es texto que alguien eligió o tecleó; el
// serial es el radio. `pool.resolver` exige que los dos coincidan, y por eso
// una fila "PNC460S-R" con un radio PNC460-R salía en el correo como "no existe
// en el inventario" (23905A0441 en septiembre, 25725A0542/0543 en noviembre)
// con la ficha ahí mismo, entera y con historia.
async function fichasDelSerial(serial) {
  const norm = pool.normSerial(serial);
  if (!pool.esSerialValido(norm)) return [];
  const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
  return snap.docs.map((d) => ({ ref: d.ref, data: d.data() }));
}

// La ficha de UNA fila de la orden: la del modelo de la fila y, si ninguna
// coincide, la ÚNICA que tenga ese serial (`otroModelo: true`). Con el serial
// repartido entre varias fichas y ninguna del modelo de la fila no se adivina:
// `ficha: null` y `otras` dice cuáles hay.
async function fichaDeFila(e) {
  const r = await pool.resolver(e.serial, e.modelo_id, e.modelo);
  if (r.data) return { ficha: { ref: r.ref, data: r.data }, otroModelo: false, otras: [] };
  const todas = await fichasDelSerial(e.serial);
  if (todas.length === 1 && todas[0].data.serial_compartido !== true) {
    return { ficha: todas[0], otroModelo: true, otras: [] };
  }
  return { ficha: null, otroModelo: false, otras: todas };
}

// ¿Alguien UBICÓ el radio después de que la ENTRADA abrió?
//
// Caso TROPICAL RESORTS / HOTEL GAMBOA (ALQ20260806-02, Brenda 2026-10-06).
// Radios devueltos por M.A.M., R. SMITH, GOLY y MAS SEGURIDAD entraron en
// junio-julio con su ENTRADA, y esas ENTRADAs se quedaron abiertas. Mientras
// tanto bodega los asignó al hotel (07-ago), salieron de programación y se
// entregaron (13-ago). El 14-ago alguien cerró las ENTRADAs viejas y el cierre
// los mandó a bodega soltando la asignación: el radio seguía en el hotel. El
// 09-09 la limpieza de POC vio "en bodega" y cerró 13 fichas vivas.
//
// La ENTRADA dice que el radio VOLVIÓ en su fecha, no dónde está hoy. Si
// después de abrirla el kardex lo puso en un contrato, con un cliente o en el
// taller de OTRA orden, el cierre no lo toca. Las correcciones de dato
// (migración, modelo, condición) no cuentan: no mueven el radio.
function reubicadaTrasEntrada(movimientos, { ordenId, desdeMs }) {
  if (!desdeMs) return false;
  const UBICA = [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.EN_TALLER];
  return (movimientos || []).some((m) => m
    && ms(m.at) > desdeMs
    && !(m.ref && m.ref.id === ordenId)
    && !/^(correccion|migracion)/.test(m.tipo || "")
    && m.tipo !== "cambio_condicion"
    && UBICA.includes(m.a_estado));
}

// ¿Alguien DECIDIÓ dónde está el radio después de que la ENTRADA abrió?
//
// Hermana de la anterior, para otra pregunta. `reubicadaTrasEntrada` dice si el
// cierre debe dejar quieto al radio (está con un cliente, en un contrato o en
// otro taller). Esta dice si lo que el cierre NO pudo mover merece un aviso:
// si bodega lo dio de baja, lo vendió, lo liberó al estante o lo ubicó con el
// radio en la mano mientras la ENTRADA seguía abierta, no hay nada que avisar —
// el radio está donde una persona dijo que está.
//
// Caso 24708A1206 (ENTRADA 2026071001, PANAMA JET): abierta el 10-jul; el 5-oct
// José Solís lo liberó y lo dio de baja ("facturado 10053 daño causado"); la
// ENTRADA se cerró el 17-nov y desde entonces el correo diario le pedía a
// recepción resolver un radio que "está baja". No había nada que resolver.
//
// No cuentan los ajustes de dato (condición, modelo, fusión de duplicados) ni
// las migraciones y correcciones que corre el sistema: no dicen dónde está el
// radio. Una corrección hecha por una PERSONA sí (bodega corrigiendo el estado
// desde la ficha queda como `correccion_migracion` con su correo).
const AJUSTES_DE_DATO = ["cambio_condicion", "correccion_modelo", "fusion_duplicado"];
function ubicadaTrasEntrada(movimientos, { ordenId, desdeMs }) {
  if (!desdeMs) return false;
  return (movimientos || []).some((m) => m
    && ms(m.at) > desdeMs
    && !(m.ref && m.ref.id === ordenId)
    && !!m.a_estado
    && !AJUSTES_DE_DATO.includes(m.tipo)
    && !(/^(correccion|migracion)/.test(m.tipo || "") && !m.por_email));
}

module.exports = { movidaDespues, incidenciaSuperada, reubicadaTrasEntrada,
  ubicadaTrasEntrada, fichasDelSerial, fichaDeFila };
