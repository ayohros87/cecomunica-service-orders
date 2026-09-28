/**
 * backfill-ordenes-search-tokens.js — re-estampa `searchTokens` en TODAS las
 * órdenes con el builder actual (prefijos 3..8 de número, cliente y técnico;
 * auditoría UX 2026-09-28, T6).
 *
 * Por qué hace falta: el trigger onOrdenWriteSearchTokens solo recalcula
 * cuando la orden se escribe. Las órdenes viejas (justo las que se buscan con
 * "hospi" o "202609") no se vuelven a tocar, así que sin este pase siguen con
 * los tokens de palabra completa y la búsqueda por prefijo no las ve.
 *
 * Usa el MISMO builder que el trigger (src/lib/searchTokens.js): el trigger
 * compara con tokensEqual y no reescribe lo que este script ya dejó bien.
 *
 * USO (desde functions/, con credenciales de admin del proyecto):
 *   node scripts/backfill-ordenes-search-tokens.js            # DRY-RUN (default)
 *   node scripts/backfill-ordenes-search-tokens.js --apply    # escribe
 *   node scripts/backfill-ordenes-search-tokens.js --apply --limit=200   # prueba acotada
 *
 * SEGURIDAD:
 *   - Idempotente: salta las órdenes cuyos tokens ya coinciden.
 *   - Solo toca el campo `searchTokens` (update, no set).
 *   - Salta las eliminadas (eliminado === true), igual que el trigger.
 *   - Lee por páginas de 500 ordenadas por ID y escribe en lotes de 400.
 *   - Cada escritura dispara el trigger una vez; como el resultado es igual,
 *     el trigger sale sin escribir (no hay bucle).
 */

const admin = require("firebase-admin");
const { buildOrderSearchTokens, tokensEqual } = require("../src/lib/searchTokens");

const APPLY = process.argv.includes("--apply");
const LIMIT_ARG = process.argv.find(a => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) || Infinity : Infinity;
const PAGE = 500;
const BATCH_SIZE = 400;

admin.initializeApp();
const db = admin.firestore();

async function run() {
  console.log(`[backfill-ordenes-search-tokens] modo=${APPLY ? "APPLY" : "DRY-RUN"} limite=${LIMIT}`);
  const t0 = Date.now();
  const st = { scanned: 0, eliminadas: 0, iguales: 0, cambian: 0, escritas: 0, errores: 0, antes: 0, despues: 0 };
  const muestra = [];

  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (!ops) return;
    if (APPLY) {
      try { await batch.commit(); st.escritas += ops; }
      catch (err) { console.error(`  lote falló: ${err.message}`); st.errores += ops; }
    }
    batch = db.batch();
    ops = 0;
  };

  let cursor = null;
  outer: for (;;) {
    let q = db.collection("ordenes_de_servicio")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      if (st.scanned >= LIMIT) break outer;
      st.scanned++;
      const data = doc.data();
      if (data.eliminado === true) { st.eliminadas++; continue; }

      const nuevos = buildOrderSearchTokens(doc.id, data);
      const actuales = Array.isArray(data.searchTokens) ? data.searchTokens : [];
      if (tokensEqual(nuevos, actuales)) { st.iguales++; continue; }

      st.cambian++;
      st.antes += actuales.length;
      st.despues += nuevos.length;
      if (muestra.length < 5) muestra.push({ id: doc.id, antes: actuales.length, despues: nuevos.length });
      if (APPLY) {
        batch.update(doc.ref, { searchTokens: nuevos });
        ops++;
        if (ops >= BATCH_SIZE) await flush();
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    console.log(`  … revisadas ${st.scanned}, por actualizar ${st.cambian}`);
  }
  await flush();

  const prom = (n) => (st.cambian ? (n / st.cambian).toFixed(1) : "0");
  console.log("──────────────────────────────────────────");
  console.log(`  revisadas            : ${st.scanned}`);
  console.log(`  eliminadas (saltadas): ${st.eliminadas}`);
  console.log(`  ya al día            : ${st.iguales}`);
  console.log(`  por actualizar       : ${st.cambian}  (tokens prom. ${prom(st.antes)} → ${prom(st.despues)})`);
  console.log(`  escritas             : ${st.escritas}`);
  if (st.errores) console.log(`  ERRORES              : ${st.errores}`);
  if (muestra.length) console.log("  muestra:", JSON.stringify(muestra));
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s — ${APPLY ? "APLICADO" : "DRY-RUN (sin escrituras; usa --apply)"}`);
}

run()
  .then(() => process.exit(0))
  .catch(err => { console.error("[backfill-ordenes-search-tokens] FATAL", err); process.exit(1); });
