/**
 * backfill-gestiones-archivo.js — Siembra `gestiones/{gid}.seriales_norm`.
 *
 * Por qué: el archivo (/contratos/, pestaña Gestiones) busca por serial con
 * array-contains, y Firestore no puede mirar dentro de items[] ni de
 * demo.seriales_asignados[]. Sin este campo, "¿en qué gestión salió el serial
 * 8J4K02245?" solo se contestaba abriendo cliente por cliente en el Centro.
 *
 * De aquí en adelante el campo lo mantiene el trigger onGestionArchivo; este
 * script es solo para el histórico. Idempotente: escribe únicamente donde el
 * conjunto de seriales cambió, así que se puede correr las veces que sea.
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-gestiones-archivo.js            # dry-run
 *   node scripts/backfill-gestiones-archivo.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const { serialesDe, mismoConjunto } = require("../src/domain/gestionSeriales");

const dryRun = !process.argv.includes("--write");

(async () => {
  const snap = await db.collection("gestiones").get();
  console.log(`${snap.size} gestiones en total`);

  const cambios = [];
  const porTipo = {};
  let conSeriales = 0;

  for (const doc of snap.docs) {
    const g = doc.data() || {};
    const seriales = serialesDe(g);
    if (seriales.length) conSeriales++;
    if (mismoConjunto(g.seriales_norm, seriales)) continue;
    porTipo[g.tipo || "?"] = (porTipo[g.tipo || "?"] || 0) + 1;
    cambios.push({ id: doc.id, ref: doc.ref, seriales, tipo: g.tipo });
  }

  console.log(`${conSeriales} tienen al menos un serial · ${cambios.length} por actualizar`);
  console.log("por tipo:", porTipo);
  for (const c of cambios.slice(0, 15)) {
    console.log(`  ${c.id} (${c.tipo}) → [${c.seriales.join(", ")}]`);
  }
  if (cambios.length > 15) console.log(`  … y ${cambios.length - 15} más`);

  if (dryRun) {
    console.log("\nDRY-RUN — nada se escribió. Corre con --write para aplicar.");
    return;
  }

  // Lotes de 400: el tope de Firestore es 500 operaciones por batch.
  let escritas = 0;
  for (let i = 0; i < cambios.length; i += 400) {
    const lote = db.batch();
    for (const c of cambios.slice(i, i + 400)) lote.update(c.ref, { seriales_norm: c.seriales });
    await lote.commit();
    escritas += Math.min(400, cambios.length - i);
    console.log(`  ${escritas}/${cambios.length}`);
  }
  console.log(`\nListo: ${escritas} gestiones indexadas.`);
})().catch((e) => { console.error(e); process.exit(1); });
