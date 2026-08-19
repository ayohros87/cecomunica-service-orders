/**
 * backfill-ordenes-eliminado.js — estampa `eliminado: false` en las órdenes
 * que NO tienen el campo (auditoría órdenes P3.19).
 *
 * POR QUÉ. La bandeja filtra los soft-deleted EN CLIENTE: se descargan y se
 * botan. Para filtrar server-side (`where("eliminado","==",false)`) el campo
 * tiene que EXISTIR en todos los docs — una igualdad sobre campo ausente
 * EXCLUYE el doc, y las órdenes legacy quedarían invisibles. Los creadores
 * vivos ya lo estampan (nueva-orden.js, ordenes-devolucion.js y la CF
 * ordenDevolucion); este script cubre el histórico.
 *
 * Idempotente: solo toca docs SIN el campo. No cambia eliminado:true/false
 * existentes ni ningún otro campo (update parcial).
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-ordenes-eliminado.js            # DRY RUN
 *   node scripts/backfill-ordenes-eliminado.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

(async () => {
  const snap = await db.collection("ordenes_de_servicio").select("eliminado").get();
  const total = snap.size;
  const sinCampo = [];
  let conTrue = 0, conFalse = 0;
  snap.forEach(doc => {
    const d = doc.data();
    if (!("eliminado" in d)) sinCampo.push(doc.id);
    else if (d.eliminado === true) conTrue++;
    else conFalse++;
  });

  console.log(`Órdenes: ${total} · con eliminado:true ${conTrue} · con eliminado:false ${conFalse} · SIN campo ${sinCampo.length}`);
  if (!sinCampo.length) { console.log("Nada que hacer."); process.exit(0); }

  if (!APPLY) {
    console.log(`DRY RUN — se estamparía eliminado:false en ${sinCampo.length} docs. Primeros 10:`, sinCampo.slice(0, 10).join(", "));
    process.exit(0);
  }

  let escritos = 0;
  for (let i = 0; i < sinCampo.length; i += 400) {
    const batch = db.batch();
    sinCampo.slice(i, i + 400).forEach(id => {
      batch.update(db.collection("ordenes_de_servicio").doc(id), { eliminado: false });
    });
    await batch.commit();
    escritos += Math.min(400, sinCampo.length - i);
    console.log(`  ${escritos}/${sinCampo.length}…`);
  }
  console.log(`LISTO: eliminado:false estampado en ${escritos} órdenes.`);
  process.exit(0);
})().catch(e => { console.error("FALLO:", e.message || e); process.exit(1); });
