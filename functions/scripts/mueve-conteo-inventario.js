/**
 * mueve-conteo-inventario.js — Mueve el conteo físico de una fila de catálogo a
 * otra. Pensado para cerrar el hueco que deja un dedup de modelos.
 *
 * `inventario_actual` usa el modelo_id como ID del documento, y `ultimo_inventario`
 * lo guarda como campo. Al deduplicar un modelo se repuntan contratos y órdenes,
 * pero el conteo se queda en la fila perdedora: queda huérfano y la tabla de
 * inventario muestra dos filas idénticas, una con conteo y otra sin él.
 * (Caso HYTERA SC780: el dedup del 2026-07-24 dejó el conteo de 5 en la fila
 * desactivada mientras las 5 series nuevas entraron a la superviviente.)
 *
 * El historial se REPUNTA, no se borra: dejarlo en la fila muerta vaciaría el
 * kardex de la fila viva.
 *
 * USAGE (desde functions/):
 *   node scripts/mueve-conteo-inventario.js <modelo_id_origen> <modelo_id_destino> [--write]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const DESDE  = process.argv[2];
const HACIA  = process.argv[3];
const dryRun = !process.argv.includes("--write");

const nom = (v) => `${v.marca || ""} ${v.modelo || ""}`.trim();

(async () => {
  if (!DESDE || !HACIA) throw new Error("USAGE: <modelo_id_origen> <modelo_id_destino> [--write]");

  const [mo, md] = await Promise.all([
    db.collection("modelos").doc(DESDE).get(),
    db.collection("modelos").doc(HACIA).get(),
  ]);
  if (!mo.exists) throw new Error(`El modelo origen ${DESDE} no existe`);
  if (!md.exists) throw new Error(`El modelo destino ${HACIA} no existe`);
  console.log(`origen:  ${nom(mo.data())} (${DESDE})  activo=${mo.data().activo}`);
  console.log(`destino: ${nom(md.data())} (${HACIA})  activo=${md.data().activo}`);
  if (md.data().activo === false) {
    throw new Error("El destino está INACTIVO — el conteo quedaría igual de huérfano");
  }
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const [co, cd] = await Promise.all([
    db.collection("inventario_actual").doc(DESDE).get(),
    db.collection("inventario_actual").doc(HACIA).get(),
  ]);
  if (!co.exists) { console.log("El origen no tiene conteo. Nada que mover."); process.exit(0); }
  if (cd.exists) {
    console.log(`!! El destino YA tiene conteo (${cd.data().cantidad}). No se pisa: revisar a mano`);
    console.log(`   origen=${co.data().cantidad}  destino=${cd.data().cantidad}`);
    process.exit(1);
  }

  const datos = co.data();
  console.log(`conteo a mover: cantidad=${datos.cantidad}  anterior=${datos.cantidad_anterior ?? "-"}`);

  const hist = await db.collection("ultimo_inventario").where("modelo_id", "==", DESDE).get();
  console.log(`historial a repuntar: ${hist.size} registro(s)`);

  if (!dryRun) {
    const batch = db.batch();
    // El conteo se copia tal cual, solo cambia a quién pertenece.
    batch.set(db.collection("inventario_actual").doc(HACIA), { ...datos, modelo_id: HACIA });
    batch.delete(db.collection("inventario_actual").doc(DESDE));
    hist.forEach((d) => batch.update(d.ref, { modelo_id: HACIA }));
    await batch.commit();
    console.log("\nlisto: conteo movido, historial repuntado y doc del origen borrado");
  } else {
    console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  }
  process.exit(0);
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
