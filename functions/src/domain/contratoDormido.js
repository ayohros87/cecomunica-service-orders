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
// Desde cuándo corren los 45 días: desde lo ÚLTIMO que acercó el contrato a
// la firma — la aprobación, la asignación de seriales, el enlace enviado o
// una reactivación anterior. Un enlace enviado hace 5 días sobre seriales
// asignados hace 50 no está abandonado.
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

// Lo último que movió el contrato hacia la firma. `solicitud` es la
// firma_solicitudes pendiente, si la hay (su created_at vale aunque el
// contrato viejo no traiga firma_solicitud_creada_at).
function baseEspera(c, solicitud) {
  const x = c || {};
  const candidatos = [
    x.dormido_reactivado_at, x.firma_solicitud_creada_at, solicitud?.created_at,
    x.seriales_asignados_at, x.fecha_aprobacion,
  ].map(_aDate).filter(Boolean);
  if (candidatos.length) return new Date(Math.max(...candidatos.map(d => d.getTime())));
  return _aDate(x.fecha_creacion);
}

function diasEsperando(c, solicitud, now = new Date()) {
  const base = baseEspera(c, solicitud);
  if (!base) return null;
  return Math.floor((now - base) / 86400000);
}

// { dormir, dias, porQue }
function decidirDormir({ contrato, solicitud = null, now = new Date(), dias = DIAS_DORMIDO } = {}) {
  if (!esperaFirmaViva(contrato)) return { dormir: false, dias: null, porQue: "no espera firma" };
  const edad = diasEsperando(contrato, solicitud, now);
  if (edad == null) return { dormir: false, dias: null, porQue: "sin fecha base" };
  if (edad < dias) return { dormir: false, dias: edad, porQue: `lleva ${edad} días (umbral ${dias})` };
  return { dormir: true, dias: edad, porQue: `${edad} días sin firma` };
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
function patchReactivar({ ahora, uid }) {
  return {
    dormido: false,
    dormido_reactivado_at: ahora,
    dormido_reactivado_por_uid: uid || null,
    fecha_modificacion: ahora,
  };
}

module.exports = {
  DIAS_DORMIDO, MOTIVO, esperaFirmaViva, baseEspera, diasEsperando,
  decidirDormir, patchDormir, patchCaducarSolicitud, patchReactivar,
};
