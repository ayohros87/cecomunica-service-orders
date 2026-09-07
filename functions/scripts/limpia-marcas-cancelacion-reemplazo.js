/**
 * limpia-marcas-cancelacion-reemplazo.js — Retira del home las marcas
 * `cancelacion_pendiente` falsas: contratos vigentes marcados al cerrar una
 * ENTRADA cuyos seriales devueltos NO son equipo propio del contrato
 * (reemplazos, renovaciones que cambian de modelo).
 *
 * Aplica la misma regla que ahora usa el trigger onOrdenWritePool
 * (src/domain/cancelacionEntrada.js). Caso que lo originó: REEMP20260901-01
 * de Hotel Gamboa, 2026-09-07.
 *
 * Deja rastro en el contrato (`cancelacion_descartada`) con la orden, los
 * seriales y el motivo, para que se sepa por qué salió de la bandeja.
 * Solo toca marcas con `orden_entrada_id` (motivo entrada); las de conteo de
 * bodega y temporales vencidos se dejan tal cual.
 *
 * USAGE (desde functions/, con PowerShell y NODE_PATH):
 *   node scripts/limpia-marcas-cancelacion-reemplazo.js          (dry-run)
 *   node scripts/limpia-marcas-cancelacion-reemplazo.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const { decidirMarcaCancelacion } = require("../src/domain/cancelacionEntrada");

const apply = process.argv.includes("--apply");
const VIGENTES = ["aprobado", "activo"];

(async () => {
  const snap = await db.collection("contratos")
    .where("estado", "in", VIGENTES)
    .orderBy("cancelacion_pendiente.at", "desc")
    .get();

  let revisados = 0, falsas = 0, escritas = 0;
  for (const d of snap.docs) {
    const v = d.data();
    const cp = v.cancelacion_pendiente;
    if (v.deleted === true || !cp || !cp.orden_entrada_id) continue;
    revisados++;

    const ss = await d.ref.collection("seriales").get();
    const propios = ss.docs.map((s) => s.data()?.serial).filter((s) => typeof s === "string");
    const decision = decidirMarcaCancelacion({ devueltos: cp.seriales || [], propios });
    const tag = `${v.contrato_id || d.id} (${v.tipo_contrato || "?"}, ${v.estado}) · entrada ${cp.orden_numero || cp.orden_entrada_id}`;
    if (decision.marcar) {
      console.log(`  ok    ${tag} · ${decision.motivo}`);
      continue;
    }
    falsas++;
    console.log(`  FALSA ${tag} · devueltos ${JSON.stringify(cp.seriales)} · propios ${propios.length}`);
    if (!apply) continue;
    await d.ref.set({
      cancelacion_pendiente: admin.firestore.FieldValue.delete(),
      cancelacion_descartada: {
        orden_entrada_id: cp.orden_entrada_id,
        orden_numero: cp.orden_numero || cp.orden_entrada_id,
        seriales: cp.seriales || [],
        motivo: "equipo_ajeno",
        nota: "Los seriales devueltos no son equipo de este contrato (reemplazo/renovación); marca retirada por scripts/limpia-marcas-cancelacion-reemplazo.js",
        at: admin.firestore.FieldValue.serverTimestamp(),
      },
    }, { merge: true });
    escritas++;
  }
  console.log(`\n${apply ? "APLICADO" : "DRY-RUN"}: ${revisados} marcas de entrada revisadas, ${falsas} falsas, ${escritas} retiradas.`);
})().catch((e) => { console.error(e); process.exit(1); });
