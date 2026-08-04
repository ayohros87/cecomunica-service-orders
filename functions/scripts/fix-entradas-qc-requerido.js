/**
 * fix-entradas-qc-requerido.js — apaga `qc_requerido` en las órdenes de
 * ENTRADA que lo arrastran por error.
 *
 * Las ENTRADA (inspección de devueltos) cierran por CERRADA (ENTRADA), sin
 * entrega ni control de calidad: `completarOrden` les pasa qcRequerido:false
 * desde el 2026-07-21. Las que se completaron ANTES de ese cambio quedaron con
 * la marca puesta, así que aparecen para siempre como "esperando QC" en la
 * cola, en el chip del resumen, en la señal del home y en la sección D del
 * recordatorio diario — sin que nadie pueda ni deba firmarlas.
 *
 * No bloquean nada (la regla de entrega exime ENTRADA por tipo); esto es
 * higiene de la cola.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-entradas-qc-requerido.js          # dry-run
 *   node scripts/fix-entradas-qc-requerido.js --apply  # escribe
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

(async () => {
  const snap = await db.collection("ordenes_de_servicio")
    .where("qc_requerido", "==", true).get();

  const objetivo = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (d.eliminado === true) return;
    if (String(d.tipo_de_servicio || "") !== "ENTRADA") return;
    objetivo.push({
      id: doc.id,
      estado: String(d.estado_reparacion || ""),
      // Una ENTRADA nunca debería tener QC firmado; si lo tiene, es señal de
      // que alguien lo hizo a mano y hay que mirarlo antes de tocar nada.
      qc: d.qc?.resultado || "",
    });
  });

  console.log(`\nÓrdenes ENTRADA con qc_requerido=true: ${objetivo.length}`);
  objetivo.forEach((o) =>
    console.log(`   ${o.id.padEnd(16)} ${o.estado.padEnd(26)} qc='${o.qc}'`));

  const conQc = objetivo.filter((o) => o.qc);
  if (conQc.length) {
    console.log(`\n⚠️  ${conQc.length} tienen QC firmado — se OMITEN (revisar a mano):`);
    conQc.forEach((o) => console.log(`   ${o.id}`));
  }

  const aplicables = objetivo.filter((o) => !o.qc);
  if (!APPLY) {
    console.log(`\nDRY-RUN. Se apagaría qc_requerido en ${aplicables.length} orden(es).`);
    console.log("Volver a correr con --apply para escribir.\n");
    process.exit(0);
  }

  let n = 0;
  for (const o of aplicables) {
    await db.collection("ordenes_de_servicio").doc(o.id).update({ qc_requerido: false });
    n++;
    console.log(`   ✓ ${o.id}`);
  }
  console.log(`\nListo: ${n} orden(es) actualizada(s).\n`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
