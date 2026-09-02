// Historial de cambios de la ficha del cliente — lógica PURA (sin Firestore).
//
// El problema real (2026-09-02, cambio de representante legal): editar la
// ficha pisaba el valor sin dejar rastro estructurado — no había forma de
// saber quién cambió el representante, cuándo, ni qué decía antes. El diff
// se calcula server-side (trigger onClienteHistorial) para capturar a TODOS
// los escritores: el grid de edición masiva, el formulario, las fusiones de
// duplicados y los scripts admin.
//
// Solo se auditan los campos con significado de negocio: los derivados
// (searchTokens, *_norm, updated_at/by) cambian en casi toda escritura y
// solo meterían ruido.

const CAMPOS_AUDITADOS = [
  "nombre", "ruc", "dv",
  "representante", "representante_cedula", "representante_email",
  "telefono", "email", "email_acuses",
  "direccion", "direccion_facturacion",
  "itbms_exento", "itbms_motivo_exencion",
  "tags", "vendedor_asignado", "vendedor_email",
  "activo", "deleted", "ip",
  "qbo_customer_id", "qbo_customer_name",
];

// undefined / null / "" son "vacío" indistinto: media colección no tiene el
// campo y el formulario escribe "" — eso NO es un cambio.
function _plano(v) {
  if (v === undefined || v === null || v === "") return null;
  return v;
}

function _igual(a, b) {
  a = _plano(a); b = _plano(b);
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

// Diff de los campos auditados. Devuelve { campo: { antes, despues } } o
// null si ningún campo auditado cambió (p. ej. escritura solo de tokens).
function diffCliente(before, after) {
  const cambios = {};
  for (const campo of CAMPOS_AUDITADOS) {
    const antes = before ? before[campo] : undefined;
    const despues = after ? after[campo] : undefined;
    if (!_igual(antes, despues)) {
      cambios[campo] = { antes: _plano(antes), despues: _plano(despues) };
    }
  }
  return Object.keys(cambios).length ? cambios : null;
}

// ¿A quién se le atribuye la escritura? updated_by solo es confiable si esta
// escritura también estampó updated_at (todos los caminos de la UI lo hacen);
// un script admin que no estampa dejaría el updated_by VIEJO y culparía al
// editor anterior. El soft-delete manda: deleted_by es quien borró.
function atribucion(before, after) {
  if (!after) return null;
  const cambioDeleted = !_igual(before && before.deleted, after.deleted);
  if (cambioDeleted && after.deleted === true && after.deleted_by) return after.deleted_by;
  const antesMs = before && before.updated_at && typeof before.updated_at.toMillis === "function"
    ? before.updated_at.toMillis() : null;
  const ahoraMs = after.updated_at && typeof after.updated_at.toMillis === "function"
    ? after.updated_at.toMillis() : null;
  const estampo = ahoraMs !== null && ahoraMs !== antesMs;
  return estampo ? (after.updated_by || null) : null;
}

module.exports = { CAMPOS_AUDITADOS, diffCliente, atribucion };
