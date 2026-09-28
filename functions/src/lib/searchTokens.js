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

// 400 (antes 200): los prefijos suman ~6 entradas por palabra. Con prioridad
// (ver buildOrderSearchTokens) lo que se recorta en una orden de 80 radios son
// sufijos de serial, nunca el cliente ni el número. ~400 × 10 bytes no pesa.
const MAX_TOKENS_PER_DOC = 400;
const MIN_WORD_LEN = 2;
const SERIAL_SUFFIX_MIN = 4;
const SERIAL_SUFFIX_MAX = 8;
// Prefijos por palabra (auditoría UX 2026-09-28, T6): "hospi" encuentra
// "Hospital" y "202609" las órdenes de septiembre. Menos de 3 es ruido; más de
// 8 no hace falta porque el cliente recorta la consulta a 8 (prefijoConsulta)
// y verifica el resto contra el texto de la orden.
const PREFIX_MIN = 3;
const PREFIX_MAX = 8;

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
 * Prefijos PREFIX_MIN..PREFIX_MAX de una palabra ya normalizada. La palabra
 * completa no va aquí: es su propio token.
 * @param {string} w
 * @returns {string[]}
 */
function prefijosDe(w) {
  const out = [];
  const tope = Math.min(String(w || "").length - 1, PREFIX_MAX);
  for (let n = PREFIX_MIN; n <= tope; n++) out.push(w.slice(0, n));
  return out;
}

/**
 * El token con que el CLIENTE consulta una palabra tecleada: la palabra tal
 * cual si cabe en un prefijo, o sus primeros 8 (el resto se verifica contra el
 * texto). Espejo en public/js/services/ordenesService.js (searchOrders).
 * @param {string} w - palabra normalizada
 * @returns {string}
 */
function prefijoConsulta(w) {
  const s = String(w || "");
  return s.length > PREFIX_MAX ? s.slice(0, PREFIX_MAX) : s;
}

/**
 * Compute the searchTokens array for an order document.
 * Source fields:
 *   - ordenId (full + dash/underscore-separated parts + prefixes 3..8)
 *   - cliente_nombre / cliente (each word ≥ 2 chars + prefixes 3..8)
 *   - tecnico_asignado (each word ≥ 2 chars + prefixes 3..8)
 *   - tipo_de_servicio (each word ≥ 3 chars)
 *   - equipos[].numero_de_serie (full + suffix tokens 4..8 chars)
 *
 * Un solo arreglo (no un campo aparte): la consulta sigue siendo UN
 * array-contains-any y los mismos índices compuestos sirven.
 *
 * El tope se aplica por PRIORIDAD (palabras completas → prefijos → seriales →
 * sufijos), no alfabéticamente: antes el slice sobre el arreglo ya ordenado
 * podía botar el nombre del cliente en una orden con muchos radios.
 *
 * @param {string} ordenId
 * @param {Object} data - order document data
 * @returns {string[]} sorted, de-duplicated tokens
 */
function buildOrderSearchTokens(ordenId, data) {
  const tokens = new Set();
  const add = (t) => { if (t && tokens.size < MAX_TOKENS_PER_DOC) tokens.add(t); };
  const conPrefijo = [];

  // ── Orden ID ────────────────────────────────────────────────────
  if (ordenId) {
    const id = String(ordenId).toLowerCase();
    add(id);
    id.split(/[-_]+/).forEach(p => { if (p) add(p); });
    conPrefijo.push(...normalize(id).split(/\s+/).filter(Boolean));
  }

  // ── Cliente nombre ──────────────────────────────────────────────
  normalize(data?.cliente_nombre || data?.cliente || "")
    .split(/\s+/)
    .forEach(w => {
      if (w.length >= MIN_WORD_LEN) add(w);
      if (w.length > PREFIX_MIN) conPrefijo.push(w);
    });

  // ── Tecnico ─────────────────────────────────────────────────────
  normalize(data?.tecnico_asignado || "")
    .split(/\s+/)
    .forEach(w => {
      if (w.length >= MIN_WORD_LEN) add(w);
      if (w.length > PREFIX_MIN) conPrefijo.push(w);
    });

  // ── Tipo de servicio ────────────────────────────────────────────
  // Min 3 because tipo words are domain-specific (REPARACION, PROGRAMACION)
  // and 2-letter matches would be noise.
  normalize(data?.tipo_de_servicio || "")
    .split(/\s+/)
    .forEach(w => { if (w.length >= 3) add(w); });

  // ── Prefijos de número, cliente y técnico ──────────────────────
  for (const w of conPrefijo) prefijosDe(w).forEach(add);

  // ── Equipos: serial + suffix tokens ────────────────────────────
  // Techs typically search by the last 4–6 digits of a serial; suffix
  // tokens make that a single indexed lookup. Todos los seriales completos
  // primero y los sufijos después, para que el tope recorte sufijos.
  const equipos = Array.isArray(data?.equipos) ? data.equipos : [];
  const seriales = [];
  for (const e of equipos) {
    if (e?.eliminado) continue;
    const serial = normalize(e?.numero_de_serie || e?.serial || "");
    if (!serial) continue;
    seriales.push(serial);
    add(serial);
  }
  for (const serial of seriales) {
    const len = serial.length;
    for (let n = SERIAL_SUFFIX_MIN; n <= Math.min(len, SERIAL_SUFFIX_MAX); n++) {
      add(serial.slice(-n));
    }
  }

  // Sort to make the array stable across runs — required for the
  // idempotence check in the CF trigger.
  return Array.from(tokens).sort();
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
  prefijosDe,
  prefijoConsulta,
  MAX_TOKENS_PER_DOC,
  PREFIX_MIN,
  PREFIX_MAX,
};
