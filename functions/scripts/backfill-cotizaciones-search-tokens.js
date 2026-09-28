/**
 * backfill-cotizaciones-search-tokens.js — estampa `searchTokens` en las
 * cotizaciones existentes (auditoría UX 2026-09-28, T6 / §4.5 #12).
 *
 * POR QUÉ. La lista de cotizaciones buscaba por cliente solo sobre las 30
 * cargadas. Desde este cambio busca en el servidor con
 * `where('searchTokens', 'array-contains', token)`. Las cotizaciones nuevas o
 * editadas reciben los tokens del trigger onCotizacionSearchTokens; este
 * script cubre el histórico que nadie vuelve a tocar.
 *
 * TOKENS (MANTENER EN SYNC con functions/src/triggers/cotizaciones/onSearchTokens.js
 * buildCotizacionSearchTokens; lo verifica functions/test/cotizacionP2.test.js):
 * prefijos 2..n de cliente_nombre y ejecutivo_nombre, cotizacion_id completo,
 * su correlativo con y sin ceros, y orden_id. Ordenados, tope 200.
 *
 * Idempotente: solo escribe docs sin tokens o con un set distinto (y estampa
 * `deleted: false` donde falte, que los KPIs de la lista cuentan con ese
 * campo). Update parcial: no toca nada más. OJO: cada escritura dispara los
 * triggers de cotizaciones (onCotizacionEstadoChange sale enseguida porque el
 * estado no cambia; onCotizacionSearchTokens ve los tokens iguales y no
 * reescribe).
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-cotizaciones-search-tokens.js            # DRY RUN
 *   node scripts/backfill-cotizaciones-search-tokens.js --apply
 */
const APPLY = process.argv.includes("--apply");

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
  return Array.from(toks).sort().slice(0, 200);
}

function iguales(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

module.exports = { buildCotizacionSearchTokens };

if (require.main === module) {
  // La app se inicializa solo al correr el script: el test lo importa para
  // comparar el builder con el del trigger sin tocar Firestore.
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: "cecomunica-service-orders" });
  const db = admin.firestore();
  (async () => {
    const snap = await db.collection("cotizaciones").get();
    console.log(`Cotizaciones leídas: ${snap.size}`);

    const pendientes = [];
    let sinDeleted = 0;
    snap.forEach((d) => {
      const c = d.data();
      const tokens = buildCotizacionSearchTokens(c);
      // De paso, `deleted: false` donde falte: los KPIs de la lista cuentan
      // en el servidor con where('deleted','==',false) y un doc sin el campo
      // quedaría fuera. Las tres puertas lo escriben desde el primer día;
      // esto es la red por si alguno entró por otra vía.
      const faltaDeleted = c.deleted === undefined;
      if (faltaDeleted) sinDeleted++;
      if (!iguales(c.searchTokens, tokens) || faltaDeleted) {
        pendientes.push({ id: d.id, cotizacion_id: c.cotizacion_id || d.id, tokens, faltaDeleted });
      }
    });
    if (sinDeleted) console.log(`Sin campo deleted (se estampa false): ${sinDeleted}`);

    console.log(`Por estampar: ${pendientes.length}`);
    pendientes.slice(0, 5).forEach((p) =>
      console.log(`  · ${p.cotizacion_id} → ${p.tokens.length} tokens (ej: ${p.tokens.slice(0, 6).join(", ")}…)`));

    if (!APPLY) {
      console.log("\nDRY RUN — nada escrito. Ejecuta con --apply para estampar.");
      process.exit(0);
    }

    let escritos = 0;
    while (pendientes.length) {
      const tanda = pendientes.splice(0, 400);
      const batch = db.batch();
      tanda.forEach((p) => batch.update(db.collection("cotizaciones").doc(p.id),
        p.faltaDeleted ? { searchTokens: p.tokens, deleted: false } : { searchTokens: p.tokens }));
      await batch.commit();
      escritos += tanda.length;
      console.log(`  …${escritos} escritos`);
    }
    console.log(`LISTO: ${escritos} cotizaciones con searchTokens.`);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
