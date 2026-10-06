/**
 * propiedad-alquiler-sin-venta-2026-10-06.js
 *
 * Fichas del pool con `propiedad: cliente`, sin `venta`, colgadas de un
 * contrato ALQ. Arrastre de la migración (la propiedad se heredó del cliente
 * anterior). Caso que lo destapó: CONCORD 25725A0547 (2026-10-06), que el
 * wizard de reemplazo bloqueaba como "comprado fuera".
 *
 * Decisión de Alberto (2026-10-06): son flota de CECOMUNICA → propiedad
 * cecomunica, con movimiento en el kardex. No toca estado ni asignación.
 *
 * USAGE (desde functions/):
 *   node scripts/propiedad-alquiler-sin-venta-2026-10-06.js          # dry-run
 *   node scripts/propiedad-alquiler-sin-venta-2026-10-06.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APPLY = process.argv.includes("--apply");

(async () => {
  const s = await db.collection("equipos_pool").where("propiedad", "==", "cliente").get();
  const malos = s.docs.filter(d => /^ALQ/i.test(d.data().asignacion?.contrato_id || "") && !d.data().venta);
  console.log(`${malos.length} fichas a corregir`);
  let n = 0;
  for (const d of malos) {
    const x = d.data();
    console.log(`   ${x.serial}  ${x.modelo_label}  ${x.asignacion.contrato_id}  ${x.asignacion.cliente_nombre}`);
    if (!APPLY) continue;
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(d.ref)).data();
      if (cur.propiedad !== "cliente" || cur.venta || !/^ALQ/i.test(cur.asignacion?.contrato_id || "")) return;
      tx.set(d.ref, { propiedad: "cecomunica", updated_at: FV.serverTimestamp() }, { merge: true });
      tx.set(d.ref.collection("movimientos").doc(), {
        tipo: "correccion_propiedad", de_estado: cur.estado, a_estado: cur.estado,
        ref: { tipo: "contrato", id: cur.asignacion.contrato_doc_id || null, label: cur.asignacion.contrato_id },
        notas: `Corrección 2026-10-06: figuraba del cliente sin factura de venta pero está en el alquiler ${cur.asignacion.contrato_id}; es flota de CECOMUNICA.`,
        at: FV.serverTimestamp(), por_email: "script:propiedad-alquiler-sin-venta-2026-10-06",
      });
      n++;
    });
  }
  console.log(APPLY ? `\n${n} corregidas.` : "\nDRY-RUN. Corre con --apply para escribir.");
})().catch(e => { console.error(e); process.exit(1); });
