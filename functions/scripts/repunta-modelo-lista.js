/**
 * repunta-modelo-lista.js — Cambia el modelo (y con él la condición) de una
 * lista de seriales del pool.
 *
 * La condición NO se pasa por parámetro: la impone la fila del catálogo
 * (estado R → reuso, N → nuevo), igual que la pantalla de captura y el
 * servidor. Así una unidad no puede quedar diciendo "reuso" con un modelo
 * que el catálogo tiene como nuevo.
 *
 * CANDADO: si el serial tiene varias fichas, solo se toca la que ya es de la
 * MISMA familia de modelo. Kenwood y otros reutilizan series entre modelos
 * distintos, y repuntar la ficha ajena borraría esa distinción.
 *
 * `--forzar` levanta ese candado para el caso en que una PERSONA vio el radio y
 * dice que el modelo está mal de familia a familia (PNC460 vs PNC560, no una
 * variante -R). Es la contraparte en script de "Editar ficha → modelo" y del
 * criterio del callable `fusionarPoolFicha`: la identidad la decide quien tiene
 * el equipo delante, no el parecido de los labels. Cada cambio entre familias
 * se imprime aparte y queda en el kardex marcado como decisión manual, porque
 * es justo el movimiento que el candado existe para evitar por accidente.
 *
 * NO toca estado, asignación ni verificado: esto corrige QUÉ es la unidad, no
 * dónde está.
 *
 * USAGE (desde functions/):
 *   node scripts/repunta-modelo-lista.js <archivo.txt> <modelo_id> [--write] [--email=..]
 *        [--forzar] [--motivo="..."]
 * Idempotente.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ARCHIVO   = process.argv[2];
const MODELO_ID = process.argv[3];
const dryRun    = !process.argv.includes("--write");
const FORZAR    = process.argv.includes("--forzar");
const MOTIVO    = (process.argv.find((a) => a.startsWith("--motivo=")) || "").split("=").slice(1).join("=")
  || "Decisión manual: el modelo de la ficha estaba mal";
const EMAIL     = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:repunta-modelo-lista";

(async () => {
  if (!ARCHIVO || !MODELO_ID) throw new Error("USAGE: <archivo.txt> <modelo_id> [--write]");

  const ms = await db.collection("modelos").doc(MODELO_ID).get();
  if (!ms.exists) throw new Error(`El modelo ${MODELO_ID} no existe`);
  const mv = ms.data();
  const LABEL = `${mv.marca || ""} ${mv.modelo || ""}`.trim();
  const COND  = (mv.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo";
  console.log(`Destino: ${LABEL} (${MODELO_ID}) · estado ${mv.estado} → condicion "${COND}"`);
  if (FORZAR) console.log(`*** --forzar: se cambian TAMBIÉN fichas de otra familia. Motivo: ${MOTIVO}`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  const r = { repuntadas: 0, sinCambio: 0, sinFicha: 0, saltadas: 0, forzadas: 0 };
  for (const norm of seriales) {
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    if (snap.empty) { r.sinFicha++; console.log(`  !! sin ficha: ${norm}`); continue; }

    for (const doc of snap.docs) {
      const v = doc.data();
      // Solo la ficha de la MISMA familia (mismoModelo tolera el sufijo -R).
      const ajena = !pool.mismoModelo(v, MODELO_ID, LABEL);
      if (ajena && !FORZAR) {
        r.saltadas++;
        console.log(`  SALTADA  ${norm}  es "${v.modelo_label}" — otra familia, no se toca (--forzar para cambiarla)`);
        continue;
      }
      if (v.modelo_id === MODELO_ID && (v.condicion || "") === COND) { r.sinCambio++; continue; }

      const antes = `${v.modelo_label || "(sin modelo)"} / ${v.condicion || "?"}`;
      if (ajena) {
        r.forzadas++;
        console.log(`  FORZADA  ${norm} [${doc.id}]  ${antes}  →  ${LABEL} / ${COND}   (cambio ENTRE FAMILIAS)`);
      }
      if (!dryRun) {
        await doc.ref.set({
          modelo_id: MODELO_ID, modelo_label: LABEL, condicion: COND,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by_email: EMAIL,
        }, { merge: true });
        await doc.ref.collection("movimientos").doc().set({
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: EMAIL,
          tipo: "correccion_modelo",
          de_estado: v.estado || null, a_estado: v.estado || null, ref: null,
          notas: `Reclasificado a ${LABEL} (${COND}). Antes: ${antes}`
            + (ajena ? ` — cambio ENTRE FAMILIAS forzado. ${MOTIVO}` : ""),
        });
      }
      r.repuntadas++;
      if (!ajena) console.log(`  ${norm}  ${antes}  →  ${LABEL} / ${COND}`);
    }
  }

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`repuntadas:  ${r.repuntadas}`);
  console.log(`sin cambio:  ${r.sinCambio}`);
  if (r.forzadas) console.log(`FORZADAS entre familias: ${r.forzadas}`);
  if (r.saltadas) console.log(`saltadas (otra familia): ${r.saltadas}`);
  if (r.sinFicha) console.log(`sin ficha:   ${r.sinFicha}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
