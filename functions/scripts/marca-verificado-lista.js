/**
 * marca-verificado-lista.js — Marca `verificado: true` las fichas de una lista
 * de seriales en equipos_pool.
 *
 * `verificado` significa "un humano confirmó esta ficha contra el equipo
 * físico". Nace en false porque la siembra del pool fue automática, y los
 * flujos que devuelven una unidad a bodega lo vuelven a poner en false (la
 * unidad regresó, hay que volver a mirarla) — por eso las 99 de la hoja
 * PNC360S quedaron sin verificar tras pasarlas a bodega el 2026-07-28, aunque
 * bodega SÍ había revisado el estante.
 *
 * Escribe los mismos campos que el botón "Verificar" de Equipos por serial
 * (EquiposPoolService.verificar): verificado + autoría.
 *
 * USAGE (desde functions/):
 *   node scripts/marca-verificado-lista.js <archivo.txt> [--write] [--email=quien@..]
 * Idempotente.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ARCHIVO = process.argv[2];
const dryRun  = !process.argv.includes("--write");
const EMAIL   = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:marca-verificado-lista";

(async () => {
  if (!ARCHIVO) throw new Error("Falta el archivo de seriales");
  const seriales = fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => s.trim()).filter(Boolean);

  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const r = { yaVerificados: 0, marcados: 0, sinFicha: 0 };
  const detalle = [];
  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  for (const raw of seriales) {
    const norm = pool.normSerial(raw);
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    if (snap.empty) { r.sinFicha++; console.log(`!! sin ficha: ${raw}`); continue; }

    for (const doc of snap.docs) {
      const v = doc.data();
      if (v.verificado === true) { r.yaVerificados++; continue; }
      if (!dryRun) {
        batch.update(doc.ref, {
          verificado: true,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: null,
          updated_by_email: EMAIL,
        });
        ops++;
        if (ops >= 400) await flush();
      }
      r.marcados++;
      detalle.push({ serial: raw, estado: v.estado || "", modelo: v.modelo_label || "(sin modelo)" });
    }
  }
  await flush();

  console.log(`--- ${detalle.length} fichas a marcar como verificadas ---`);
  detalle.slice(0, 20).forEach((d) =>
    console.log(`  ${d.serial.padEnd(12)} ${d.estado.padEnd(20)} ${d.modelo}`));
  if (detalle.length > 20) console.log(`  …y ${detalle.length - 20} más`);

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`ya estaban verificados: ${r.yaVerificados}`);
  console.log(`marcados ahora:         ${r.marcados}`);
  if (r.sinFicha) console.log(`sin ficha (revisar):    ${r.sinFicha}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
