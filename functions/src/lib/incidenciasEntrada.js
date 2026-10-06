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

async function incidenciaSuperada(serial, { ordenId, desde }) {
  const desdeMs = ms(desde);
  if (!desdeMs) return false;
  const snap = await db.collection("equipos_pool")
    .where("serial_norm", "==", pool.normSerial(serial)).get();
  if (snap.size !== 1) return false;
  const movs = await snap.docs[0].ref.collection("movimientos").get();
  return movidaDespues(movs.docs.map((d) => d.data()), { ordenId, desdeMs });
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

module.exports = { movidaDespues, incidenciaSuperada, reubicadaTrasEntrada };
