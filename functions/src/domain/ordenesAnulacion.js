// Qué hacer con las ÓRDENES DE SERVICIO de un contrato que se anula — la
// DECISIÓN, sin Firestore. La escritura vive en lib/ordenesDeContratoAnulado.js.
//
// Se parte en dos por el mismo motivo que lib/devolucion.js: la clasificación
// es lógica pura y se prueba sin emulador; mezclarla con el writer obligaba a
// levantar firebase-admin para comprobar un `if`.
//
// EL HUECO QUE CIERRA (2026-09-15, pregunta de Alberto: "si el contrato se
// anuló, la orden se debería anular también, verifica por qué no se anularía").
// No se anulaba porque nadie la tocaba: `onAnnulment` cerraba la facturación,
// resolvía el pool y abría la devolución, pero NUNCA miraba
// `ordenes_de_servicio`. El contrato moría y su orden seguía viva en la bandeja
// para siempre — y desde el candado de firma de la entrega (2026-09-03) ya ni
// se podía entregar: un contrato anulado no está firmado ni activo, así que la
// única salida era el override de admin.
//
// Medido antes del arreglo: 24 órdenes colgaban de un contrato anulado. 20 ya
// estaban cerradas y 4 seguían vivas, tres de ellas COMPLETADAS con 15, 10 y 1
// radio esperando una entrega imposible desde julio y agosto. Sus radios NO
// estaban con el cliente: el pool los tenía en taller o en bodega. Trabajo
// fantasma, en la cola de todo el mundo.
//
// TRES SALIDAS, no dos. La versión obvia —"contrato anulado, orden anulada"—
// se probó contra los 4 casos reales y habría destrozado 3: en los tres el
// cliente SÍ tenía un contrato nuevo, ese contrato nuevo NO tenía orden propia,
// y la orden vieja era la única que llevaba el trabajo (15, 10 y 1 radio ya
// preparados, en taller). Anularlas habría tirado a la basura trabajo real y
// dejado los radios sin ninguna orden que los reclame.
//
//   · SUSTITUCIÓN con sustituto declarado → REPUNTAR. El papel se rehace y el
//     radio no se mueve: los seriales ya se traspasaron
//     (lib/sustitucionContrato.js) y la orden hace el MISMO trabajo, solo que
//     bajo otro contrato.
//   · Sin sustituto y SIN trabajo encima (ni un serial) → ANULADA. No hay nada
//     que perder y no hay contrato bajo el cual entregar.
//   · Sin sustituto pero CON equipos preparados → REVISAR. Aquí el sistema no
//     sabe, y adivinar cuesta caro en las dos direcciones: anular tira trabajo,
//     dejarla callada la vuelve fantasma. Se estampa el aviso en la orden y se
//     le dice a Recepción por nombre y apellido, con el conteo de radios, para
//     que una persona decida entre pasarla al contrato nuevo o anularla. Es el
//     mismo criterio de "no trancar a recepción": dejar seguir, pero con el
//     dato viejo señalado.
//
// Nunca se toca una orden ya terminada ni una eliminada: lo que ya pasó, pasó.
// Y se CIERRA, no se borra — la orden y su bitácora quedan enteras.
"use strict";

// Terminal = la orden ya terminó su vida por la puerta que le tocaba. Espejo de
// ESTADOS de public/js/pages/ordenes-state.js; mismo criterio que TERMINALES de
// domain/conciliacionPool.js.
const TERMINALES = new Set([
  "ENTREGADO AL CLIENTE",
  "CERRADA (VISITA)",
  "CERRADA (ENTRADA)",
  "CERRADA (DEVOLUCION)",
  "CERRADA (SIN RETIRAR)",
  "ANULADA",
]);

const ANULADA = "ANULADA";

/** ¿Esta orden todavía está viva? */
function estaViva(o = {}) {
  return o.eliminado !== true && !TERMINALES.has(String(o.estado_reparacion || "").toUpperCase());
}

/**
 * Equipos que la orden ya tiene encima. Un serial declarado es trabajo: bodega
 * eligió esa unidad y el taller la preparó. Sin un solo serial, la orden es un
 * papel en blanco y anularla no cuesta nada.
 */
function equiposConSerial(o = {}) {
  return (Array.isArray(o.equipos) ? o.equipos : [])
    .filter((e) => e && e.eliminado !== true && String(e.serial || "").trim()).length;
}

/**
 * Decide qué hacer con cada orden de un contrato anulado.
 *
 * @param {Array<{id:string, data:Object}>} ordenes  órdenes del contrato
 * @param {{sustitutoId?:string, sustitutoNumero?:string}} opts
 * @returns {{repuntar:Array, anular:Array, revisar:Array, intactas:Array}}
 */
function planOrdenes(ordenes, { sustitutoId = null, sustitutoNumero = "" } = {}) {
  const plan = { repuntar: [], anular: [], revisar: [], intactas: [] };
  for (const o of ordenes || []) {
    const data = o.data || {};
    if (!estaViva(data)) { plan.intactas.push(o); continue; }
    if (sustitutoId) { plan.repuntar.push({ ...o, sustitutoId, sustitutoNumero }); continue; }
    const n = equiposConSerial(data);
    if (n > 0) plan.revisar.push({ ...o, equipos_n: n });
    else plan.anular.push(o);
  }
  return plan;
}

module.exports = { TERMINALES, ANULADA, estaViva, equiposConSerial, planOrdenes };
