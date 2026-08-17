/**
 * backfill-contratos-search-tokens.js — estampa `searchTokens` en los
 * contratos existentes (auditoría UX A8, 3ª tanda).
 *
 * POR QUÉ. La búsqueda server-side de la lista era por PREFIJO de
 * cliente_nombre_lower: "israelita" no encontraba "Sociedad Israelita" y el
 * vendedor concluía "no existe" → contratos duplicados. Los contratos nuevos
 * nacen con tokens (nc-guardar → ContratosService.buildSearchTokens); este
 * script cubre el histórico.
 *
 * TOKENS (MANTENER EN SYNC con public/js/services/contratosService.js
 * buildSearchTokens): word-prefixes 2..n del cliente_nombre normalizado
 * (sin acentos, minúsculas) + el contrato_id completo en minúsculas.
 * Tope 200 tokens.
 *
 * Idempotente: solo escribe docs sin searchTokens o cuyo set calculado
 * difiere del guardado. No toca ningún otro campo (update parcial).
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-contratos-search-tokens.js            # DRY RUN
 *   node scripts/backfill-contratos-search-tokens.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

function buildSearchTokens({ cliente_nombre = "", contrato_id = "" } = {}) {
  const norm = (s) => String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const toks = new Set();
  norm(cliente_nombre).split(/[^a-z0-9]+/).filter(Boolean).forEach(p => {
    for (let i = 2; i <= p.length; i++) toks.add(p.slice(0, i));
  });
  if (contrato_id) toks.add(String(contrato_id).toLowerCase());
  return Array.from(toks).slice(0, 200);
}

function igualComoSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}

(async () => {
  const snap = await db.collection("contratos").get();
  console.log(`Contratos leídos: ${snap.size}`);

  const pendientes = [];
  snap.forEach(d => {
    const c = d.data();
    const tokens = buildSearchTokens({
      cliente_nombre: c.cliente_nombre || "",
      contrato_id: c.contrato_id || "",
    });
    if (!igualComoSet(c.searchTokens, tokens)) {
      pendientes.push({ id: d.id, contrato_id: c.contrato_id || d.id, tokens });
    }
  });

  console.log(`Por estampar: ${pendientes.length}`);
  pendientes.slice(0, 5).forEach(p =>
    console.log(`  · ${p.contrato_id} → ${p.tokens.length} tokens (ej: ${p.tokens.slice(0, 6).join(", ")}…)`));

  if (!APPLY) {
    console.log("\nDRY RUN — nada escrito. Ejecuta con --apply para estampar.");
    process.exit(0);
  }

  let escritos = 0;
  while (pendientes.length) {
    const tanda = pendientes.splice(0, 400);
    const batch = db.batch();
    tanda.forEach(p => batch.update(db.collection("contratos").doc(p.id), { searchTokens: p.tokens }));
    await batch.commit();
    escritos += tanda.length;
    console.log(`  …${escritos} escritos`);
  }
  console.log(`LISTO: ${escritos} contratos con searchTokens.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
