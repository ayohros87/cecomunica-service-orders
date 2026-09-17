/**
 * limpia-marcas-cancelacion-reemplazo.js — Retira del home las marcas
 * `cancelacion_pendiente` falsas: contratos vigentes marcados al cerrar una
 * ENTRADA cuyos seriales devueltos NO son equipo propio del contrato
 * (reemplazos, renovaciones que cambian de modelo).
 *
 * Aplica la misma regla que ahora usa el trigger onOrdenWritePool
 * (src/domain/cancelacionEntrada.js). Casos que lo originaron: REEMP20260901-01
 * de Hotel Gamboa (2026-09-07) y ALQ20260902-01 de SilverKing (2026-09-17),
 * este último un reemplazo POR GESTIÓN sobre el mismo contrato de alquiler
 * —el saliente SÍ era equipo propio— donde además la devolución se hizo ANTES
 * de marcar la entrega del entrante. Por eso el script pregunta también por los
 * salientes declarados en las gestiones de reemplazo del contrato.
 *
 * Sanea de paso la otra huella del mismo enredo: `pendiente_devolucion` puesto
 * por el linaje del reemplazo sobre un radio que YA había vuelto (el cron de
 * devoluciones pendientes lo cobra a diario aunque esté en el estante).
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
const { salientesDeReemplazo } = require("../src/lib/gestiones");
const pool = require("../src/domain/equiposPool");

// Estados en los que el radio está fuera de la casa; en cualquier otro ya volvió.
const EN_PODER_DEL_CLIENTE = new Set([
  pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.ASIGNADO, pool.ESTADOS.PENDIENTE_COBRO, pool.ESTADOS.VENDIDO,
]);

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
    const sustituidos = (await salientesDeReemplazo(d.id)) || [];
    const decision = decidirMarcaCancelacion({ devueltos: cp.seriales || [], propios, sustituidos });
    const tag = `${v.contrato_id || d.id} (${v.tipo_contrato || "?"}, ${v.estado}) · entrada ${cp.orden_numero || cp.orden_entrada_id}`;
    if (decision.marcar) {
      console.log(`  ok    ${tag} · ${decision.motivo}`);
      continue;
    }
    falsas++;
    console.log(`  FALSA ${tag} · ${decision.motivo} · devueltos ${JSON.stringify(cp.seriales)} · propios ${propios.length}`);
    if (!apply) continue;
    await d.ref.set({
      cancelacion_pendiente: admin.firestore.FieldValue.delete(),
      cancelacion_descartada: {
        orden_entrada_id: cp.orden_entrada_id,
        orden_numero: cp.orden_numero || cp.orden_entrada_id,
        seriales: cp.seriales || [],
        motivo: decision.motivo,
        nota: decision.motivo === "reemplazo_sustituido"
          ? "Los seriales devueltos son salientes de un reemplazo de este contrato: el cliente se quedó con el entrante y el contrato sigue vigente; marca retirada por scripts/limpia-marcas-cancelacion-reemplazo.js"
          : "Los seriales devueltos no son equipo de este contrato (reemplazo/renovación); marca retirada por scripts/limpia-marcas-cancelacion-reemplazo.js",
        at: admin.firestore.FieldValue.serverTimestamp(),
      },
    }, { merge: true });
    escritas++;
  }
  console.log(`\n${apply ? "APLICADO" : "DRY-RUN"}: ${revisados} marcas de entrada revisadas, ${falsas} falsas, ${escritas} retiradas.`);

  // ── Deuda falsa: pendiente_devolucion sobre un radio que ya volvió ──────
  // El linaje del reemplazo marca al saliente "pendiente de devolución"; si el
  // radio ya había vuelto (devolución hecha antes de marcar la entrega), esa
  // marca es una deuda que no existe y el cron la cobra a diario.
  const flags = await db.collection("equipos_pool").where("pendiente_devolucion", "==", true).get();
  let deudas = 0, limpiadas = 0;
  for (const d of flags.docs) {
    const v = d.data();
    if (EN_PODER_DEL_CLIENTE.has(v.estado)) continue;
    deudas++;
    console.log(`  DEUDA FALSA ${d.id} · estado ${v.estado}`);
    if (!apply) continue;
    await d.ref.set({
      pendiente_devolucion: admin.firestore.FieldValue.delete(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await d.ref.collection("movimientos").add({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null,
      tipo: "correccion", de_estado: v.estado, a_estado: v.estado, ref: null,
      notas: `Se retira pendiente_devolucion: el radio ya está en casa (${v.estado}). La marca la puso el linaje de un reemplazo después de que el equipo volviera.`,
    });
    limpiadas++;
  }
  console.log(`${apply ? "APLICADO" : "DRY-RUN"}: ${deudas} deuda(s) de devolución falsa(s), ${limpiadas} limpiada(s).`);
})().catch((e) => { console.error(e); process.exit(1); });
