/**
 * backfill-devolucion-espejo.js — Estampa en cada contrato el resumen de sus
 * órdenes de DEVOLUCIÓN (`devolucion_tiquetes` + los derivados planos).
 *
 * De aquí en adelante lo mantiene onOrdenDevolucionWrite en cada escritura del
 * tiquete; esto aplica lo mismo a las órdenes que ya existen.
 *
 * Reconstruye el mapa COMPLETO por contrato (no hace merge de una sola clave),
 * así que también sirve como reparación si el espejo se desincroniza. Las
 * órdenes viejas no tienen `contrato.contrato_origen_ids` —es un campo nuevo—
 * por lo que su espejo cae solo en el contrato titular; el back-pointer del
 * origen lo cubre `backfill-linaje-back-pointer.js` y el chip "sin registro".
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/backfill-devolucion-espejo.js            # dry-run
 *   node scripts/backfill-devolucion-espejo.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const { resumenDevolucion, derivarEstadoDevolucion } = require("../src/lib/devolucion");

const EXECUTE = process.argv.includes("--execute");

(async () => {
  const snap = await db.collection("ordenes_de_servicio")
    .where("tipo_de_servicio", "==", "DEVOLUCION").get();
  console.log(`Órdenes de DEVOLUCIÓN: ${snap.size} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}`);

  // contratoDocId → { [ordenId]: {pendientes, esperado, abierta, rol} }
  const porContrato = new Map();
  let sinContrato = 0;

  for (const d of snap.docs) {
    const orden = d.data();
    const c = orden.contrato || {};
    const destinos = [];
    if (c.contrato_doc_id) destinos.push({ id: c.contrato_doc_id, rol: "titular" });
    for (const origenId of (Array.isArray(c.contrato_origen_ids) ? c.contrato_origen_ids : [])) {
      if (origenId && origenId !== c.contrato_doc_id) destinos.push({ id: origenId, rol: "origen" });
    }
    if (!destinos.length) { sinContrato++; continue; }   // devolución sin contrato (papel)

    const resumen = resumenDevolucion(orden);
    for (const destino of destinos) {
      if (!porContrato.has(destino.id)) porContrato.set(destino.id, {});
      porContrato.get(destino.id)[d.id] = { ...resumen, rol: destino.rol };
    }
  }

  console.log(`Contratos a marcar: ${porContrato.size}${sinContrato ? ` · ${sinContrato} orden(es) sin contrato ligado (papel)` : ""}\n`);

  let tocados = 0, ausentes = 0;
  const conteo = { pendiente: 0, completa: 0, cerrada_con_faltantes: 0 };

  for (const [contratoId, tiquetes] of porContrato) {
    const ref  = db.collection("contratos").doc(contratoId);
    const doc  = await ref.get();
    if (!doc.exists) {
      console.log(`  ! ${contratoId} — el contrato NO existe (tiquetes: ${Object.keys(tiquetes).join(", ")})`);
      ausentes++;
      continue;
    }
    const { pendientes, esperado, estado } = derivarEstadoDevolucion(tiquetes);
    if (estado && conteo[estado] !== undefined) conteo[estado]++;

    const c = doc.data();
    console.log(`  ${c.contrato_id || contratoId} → ${estado} · ${pendientes}/${esperado} · ${Object.keys(tiquetes).length} tiquete(s)`);
    tocados++;
    if (!EXECUTE) continue;

    await ref.set({
      devolucion_tiquetes:       tiquetes,
      devolucion_pendientes:     pendientes,
      devolucion_esperado:       esperado,
      devolucion_estado:         estado,
      devolucion_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  console.log(`\n${EXECUTE ? "Actualizados" : "Se actualizarían"}: ${tocados} contrato(s)`);
  console.log(`  pendiente: ${conteo.pendiente} · completa: ${conteo.completa} · cerrada con faltantes: ${conteo.cerrada_con_faltantes}`);
  if (ausentes) console.log(`Contratos referenciados que no existen: ${ausentes} (revisar a mano)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
