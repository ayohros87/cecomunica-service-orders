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

module.exports = { movidaDespues, incidenciaSuperada };
