/**
 * corrige-propiedad-lista.js — Corrige SOLO la propiedad (y opcionalmente
 * `verificado`) de una lista de seriales, sin tocar dónde está la unidad.
 *
 * Existe porque los conteos físicos destapan siempre el mismo falso positivo:
 * la regla 4 de `backfill-propiedad.js` marcó "del cliente" todo radio que
 * entró únicamente por una orden de servicio, sin contrato que lo amparara. Un
 * radio de alquiler devuelto por reemplazo entra así, y queda diciendo que es
 * del cliente aunque sea flota nuestra.
 *
 * `ingresa-bodega-lista.js` ya sabe corregir la propiedad, pero de paso fuerza
 * la unidad a bodega. Cuando el radio NO está en bodega —porque ya salió a otro
 * contrato entre el conteo y la corrección— ese efecto es justo el que no se
 * quiere: sacaría la unidad de un contrato vivo. Aquí solo se toca el dato que
 * está mal.
 *
 * USAGE (desde functions/):
 *   node scripts/corrige-propiedad-lista.js <archivo.txt> --propiedad=cecomunica
 *        [--verificado] [--motivo="..."] [--write] [--email=..]
 * Idempotente.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ARCHIVO   = process.argv[2];
const dryRun    = !process.argv.includes("--write");
const VERIFICAR = process.argv.includes("--verificado");
const PROPIEDAD = (process.argv.find((a) => a.startsWith("--propiedad=")) || "").split("=")[1] || "";
const MOTIVO    = (process.argv.find((a) => a.startsWith("--motivo=")) || "").split("=").slice(1).join("=")
  || "Corrección de propiedad con evidencia documental";
const EMAIL     = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:corrige-propiedad-lista";
const PROPIEDADES = new Set(["cecomunica", "cliente", "desconocida"]);

(async () => {
  if (!ARCHIVO) throw new Error("USAGE: <archivo.txt> --propiedad=cecomunica|cliente|desconocida");
  if (!PROPIEDADES.has(PROPIEDAD)) {
    throw new Error(`--propiedad debe ser una de: ${[...PROPIEDADES].join(", ")}`);
  }
  console.log(`Propiedad → "${PROPIEDAD}"${VERIFICAR ? " + verificado" : ""}`);
  console.log(`Motivo: ${MOTIVO}`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  const r = { corregidas: 0, sinCambio: 0, sinFicha: 0 };
  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  for (const norm of seriales) {
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    if (snap.empty) { r.sinFicha++; console.log(`!! sin ficha: ${norm}`); continue; }

    for (const doc of snap.docs) {
      const v = doc.data();
      const yaOk = v.propiedad === PROPIEDAD && (!VERIFICAR || v.verificado === true);
      if (yaOk) { r.sinCambio++; continue; }
      console.log(`  ${norm} [${doc.id}] ${v.modelo_label || "(sin modelo)"} · ${v.estado}` +
        ` · propiedad ${v.propiedad || "(vacía)"} → ${PROPIEDAD}` +
        (v.asignacion?.cliente_nombre ? ` · asignado a ${v.asignacion.cliente_nombre}` +
          `${v.asignacion.contrato_id ? ` (${v.asignacion.contrato_id})` : ""}` : ""));
      if (!dryRun) {
        batch.update(doc.ref, {
          propiedad: PROPIEDAD,
          ...(VERIFICAR ? { verificado: true } : {}),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: null,
          updated_by_email: EMAIL,
        });
        // El kardex es la única memoria de POR QUÉ cambió la propiedad: sin la
        // nota, el próximo backfill vuelve a "corregirla" al revés.
        batch.set(doc.ref.collection("movimientos").doc(), {
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: EMAIL,
          tipo: "correccion_propiedad",
          de_estado: v.estado || null, a_estado: v.estado || null, ref: null,
          notas: `Propiedad ${v.propiedad || "(vacía)"} → ${PROPIEDAD}. ${MOTIVO}`,
        });
        ops += 2;
        if (ops >= 400) await flush();
      }
      r.corregidas++;
    }
  }
  await flush();

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`fichas corregidas: ${r.corregidas}`);
  console.log(`sin cambio:        ${r.sinCambio}`);
  if (r.sinFicha) console.log(`sin ficha:         ${r.sinFicha}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
