/**
 * fix-entradas-mal-cerradas.js — Corrige el estado terminal de las órdenes de
 * ENTRADA que quedaron en "ENTREGADO AL CLIENTE".
 *
 * Una ENTRADA es el regreso físico del equipo: no se entrega al cliente, se
 * cierra. Su terminal propio es CERRADA (ENTRADA), pero ese estado no existía
 * antes del 2026-07-21, así que las 191 ENTRADAs anteriores se cerraron con lo
 * único disponible: "Entregar". Efecto colateral: onOrdenWritePool trata ese
 * estado como salida de taller y empujó esas unidades a `en_cliente`.
 *
 * QUÉ TOCA: solo `estado_reparacion` de la orden (+ marca y log).
 * QUÉ NO:   el inventario. Se estampa `correccion_terminal: true`, que
 *           onOrdenWritePool usa para NO mover el pool — dónde está hoy ese
 *           equipo no se deduce de una orden de hace un año. La lista de
 *           unidades afectadas está en
 *           local-data/entradas-mal-cerradas-2026-07-28.csv y se resuelve
 *           aparte, con conteo físico.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-entradas-mal-cerradas.js           # dry-run
 *   node scripts/fix-entradas-mal-cerradas.js --write
 * Idempotente.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const DESTINO = "CERRADA (ENTRADA)";
const MALO    = "ENTREGADO AL CLIENTE";
const AUTOR   = "script:fix-entradas-mal-cerradas";

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const snap = await db.collection("ordenes_de_servicio").get();
  const objetivo = [];
  snap.forEach((d) => {
    const v = d.data();
    if (v.eliminado === true) return;
    if ((v.tipo_de_servicio || "").toUpperCase().trim() !== "ENTRADA") return;
    if ((v.estado_reparacion || "").toUpperCase().trim() !== MALO) return;
    objetivo.push({
      id: d.id, orden: v.numero_orden || d.id,
      cliente: v.cliente_nombre || "",
      fecha: v.fecha_creacion?.toDate ? v.fecha_creacion.toDate().toISOString().slice(0, 10) : "",
      equipos: (v.equipos || []).filter((e) => e && !e.eliminado).length,
      yaMarcada: v.correccion_terminal === true,
    });
  });

  let batch = db.batch(), ops = 0, escritas = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  for (const o of objetivo) {
    if (!dryRun) {
      batch.update(db.collection("ordenes_de_servicio").doc(o.id), {
        estado_reparacion: DESTINO,
        // Lo lee onOrdenWritePool para no mover inventario por esta corrección.
        correccion_terminal: true,
        correccion_terminal_at: admin.firestore.FieldValue.serverTimestamp(),
        correccion_terminal_de: MALO,
        os_logs: admin.firestore.FieldValue.arrayUnion({
          action: "CORREGIR_TERMINAL", by: AUTOR,
        }),
      });
      ops++;
      if (ops >= 400) await flush();
    }
    escritas++;
  }
  await flush();

  console.log(`--- ${objetivo.length} ordenes ENTRADA en "${MALO}" ---`);
  objetivo.slice(0, 20).forEach((o) =>
    console.log(`  ${String(o.orden).padEnd(12)} ${o.fecha}  ${String(o.equipos).padStart(3)} equipo(s)  ${o.cliente}`));
  if (objetivo.length > 20) console.log(`  …y ${objetivo.length - 20} más`);

  const totalEquipos = objetivo.reduce((s, o) => s + o.equipos, 0);
  console.log(`\n=== resumen ===`);
  console.log(`ordenes a corregir → "${DESTINO}": ${escritas}`);
  console.log(`renglones de equipo que abarcan:    ${totalEquipos}`);
  console.log(`(el inventario NO se toca: correccion_terminal frena onOrdenWritePool)`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
