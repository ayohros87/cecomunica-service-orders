// searchTokens de cotizaciones (auditoría UX 2026-09-28 T6 / §4.5 #12): la
// búsqueda por cliente de la lista filtraba solo las 30 cargadas + "Cargar
// más". Con tokens, cotizaciones-index busca en el servidor con
// array-contains, igual que contratos.
//
// Por qué un trigger y no estamparlos al guardar en el navegador: las
// cotizaciones nacen por TRES puertas (el editor, cotizar-orden del taller y
// lib/reposicionDano en el servidor). Estampar en una sola dejaba a las otras
// dos sin buscar. El trigger es el único punto que ve las tres.
//
// TOKENS (MANTENER EN SYNC con functions/scripts/backfill-cotizaciones-search-tokens.js):
// prefijos de palabra 2..n (sin acentos, minúsculas) de cliente_nombre y
// ejecutivo_nombre — mismo patrón que ContratosService.buildSearchTokens —, el
// cotizacion_id completo en minúsculas, su correlativo con y sin ceros
// ("0040", "40") y la orden de taller. Ordenados (la comparación de abajo lo
// exige) y con tope de 200.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

const MAX_TOKENS = 200;

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function prefijos(texto, toks) {
  norm(texto).split(/[^a-z0-9]+/).filter(Boolean).forEach((p) => {
    for (let i = 2; i <= p.length; i++) toks.add(p.slice(0, i));
  });
}

function buildCotizacionSearchTokens(c) {
  const toks = new Set();
  prefijos(c?.cliente_nombre, toks);
  prefijos(c?.ejecutivo_nombre, toks);
  const id = norm(c?.cotizacion_id);
  if (id) {
    toks.add(id);
    const m = id.match(/(\d+)$/);
    if (m) {
      toks.add(m[1]);
      const sinCeros = String(Number(m[1]));
      if (sinCeros && sinCeros !== "0") toks.add(sinCeros);
    }
  }
  const orden = norm(c?.orden_id);
  if (orden) toks.add(orden);
  return Array.from(toks).sort().slice(0, MAX_TOKENS);
}

function iguales(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const fn = onDocumentWritten(
  { document: "cotizaciones/{docId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return null; // borrado físico
    const tokens = buildCotizacionSearchTokens(after);
    // El trigger se dispara con su propia escritura: si ya coinciden, no se
    // escribe (sin esto recursaría para siempre).
    if (iguales(tokens, after.searchTokens)) return null;
    try {
      await event.data.after.ref.update({ searchTokens: tokens });
    } catch (e) {
      logger.error("[onCotizacionSearchTokens] no se pudieron estampar", { docId: event.params.docId, error: e.message });
    }
    return null;
  }
);

fn.buildCotizacionSearchTokens = buildCotizacionSearchTokens;
fn.tokensIguales = iguales;
module.exports = fn;
