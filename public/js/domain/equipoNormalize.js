// Canonical equipment field normalizer
// Reads any legacy field variant and writes to canonical names.
// Use at write time so readers can trust field names without fallbacks.
window.EquipoNormalize = {
  // Normalize a single raw equipment object to canonical fields.
  // Preserves all existing fields; adds/overwrites only the canonical ones.
  normalize(raw) {
    if (!raw) return raw;
    return {
      ...raw,
      serial:        raw.serial        || raw.SERIAL        || raw.numero_de_serie || "",
      modelo:        raw.modelo        || raw.MODEL         || raw.modelo_nombre   || "",
      observaciones: raw.observaciones || raw.descripcion   || raw.nombre          || "",
    };
  },

  normalizeAll(equipos) {
    return (equipos || []).map(e => EquipoNormalize.normalize(e));
  }
};
