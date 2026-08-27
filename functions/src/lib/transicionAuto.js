// Candados del AUTO-RECLAMO de devolución (onEntregaTransicion).
//
// El trigger reclama, al confirmarse la entrega de una renovación/reemplazo,
// todo el alquiler que siga colgando del contrato de ORIGEN. Esa regla es
// correcta cuando el origen es un hecho declarado por una persona. Deja de
// serlo cuando el origen es una SUPOSICIÓN — y ahí es donde reventó
// REEMP20260825-01 (SEGURIDAD IDEAL, 2026-08-27, orden 2026082705):
//
//   · El vendedor marcó en el formulario "el contrato original es de papel"
//     (`origen_tipo: 'legacy'`, ref ALQ2024-10-30-01). O sea: el origen NO
//     está en el sistema, y el radio a reemplazar (24813A0527) tampoco colgaba
//     de ningún contrato interno.
//   · Como el contrato quedó sin `contrato_origen_ids`, el script
//     amarra-renovaciones.js le buscó uno por deducción (mismo cliente, ALQ
//     vigente, único candidato) y lo amarró a ALQ20260206-01 — la adición de
//     febrero, que no tiene nada que ver.
//   · Al confirmarse la entrega, el trigger leyó ese origen inventado y
//     reclamó sus DOS radios, cuando el reemplazo entregaba UNO.
//
// Los tres candados de abajo son la misma idea aplicada tres veces: **una
// inferencia no dispara trabajo operativo**. Cuando el sistema no puede
// justificar a quién le pide qué, no crea la orden — deja la marca para que
// una persona confirme. Perder la automatización en el caso dudoso cuesta un
// clic; equivocarse cuesta que recepción le pida a un cliente radios que son
// suyos con todo derecho.
//
// Función PURA (test/transicionAuto.test.js): recibe el doc y decide.
"use strict";

const { codigoTipo } = require("./vigencia");

// Por qué se frenó el auto-reclamo. Viaja a `transicion_auto_bloqueada.motivo`
// y la UI lo traduce, así que son códigos, no frases.
const MOTIVOS = {
  ORIGEN_PAPEL: "origen_papel",
  LINAJE_INFERIDO: "linaje_inferido",
  EXCEDE_TOPE: "excede_tope",
};

// Cuántas unidades declara el contrato NUEVO. `total_equipos` es el campo que
// escribe la venta; se recalcula desde `equipos[]` cuando falta (contratos
// viejos) y se devuelve 0 cuando no hay forma de saberlo — 0 significa "sin
// dato", y sin dato no se aplica tope.
function unidadesDeclaradas(contrato) {
  const c = contrato || {};
  const directo = Number(c.total_equipos || c.equipos_total || 0);
  if (directo > 0) return directo;
  return (c.equipos || []).reduce((s, e) => s + Number((e && e.cantidad) || 0), 0);
}

/**
 * ¿Se puede confiar en el contrato de origen que trae este contrato?
 *
 * Candado (a) — `origen_tipo: 'legacy'`. El vendedor YA respondió que el
 * original está en papel. Cualquier `contrato_origen_ids` que aparezca en un
 * contrato así llegó por deducción, no por su mano. El predicado del navegador
 * (js/domain/transicionPendiente.js) ya honra este campo desde 2026-08-07; el
 * trigger no lo miraba.
 *
 * Candado (b) — linaje INFERIDO sin confirmar. `linaje_amarrado` es la marca
 * que deja amarra-renovaciones.js. A 2026-08-27 hay 31 contratos con ella y el
 * trigger no podía distinguirlos de un vínculo escrito por una persona. Una
 * vez que alguien confirma (`linaje_confirmado`), el vínculo pasa a valer
 * igual que uno declarado en la venta.
 *
 * @param {Object} contrato — doc del contrato NUEVO
 * @returns {{ok:boolean, motivo?:string, detalle?:string}}
 */
function evaluarOrigen(contrato) {
  const c = contrato || {};

  if (c.origen_tipo === "legacy") {
    return {
      ok: false,
      motivo: MOTIVOS.ORIGEN_PAPEL,
      detalle: `El contrato original está en papel${c.origen_legacy_ref ? ` (${c.origen_legacy_ref})` : ""}`
             + ", así que el vínculo a un contrato del sistema no puede haberlo puesto la venta.",
    };
  }

  if (c.linaje_amarrado && !c.linaje_confirmado) {
    const dst = (c.linaje_amarrado && c.linaje_amarrado.origen_contrato_id) || "—";
    return {
      ok: false,
      motivo: MOTIVOS.LINAJE_INFERIDO,
      detalle: `El vínculo al contrato ${dst} lo dedujo ${(c.linaje_amarrado && c.linaje_amarrado.por) || "un script"}`
             + ", no la venta. Hay que confirmarlo antes de pedirle equipos al cliente.",
    };
  }

  return { ok: true };
}

/**
 * Tope de un REEMPLAZO: no puede reclamar más unidades de las que entrega.
 *
 * Un REEMP existe para sustituir N radios por N radios. Si el cálculo produce
 * MÁS salientes que las unidades que el contrato declara, el origen o el pareo
 * están mal — y como no hay forma de saber CUÁL de los candidatos es el
 * correcto, no se recorta: se frena entero. Recortar 2→1 en el caso SEGURIDAD
 * IDEAL habría reclamado igualmente un radio equivocado, solo que uno menos.
 *
 * No aplica a renovaciones: ahí "todo el origen se devuelve" es la regla
 * deliberada (una renovación de 2 líneas puede reemplazar un contrato de 40
 * radios sin que eso sea un error).
 *
 * @param {Object} contrato — doc del contrato NUEVO
 * @param {Array}  reclamar — salida de decidirSalientes()
 * @returns {{ok:boolean, motivo?:string, detalle?:string, tope?:number}}
 */
function evaluarTope(contrato, reclamar) {
  const c = contrato || {};
  if (codigoTipo(c) !== "REEMP") return { ok: true };

  const tope = unidadesDeclaradas(c);
  if (tope <= 0) return { ok: true };          // sin dato no se inventa un tope

  const n = (reclamar || []).length;
  if (n <= tope) return { ok: true };

  return {
    ok: false,
    motivo: MOTIVOS.EXCEDE_TOPE,
    tope,
    detalle: `El reemplazo entrega ${tope} equipo(s) y el cálculo reclama ${n}. `
           + "Un reemplazo sustituye uno por uno: si salen más de los que entran, "
           + "el contrato de origen o el plan de transición están mal.",
  };
}

/**
 * Los dos candados juntos, en el orden en que importan. Lo llama el trigger:
 * `ok:false` significa "no crees la orden, deja la marca".
 * @param {Object} contrato
 * @param {Array}  reclamar
 * @returns {{ok:boolean, motivo?:string, detalle?:string, tope?:number}}
 */
function evaluarAutoReclamo(contrato, reclamar) {
  const origen = evaluarOrigen(contrato);
  if (!origen.ok) return origen;
  return evaluarTope(contrato, reclamar);
}

module.exports = {
  MOTIVOS, unidadesDeclaradas,
  evaluarOrigen, evaluarTope, evaluarAutoReclamo,
};
