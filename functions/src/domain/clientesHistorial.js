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
  "nombre", "ruc", "ruc_tipo", "dv",
  "representante", "representante_cedula", "representante_doc_tipo", "representante_email",
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

// Lo que el app YA entendía cuando el campo no existía: `activo !== false`
// es activo, sin `itbms_exento` paga, sin `tags` no tiene etiquetas, sin
// `representante_doc_tipo` es cédula. buildClientePayload los rellena en
// cada guardado y el historial contaba "ITBMS: — → Paga" y "Etiquetas: — →
// []" como cambios (135 y 134 líneas en 30 días, auditoría de módulos
// 2026-09-30, R2). Campo ausente → su valor implícito NO es un cambio.
const VALOR_IMPLICITO = {
  activo: true,
  deleted: false,
  itbms_exento: false,
  tags: [],
  representante_doc_tipo: "cedula",
};
function _relleno(campo, antes, despues) {
  if (antes !== undefined && antes !== null) return false;
  if (!(campo in VALOR_IMPLICITO)) return false;
  return _igual(VALOR_IMPLICITO[campo], despues);
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
    // En el alta (before null) sí se anota todo lo que trae valor.
    if (before && _relleno(campo, antes, despues)) continue;
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
