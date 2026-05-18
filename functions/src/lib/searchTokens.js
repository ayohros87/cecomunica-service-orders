/**
 * searchTokens.js — pure token computation for ordenes_de_servicio search.
 *
 * Generates the bag-of-tokens array stored on each order doc so the
 * frontend can search via `where('searchTokens', 'array-contains-any', ...)`
 * instead of scanning the entire collection. See
 * ORDENES_INDEX_IMPROVEMENTS.md §1.1.
 *
 * Same shape is computed both by the onWrite CF trigger (online) and the
 * backfill script (one-shot for existing docs). Pure: no Firestore, no
 * admin SDK, no I/O — trivially unit-testable.
 */

const MAX_TOKENS_PER_DOC = 200;
const MIN_WORD_LEN = 2;
const SERIAL_SUFFIX_MIN = 4;
const SERIAL_SUFFIX_MAX = 8;

/**
 * Normalize a string for tokenization: lowercase, strip diacritics,
 * collapse non-alphanumeric to spaces, trim.
 * @param {string} s
 * @returns {string}
 */
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Compute the searchTokens array for an order document.
 * Source fields:
 *   - ordenId (full + dash/underscore-separated parts)
 *   - cliente_nombre / cliente (each word ≥ 2 chars)
 *   - tecnico_asignado (each word ≥ 2 chars)
 *   - tipo_de_servicio (each word ≥ 3 chars)
 *   - equipos[].numero_de_serie (full + suffix tokens 4..8 chars)
 *
 * Capped at MAX_TOKENS_PER_DOC to bound doc size.
 *
 * @param {string} ordenId
 * @param {Object} data - order document data
 * @returns {string[]} sorted, de-duplicated tokens
 */
function buildOrderSearchTokens(ordenId, data) {
  const tokens = new Set();

  // ── Orden ID ────────────────────────────────────────────────────
  if (ordenId) {
    const id = String(ordenId).toLowerCase();
    tokens.add(id);
    id.split(/[-_]+/).forEach(p => { if (p) tokens.add(p); });
  }

  // ── Cliente nombre ──────────────────────────────────────────────
  normalize(data?.cliente_nombre || data?.cliente || "")
    .split(/\s+/)
    .forEach(w => { if (w.length >= MIN_WORD_LEN) tokens.add(w); });

  // ── Tecnico ─────────────────────────────────────────────────────
  normalize(data?.tecnico_asignado || "")
    .split(/\s+/)
    .forEach(w => { if (w.length >= MIN_WORD_LEN) tokens.add(w); });

  // ── Tipo de servicio ────────────────────────────────────────────
  // Min 3 because tipo words are domain-specific (REPARACION, PROGRAMACION)
  // and 2-letter matches would be noise.
  normalize(data?.tipo_de_servicio || "")
    .split(/\s+/)
    .forEach(w => { if (w.length >= 3) tokens.add(w); });

  // ── Equipos: serial + suffix tokens ────────────────────────────
  // Techs typically search by the last 4–6 digits of a serial; suffix
  // tokens make that a single indexed lookup.
  const equipos = Array.isArray(data?.equipos) ? data.equipos : [];
  for (const e of equipos) {
    if (e?.eliminado) continue;
    const serial = normalize(e?.numero_de_serie || e?.serial || "");
    if (!serial) continue;
    tokens.add(serial);
    const len = serial.length;
    for (let n = SERIAL_SUFFIX_MIN; n <= Math.min(len, SERIAL_SUFFIX_MAX); n++) {
      tokens.add(serial.slice(-n));
    }
  }

  // Sort to make the array stable across runs — required for the
  // idempotence check in the CF trigger.
  return Array.from(tokens).sort().slice(0, MAX_TOKENS_PER_DOC);
}

/**
 * True when two token arrays are element-wise equal. Both inputs are
 * assumed sorted (buildOrderSearchTokens returns sorted output).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function tokensEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

module.exports = {
  normalize,
  buildOrderSearchTokens,
  tokensEqual,
  MAX_TOKENS_PER_DOC,
};
