/**
 * diagnostico-bandeja-hoy.js — SOLO LECTURA. Reproduce los conteos de la
 * bandeja Almacén · Hoy contra producción para explicar números altos:
 * de dónde sale cada cola del pool (con antigüedad y origen) y cuántas
 * "diferencias de conteo" hay y qué tan viejos son esos conteos.
 *
 * USAGE (desde functions/): node scripts/diagnostico-bandeja-hoy.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const tight = (l) => (l || "").toString().toLowerCase()
  // eslint-disable-next-line no-control-regex -- intencional: recorta lo no-ASCII
  .normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "");
const dias = (ts) => ts && ts.toMillis ? Math.floor((Date.now() - ts.toMillis()) / 86400000) : null;
const bucketDias = (d) => d == null ? "sin fecha" : d <= 7 ? "≤7d" : d <= 30 ? "8-30d" : d <= 90 ? "31-90d" : ">90d";

(async () => {
  // ── 1. Pool por estado ──────────────────────────────────────────────────
  const pool = (await db.collection("equipos_pool").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const porEstado = {};
  for (const e of pool) porEstado[e.estado || "(sin estado)"] = (porEstado[e.estado || "(sin estado)"] || 0) + 1;
  console.log(`\n== equipos_pool: ${pool.length} docs ==`);
  Object.entries(porEstado).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k}: ${n}`));

  // ── 2. Cuarentena (devuelto_revision): edad y origen ────────────────────
  const dev = pool.filter((e) => e.estado === "devuelto_revision");
  const edadDev = {}, origenDev = {};
  for (const e of dev) {
    edadDev[bucketDias(dias(e.updated_at))] = (edadDev[bucketDias(dias(e.updated_at))] || 0) + 1;
    origenDev[e.origen || "(sin origen)"] = (origenDev[e.origen || "(sin origen)"] || 0) + 1;
  }
  console.log(`\n== devuelto_revision: ${dev.length} ==`);
  console.log("  por edad (updated_at):", JSON.stringify(edadDev));
  console.log("  por origen:", JSON.stringify(origenDev));

  // ── 3. Por clasificar ───────────────────────────────────────────────────
  const cla = pool.filter((e) => e.estado === "por_clasificar");
  const porModeloCla = {};
  for (const e of cla) porModeloCla[e.modelo_label || "?"] = (porModeloCla[e.modelo_label || "?"] || 0) + 1;
  console.log(`\n== por_clasificar: ${cla.length} ==`, JSON.stringify(porModeloCla));

  // ── 4. Conflictos (predicado de la bandeja) ─────────────────────────────
  const compartidos = pool.filter((e) => e.serial_compartido === true);
  const porNorm = new Map();
  for (const e of compartidos) {
    const k = e.serial_norm || (e.id || "").split("__")[0];
    if (!porNorm.has(k)) porNorm.set(k, []);
    porNorm.get(k).push(e);
  }
  let grupos = 0, revisados = 0;
  for (const [, docs] of porNorm) {
    if (docs.length < 2) continue;
    if (docs.every((d) => d.conflicto_revisado === true)) { revisados++; continue; }
    grupos++;
  }
  console.log(`\n== conflictos: ${compartidos.length} docs serial_compartido → ${grupos} grupos pendientes (${revisados} ya revisados) ==`);

  // ── 5. Sin verificar ────────────────────────────────────────────────────
  console.log(`\n== verificado==false: ${pool.filter((e) => e.verificado === false).length} ==`);

  // ── 6. Diferencias de conteo (mismo join de StockAgg) ───────────────────
  const [modelosSnap, conteosSnap] = await Promise.all([
    db.collection("modelos").get(),
    db.collection("inventario_actual").get(),
  ]);
  const modelos = {}; // solo activos, como StockAgg.build
  modelosSnap.docs.forEach((d) => { const v = d.data(); if (v.activo !== false) modelos[d.id] = v; });
  const bodega = pool.filter((e) => e.estado === "en_bodega");
  const porId = new Map(), porLabel = new Map();
  for (const e of bodega) {
    const kId = e.modelo_id || null, kL = tight(e.modelo_label);
    if (kId) porId.set(kId, (porId.get(kId) || 0) + 1);
    else if (kL) porLabel.set(kL, (porLabel.get(kL) || 0) + 1);
  }
  const difs = [];
  conteosSnap.docs.forEach((d) => {
    const m = modelos[d.id];
    if (!m) return;                          // conteo de modelo inactivo/borrado
    const c = d.data();
    const n = (porId.get(d.id) || 0) + (porLabel.get(tight(m.modelo || "")) || 0);
    const dif = n - Number(c.cantidad ?? 0);
    if (dif !== 0) difs.push({ modelo: m.modelo, pool: n, conteo: c.cantidad ?? 0, dif, edadConteo: dias(c.ultima_actualizacion) });
  });
  difs.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
  const porEdadConteo = {};
  difs.forEach((f) => { porEdadConteo[bucketDias(f.edadConteo)] = (porEdadConteo[bucketDias(f.edadConteo)] || 0) + 1; });
  console.log(`\n== diferencias (dif != 0): ${difs.length} modelos ==`);
  console.log("  por edad del ÚLTIMO CONTEO:", JSON.stringify(porEdadConteo));
  console.log("  top 15 por |dif|:");
  difs.slice(0, 15).forEach((f) =>
    console.log(`    ${String(f.modelo).padEnd(22)} pool ${String(f.pool).padStart(4)} vs conteo ${String(f.conteo).padStart(4)} → ${f.dif > 0 ? "+" : ""}${f.dif}  (conteo hace ${f.edadConteo ?? "?"}d)`));

  const totalBandejaPool = dev.length + cla.length + grupos;
  console.log(`\n== TOTAL grupo "Del pool" que pinta la bandeja: ${dev.length} + ${cla.length} + ${grupos} = ${totalBandejaPool} ==`);
  console.log(`== TOTAL grupo "De conteos": ${difs.length} ==`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
