/**
 * concord-radios-en-cliente-2026-10-06.js — CONCORD SECURITY, ALQ20260810-01.
 *
 * QUÉ PASÓ
 *   La corrección del 17-sep (corrige-seriales-concord-2026-09-17.js) dejó en
 *   el contrato los 15 radios de la orden de PROGRAMACIÓN 2026080705, pero esa
 *   orden nunca registró la entrega (sigue "COMPLETADO (EN OFICINA)"). El pool
 *   los siguió viendo en_taller / asignado_contrato aunque el cliente los
 *   tiene desde agosto. El 6-oct Elvia no pudo marcar el radio dañado en el
 *   wizard de reemplazo.
 *
 * QUÉ HACE (Alberto, 2026-10-06: "el cliente sí tiene los radios")
 *   Pasa a en_cliente las fichas ligadas a ALQ20260810-01 que no lo estén,
 *   con movimiento en el kardex. No toca la orden ni el contrato.
 *
 * USAGE (desde functions/):
 *   node scripts/concord-radios-en-cliente-2026-10-06.js          # dry-run
 *   node scripts/concord-radios-en-cliente-2026-10-06.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");
const APPLY = process.argv.includes("--apply");

const CONTRATO_DOC_ID = "NCvl3uJYaXhHEf4LhCFV";
const CLIENTE_ID = "GxqXVWk6SYLKFU7v9bDM";
const NOTA = "Corrección 2026-10-06: CONCORD tiene estos radios desde agosto; la entrega de la "
  + "orden de PROGRAMACIÓN 2026080705 nunca se registró y el pool los seguía viendo en la oficina.";

(async () => {
  const c = (await db.collection("contratos").doc(CONTRATO_DOC_ID).get()).data();
  if (c?.contrato_id !== "ALQ20260810-01" || c.estado !== "activo") throw new Error("contrato inesperado");
  const s = await db.collection("equipos_pool").where("asignacion.contrato_doc_id", "==", CONTRATO_DOC_ID).get();
  const mover = s.docs.filter(d => d.data().asignacion?.cliente_id === CLIENTE_ID && d.data().estado !== pool.ESTADOS.EN_CLIENTE);
  console.log(`${s.size} fichas en el contrato · ${mover.length} pasan a en_cliente`);
  for (const d of mover) {
    const x = d.data();
    if (!APPLY) { console.log(`   ${x.serial}  ${x.modelo_label}  ${x.estado} → en_cliente`); continue; }
    const r = await pool.transicionarPorId(d.id, {
      aEstado: pool.ESTADOS.EN_CLIENTE, tipo: "correccion_manual",
      refMov: { tipo: "contrato", id: CONTRATO_DOC_ID, label: "ALQ20260810-01" }, notas: NOTA,
    });
    console.log(`   ${x.serial}  ${x.estado} → ${r}`);
  }
  if (!APPLY) console.log("\nDRY-RUN. Corre con --apply para escribir.");
})().catch(e => { console.error(e); process.exit(1); });
