/**
 * suelta-asignaciones-anuladas.js — Suelta la parte de CONTRATO de la
 * asignación en unidades del pool cuyo contrato ya no existe o quedó
 * anulado/deleted. La custodia del CLIENTE se conserva: el radio sigue donde
 * sigue, y saber con quién está no depende de que el contrato viva.
 *
 * CONTEXTO (informe docs/INFORME_TRACKING_SERIAL_2026-08-12.md, brecha B3).
 * Medición del 2026-08-12: 50 unidades apuntaban a contratos anulados, pero
 * 32 de ellas estaban BIEN — son recuperaciones en vuelo (`pendiente_devolucion`
 * usa la asignación como el hilo que persigue la devolución; desasignar ahí
 * rompería la orden de recuperación). Este script las salta SIEMPRE. Las 18
 * reales: 15 en_taller de un contrato anulado y rehecho (CONCORD
 * ALQ20260806-01 → ALQ20260810-01; cuando inventario asigne los seriales del
 * nuevo, la reasignación normal las adopta) y 3 fichas sufijadas de la
 * colisión 25725A0542/0543 (la fusión de esas fichas es trabajo aparte —
 * merge-pool-duplicados.js).
 *
 * QUÉ TOCA: asignacion.contrato_doc_id/contrato_id → null (cliente se queda),
 *           + movimiento 'liberacion' en el kardex.
 * QUÉ NO:   estado, propiedad, pendiente_devolucion (esas unidades se saltan).
 *
 * USAGE (desde functions/):
 *   node scripts/suelta-asignaciones-anuladas.js            # dry-run
 *   node scripts/suelta-asignaciones-anuladas.js --write
 * Idempotente: una unidad ya suelta no matchea el filtro.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const [pool, cs] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("contratos").get(),
  ]);
  const contratos = new Map();
  cs.forEach((d) => contratos.set(d.id, d.data()));

  let sueltas = 0, saltadasPend = 0;
  for (const d of pool.docs) {
    const u = d.data();
    const cid = u.asignacion?.contrato_doc_id;
    if (!cid) continue;
    const c = contratos.get(cid);
    if (c && !c.deleted && ["activo", "aprobado"].includes(c.estado)) continue;

    // Recuperación en vuelo: la asignación es el hilo de la devolución
    // (mismo guard que desasignarContrato). No se toca.
    if (u.pendiente_devolucion) { saltadasPend++; continue; }

    const motivo = c ? (c.deleted ? "eliminado" : c.estado) : "no existe";
    console.log(`  ${d.id.padEnd(36)} ${String(u.estado).padEnd(14)} ${u.asignacion.contrato_id || cid}  (${motivo})  ${(u.asignacion.cliente_nombre || "").slice(0, 30)}`);

    if (!dryRun) {
      await d.ref.set({
        asignacion: {
          contrato_doc_id: null,
          contrato_id: "",
          cliente_id: u.asignacion.cliente_id || "",
          cliente_nombre: u.asignacion.cliente_nombre || "",
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await d.ref.collection("movimientos").add({
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: null,
        tipo: "liberacion", de_estado: u.estado, a_estado: u.estado,
        ref: { tipo: "contrato", id: cid, label: u.asignacion.contrato_id || "" },
        notas: `Contrato ${motivo}: se suelta el vínculo al contrato; la custodia del cliente se conserva`,
      });
    }
    sueltas++;
  }

  console.log(`\n=== ${sueltas} suelta(s) · ${saltadasPend} saltada(s) por recuperación en vuelo (pendiente_devolucion) ===`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
