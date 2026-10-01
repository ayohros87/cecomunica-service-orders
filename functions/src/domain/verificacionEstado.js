// Estado que debe decir la verificación pública (/c/<id>?v=) de un contrato.
// Lógica PURA: nada de Firestore aquí.
//
// Por qué existe (auditoría de módulos 2026-09-30, Contratos R1): el QR
// impreso certificaba como "válido y vigente" contratos anulados y vencidos.
// verificaciones/{id}.estado solo se actualizaba AL CAMBIAR el estado del
// contrato y solo desde el 28-sep: 192 de 513 verificaciones decían otra
// cosa que el contrato. Esta es la ÚNICA fórmula de "qué debe decir el
// espejo"; la usan el backfill (runBackfill cuadrarVerificaciones), el cuadre
// semanal (scheduled/cuadreVerificaciones) y el trigger onContratoActivado.

const VIVOS = ["activo", "aprobado"];

// 'vencido' manda sobre un contrato vivo que venció por fecha (la sección H
// del cron conserva estado 'activo' y solo marca vencimiento_estado). Un
// contrato borrado (soft delete) no está vigente: la página pública cae en
// "Contrato no vigente" con 'inactivo'.
function estadoEsperado(contrato) {
  const c = contrato || {};
  if (c.deleted === true) return "inactivo";
  if (VIVOS.includes(c.estado) && c.vencimiento_estado === "vencido") return "vencido";
  return c.estado || null;
}

// Fecha que acompaña al estado no vigente (misma preferencia que
// propagarEstadoVerificacion en onApproval.js). `ahora` es el valor que se
// escribe cuando el contrato no trae ninguna (FieldValue.serverTimestamp()).
function fechaDeEstado(contrato, estado, ahora) {
  const c = contrato || {};
  if (estado === "anulado") return c.anulado_fecha || c.fecha_anulacion || ahora;
  if (estado === "vencido") return c.vencido_at || c.fecha_fin || c.fecha_vencimiento || ahora;
  return null;
}

// Parche a aplicar sobre verificaciones/{id} para que cuadre con el contrato,
// o null si ya cuadra. Además del estado, corrige el "número de contrato"
// (B2: el trigger guardaba el ID interno del documento como contrato_id, y
// la página pública se lo mostraba al cliente, que no puede cotejarlo con su
// papel). `docId` es el ID del documento; `ahora` el timestamp del servidor.
function patchVerificacion({ verificacion, contrato, docId, ahora }) {
  const v = verificacion || {};
  const c = contrato || {};
  const patch = {};
  const esperado = estadoEsperado(c);
  if ((v.estado || null) !== esperado) {
    patch.estado = esperado;
    patch.estado_actualizado_at = ahora;
    const f = fechaDeEstado(c, esperado, ahora);
    if (esperado === "anulado" && !v.anulado_fecha) patch.anulado_fecha = f;
    if (esperado === "vencido" && !v.vencido_fecha) patch.vencido_fecha = f;
  }
  const numero = c.contrato_id && c.contrato_id !== docId ? c.contrato_id : null;
  if (numero && v.contrato_id !== numero) patch.contrato_id = numero;
  if (docId && v.contrato_doc_id !== docId) patch.contrato_doc_id = docId;
  return Object.keys(patch).length ? patch : null;
}

module.exports = { estadoEsperado, fechaDeEstado, patchVerificacion };
