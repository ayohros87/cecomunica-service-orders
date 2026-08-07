/**
 * marca-radios-distintos.js — Cierra la cola de Conflictos para seriales que
 * bodega confirmó como DOS RADIOS FÍSICOS distintos.
 *
 * Un serial con 2+ fichas puede ser una de dos cosas, y se ven idénticas:
 *   · el mismo radio con el modelo mal capturado → la ficha aparte duplica el
 *     inventario (se resuelve fusionando: merge-pool-duplicados.js);
 *   · dos radios distintos que comparten numeración → las dos fichas son
 *     correctas. Kenwood reusa la serie entre el portátil (NX-420) y la base /
 *     móvil (NX-920): B3900146 existe en ambos, confirmado por bodega el
 *     2026-08-07 con los equipos a la vista.
 *
 * Escribe lo mismo que el botón "Son distintos" de la cola de Conflictos
 * (`conflicto_revisado: true`) y además deja movimiento en el kardex — el botón
 * no lo deja, y sin la nota nadie sabe en qué se basó la decisión.
 *
 * Sale de la cola pero conserva el aviso "2+ MODELOS" en la ficha.
 *
 * USAGE (desde functions/):
 *   node scripts/marca-radios-distintos.js <serial>[,<serial>...] [--write]
 *        [--motivo="..."] [--email=quien@..]
 * Idempotente.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const LISTA  = (process.argv[2] || "").split(",").map((s) => pool.normSerial(s)).filter(Boolean);
const dryRun = !process.argv.includes("--write");
const MOTIVO = (process.argv.find((a) => a.startsWith("--motivo=")) || "").split("=").slice(1).join("=")
  || "Bodega confirmó con los equipos a la vista que son radios físicos distintos";
const EMAIL  = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:marca-radios-distintos";

(async () => {
  if (!LISTA.length) throw new Error("USAGE: <serial>[,<serial>...] [--write]");
  console.log(`Motivo: ${MOTIVO}`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  let marcadas = 0, sinCambio = 0;
  for (const norm of LISTA) {
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    if (snap.size < 2) {
      console.log(`!! ${norm}: ${snap.size} ficha(s) — no hay conflicto que cerrar, se salta`);
      continue;
    }
    console.log(`\n${norm}: ${snap.size} fichas`);
    for (const doc of snap.docs) {
      const v = doc.data();
      console.log(`  [${doc.id}] ${v.modelo_label || "(sin modelo)"} · ${v.estado}` +
        `${v.conflicto_revisado === true ? " · ya revisado" : ""}`);
      if (v.conflicto_revisado === true) { sinCambio++; continue; }
      if (!dryRun) {
        await doc.ref.set({
          conflicto_revisado: true,
          serial_compartido: true,   // el aviso "2+ MODELOS" se queda
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by_email: EMAIL,
        }, { merge: true });
        await doc.ref.collection("movimientos").doc().set({
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: EMAIL,
          tipo: "conflicto_revisado",
          de_estado: v.estado || null, a_estado: v.estado || null, ref: null,
          notas: `Serial compartido entre modelos: son radios distintos. ${MOTIVO}`,
        });
      }
      marcadas++;
    }
  }

  console.log(`\n=== ${LISTA.length} seriales ===`);
  console.log(`fichas marcadas: ${marcadas}`);
  console.log(`ya lo estaban:   ${sinCambio}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
