/**
 * copasecuva-revertir-cierre-historico-2026021205.js
 *
 * La OS 2026021205 (COPASECUVA, reparación de 3 PNC360S-R) quedó en
 * COMPLETADO (EN OFICINA) el 2026-02-23. El cierre histórico del 2026-08-12 la
 * pasó a ENTREGADO AL CLIENTE porque los radios tenían airtime activo en el
 * PoC. Pero el PoC es plataforma, no ubicación: los tres radios nunca salieron
 * del taller (Solangel, 2026-10-13).
 *
 * Qué hace:
 *   · la orden vuelve a COMPLETADO (EN OFICINA) con `qc_requerido` para que
 *     no se entregue sin que el taller firme el QC. En ese QC se marca
 *     22N22A0167 como descartado (se queda en Cecomunica, daño del cliente,
 *     facturado en la 9478) y las otras dos como aprobadas. Al entregar,
 *     onOrdenWritePool manda las aprobadas a en_cliente y la descartada a
 *     cuarentena, y el cliente firma solo lo que se lleva;
 *   · `correccion_terminal`: onComplete no cuenta estadísticas ni manda correo
 *     por un trabajo de febrero;
 *   · los tres radios pasan de en_cliente a en_taller ligados a la orden, con
 *     kardex `reubicacion`. Se conserva la custodia del cliente.
 * No toca el PoC ni factura nada.
 *
 * USAGE (desde functions/):
 *   node scripts/copasecuva-revertir-cierre-historico-2026021205.js          # dry-run
 *   node scripts/copasecuva-revertir-cierre-historico-2026021205.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const pool = require("../src/domain/equiposPool");
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const dryRun = !process.argv.includes("--write");
const ORDEN = "2026021205";
const POR = "ayohros@gmail.com";
const ENTREGADO = "ENTREGADO AL CLIENTE";
const COMPLETADO = "COMPLETADO (EN OFICINA)";
const NOTA = "El cierre histórico 2026-08-12 dio la orden por entregada por el airtime activo en PoC; "
  + "los radios nunca salieron del taller (Solangel, 2026-10-13). Vuelve a EN OFICINA.";

(async () => {
  const ref = db.collection("ordenes_de_servicio").doc(ORDEN);
  const o = (await ref.get()).data();
  if (!o) throw new Error("La orden no existe");
  if (o.estado_reparacion !== ENTREGADO || o.actualizado_por_email !== "cierre-historico-2026-08-12") {
    console.log("La orden ya no está como la dejó el cierre histórico:", o.estado_reparacion, o.actualizado_por_email);
    process.exit(1);
  }
  const equipos = (o.equipos || []).filter((e) => e && !e.eliminado);
  console.log(`${dryRun ? "[DRY-RUN] " : ""}OS ${ORDEN}: ${o.estado_reparacion} → ${COMPLETADO}`);

  for (const e of equipos) {
    const { data } = await pool.resolver(e.numero_de_serie, e.modelo_id, e.modelo);
    console.log(`  ${e.numero_de_serie}: ${data?.estado} → en_taller (orden_actual_id ${data?.orden_actual_id || "—"} → ${ORDEN})`);
    if (data?.estado !== "en_cliente") throw new Error(`${e.numero_de_serie} no está en_cliente; revisar a mano`);
  }
  if (dryRun) { console.log("\nSin cambios. Correr con --write."); return; }

  await ref.update({
    estado_reparacion: COMPLETADO,
    qc_requerido: true,
    correccion_terminal: true,
    correccion_terminal_at: FV.serverTimestamp(),
    correccion_terminal_de: ENTREGADO,
    cierre_historico_revertido: { at: FV.serverTimestamp(), por: POR, nota_anterior: o.notas_entrega || "", motivo: NOTA },
    notas_entrega: FV.delete(),
    actualizado_en: FV.serverTimestamp(),
    actualizado_por_email: POR,
    os_logs: FV.arrayUnion({ action: "REVERTIR_CIERRE_HISTORICO", from: ENTREGADO, to: COMPLETADO, by: POR, nota: NOTA }),
  });

  const refMov = { tipo: "orden", id: ORDEN, label: ORDEN };
  for (const e of equipos) {
    const r = await pool.transicionar(e.numero_de_serie, e.modelo_id, e.modelo, {
      aEstado: pool.ESTADOS.EN_TALLER,
      soloDesde: [pool.ESTADOS.EN_CLIENTE],
      tipo: "reubicacion",
      refMov,
      notas: `Nunca salió del taller: la OS ${ORDEN} se dio por entregada en el cierre histórico 2026-08-12 (Solangel, 2026-10-13)`,
      extra: { orden_actual_id: ORDEN, updated_by_email: POR },
    });
    console.log(`  ${e.numero_de_serie}: ${r}`);
  }
  console.log("Listo.");
})().catch((e) => { console.error(e); process.exit(1); });
