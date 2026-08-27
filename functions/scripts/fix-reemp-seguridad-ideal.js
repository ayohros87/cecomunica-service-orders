/**
 * fix-reemp-seguridad-ideal.js — Revierte la devolución falsa del caso
 * REEMP20260825-01 / SEGURIDAD IDEAL (orden 2026082705, 2026-08-27).
 *
 * QUÉ PASÓ
 *   El reemplazo REEMP20260825-01 sustituyó el radio 24813A0527, que venía de
 *   un contrato de PAPEL (el contrato declara `origen_tipo: 'legacy'`,
 *   `origen_legacy_ref: 'ALQ2024-10-30-01'`). Como quedó sin
 *   `contrato_origen_ids`, el script amarra-renovaciones.js le dedujo uno —
 *   ALQ20260206-01, la adición de febrero, único candidato del cliente— y al
 *   confirmarse la entrega del reemplazo (2026-08-27 17:14) onEntregaTransicion
 *   reclamó las DOS unidades de ese contrato: 25O10A2994 y 25O10A2995. Ninguna
 *   tiene que ver con el reemplazo, y el radio que sí se reemplazó ya había
 *   vuelto (devolución 2026082506 + entrada 2026082507, ambas cerradas el
 *   2026-08-25; su ficha está `en_bodega`).
 *
 * QUÉ REVIERTE (todo lo que dejó ese disparo, nada más)
 *   1. Orden 2026082705 → eliminada, con motivo en os_logs. NO se borra el
 *      documento: el tiquete es evidencia de lo que pasó (misma regla que
 *      todos los saneos — cerrar, no desaparecer).
 *   2. Los 2 mapeos auto de contratos/{REEMP}/mapeos → borrados.
 *   3. `pendiente_devolucion` de 25O10A2994 y 25O10A2995 → limpiado. Siguen
 *      `en_cliente` bajo ALQ20260206-01, que es lo correcto.
 *   4. El vínculo inventado del REEMP (contrato_origen_id/_ids + linaje_amarrado
 *      + transicion_auto_*) → borrado, y el back-pointer `renovado_por_ids` del
 *      contrato de febrero también.
 *   5. Espejo de devolución (devolucion_*) de los dos contratos → limpiado.
 *
 * NO toca: la entrega del reemplazo, el serial entrante 24708A1212, ni las
 * órdenes 2026082506/2026082507, que registraron la devolución REAL.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-reemp-seguridad-ideal.js            # dry-run
 *   node scripts/fix-reemp-seguridad-ideal.js --write
 * Idempotente: lo ya revertido se salta.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const dryRun = !process.argv.includes("--write");
const REEMP_DOC = "CicADistdwgiUirQab2U";   // REEMP20260825-01
const ORIGEN_DOC = "xmvXytXlrN8ik5ECaKFp";  // ALQ20260206-01 (la adición de febrero)
const ORDEN = "2026082705";
const SERIALES = ["25O10A2994", "25O10A2995"];
const MOTIVO = "Devolución falsa: el origen ALQ20260206-01 fue deducido por script; "
             + "el reemplazo REEMP20260825-01 sustituyó 24813A0527, de un contrato de papel, "
             + "que ya volvió por la devolución 2026082506.";

const plan = [];
const paso = (t, fn) => plan.push({ t, fn });

(async () => {
  console.log(`\n=== fix-reemp-seguridad-ideal ${dryRun ? "(DRY-RUN)" : "(WRITE)"} ===\n`);

  // 1) La orden de devolución falsa.
  const ordenRef = db.collection("ordenes_de_servicio").doc(ORDEN);
  const orden = await ordenRef.get();
  if (!orden.exists) {
    console.log(`1) Orden ${ORDEN}: no existe — nada que hacer`);
  } else if (orden.data().eliminado === true) {
    console.log(`1) Orden ${ORDEN}: ya estaba eliminada — se salta`);
  } else {
    const esperados = (orden.data().devolucion?.esperados || []).length;
    console.log(`1) Orden ${ORDEN} (${esperados} esperados) → eliminada`);
    paso("orden", () => ordenRef.update({
      eliminado: true,
      estado_reparacion: "ANULADA",
      os_logs: FV.arrayUnion({
        action: "ELIMINAR",
        by: "script:fix-reemp-seguridad-ideal",
        motivo: MOTIVO,
        at_iso: new Date().toISOString(),
      }),
    }));
  }

  // 2) Mapeos auto del reemplazo.
  const mapeos = await db.collection("contratos").doc(REEMP_DOC).collection("mapeos").get();
  const autos = mapeos.docs.filter((d) => d.data().auto === true);
  console.log(`2) Mapeos auto en REEMP20260825-01: ${autos.length}${autos.length ? ` (${autos.map(d => d.data().saliente).join(", ")})` : ""} → borrados`);
  autos.forEach((d) => paso("mapeo", () => d.ref.delete()));

  // 3) Fichas del pool: soltar la marca de devolución pendiente.
  for (const s of SERIALES) {
    const ref = db.collection("equipos_pool").doc(s);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`3) ${s}: sin ficha — se salta`); continue; }
    const u = snap.data();
    if (!u.pendiente_devolucion) { console.log(`3) ${s}: ya sin pendiente_devolucion — se salta`); continue; }
    console.log(`3) ${s} (${u.estado}, contrato ${u.asignacion?.contrato_id || "—"}) → pendiente_devolucion limpiado`);
    paso("pool", () => ref.update({
      pendiente_devolucion: FV.delete(),
      pendiente_devolucion_at: FV.delete(),
      updated_at: FV.serverTimestamp(),
    }));
  }

  // 4) El vínculo inventado, por los dos lados.
  console.log("4) REEMP20260825-01 → se borra el origen deducido y el rastro del auto-reclamo");
  paso("linaje", () => db.collection("contratos").doc(REEMP_DOC).update({
    contrato_origen_id: FV.delete(),
    contrato_origen_ids: FV.delete(),
    linaje_amarrado: FV.delete(),
    transicion_auto_at: FV.delete(),
    transicion_auto_unidades: FV.delete(),
    transicion_mapeos_count: 0,
    transicion_ultimo_mapeo_at: FV.delete(),
    orden_devolucion_id: FV.delete(),
    saneado_2026_08_27: {
      por: "script:fix-reemp-seguridad-ideal",
      motivo: MOTIVO,
      at: FV.serverTimestamp(),
    },
  }));
  console.log("   ALQ20260206-01 → se borra el back-pointer renovado_por_ids");
  paso("backpointer", () => db.collection("contratos").doc(ORIGEN_DOC).update({
    renovado_por_ids: FV.arrayRemove(REEMP_DOC),
  }));

  // 5) Espejo de devolución en los dos contratos.
  const limpiezaEspejo = {
    devolucion_tiquetes: FV.delete(),
    devolucion_estado: FV.delete(),
    devolucion_pendientes: FV.delete(),
    devolucion_esperado: FV.delete(),
    devolucion_actualizado_at: FV.serverTimestamp(),
  };
  console.log("5) Espejo devolucion_* limpiado en los dos contratos");
  paso("espejo-reemp", () => db.collection("contratos").doc(REEMP_DOC).update(limpiezaEspejo));
  paso("espejo-origen", () => db.collection("contratos").doc(ORIGEN_DOC).update(limpiezaEspejo));

  console.log(`\n${plan.length} escrituras planificadas.`);
  if (dryRun) { console.log("Dry-run: nada escrito. --write para aplicar.\n"); process.exit(0); }

  for (const p of plan) {
    try { await p.fn(); process.stdout.write("."); }
    catch (e) { console.error(`\n  ! falló ${p.t}: ${e.message}`); }
  }
  console.log(`\n\nListo: ${plan.length} escrituras aplicadas.\n`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
