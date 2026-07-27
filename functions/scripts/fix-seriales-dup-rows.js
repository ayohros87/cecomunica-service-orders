/**
 * fix-seriales-dup-rows.js — Elimina filas GEMELAS en contratos/{id}/seriales:
 * el mismo serial (por serial_norm) registrado 2+ veces en el MISMO contrato
 * (auditoría L7 2026-07-27: 13 grupos en 2 contratos, creados por doble
 * guardado — inflaban seriales_count y disparaban el trigger dos veces).
 *
 * Conserva la fila más ANTIGUA (created_at; empate → docId menor) y borra las
 * demás. REQUIERE el guard de onSerialWrite desplegado (2026-07-27): con él,
 * borrar la gemela NO libera la unidad del pool porque la fila superviviente
 * sigue listando el serial; el trigger además recalcula seriales_count como
 * seriales DISTINTOS.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-seriales-dup-rows.js            # dry-run
 *   node scripts/fix-seriales-dup-rows.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const ms = (t) => (t && typeof t.toDate === "function") ? t.toDate().getTime() : Number.MAX_SAFE_INTEGER;

(async () => {
  const snap = await db.collectionGroup("seriales").get();
  const porContrato = new Map(); // cid → Map(norm → [{ref, serial, created}])
  for (const d of snap.docs) {
    const s = d.data();
    const raw = String(s.serial || "").trim();
    if (!raw) continue;
    const norm = pool.normSerial(raw);
    if (!norm) continue;
    const cid = d.ref.parent.parent.id;
    if (!porContrato.has(cid)) porContrato.set(cid, new Map());
    const m = porContrato.get(cid);
    if (!m.has(norm)) m.set(norm, []);
    m.get(norm).push({ ref: d.ref, id: d.id, serial: raw, created: ms(s.created_at) });
  }

  let grupos = 0, borradas = 0;
  for (const [cid, m] of porContrato) {
    for (const [norm, rows] of m) {
      if (rows.length < 2) continue;
      grupos++;
      rows.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
      const [keeper, ...extras] = rows;
      console.log(`${cid} · ${norm}: conserva ${keeper.id}, borra ${extras.map(x => x.id).join(", ")}`);
      for (const x of extras) {
        borradas++;
        if (EXECUTE) await x.ref.delete();
      }
    }
  }
  console.log(`\n${EXECUTE ? "ESCRITURA" : "DRY-RUN"} — grupos: ${grupos} · filas borradas: ${borradas}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
