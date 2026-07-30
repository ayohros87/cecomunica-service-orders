/**
 * mueve-a-por-clasificar-lista.js — Manda a `por_clasificar` una lista puntual
 * de seriales. Es el hermano a-mano de mueve-a-por-clasificar.js, que trabaja
 * por reglas masivas: acá los casos los eligió una persona.
 *
 * `por_clasificar` NO es una ubicación física: es la bandeja de "hay que ir a
 * buscar este radio". Sale por donde corresponda — a bodega si aparece en el
 * estante, o asignada si se confirma con un cliente. La asignación se CONSERVA
 * porque es la única pista de dónde buscarlo; el estado ya dice que la
 * ubicación se desconoce.
 *
 * Caso típico: un conteo físico devuelve N unidades y el sistema esperaba N+1
 * — la que no apareció no está "con el cliente", está sin ubicar.
 *
 * No toca estados terminales (baja, vendido): ahí la ficha ya cerró su ciclo
 * y moverla sería inventar una unidad. Los reporta y sigue.
 *
 * USAGE (desde functions/):
 *   node scripts/mueve-a-por-clasificar-lista.js <archivo.txt> [--motivo="..."]
 *                                                [--write] [--email=..]
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
  || "script:mueve-a-por-clasificar-lista";
const MOTIVO  = (process.argv.find((a) => a.startsWith("--motivo=")) || "").split("=").slice(1).join("=")
  || "Ubicación sin respaldo: revisión manual";
const TERMINALES = new Set([pool.ESTADOS.BAJA, pool.ESTADOS.VENDIDO]);

(async () => {
  if (!ARCHIVO) throw new Error("USAGE: <archivo.txt> [--motivo=..] [--write]");
  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  console.log(`motivo: ${MOTIVO}`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const r = { movidas: 0, yaEstaban: 0, terminales: 0, sinFicha: 0 };
  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  for (const norm of seriales) {
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    if (snap.empty) { r.sinFicha++; console.log(`  ${norm}  SIN FICHA — se omite`); continue; }

    for (const doc of snap.docs) {
      const v = doc.data();
      if (v.estado === pool.ESTADOS.POR_CLASIFICAR) { r.yaEstaban++; continue; }
      if (TERMINALES.has(v.estado)) {
        r.terminales++;
        console.log(`  ${norm}  estado terminal "${v.estado}" — NO se toca`);
        continue;
      }
      if (!dryRun) {
        batch.update(doc.ref, {
          estado: pool.ESTADOS.POR_CLASIFICAR,
          verificado: false,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by_email: EMAIL,
        });
        batch.set(doc.ref.collection("movimientos").doc(), {
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: EMAIL,
          tipo: "reclasificacion", de_estado: v.estado || null,
          a_estado: pool.ESTADOS.POR_CLASIFICAR, ref: null, notas: MOTIVO,
        });
        ops += 2;
        if (ops >= 400) await flush();
      }
      r.movidas++;
      console.log(`  ${norm}  ${v.estado} → por_clasificar` +
        (v.asignacion?.cliente_nombre ? ` (figuraba con ${v.asignacion.cliente_nombre})` : ""));
    }
  }
  await flush();

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`movidas a por_clasificar: ${r.movidas}`);
  console.log(`ya estaban:               ${r.yaEstaban}`);
  console.log(`estado terminal (omitidas): ${r.terminales}`);
  console.log(`sin ficha:                ${r.sinFicha}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
