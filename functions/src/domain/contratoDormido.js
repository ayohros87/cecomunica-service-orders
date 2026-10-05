// Contrato DORMIDO — aprobado sin firmar a los 45 días. Lógica PURA.
//
// Decisión de Alberto (1-oct-2026, auditoría de módulos, pregunta 7): un
// contrato aprobado que a los 45 días sigue sin la firma del cliente deja de
// ser un trámite. Caduca la solicitud y el enlace de firma; el contrato queda
// DORMIDO (marca explícita, no se borra ni se anula): un borrador para el
// futuro que no cuenta en "Contratos por firmar" ni bloquea otros trámites
// de la cuenta. Lo reactiva el vendedor desde el Centro, con enlace nuevo.
//
// Antes (C3 del informe): el Centro lo sacaba del trámite a los 45 días y el
// home lo seguía contando — dos verdades para la misma persona. 10 de 13 el
// día de la auditoría, con 50 días de espera promedio.
//
// Qué contratos entran: los mismos que la señal "Contratos por firmar"
// (senalesService.listContratosPorFirmar): aprobado, seriales asignados por
// bodega, lleva firma (no REEMP/DEMO), sin firmar, sin entregar, vivo. Los
// que esperan seriales son de bodega (recordatorioSeriales los escala); los
// legacy no esperan nada.
//
// Desde cuándo corren los 45 días (Alberto, 2-oct-2026): desde la APROBACIÓN.
// Antes (9c93b13) corrían desde lo último que acercó la firma (aprobación,
// seriales, enlace enviado, reactivación); un enlace reenviado reiniciaba el
// reloj sin que el cliente firmara nada. La única excepción es la
// REACTIVACIÓN: si el vendedor despierta un dormido, el reloj vuelve a
// empezar desde ahí — si no, se volvería a dormir en el próximo cron.
//
// ANEXOS de aumento (Alberto, 2-oct-2026): mismo trato. Un aumento aprobado
// en 'pendiente_firma' que a los 45 días de su aprobación sigue sin la firma
// del cliente queda dormido (marca en la gestión, el estado NO cambia), su
// solicitud y enlace caducan, no cuenta como trámite de la cuenta y lo
// reactiva el vendedor. No entran las actualizaciones de seriales
// (es_regularizacion: ya no se firman, se aplican) ni el anexo ya firmado que
// espera la validación del firmante.
const { llevaFirma } = require("./contratoFirma");

const DIAS_DORMIDO = 45;
const MOTIVO = "sin_firma_45d";

function _aDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ¿Es candidato a dormir (sin mirar la edad)?
function esperaFirmaViva(c) {
  const x = c || {};
  return x.estado === "aprobado"
    && x.deleted !== true
    && x.dormido !== true
    && x.seriales_estado === "asignados"
    && llevaFirma(x)
    && x.firmado !== true
    && x.entrega_confirmada !== true;
}

// Fecha base de la espera: la aprobación, o la reactivación si es posterior.
// Sin aprobación registrada (histórico), la creación.
function _maxFecha(vals) {
  const ds = vals.map(_aDate).filter(Boolean);
  return ds.length ? new Date(Math.max(...ds.map(d => d.getTime()))) : null;
}

function baseEspera(c) {
  const x = c || {};
  return _maxFecha([x.dormido_reactivado_at, x.fecha_aprobacion]) || _aDate(x.fecha_creacion);
}

function diasEsperando(c, now = new Date()) {
  const base = baseEspera(c);
  if (!base) return null;
  return Math.floor((now - base) / 86400000);
}

// { dormir, dias, porQue }
function _decidir(viva, edad, dias) {
  if (!viva) return { dormir: false, dias: null, porQue: "no espera firma" };
  if (edad == null) return { dormir: false, dias: null, porQue: "sin fecha base" };
  if (edad < dias) return { dormir: false, dias: edad, porQue: `lleva ${edad} días (umbral ${dias})` };
  return { dormir: true, dias: edad, porQue: `${edad} días sin firma` };
}

function decidirDormir({ contrato, now = new Date(), dias = DIAS_DORMIDO } = {}) {
  const viva = esperaFirmaViva(contrato);
  return _decidir(viva, viva ? diasEsperando(contrato, now) : null, dias);
}

// ── Anexos de aumento (gestiones tipo 'aumento' en 'pendiente_firma') ──

function anexoEsperaFirmaViva(g) {
  const x = g || {};
  return x.tipo === "aumento"
    && x.estado === "pendiente_firma"
    && x.deleted !== true
    && x.dormido !== true
    && x.aumento?.es_regularizacion !== true
    && x.cierre?.firma !== true
    && x.firma_pendiente_validacion !== true;
}

// Desde la aprobación comercial (aprobacion.at), o la reactivación si es
// posterior. Sin aprobación registrada, desde que se pidió.
function baseEsperaAnexo(g) {
  const x = g || {};
  return _maxFecha([x.dormido_reactivado_at, x.aprobacion?.at]) || _aDate(x.fecha_solicitud);
}

function diasEsperandoAnexo(g, now = new Date()) {
  const base = baseEsperaAnexo(g);
  if (!base) return null;
  return Math.floor((now - base) / 86400000);
}

function decidirDormirAnexo({ gestion, now = new Date(), dias = DIAS_DORMIDO } = {}) {
  const viva = anexoEsperaFirmaViva(gestion);
  return _decidir(viva, viva ? diasEsperandoAnexo(gestion, now) : null, dias);
}

// Parche de la gestión al dormirla: SOLO la marca (el estado sigue
// 'pendiente_firma' — cambiarlo correría la máquina de onGestionWrite).
// `borrar` (FieldValue.delete()): el ciclo nuevo empieza limpio — sin la
// retención, los avisos ni la marca de bodega de un sueño anterior
// (domain/anexoDormido, 5-oct-2026).
function patchDormirAnexo({ gestion, dias, ahora, teniaEnlace, borrar }) {
  const patch = { dormido: true, dormido_at: ahora, dormido_motivo: MOTIVO, dormido_dias: dias };
  if (borrar !== undefined) {
    for (const k of require("./anexoDormido").CAMPOS_ECO) {
      if ((gestion || {})[k] !== undefined) patch[k] = borrar;
    }
  }
  if (teniaEnlace || (gestion || {}).firma_solicitud_estado === "pendiente") {
    patch.firma_solicitud_estado = "caducado";
  }
  return patch;
}

// Parche del contrato al dormirlo. `ahora` = FieldValue.serverTimestamp().
function patchDormir({ contrato, dias, ahora, teniaEnlace }) {
  const patch = {
    dormido: true,
    dormido_at: ahora,
    dormido_motivo: MOTIVO,
    dormido_dias: dias,
    fecha_modificacion: ahora,
  };
  // El enlace caduca con la solicitud: el contrato lo refleja para que el
  // Centro no ofrezca "reenviar" un enlace muerto.
  if (teniaEnlace || (contrato || {}).firma_solicitud_estado === "pendiente") {
    patch.firma_solicitud_estado = "caducado";
  }
  return patch;
}

// Parche de la solicitud de firma al caducar.
function patchCaducarSolicitud(ahora) {
  return { estado: "caducado", caducado_at: ahora, caducado_motivo: MOTIVO };
}

// Parche del contrato al reactivarlo (lo hace el vendedor desde el Centro).
// La solicitud vieja sigue caducada; el vendedor genera un enlace nuevo.
// dormido_reactivado_at es la nueva fecha base de los 45 días.
function patchReactivar({ ahora, uid, esGestion = false }) {
  return {
    dormido: false,
    dormido_reactivado_at: ahora,
    dormido_reactivado_por_uid: uid || null,
    ...(esGestion ? {} : { fecha_modificacion: ahora }),
  };
}

// Campos que escribe el dormir/reactivar sobre una gestión: onGestionWrite
// los trata como eco (no deciden nada en la máquina de estados).
const CAMPOS_GESTION = ["dormido", "dormido_at", "dormido_motivo", "dormido_dias",
  "dormido_reactivado_at", "dormido_reactivado_por_uid", "firma_solicitud_estado",
  // Desde el 5-oct-2026 también la retención, los avisos y la marca de bodega
  // del plazo para soltar los equipos (domain/anexoDormido).
  ...require("./anexoDormido").CAMPOS_ECO];

module.exports = {
  DIAS_DORMIDO, MOTIVO, CAMPOS_GESTION, esperaFirmaViva, baseEspera, diasEsperando,
  decidirDormir, patchDormir, patchCaducarSolicitud, patchReactivar,
  anexoEsperaFirmaViva, baseEsperaAnexo, diasEsperandoAnexo, decidirDormirAnexo, patchDormirAnexo,
};
