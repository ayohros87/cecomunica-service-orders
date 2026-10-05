/**
 * reapunta-poc-sustituciones.js — pasa al contrato sustituto los equipos de la
 * Base PoC que se quedaron vinculados a un contrato anulado por SUSTITUCIÓN.
 *
 * El traspaso de onAnnulment movía el pool y los seriales del contrato, pero
 * nunca `poc_devices.contrato_doc_id`: la PoC seguía enseñando el número
 * muerto. Caso que lo destapó (2026-10-05, Brenda): MAGEN DAVID,
 * ALQ20260720-02 → ALQ20260812-02, 22 PNC460-R. Desde este commit el traspaso
 * reapunta la PoC (reapuntarPoc); esto barre lo de antes.
 *
 * Solo toca devices cuyo serial YA está en los seriales del sustituto.
 *
 * USAGE (desde functions/):
 *   node scripts/reapunta-poc-sustituciones.js                     # dry-run, todas
 *   node scripts/reapunta-poc-sustituciones.js --origen=ALQ20260720-02
 *   node scripts/reapunta-poc-sustituciones.js --aplicar
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const { reapuntarPoc } = require("../src/lib/sustitucionContrato");

const APLICAR = process.argv.includes("--aplicar");
const ORIGEN = (process.argv.find((a) => a.startsWith("--origen=")) || "").split("=")[1] || null;

(async () => {
  console.log(APLICAR ? "=== APLICANDO ===" : "=== DRY-RUN (usa --aplicar para escribir) ===");
  const snap = await db.collection("contratos").where("anulacion_tipo", "==", "sustitucion").get();
  let total = 0;
  for (const d of snap.docs) {
    const o = d.data() || {};
    if (ORIGEN && d.id !== ORIGEN && o.contrato_id !== ORIGEN) continue;
    if (!o.sustituido_por_id) continue;
    const sus = await db.collection("contratos").doc(o.sustituido_por_id).get();
    if (!sus.exists) { console.log(`! ${o.contrato_id}: el sustituto ${o.sustituido_por_id} no existe`); continue; }
    const r = await reapuntarPoc({
      origenId: d.id, origen: o, sustitutoId: sus.id, sustituto: sus.data() || {}, escribir: APLICAR,
    });
    if (!r.reapuntados) continue;
    total += r.reapuntados;
    console.log(`${o.contrato_id} → ${sus.data().contrato_id}: ${r.reapuntados} equipo(s) PoC`);
    console.log("   " + r.seriales.join(", "));
  }
  console.log(`\nTotal: ${total} equipo(s) ${APLICAR ? "reapuntados" : "por reapuntar"}.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
