/**
 * backfill-unit-id-num.js — Sanea unit_id en TODA la colección poc_devices:
 *   1. unit_id numérico → string (el import de Excel escribía numbers y
 *      Firestore ordena por tipo primero, partiendo la lista en dos bloques).
 *   2. Estampa unit_id_num (espejo numérico, int|null) en TODOS los docs —
 *      la lista POC ordena por este campo desde 2026-07-21; un doc sin el
 *      campo desaparecería del orderBy.
 * Idempotente: solo escribe docs cuyo unit_id/unit_id_num difiere del target.
 * No toca updated_at (saneo técnico, no edición de negocio). El trigger
 * onPocDeviceWritePool hace no-op cuando el serial no cambia.
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-unit-id-num.js            # dry-run
 *   node scripts/backfill-unit-id-num.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");

const unitIdNum = (v) => {
  const s = (v ?? "").toString().trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
};

(async () => {
  const snap = await db.collection("poc_devices").get();
  console.log(`poc_devices total: ${snap.size} docs${dryRun ? "  [DRY-RUN]" : ""}`);

  const targets = [];
  let numericos = 0;
  const porCliente = new Map();
  snap.forEach((doc) => {
    const v = doc.data();
    const raw = v.unit_id;
    const strTarget = (raw ?? "").toString().trim();
    const numTarget = unitIdNum(strTarget);
    const update = {};
    if (typeof raw === "number" || (typeof raw === "string" && raw !== strTarget)) {
      update.unit_id = strTarget;
      if (typeof raw === "number") numericos++;
    }
    if (!("unit_id_num" in v) || (v.unit_id_num !== numTarget)) {
      update.unit_id_num = numTarget;
    }
    if (Object.keys(update).length) {
      targets.push({ id: doc.id, update });
      const cli = v.cliente_nombre || v.cliente || "(sin cliente)";
      porCliente.set(cli, (porCliente.get(cli) || 0) + 1);
    }
  });

  console.log(`Docs a tocar: ${targets.length} (unit_id numérico→string: ${numericos})`);
  console.log("\nPor cliente:");
  Array.from(porCliente.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`  ${String(n).padStart(5)}  ${c}`));

  if (dryRun) {
    console.log("\nDRY-RUN: no se escribió nada. Corre con --write para aplicar.");
    process.exit(0);
  }

  const CHUNK = 450;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = db.batch();
    for (const t of targets.slice(i, i + CHUNK)) {
      batch.update(db.collection("poc_devices").doc(t.id), t.update);
    }
    await batch.commit();
    console.log(`  escrito ${Math.min(i + CHUNK, targets.length)}/${targets.length}`);
  }
  console.log("Backfill completado.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
