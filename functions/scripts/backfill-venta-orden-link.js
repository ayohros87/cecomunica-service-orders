/**
 * backfill-venta-orden-link.js — Amarra ventas huérfanas a su orden de
 * PROGRAMACIÓN ya existente (fix 2026-07-27): fichas `vendido` con
 * venta.orden_programacion_id == null cuyo serial YA aparece en una orden de
 * PROGRAMACIÓN no eliminada del MISMO cliente. Sin el enlace, el feed del
 * home sugiere crear una orden que ya existe, para siempre.
 *
 * A futuro lo hace onOrdenWritePool por contacto; este script limpia el
 * rezago actual (ventas registradas después de crear la orden a mano).
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-venta-orden-link.js            # dry-run
 *   node scripts/backfill-venta-orden-link.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");

(async () => {
  const snap = await db.collection("equipos_pool")
    .where("estado", "==", "vendido")
    .where("venta.orden_programacion_id", "==", null).get();
  if (!snap.size) { console.log("Sin ventas huérfanas."); return; }
  console.log(`Fichas vendido sin orden amarrada: ${snap.size} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}`);

  // Índice serial_norm → órdenes PROGRAMACIÓN vivas (más reciente primero).
  const ordSnap = await db.collection("ordenes_de_servicio")
    .orderBy("fecha_creacion", "desc").limit(1500).get();
  const porSerial = new Map();
  for (const d of ordSnap.docs) {
    const o = d.data();
    if (o.eliminado === true) continue;
    if (!String(o.tipo_de_servicio || "").toUpperCase().includes("PROGRAMA")) continue;
    for (const e of (o.equipos || [])) {
      if (e && e.eliminado) continue;
      const n = pool.normSerial((e && (e.numero_de_serie || e.serial)) || "");
      if (!n) continue;
      if (!porSerial.has(n)) porSerial.set(n, []);
      porSerial.get(n).push({ id: d.id, cliente_id: o.cliente_id || "", estado: o.estado_reparacion || "" });
    }
  }

  let amarradas = 0, sinCandidata = 0;
  for (const d of snap.docs) {
    const u = d.data();
    const n = u.serial_norm || d.id;
    const cv = u.venta?.cliente_id || "";
    const candidatas = (porSerial.get(n) || [])
      .filter((o) => !cv || !o.cliente_id || o.cliente_id === cv);
    if (!candidatas.length) {
      sinCandidata++;
      console.log(`  ${u.serial}: sin orden de PROGRAMACIÓN candidata — la sugerencia del feed sigue (correcto)`);
      continue;
    }
    const orden = candidatas[0]; // la más reciente
    console.log(`  ${u.serial} → orden ${orden.id} [${orden.estado}]`);
    amarradas++;
    if (EXECUTE) {
      await d.ref.set({ venta: { orden_programacion_id: orden.id } }, { merge: true });
    }
  }
  console.log(`\n${EXECUTE ? "ESCRITURA" : "DRY-RUN"} — amarradas: ${amarradas} · sin candidata: ${sinCandidata}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
