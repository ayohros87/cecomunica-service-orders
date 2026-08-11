/**
 * fix-entradas-mal-cerradas.js — Lleva a su terminal propio, CERRADA (ENTRADA),
 * las órdenes de ENTRADA que se quedaron en otro estado porque ese terminal no
 * existía antes del 2026-07-21.
 *
 * Una ENTRADA es el regreso físico del equipo: no se entrega al cliente, se
 * cierra. Sin su terminal, las de antes del corte quedaron de dos formas, y las
 * dos se arreglan igual:
 *
 *   · "ENTREGADO AL CLIENTE" (191, corregidas el 2026-07-28) — se cerraron con
 *     lo único disponible: "Entregar". Efecto colateral: onOrdenWritePool trata
 *     ese estado como salida de taller y empujó esas unidades a `en_cliente`.
 *   · "COMPLETADO (EN OFICINA)" (197, revisadas el 2026-08-11) — el técnico
 *     marcó el trabajo hecho y ahí murió: sin terminal no había botón que
 *     apretar. Quedaron como cola falsa para siempre.
 *
 * QUÉ TOCA: solo `estado_reparacion` de la orden (+ marca y log).
 * QUÉ NO:   el inventario. Se estampa `correccion_terminal: true`, que
 *           onOrdenWritePool usa para NO mover el pool — dónde está hoy ese
 *           equipo no se deduce de una orden de hace un año. Sin esa marca, el
 *           cierre normal manda a bodega todo lo que esté en cuarentena, taller,
 *           asignado O CON EL CLIENTE: para las 197 de "COMPLETADO" serían 1,000
 *           unidades, **739 de ellas hoy en poder del cliente**. La ubicación
 *           real se resuelve aparte, con conteo físico.
 *           `correccion_terminal` también frena el `cancelacion_pendiente` que
 *           el cierre normal le estampa al contrato vigente.
 *
 * CUIDADO: esto es para las ANTERIORES al 2026-07-21. Una ENTRADA posterior que
 * siga parada NO es un hueco histórico —su terminal ya existía— y cerrarla sí
 * debe mover inventario. Esas se revisan a mano.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-entradas-mal-cerradas.js                                  # dry-run
 *   node scripts/fix-entradas-mal-cerradas.js --write
 *   node scripts/fix-entradas-mal-cerradas.js --desde="COMPLETADO (EN OFICINA)" --hasta-fecha=2026-07-21
 * Idempotente.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=");
const DESTINO = "CERRADA (ENTRADA)";
// Estado de origen a corregir. Default: el caso del 2026-07-28.
const MALO    = arg("desde") || "ENTREGADO AL CLIENTE";
// Corte opcional: solo las completadas ANTES de esta fecha (YYYY-MM-DD). Existe
// porque después del 2026-07-21 el terminal ya existía y quedarse parada deja
// de ser un hueco histórico.
const HASTA   = arg("hasta-fecha") || "";
const AUTOR   = "script:fix-entradas-mal-cerradas";
const iso = (t) => {
  const d = t?.toDate ? t.toDate() : null;
  return d && !isNaN(d) ? d.toISOString().slice(0, 10) : "";
};

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  console.log(`origen: "${MALO}"  →  destino: "${DESTINO}"`);
  if (HASTA) console.log(`corte: solo las completadas ANTES de ${HASTA}\n`);

  const snap = await db.collection("ordenes_de_servicio").get();
  const objetivo = [];
  let fueraDeCorte = 0;
  snap.forEach((d) => {
    const v = d.data();
    if (v.eliminado === true) return;
    if ((v.tipo_de_servicio || "").toUpperCase().trim() !== "ENTRADA") return;
    if ((v.estado_reparacion || "").toUpperCase().trim() !== MALO.toUpperCase().trim()) return;
    // El corte mira la fecha de completado (cuándo se hizo el trabajo); si no
    // consta, la de creación. Sin ninguna de las dos NO se asume histórica.
    const fecha = iso(v.fecha_completado) || iso(v.fecha_creacion);
    if (HASTA && (!fecha || fecha >= HASTA)) { fueraDeCorte++; return; }
    objetivo.push({
      id: d.id, orden: v.numero_orden || d.id,
      cliente: v.cliente_nombre || "",
      fecha,
      equipos: (v.equipos || []).filter((e) => e && !e.eliminado).length,
      yaMarcada: v.correccion_terminal === true,
    });
  });
  if (fueraDeCorte) console.log(`(${fueraDeCorte} quedaron fuera del corte — se revisan a mano)\n`);

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
