/**
 * sanea-vencimientos-tipos.js — Retira la señal de vencimiento de los tipos
 * que NO renuevan: DEMO y TEMP (deep-dive 2026-08-26, pedido de Alberto:
 * "contratos demo pidiendo renovación no hace sentido").
 *
 * El backfill del 2026-08-26 estampó fecha_vencimiento a TODO contrato
 * activo/aprobado con duración parseable, incluyendo 19 DEMO y 4 TEMP. Un demo
 * o un temporal TERMINAN (sus equipos se recuperan por su propio flujo de
 * devolución) — no piden renovación. El REEMP se queda: vence con su duración
 * propia o hereda la del origen (backfill-vencimiento.js).
 *
 * QUÉ TOCA (solo con --write): borra fecha_vencimiento, vencimiento_estado,
 * vencimiento_estado_at y vigencia de los contratos DEMO/TEMP no borrados.
 * QUÉ NO: ALQ/PROP/REEMP intactos; ningún otro campo.
 *
 * USAGE (desde functions/):
 *   node scripts/sanea-vencimientos-tipos.js            # dry-run
 *   node scripts/sanea-vencimientos-tipos.js --write
 * Idempotente: un DEMO/TEMP sin fecha se salta.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const V = require("../src/lib/vigencia");

const dryRun = !process.argv.includes("--write");
const SIN_SENAL = ["DEMO", "TEMP"];

(async () => {
  const snap = await db.collection("contratos").get();
  const objetivo = [];
  snap.forEach((d) => {
    const c = d.data() || {};
    if (c.deleted) return;
    if (!SIN_SENAL.includes(V.codigoTipo(c))) return;
    if (!c.fecha_vencimiento && !c.vencimiento_estado && !c.vigencia) return;
    objetivo.push({ ref: d.ref, contrato: c.contrato_id || d.id, cliente: c.cliente_nombre || "—", tipo: V.codigoTipo(c), estado: c.vencimiento_estado || "—" });
  });

  console.log(`\n=== sanea-vencimientos-tipos ${dryRun ? "(DRY-RUN)" : "(WRITE)"} ===`);
  console.log(`DEMO/TEMP con señal a retirar: ${objetivo.length}`);
  objetivo.forEach((x) => console.log(`   · [${x.tipo}] ${x.contrato}  ${x.cliente}  (${x.estado})`));

  if (dryRun) { console.log("\nDry-run: nada escrito. --write para aplicar."); process.exit(0); }

  const DEL = admin.firestore.FieldValue.delete();
  for (let i = 0; i < objetivo.length; i += 400) {
    const batch = db.batch();
    for (const x of objetivo.slice(i, i + 400)) {
      batch.update(x.ref, {
        fecha_vencimiento: DEL,
        vencimiento_estado: DEL,
        vencimiento_estado_at: DEL,
        vigencia: DEL,
      });
    }
    await batch.commit();
  }
  console.log(`\nListo: señal retirada de ${objetivo.length} contratos DEMO/TEMP.`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
