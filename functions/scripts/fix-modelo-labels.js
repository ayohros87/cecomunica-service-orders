/**
 * fix-modelo-labels.js — Normaliza el label de modelo al CANÓNICO del catálogo
 * (`${marca} ${modelo}`, ej. "HYTERA PNC360S") en poc_devices y equipos_pool.
 *
 * Casos:
 *   1. Doc CON modelo_id → modelo_label = label canónico de esa fila (si difiere).
 *   2. Doc SIN modelo_id → resuelve la fila del catálogo por label tolerante
 *      (base sin marca/sufijo -R) exigiendo: candidato ÚNICO tras filtrar por
 *      variante (label con -R ↔ fila estado R). Si resuelve → escribe
 *      modelo_id + modelo_label. Ambiguo o sin match → se reporta, no se toca.
 * Aditivo (el texto libre legacy `modelo` de poc_devices NO se toca — misma
 * convención que el backfill linkModeloIdPoc). Idempotente.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-modelo-labels.js            # dry-run
 *   node scripts/fix-modelo-labels.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");

const tight = (s) => (s || "").toString().toLowerCase()
  // eslint-disable-next-line no-control-regex -- intencional: recorta todo lo no-ASCII
  .normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "");
// Variante reuso por el NOMBRE (no por el campo estado del catálogo, que a
// veces está mal): "-R", " R" o la R pegada al número ("PNC360R").
const esR = (label) => /[\d\s-]r$/i.test((label || "").toString().trim());
const base = (label) => tight(label).replace(/r$/, "");

(async () => {
  const [modelosSnap, pocSnap, poolSnap] = await Promise.all([
    db.collection("modelos").get(),
    db.collection("poc_devices").get(),
    db.collection("equipos_pool").get(),
  ]);

  // Catálogo: byId + índice por base de label (y de aliases) para resolución.
  const porId = new Map();
  const entradas = []; // { b: base, row, r: esR del texto que originó la entrada }
  modelosSnap.forEach((d) => {
    const m = d.data();
    const label = `${m.marca || ""} ${m.modelo || ""}`.trim();
    const row = { id: d.id, label };
    porId.set(d.id, row);
    if (base(label)) entradas.push({ b: base(label), row, r: esR(label) });
    for (const a of (m.aliases || [])) {
      if (base(a)) entradas.push({ b: base(a), row, r: esR(a) });
    }
  });

  // Resuelve la fila única para un label sin FK:
  //   1. candidatos por contención de base (label o alias del catálogo)
  //   2. filtra por variante N/R según el SUFIJO del nombre
  //   3. si la variante no existe pero la familia tiene UNA sola fila, se
  //      adopta (catálogos con solo la fila -R: TK-3000-R, BD506U-R, …)
  const resolver = (label) => {
    const lb = base(label);
    if (!lb || lb.length < 3) return null;
    const candidatos = entradas.filter((e) => e.b === lb || e.b.endsWith(lb) || e.b.includes(lb));
    if (!candidatos.length) return null;
    const variante = esR(label);
    const filtrados = candidatos.filter((e) => e.r === variante);
    const unicos = (arr) => [...new Map(arr.map((e) => [e.row.id, e.row])).values()];
    const porVariante = unicos(filtrados);
    if (porVariante.length === 1) return porVariante[0];
    if (porVariante.length === 0) {
      const familia = unicos(candidatos);
      if (familia.length === 1) return familia[0];
    }
    return null;
  };

  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };
  const sinResolver = new Map(); // label → count

  // fuenteLabel(v): de dónde sale el texto a resolver cuando no hay FK.
  // extraRow(v): fila del catálogo aportada por otra vía (pool ← device POC).
  const procesar = async (snap, conteo, { fuenteLabel, extraRow = () => null }) => {
    for (const doc of snap.docs) {
      const v = doc.data();
      if (v.deleted === true) continue;
      const actual = (v.modelo_label || "").toString().trim();
      let row = v.modelo_id ? porId.get(v.modelo_id) : null;
      const update = {};
      if (!row) row = extraRow(v);
      if (!row) {
        const texto = (fuenteLabel(v) || "").toString().trim();
        if (!texto) { conteo.sinLabel++; continue; }
        row = resolver(texto);
        if (!row) {
          conteo.sinResolver++;
          sinResolver.set(texto, (sinResolver.get(texto) || 0) + 1);
          continue;
        }
      }
      if (!v.modelo_id || v.modelo_id !== row.id) { update.modelo_id = row.id; conteo.fkResuelto++; }
      if (actual !== row.label) { update.modelo_label = row.label; conteo.labelCorregido++; }
      if (!Object.keys(update).length) { conteo.ok++; continue; }
      update.updated_at = admin.firestore.FieldValue.serverTimestamp();
      batch.update(doc.ref, update);
      ops++;
      if (ops >= 400) await flush();
    }
    await flush();
  };

  const rPoc = { labelCorregido: 0, fkResuelto: 0, sinResolver: 0, sinLabel: 0, ok: 0 };
  const rPool = { labelCorregido: 0, fkResuelto: 0, sinResolver: 0, sinLabel: 0, ok: 0 };
  // POC: sin FK, el texto sale de modelo_label o del texto libre legacy `modelo`.
  await procesar(pocSnap, rPoc, { fuenteLabel: (v) => v.modelo_label || v.modelo });

  // Pool: hereda la fila del device POC vinculado (ya corregido arriba) cuando
  // no tiene FK propia; si no, resuelve por su propio label.
  const rowDeDevice = new Map(); // deviceId → row
  pocSnap.forEach((d) => {
    const v = d.data();
    if (v.deleted === true) return;
    const row = v.modelo_id ? porId.get(v.modelo_id) : resolver(v.modelo_label || v.modelo || "");
    if (row) rowDeDevice.set(d.id, row);
  });
  await procesar(poolSnap, rPool, {
    fuenteLabel: (v) => v.modelo_label,
    extraRow: (v) => (v.poc_device_id ? rowDeDevice.get(v.poc_device_id) || null : null),
  });

  console.log(`fix-modelo-labels — ${dryRun ? "DRY-RUN" : "ESCRITURA REAL"}`);
  console.log("poc_devices:", JSON.stringify(rPoc));
  console.log("equipos_pool:", JSON.stringify(rPool));
  const top = [...sinResolver.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (top.length) console.log("Sin resolver (top):", top.map(([l, n]) => `${l} ×${n}`).join(" | "));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
