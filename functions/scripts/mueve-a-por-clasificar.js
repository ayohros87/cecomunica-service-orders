/**
 * mueve-a-por-clasificar.js — Pasa a `por_clasificar` las unidades que figuran
 * en_cliente sin nada que respalde esa ubicación.
 *
 * `por_clasificar` NO es una ubicación física: es la bandeja de "hay que ir a
 * buscar este radio". Sale por donde corresponda — a bodega si aparece en el
 * estante, o asignada si se confirma con un cliente.
 *
 * DOS REGLAS (decisión del usuario 2026-07-28):
 *   A) Las unidades cuyo ÚLTIMO evento fue una orden de ENTRADA cerrada por
 *      error como "ENTREGADO AL CLIENTE" (ver fix-entradas-mal-cerradas.js).
 *      Volvieron al taller y el sistema las mandó al cliente.
 *   B) en_cliente + origen `migracion_poc` + SIN contrato asignado + SIN
 *      ninguna orden de servicio. La migración de POC infirió el cliente del
 *      device, sin respaldo documental.
 *
 * NOTA sobre la regla B: 1040 de esas unidades tienen el device POC ACTIVO,
 * o sea airtime vivo — evidencia razonable de que SÍ están con ese cliente. Se
 * planteó respetarlas y el usuario decidió moverlas igual (2026-07-28). Queda
 * dicho para que el número no sorprenda: la bandeja nace grande.
 *
 * USAGE (desde functions/):
 *   node scripts/mueve-a-por-clasificar.js <csv-regla-A> [--write]
 * Idempotente.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const CSV_A  = process.argv[2];
const dryRun = !process.argv.includes("--write");
const AUTOR  = "script:mueve-a-por-clasificar";

(async () => {
  // Seriales con alguna orden de servicio viva (regla B).
  const conOrden = new Set();
  (await db.collection("ordenes_de_servicio").get()).forEach((d) => {
    const v = d.data();
    if (v.eliminado === true) return;
    for (const e of (v.equipos || [])) {
      if (e?.eliminado) continue;
      const s = pool.normSerial(e?.serial || e?.SERIAL || e?.numero_de_serie || "");
      if (s) conOrden.add(s);
    }
  });

  // Regla A: seriales del CSV de entradas mal cerradas.
  const setA = new Set();
  if (CSV_A && fs.existsSync(CSV_A)) {
    fs.readFileSync(CSV_A, "utf8").split(/\r?\n/).filter(Boolean).slice(1).forEach((l) => {
      const s = (l.match(/"(?:[^"]|"")*"/g) || [])[0]?.slice(1, -1);
      if (s) setA.add(s);
    });
  }
  console.log(`regla A: ${setA.size} seriales del CSV`);

  const snap = await db.collection("equipos_pool").get();
  const objetivo = [];
  snap.forEach((d) => {
    const v = d.data();
    if (v.estado !== pool.ESTADOS.EN_CLIENTE) return;
    const esA = setA.has(v.serial_norm);
    const esB = v.origen === "migracion_poc"
      && !(v.asignacion && v.asignacion.contrato_doc_id)
      && !conOrden.has(v.serial_norm);
    if (!esA && !esB) return;
    objetivo.push({ ref: d.ref, id: d.id, serial: v.serial_norm,
      regla: esA ? (esB ? "A+B" : "A") : "B",
      cliente: v.asignacion?.cliente_nombre || "" });
  });

  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***" : "\n*** ESCRIBIENDO ***");
  const porRegla = {};
  objetivo.forEach((o) => { porRegla[o.regla] = (porRegla[o.regla] || 0) + 1; });

  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  for (const o of objetivo) {
    if (!dryRun) {
      batch.update(o.ref, {
        estado: pool.ESTADOS.POR_CLASIFICAR,
        // La asignación se conserva: es la ÚNICA pista de dónde buscar el
        // radio. No es una afirmación de ubicación — el estado ya dice que se
        // desconoce.
        verificado: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by_email: AUTOR,
      });
      batch.set(o.ref.collection("movimientos").doc(), {
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: AUTOR,
        tipo: "reclasificacion", de_estado: pool.ESTADOS.EN_CLIENTE,
        a_estado: pool.ESTADOS.POR_CLASIFICAR, ref: null,
        notas: o.regla === "B"
          ? "Ubicación sin respaldo: venía de migración POC, sin contrato ni orden de servicio"
          : "Ubicación sin respaldo: su último evento fue una ENTRADA cerrada por error como entregada al cliente",
      });
      ops += 2;
      if (ops >= 400) await flush();
    }
  }
  await flush();

  console.log(`\n=== ${objetivo.length} unidades a por_clasificar ===`);
  Object.entries(porRegla).sort().forEach(([k, v]) => console.log(`  regla ${k}: ${v}`));
  console.log("\nmuestra:");
  objetivo.slice(0, 10).forEach((o) => console.log(`  ${o.serial.padEnd(12)} [${o.regla}] ${o.cliente}`));
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
