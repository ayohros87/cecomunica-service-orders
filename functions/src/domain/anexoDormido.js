// Anexo de aumento DORMIDO: qué pasa con los equipos que aparta. Lógica PURA.
//
// Decisión de Alberto (5-oct-2026). Un anexo dormido (45 días aprobado sin la
// firma del cliente — domain/contratoDormido) seguía apartando sus radios y su
// orden de programación para siempre: el estado no cambia al dormir, así que
// nada los soltaba. Ahora:
//
//   · PLAZO DE DECISIÓN: 15 días desde que se durmió. En el Centro el vendedor
//     (y administración/gerencia) decide:
//       - RETENER los equipos: motivo + fecha probable de firma; quedan
//         apartados 30 días más (desde el plazo vigente). Una sola vez por el
//         vendedor; la segunda retención la hace solo administración.
//       - SOLTAR los equipos: anula el anexo con motivo; la anulación de
//         siempre (lib/gestiones.limpiarAnulacion, vía onGestionWrite) libera
//         los radios y elimina la orden de programación sin trabajar.
//   · NADIE DECIDE: al vencer el plazo (o la retención) el cron suelta solo —
//     anula el anexo con motivo "sin firma ni retención"— SOLO si ninguna de
//     sus órdenes de programación está trabajada. Con una orden trabajada en
//     el taller no se toca nada: el anexo queda marcado `dormido_bodega` y
//     BODEGA decide (Almacén · Hoy).
//   · AVISOS al vendedor: a los 10 días de dormido (si no lo retuvo) y un día
//     antes de soltarse (también al final de una retención).
//   · REACTIVAR sigue: apaga `dormido` y el plazo deja de correr (todo lo de
//     aquí exige dormido:true). Si se vuelve a dormir, el ciclo empieza limpio
//     (contratoDormido.patchDormirAnexo borra retención, avisos y bodega).
//
// Espejo del front: public/js/domain/anexoDormido.js (si cambia uno, cambia el
// otro). Rules: esRetenerAnexoDormido / esSoltarAnexoDormido.
"use strict";

const DIAS_DECIDIR = 15;
const DIAS_RETENCION = 30;
const DIAS_AVISO = 10;
const DIA = 86400000;

const MOTIVO_AUTO = "Anexo dormido sin firma ni retención: se soltaron los equipos apartados.";

// Roles (literales de usuarios.rol).
const ROLES_DECIDEN = ["administrador", "gerente", "vendedor"];
const ROL_SEGUNDA = "administrador";

function _aDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Fecha de Panamá (UTC-5, sin horario de verano) como AAAA-MM-DD.
function diaPanama(d) {
  const x = _aDate(d);
  if (!x) return "";
  return new Date(x.getTime() - 5 * 3600000).toISOString().slice(0, 10);
}

/** ¿Es un anexo dormido vivo (el plazo corre o espera a bodega)? */
function esAnexoDormido(g) {
  const x = g || {};
  return x.tipo === "aumento" && x.estado === "pendiente_firma"
    && x.dormido === true && x.deleted !== true;
}

/** Retenciones hechas en ESTE ciclo de sueño. */
function retenciones(g) {
  return Number((g || {}).dormido_retencion?.n || 0);
}

/** ¿Quedó para que bodega decida (orden trabajada al vencer)? */
function esperaBodega(g) {
  return esAnexoDormido(g) && !!(g || {}).dormido_bodega;
}

/** Cuándo se sueltan los equipos: fin de la retención, o dormido_at + 15. */
function plazoSoltar(g) {
  if (!esAnexoDormido(g)) return null;
  const hasta = _aDate(g.dormido_retener_hasta);
  if (hasta) return hasta;
  const base = _aDate(g.dormido_at);
  return base ? new Date(base.getTime() + DIAS_DECIDIR * DIA) : null;
}

/** Fin de una retención nueva: el plazo vigente (o ahora, si ya pasó) + 30. */
function retenerHasta(g, now = new Date()) {
  const p = plazoSoltar(g);
  const desde = p && p > now ? p : now;
  return new Date(desde.getTime() + DIAS_RETENCION * DIA);
}

/** ¿Este rol puede retener ahora? { ok, motivo } — la página dice por qué no. */
function puedeRetener(g, rol) {
  if (!esAnexoDormido(g)) return { ok: false, motivo: "El anexo no está dormido." };
  if (esperaBodega(g)) return { ok: false, motivo: "El plazo venció con la orden trabajada: lo decide bodega." };
  if (!ROLES_DECIDEN.includes(rol)) return { ok: false, motivo: "Lo retiene el vendedor o administración." };
  if (retenciones(g) >= 1 && rol !== ROL_SEGUNDA) {
    return { ok: false, motivo: "Ya se retuvo una vez: la segunda retención la hace administración." };
  }
  return { ok: true, motivo: "" };
}

/** ¿Puede soltar? Vendedor (el responsable), administración, gerencia; bodega solo si le tocó decidir. */
function puedeSoltar(g, rol, uid) {
  if (!esAnexoDormido(g)) return { ok: false, motivo: "El anexo no está dormido." };
  if ((g || {}).cierre?.entrega === true) return { ok: false, motivo: "Ya se entregó: no hay nada apartado." };
  if (["administrador", "gerente"].includes(rol)) return { ok: true, motivo: "" };
  if (rol === "vendedor") {
    return g.responsable_uid && g.responsable_uid === uid
      ? { ok: true, motivo: "" }
      : { ok: false, motivo: "Lo suelta el vendedor que lo pidió o administración." };
  }
  if (rol === "inventario") {
    return esperaBodega(g)
      ? { ok: true, motivo: "" }
      : { ok: false, motivo: "Bodega decide solo cuando el plazo vence con la orden trabajada." };
  }
  return { ok: false, motivo: "Tu rol no suelta anexos." };
}

/**
 * ¿La orden de programación ya la trabajó el taller? Cualquier rastro cuenta:
 * estado más allá de POR ASIGNAR, técnico asignado, QC, o un equipo con
 * trabajo, consumos, "no disponible" o descarte. Una eliminada no cuenta.
 */
function ordenTrabajada(o) {
  const x = o || {};
  if (x.eliminado === true) return false;
  const est = String(x.estado_reparacion || "").trim().toUpperCase();
  if (est && est !== "POR ASIGNAR") return true;
  if (String(x.tecnico_asignado || "").trim() || String(x.tecnico_uid || "").trim()) return true;
  if (x.qc && typeof x.qc === "object" && Object.keys(x.qc).length) return true;
  if (Array.isArray(x.qc_historial) && x.qc_historial.length) return true;
  return (Array.isArray(x.equipos) ? x.equipos : []).some(e => e && e.eliminado !== true && (
    String(e.trabajo_tecnico || "").trim()
    || (Array.isArray(e.consumos) && e.consumos.length)
    || e.intervencion_no_disponible === true
    || e.descartado_revision === true));
}

/** Ids de las órdenes de programación del anexo. */
function ordenesProgramacion(g) {
  const o = (g || {}).ordenes || {};
  return o.programacion_ids || (o.programacion_id ? [o.programacion_id] : []);
}

/**
 * Qué toca hoy con un anexo dormido.
 * @param {{gestion:Object, ordenes?:Array<{id:string,data:Object}>, now?:Date}} p
 * @returns {{accion:'nada'|'aviso_10'|'aviso_previo'|'soltar'|'bodega', plazo:Date|null, porQue:string, trabajadas:string[]}}
 */
function decidir({ gestion, ordenes = [], now = new Date() } = {}) {
  const g = gestion || {};
  const r = (accion, porQue, extra = {}) => ({ accion, plazo: plazoSoltar(g), porQue, trabajadas: [], ...extra });
  if (!esAnexoDormido(g)) return r("nada", "no es un anexo dormido");
  if (g.cierre?.entrega === true) return r("nada", "ya entregado");
  if (esperaBodega(g)) return r("nada", "espera la decisión de bodega");
  const plazo = plazoSoltar(g);
  if (!plazo) return r("nada", "sin fecha de dormido");
  if (now >= plazo) {
    const trabajadas = (ordenes || []).filter(o => ordenTrabajada(o.data)).map(o => o.id);
    return trabajadas.length
      ? r("bodega", `plazo vencido con ${trabajadas.length} orden(es) trabajada(s): decide bodega`, { trabajadas })
      : r("soltar", g.dormido_retener_hasta ? "retención vencida sin firma" : "plazo vencido sin firma ni retención");
  }
  if (now.getTime() >= plazo.getTime() - DIA && g.dormido_aviso_previo_para !== diaPanama(plazo)) {
    return r("aviso_previo", `se suelta el ${diaPanama(plazo)}`);
  }
  const base = _aDate(g.dormido_at);
  if (base && !g.dormido_aviso_10_at && retenciones(g) === 0
      && now.getTime() >= base.getTime() + DIAS_AVISO * DIA) {
    return r("aviso_10", `${DIAS_AVISO} días dormido sin decisión`);
  }
  return r("nada", `se suelta el ${diaPanama(plazo)}`);
}

// ── Parches (ahora = FieldValue.serverTimestamp() o Date) ──

function patchSoltarAuto({ ahora, porQue }) {
  return {
    estado: "anulada",
    anulada_motivo: MOTIVO_AUTO,
    anulada_por_uid: "system",
    anulada_at: ahora,
    dormido_soltado: { modo: "auto", at: ahora, por_que: porQue || "" },
  };
}

function patchBodega({ ahora, trabajadas, porQue }) {
  return { dormido_bodega: { at: ahora, ordenes: trabajadas || [], por_que: porQue || "" } };
}

function patchAviso({ accion, ahora, plazo }) {
  // El previo también apaga el de 10 días: si los dos tocan el mismo día,
  // basta el que dice la fecha.
  return accion === "aviso_previo"
    ? { dormido_aviso_previo_para: diaPanama(plazo), dormido_aviso_10_at: ahora }
    : { dormido_aviso_10_at: ahora };
}

// Campos de este ciclo que onGestionWrite trata como eco (no deciden nada en
// la máquina: el estado sigue 'pendiente_firma'). `dormido_soltado` NO va:
// viaja con estado → 'anulada', que sí corre la anulación.
const CAMPOS_ECO = ["dormido_retencion", "dormido_retener_hasta", "dormido_aviso_10_at",
  "dormido_aviso_previo_para", "dormido_bodega"];

module.exports = {
  DIAS_DECIDIR, DIAS_RETENCION, DIAS_AVISO, MOTIVO_AUTO, CAMPOS_ECO,
  diaPanama, esAnexoDormido, retenciones, esperaBodega, plazoSoltar, retenerHasta,
  puedeRetener, puedeSoltar, ordenTrabajada, ordenesProgramacion, decidir,
  patchSoltarAuto, patchBodega, patchAviso,
};
