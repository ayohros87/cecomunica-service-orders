/**
 * backfill-agregado-pool.js — Construye (o reconstruye) `agregados_pool`, el
 * resumen del pool por modelo que Almacén · Existencias lee en vez de barrer
 * las 7,592 fichas en cada apertura.
 *
 * Misma lógica que el cron de las 05:30 (src/domain/agregadoPool.js). Sirve
 * para el arranque inicial y para verificar la deriva a demanda.
 *
 * Por defecto es SOLO LECTURA: compara lo que hay contra lo que debería haber
 * y te dice la diferencia sin tocar nada. Con --aplicar escribe el resumen.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/backfill-agregado-pool.js              # verifica (dry-run)
 *   node scripts/backfill-agregado-pool.js --aplicar    # escribe
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const AG = require("../src/domain/agregadoPool");

const APLICAR = process.argv.includes("--aplicar");

(async () => {
  const db = admin.firestore();
  console.log(APLICAR ? "Modo: APLICAR (escribe)\n" : "Modo: verificación (no escribe)\n");

  const R = await AG.recalcular(db, { aplicar: APLICAR });

  console.log(`Fichas leídas del pool : ${R.fichas.toLocaleString()}`);
  console.log(`Modelos en el resumen  : ${R.modelos.toLocaleString()}`);
  console.log();

  if (R.ok) {
    console.log("El resumen cuadra con el pool: sin diferencias.");
  } else {
    console.log(`Diferencias: ${R.difs.length}   ·   Modelos sobrantes: ${R.sobrantes.length}`);
    if (R.difs.length) {
      console.log("\n  modelo / estado                                 tenía    real");
      for (const d of R.difs.slice(0, 40)) {
        console.log(`  ${(d.key + " / " + d.estado).padEnd(46)} ${String(d.tenia).padStart(6)}  ${String(d.real).padStart(6)}`);
      }
      if (R.difs.length > 40) console.log(`  … y ${R.difs.length - 40} más`);
    }
    if (R.sobrantes.length) {
      console.log("\n  Sin ninguna unidad (el doc sobra):");
      R.sobrantes.slice(0, 20).forEach(k => console.log(`    ${k}`));
      if (R.sobrantes.length > 20) console.log(`    … y ${R.sobrantes.length - 20} más`);
    }
    console.log(APLICAR ? "\nYa quedaron corregidas." : "\nCorre con --aplicar para escribirlas.");
  }

  // El registro que aguanta: qué se ha corrido antes y cuántas corridas
  // limpias llevamos. Es lo que contesta "¿esto se repite?".
  const rep = (await db.collection(AG.REPORTE).doc(AG.REPORTE_DOC).get()).data();
  const meta = (await db.collection(AG.META).doc(AG.META_DOC).get()).data();
  console.log("\n── Registro de deriva (admin_reportes/agregado_pool) ──");
  if (!rep) {
    console.log("  todavía no hay ninguna corrida registrada");
  } else {
    console.log(`  última corrida       : ${rep.corrida_en || "—"}`);
    console.log(`  corridas limpias seg.: ${rep.corridas_limpias_seguidas ?? 0}`);
    console.log(`  última deriva        : ${rep.ultima_deriva_en || "nunca"}`);
    console.log(`  derivas registradas  : ${rep.derivas_registradas ?? 0}`);
    for (const h of (rep.historial || []).slice(0, 8)) {
      const q = (h.muestra || []).slice(0, 3).map(m => `${m.key}/${m.estado}`).join(", ");
      console.log(`    · ${h.en}  difs=${h.difs} sobrantes=${h.sobrantes}` +
        `${h.venia_marcado ? " [el trigger habia fallado]" : ""}${q ? "  → " + q : ""}`);
    }
  }
  if (meta && meta.deriva === true) {
    console.log(`  ¡MARCA VIVA! el trigger falló y aún no se reconcilia: ${meta.deriva_motivo || ""}`);
  }

  // El total por estado, para poder cotejarlo de un vistazo contra Existencias.
  const snap = await db.collection(AG.COL).get();
  const tot = {};
  snap.forEach(d => {
    const est = (d.data() || {}).est || {};
    for (const [e, n] of Object.entries(est)) tot[e] = (tot[e] || 0) + Number(n || 0);
  });
  if (snap.size) {
    console.log("\nTotales por estado en el resumen:");
    Object.entries(tot).sort((a, b) => b[1] - a[1])
      .forEach(([e, n]) => console.log(`  ${String(n).padStart(6)}  ${e}`));
    console.log(`  ${String(Object.values(tot).reduce((a, b) => a + b, 0)).padStart(6)}  TOTAL`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
