/**
 * fusiona-cliente-jean-simancas.js — JEAN SIMANCAS quedó con dos fichas
 * (2026-09-15). `pipw6…` es la completa (RUC, correo, teléfono, representante,
 * vendedora) y tiene el contrato SERV20260911-01 y su orden; `F3cui…` es una
 * ficha pelada que abrió recepción el 8-sep para la venta de la factura 10459
 * y es la que quedó estampada en las ventas del pool.
 *
 * Hace lo mismo que Admin · Clientes duplicados (re-apunta referencias, rellena
 * huecos del canónico, soft-delete del duplicado) MÁS lo que esa herramienta no
 * cubre: `equipos_pool.asignacion.cliente_id` y `equipos_pool.venta.cliente_id`.
 *
 * USAGE (desde functions/):
 *   node scripts/fusiona-cliente-jean-simancas.js            # dry-run
 *   node scripts/fusiona-cliente-jean-simancas.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");

const DUP = "F3cuihU2yJWJoozNtyeQ";
const CANON = "pipw6pBylrAH4mgag4DS";
const POR_EMAIL = "script:fusiona-cliente-jean-simancas-2026-09-15";

(async () => {
  const [dSnap, cSnap] = await Promise.all([
    db.collection("clientes").doc(DUP).get(),
    db.collection("clientes").doc(CANON).get(),
  ]);
  if (!dSnap.exists || !cSnap.exists) throw new Error("falta una de las dos fichas");
  const dup = dSnap.data(), canon = cSnap.data();
  if (dup.deleted === true) throw new Error("el duplicado ya está borrado");
  if ((dup.nombre || "").trim().toUpperCase() !== (canon.nombre || "").trim().toUpperCase()) {
    throw new Error(`nombres distintos: "${dup.nombre}" vs "${canon.nombre}"`);
  }
  console.log(`Canónico: ${CANON} · ${canon.nombre} · RUC ${canon.ruc || "—"}`);
  console.log(`Duplicado: ${DUP} · ${dup.nombre} · RUC ${dup.ruc || "—"}\n`);

  // ── Qué se va a tocar ───────────────────────────────────────────────────
  const ordenes = (await db.collection("ordenes_de_servicio").where("cliente_id", "==", DUP).get()).docs;
  const pool = (await db.collection("equipos_pool").get()).docs
    .filter(d => { const x = d.data(); return x.asignacion?.cliente_id === DUP || x.venta?.cliente_id === DUP; });
  // Huecos del canónico que el duplicado puede rellenar.
  const fill = {};
  if (!Array.isArray(canon.poc_grupos) || !canon.poc_grupos.length) {
    if (Array.isArray(dup.poc_grupos) && dup.poc_grupos.length) fill.poc_grupos = dup.poc_grupos;
  }

  ordenes.forEach(d => console.log(`  orden  ${d.id} → cliente_id al canónico`));
  pool.forEach(d => {
    const x = d.data();
    const q = [x.asignacion?.cliente_id === DUP ? "asignacion" : null,
               x.venta?.cliente_id === DUP ? "venta" : null].filter(Boolean).join(" + ");
    console.log(`  pool   ${d.id} (${x.modelo_label || "?"}) → ${q}`);
  });
  if (Object.keys(fill).length) console.log(`  canon  rellena: ${JSON.stringify(fill)}`);
  console.log(`  dup    ${DUP} → deleted:true, merged_into:${CANON}`);

  if (!APPLY) { console.log("\nDRY-RUN. Corre con --apply para escribir."); return; }

  const ahora = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  for (const d of ordenes) {
    batch.update(d.ref, { cliente_id: CANON, cliente_nombre: canon.nombre, updated_at: ahora });
  }
  for (const d of pool) {
    const x = d.data();
    const u = { updated_at: ahora, updated_by_email: POR_EMAIL };
    if (x.asignacion?.cliente_id === DUP) {
      u["asignacion.cliente_id"] = CANON; u["asignacion.cliente_nombre"] = canon.nombre;
    }
    if (x.venta?.cliente_id === DUP) {
      u["venta.cliente_id"] = CANON; u["venta.cliente_nombre"] = canon.nombre;
    }
    batch.update(d.ref, u);
  }
  if (Object.keys(fill).length) {
    batch.update(cSnap.ref, { ...fill, updated_at: ahora, updated_by_email: POR_EMAIL });
  }
  batch.update(dSnap.ref, {
    deleted: true, activo: false, merged_into: CANON, merged_at: ahora,
    merged_by: null, merged_by_email: POR_EMAIL, updated_at: ahora, updated_by_email: POR_EMAIL,
  });
  await batch.commit();
  console.log(`\nHECHO: ${ordenes.length} orden(es), ${pool.length} unidad(es) del pool, duplicado cerrado.`);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
