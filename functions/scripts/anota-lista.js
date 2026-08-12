/**
 * anota-lista.js — Estampa una nota en las fichas del pool de una lista de
 * seriales, y la deja también en el kardex de cada una.
 *
 * Existe para lo que un conteo físico observa pero el pool no modela: el caso
 * que lo motivó son las bases TM-7PLUS que bodega contó marcadas "DAÑADA"
 * (2026-08-12). El radio ESTÁ en el estante —así que va a `en_bodega` como
 * cualquier otro— pero no sirve, y esa condición no cabe en `estado`: dañado
 * no es una ubicación. Darlo de baja lo sacaría del pool y es una decisión de
 * negocio que nadie tomó; `en_taller` mentiría sobre dónde está.
 *
 * `notas` se PISA, no se concatena: es el campo que la ficha muestra tal cual.
 * Correr dos veces con la misma nota no cambia nada (idempotente); correrlo con
 * otra nota reemplaza la anterior, y el rastro de ambas queda en el kardex.
 *
 * CANDADO: si el serial tiene varias fichas hay que decir a cuál —- con
 * `--modelo=<modelo_id>`. Sin eso, un serial compartido entre modelos (Kenwood
 * NX-420/NX-920 y compañía) se anotaría por partida doble.
 *
 * USAGE (desde functions/):
 *   node scripts/anota-lista.js <archivo.txt> "<nota>" [--write] [--modelo=<id>] [--email=..]
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ARCHIVO = process.argv[2];
const NOTA    = process.argv[3];
const dryRun  = !process.argv.includes("--write");
const MODELO  = (process.argv.find((a) => a.startsWith("--modelo=")) || "").split("=")[1] || "";
const EMAIL   = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:anota-lista";

(async () => {
  if (!ARCHIVO || !NOTA) throw new Error('USAGE: <archivo.txt> "<nota>" [--write] [--modelo=<id>]');
  console.log(`Nota: "${NOTA}"${MODELO ? `  ·  solo fichas del modelo ${MODELO}` : ""}`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  const r = { anotadas: 0, sinCambio: 0, sinFicha: 0, ambiguas: 0 };
  for (const norm of seriales) {
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    if (snap.empty) { r.sinFicha++; console.log(`  !! sin ficha: ${norm}`); continue; }

    const docs = MODELO ? snap.docs.filter((d) => d.data().modelo_id === MODELO) : snap.docs;
    if (!docs.length) { r.sinFicha++; console.log(`  !! ${norm} no tiene ficha del modelo ${MODELO}`); continue; }
    if (docs.length > 1) {
      r.ambiguas++;
      console.log(`  AMBIGUO ${norm}: ${docs.length} fichas (${docs.map((d) => d.data().modelo_label || "?").join(" | ")})`
        + " — usar --modelo=<id> para elegir");
      continue;
    }

    const doc = docs[0];
    const v = doc.data();
    if ((v.notas || "") === NOTA) { r.sinCambio++; continue; }
    console.log(`  ${norm} [${doc.id}] ${v.modelo_label || "(sin modelo)"} · ${v.estado}`
      + `   notas: "${v.notas || ""}" → "${NOTA}"`);
    if (!dryRun) {
      await doc.ref.set({
        notas: NOTA,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by_email: EMAIL,
      }, { merge: true });
      await doc.ref.collection("movimientos").doc().set({
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: EMAIL,
        tipo: "nota", de_estado: v.estado || null, a_estado: v.estado || null, ref: null,
        notas: NOTA + (v.notas ? ` (antes: "${v.notas}")` : ""),
      });
    }
    r.anotadas++;
  }

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`anotadas:   ${r.anotadas}`);
  console.log(`sin cambio: ${r.sinCambio}`);
  if (r.ambiguas) console.log(`ambiguas (varias fichas): ${r.ambiguas}`);
  if (r.sinFicha) console.log(`sin ficha:  ${r.sinFicha}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
