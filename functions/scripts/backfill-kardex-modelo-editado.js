/**
 * backfill-kardex-modelo-editado.js — Reconstruye el movimiento `correccion_modelo`
 * que falta en fichas cuyo modelo se cambió por "Editar ficha".
 *
 * El caso que lo motiva: el 2026-08-14 bodega pasó 32 seriales de VM686 a PD686
 * una por una desde la ficha. Esa pantalla llama a `actualizar`, que pisa el
 * campo y NO escribe kardex (ver el comentario en equiposPoolService.js sobre
 * por qué las tres correcciones "de verdad" van con `_conKardex`). Resultado:
 * las fichas quedaron bien pero su historia dice solo "Toma física inicial", y
 * el próximo backfill que mire el kardex no tiene cómo saber que el cambio fue
 * deliberado.
 *
 * NO toca ningún campo del doc: los campos YA están correctos. Escribe
 * únicamente el movimiento que faltó, fechado en el `updated_at` real de cada
 * ficha (no "ahora"), para que el kardex se lea en orden cronológico. La nota
 * dice que el registro se reconstruyó y quién hizo el cambio original.
 *
 * IDEMPOTENTE: si la ficha ya tiene un `correccion_modelo`, se salta.
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-kardex-modelo-editado.js <archivo.txt> <modelo_id> \
 *        --antes="HYTERA VM686" [--write] [--por=email] [--motivo="..."]
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const arg = (p) => {
  const a = process.argv.find((x) => x.startsWith(p));
  return a ? a.slice(p.length) : "";
};

const ARCHIVO   = process.argv[2];
const MODELO_ID = process.argv[3];
const ANTES     = arg("--antes=");
const dryRun    = !process.argv.includes("--write");
const POR       = arg("--por=") || "script:backfill-kardex-modelo-editado";
const MOTIVO    = arg("--motivo=");

(async () => {
  if (!ARCHIVO || !MODELO_ID || !ANTES) {
    throw new Error('USAGE: <archivo.txt> <modelo_id> --antes="MODELO ANTERIOR" [--write]');
  }
  const ms = await db.collection("modelos").doc(MODELO_ID).get();
  if (!ms.exists) throw new Error(`El modelo ${MODELO_ID} no existe`);
  const mv = ms.data();
  const LABEL = `${mv.marca || ""} ${mv.modelo || ""}`.trim();
  const COND  = (mv.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo";
  console.log(`Destino esperado: ${LABEL} (${MODELO_ID}) · condicion "${COND}"`);
  console.log(`Modelo anterior a documentar: ${ANTES}`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  const r = { escritos: 0, yaTenian: 0, sinFicha: 0, noCuadra: 0 };
  for (const norm of seriales) {
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    if (snap.empty) { r.sinFicha++; console.log(`  !! sin ficha: ${norm}`); continue; }

    for (const doc of snap.docs) {
      const v = doc.data();
      // Candado: solo se documenta la ficha que YA quedó en el modelo destino.
      // Si no cuadra, este script no es el remedio — es repunta-modelo-lista.
      if (v.modelo_id !== MODELO_ID || (v.condicion || "") !== COND) {
        r.noCuadra++;
        console.log(`  SALTADA  ${norm}  es "${v.modelo_label}" / ${v.condicion} — no está en el destino`);
        continue;
      }
      const previos = await doc.ref.collection("movimientos")
        .where("tipo", "==", "correccion_modelo").limit(1).get();
      if (!previos.empty) { r.yaTenian++; continue; }

      const cuando = v.updated_at || null;
      const quien  = v.updated_by_email || "(desconocido)";
      const notaFicha = (v.notas || "").trim();
      const notas = `Reclasificado a ${LABEL} (${COND}). Antes: ${ANTES}.`
        + ` Cambio hecho por ${quien} desde "Editar ficha", que no dejó kardex;`
        + ` movimiento reconstruido el 2026-08-17 a partir de updated_at.`
        + (notaFicha ? ` Nota de bodega en la ficha: "${notaFicha}".` : "")
        + (MOTIVO ? ` ${MOTIVO}` : "");

      console.log(`  ${norm}  ${ANTES} → ${LABEL} / ${COND}`
        + `  (${cuando ? cuando.toDate().toISOString().slice(0, 16) : "sin fecha"} · ${quien})`);

      if (!dryRun) {
        await doc.ref.collection("movimientos").doc().set({
          at: cuando || admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: POR,
          tipo: "correccion_modelo",
          de_estado: v.estado || null, a_estado: v.estado || null, ref: null,
          notas,
          reconstruido: true,
        });
      }
      r.escritos++;
    }
  }

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`movimientos escritos: ${r.escritos}`);
  if (r.yaTenian)  console.log(`ya tenían kardex:     ${r.yaTenian}`);
  if (r.noCuadra)  console.log(`no están en el modelo destino: ${r.noCuadra}`);
  if (r.sinFicha)  console.log(`sin ficha:            ${r.sinFicha}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
