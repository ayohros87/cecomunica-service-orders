/**
 * fix-lineas-modelo-id.js — Sanea el `modelo_id` de las líneas de equipos[]
 * de contratos VIGENTES cuando apunta a un doc que NO existe en el catálogo
 * `modelos` (o viene vacío), re-apuntándolo al doc canónico por nombre.
 *
 * CONTEXTO (2026-08-27, caso Feduro): 419 unidades del pool no pareaban con
 * su línea porque las líneas llevan modelo_id `uYNSf5…` ("PNC360S") que no
 * existe en el catálogo — un id fantasma arrastrado por el wizard viejo. Eso
 * dejaba la tarifa/vencimiento por equipo en blanco Y rompe el cálculo de
 * factura (calcularFacturaContrato resuelve el catálogo por ese id).
 *
 * REGLAS (conservadoras):
 *  · Solo líneas cuyo modelo_id NO resuelve en el catálogo (o es null).
 *  · Candidato canónico por nombre normalizado (alfanumérico): igualdad con
 *    "marca+modelo" o con "modelo" a secas, o sufijo (la línea suele venir
 *    sin marca). Los docs -R solo casan si el nombre de la línea termina en R
 *    — NUNCA se fusiona base con refurbished (regla de inventario).
 *  · Se aplica SOLO con candidato ÚNICO; ambiguos se listan.
 *  · Se corrige el modelo_id; el TEXTO de la línea no se toca (aparece en el
 *    contrato impreso). Marker `modelos_saneados_at` en el contrato.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-lineas-modelo-id.js            # dry-run
 *   node scripts/fix-lineas-modelo-id.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  const [conSnap, modSnap] = await Promise.all([
    db.collection("contratos").get(),
    db.collection("modelos").get(),
  ]);
  const catalogo = [];
  const ids = new Set();
  modSnap.forEach((d) => {
    const m = d.data();
    ids.add(d.id);
    catalogo.push({
      id: d.id,
      full: norm(`${m.marca || ""} ${m.modelo || ""}`),
      solo: norm(m.modelo || ""),
      esR: /R$/.test(norm(m.modelo || "")) && /(-|\s)R$/i.test(String(m.modelo || "").trim()),
      label: `${(m.marca || "").trim()} ${(m.modelo || "").trim()}`.trim(),
      activo: m.activo !== false,
    });
  });

  const candidatosDe = (nombreLinea) => {
    const n = norm(nombreLinea);
    if (!n) return [];
    const quiereR = /(-|\s)?R$/i.test(String(nombreLinea).trim()) && n.endsWith("R");
    let cands = catalogo.filter((m) =>
      (m.full === n || m.solo === n || m.full.endsWith(n) || (n.length >= 5 && m.solo.endsWith(n))));
    // Base NUNCA casa con -R y viceversa (buckets de inventario separados).
    cands = cands.filter((m) => (quiereR ? m.esR : !m.esR));
    if (cands.length > 1) {
      const activos = cands.filter((m) => m.activo);
      if (activos.length === 1) return activos;
    }
    return cands;
  };

  const mapeos = new Map(); // `${idViejo||'null'}|${nombre}` → {a, label, n}
  const porContrato = [];
  const ambiguos = new Map();
  let lineasMal = 0;
  conSnap.forEach((d) => {
    const c = d.data();
    if (c.deleted || !["activo", "aprobado"].includes(c.estado)) return;
    const equipos = Array.isArray(c.equipos) ? c.equipos : [];
    const cambios = [];
    equipos.forEach((l, ix) => {
      if (l.modelo_id && ids.has(l.modelo_id)) return; // id válido: no se toca
      lineasMal++;
      const cands = candidatosDe(l.modelo);
      if (cands.length === 1) {
        cambios.push({ ix, de: l.modelo_id || null, a: cands[0].id, nombre: l.modelo, aLabel: cands[0].label });
        const k = `${l.modelo_id || "null"}|${l.modelo}`;
        if (!mapeos.has(k)) mapeos.set(k, { a: cands[0].id, label: cands[0].label, n: 0 });
        mapeos.get(k).n++;
      } else {
        const k = `${l.modelo || "?"} (id ${l.modelo_id || "null"})`;
        ambiguos.set(k, (ambiguos.get(k) || 0) + cands.length * 0 + 1);
      }
    });
    if (cambios.length) porContrato.push({ ref: d.ref, contrato: c.contrato_id || d.id, equipos, cambios });
  });

  console.log(`\n=== fix-lineas-modelo-id ${dryRun ? "(DRY-RUN)" : "(WRITE)"} ===`);
  console.log(`Líneas con modelo_id inválido/vacío (contratos vigentes): ${lineasMal}`);
  console.log(`Contratos a corregir: ${porContrato.length} · líneas: ${porContrato.reduce((s, x) => s + x.cambios.length, 0)}`);
  console.log(`\nMapeos (id viejo | nombre de línea → catálogo canónico):`);
  for (const [k, v] of [...mapeos.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`   × ${String(v.n).padStart(3)}  ${k}  →  ${v.a}  (${v.label})`);
  }
  if (ambiguos.size) {
    console.log(`\nSIN candidato único (no se tocan — revisar catálogo):`);
    for (const [k, n] of ambiguos) console.log(`   × ${n}  ${k}`);
  }

  if (dryRun) { console.log(`\nDry-run: nada escrito. --write para aplicar.`); process.exit(0); }

  let escritos = 0;
  for (const x of porContrato) {
    const equipos = x.equipos.map((l) => ({ ...l }));
    for (const ch of x.cambios) equipos[ch.ix].modelo_id = ch.a;
    await x.ref.update({
      equipos,
      modelos_saneados_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    escritos++;
  }
  console.log(`\nListo: ${escritos} contratos actualizados.`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
