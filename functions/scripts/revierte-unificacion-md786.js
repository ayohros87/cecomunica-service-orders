/**
 * revierte-unificacion-md786.js — Deshace la unificación MD786 del 2026-08-11.
 *
 * El 11-ago se dieron por REFURBISHED las 12 bases que la toma física del 23-jul
 * había capturado bajo la fila "MD786" (nuevo): se repuntaron a MD786-R, la fila
 * nuevo se desactivó y su conteo se fusionó en el de la fila R (29 + 12 = 41).
 * El 12-ago bodega —que tiene los equipos delante— confirmó que esas 12 bases
 * SON NUEVAS. La flota está partida de verdad: 29 en reuso y 12 nuevas.
 *
 * Este script hace las dos piezas que ningún script genérico cubre:
 *   1. Reactiva la fila "MD786" (nuevo) — sin esto no se puede volver a capturar
 *      contra ella y `ajusta-conteo-inventario.js` se niega a darle conteo.
 *   2. Devuelve a esa fila sus 2 registros de `ultimo_inventario` (los dos de
 *      cantidad 12), que la unificación había repuntado a MD786-R.
 *
 * El resto de la reversa va con los scripts de siempre, en este orden:
 *   node scripts/revierte-unificacion-md786.js --write
 *   node scripts/repunta-modelo-lista.js ../local-data/md786-a-nuevo-2026-08-12.txt \
 *        jXvtFLV5XxBD5Rn7nuck --write --motivo="Bodega confirma que son nuevas"
 *   node scripts/ajusta-conteo-inventario.js jXvtFLV5XxBD5Rn7nuck 12 --write --nota="..."
 *   node scripts/ajusta-conteo-inventario.js nZDmiShibOAr7PfRR4TH 29 --write --nota="..."
 *
 * USAGE (desde functions/):
 *   node scripts/revierte-unificacion-md786.js [--write]
 * Idempotente.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const NUEVO = "jXvtFLV5XxBD5Rn7nuck"; // HYTERA MD786   (estado N)
const R     = "nZDmiShibOAr7PfRR4TH"; // HYTERA MD786-R (estado R)
// Los dos registros de conteo que nacieron en la fila nuevo (12 el 2026-07-23 y
// 12 en jun-2025) y que la unificación repuntó a MD786-R. Por ID y no por query
// para no arrastrar un futuro conteo de 12 que sí sea de la fila R.
const HIST = ["TBdGYGUAN6Zt5pODTmAO", "Zc96QmHSxzA3LpnpHaok"];

const dryRun = !process.argv.includes("--write");

(async () => {
  const m = await db.collection("modelos").doc(NUEVO).get();
  if (!m.exists) throw new Error(`El modelo ${NUEVO} no existe`);
  const mv = m.data();
  console.log(`Fila a reactivar: ${`${mv.marca || ""} ${mv.modelo || ""}`.trim()} (${NUEVO}) · activo=${mv.activo}`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const batch = db.batch();
  let cambios = 0;

  if (mv.activo === false) {
    console.log("  reactivar fila MD786 (nuevo): activo false → true");
    batch.set(m.ref, { activo: true, actualizado_en: admin.firestore.Timestamp.now() }, { merge: true });
    cambios++;
  } else {
    console.log("  fila MD786 (nuevo) ya está activa — nada que hacer");
  }

  for (const id of HIST) {
    const ref = db.collection("ultimo_inventario").doc(id);
    const s = await ref.get();
    if (!s.exists) { console.log(`  !! ultimo_inventario/${id} no existe`); continue; }
    const v = s.data();
    if (v.modelo_id === NUEVO) { console.log(`  ${id} ya apunta a MD786 (nuevo)`); continue; }
    if (v.modelo_id !== R) { console.log(`  !! ${id} apunta a ${v.modelo_id}, no a MD786-R — se salta`); continue; }
    if (v.cantidad !== 12) { console.log(`  !! ${id} tiene cantidad ${v.cantidad}, esperaba 12 — se salta`); continue; }
    const cuando = v.timestamp?.toDate ? v.timestamp.toDate().toISOString().slice(0, 10) : "?";
    console.log(`  repuntar ultimo_inventario/${id} (cantidad 12, ${cuando})  MD786-R → MD786 (nuevo)`);
    batch.update(ref, { modelo_id: NUEVO });
    cambios++;
  }

  if (!cambios) { console.log("\nNada que cambiar."); process.exit(0); }
  if (!dryRun) {
    await batch.commit();
    console.log(`\nlisto: ${cambios} cambio(s) aplicados`);
  } else {
    console.log(`\n${cambios} cambio(s) pendientes`);
    console.log("*** DRY-RUN — volver a correr con --write para aplicar ***");
  }
  process.exit(0);
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
