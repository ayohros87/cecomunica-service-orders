/**
 * backfill-clientes-activo.js — pone `activo: true` en los clientes NO borrados
 * a los que les falta el campo.
 *
 * POR QUÉ (2026-09-09, reporte de Alberto sobre C COMUNICA, S.A.): el sistema
 * lee `activo` con DOS semánticas incompatibles y un doc sin el campo cae en
 * medio de las dos.
 *   · Al PINTAR:  `c.activo !== false`  → sin el campo sale "Activo".
 *   · Al FILTRAR: `where('activo','==',true)` (Firestore no matchea el campo
 *     ausente) → sin el campo el cliente NO aparece.
 * Resultado: la ficha dice "Activo" y la lista del Centro con "Solo activos"
 * (encendido por defecto) lo esconde. Se ve exactamente como una cuenta
 * desactivada que nadie desactivó.
 *
 * Se elige `true` porque es lo que ya dice cada pantalla que los pinta: nadie
 * los desactivó nunca. Los 3 clientes con `activo: false` de verdad no se
 * tocan, ni los borrados (`deleted: true`).
 *
 * Idempotente: solo escribe donde el campo falta.
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-clientes-activo.js            # dry-run
 *   node scripts/backfill-clientes-activo.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");

(async () => {
  const snap = await db.collection("clientes").get();
  const faltan = [];
  let activos = 0, inactivos = 0, borrados = 0;
  snap.docs.forEach((d) => {
    if (d.get("deleted") === true) { borrados++; return; }
    const a = d.get("activo");
    if (a === true) activos++;
    else if (a === false) inactivos++;
    else faltan.push(d);
  });

  console.log(`clientes: ${snap.size} (${borrados} borrados)`);
  console.log(`  activo:true  ${activos}`);
  console.log(`  activo:false ${inactivos}  (no se tocan)`);
  console.log(`  SIN el campo ${faltan.length}  ← se les pone activo:true`);
  faltan.slice(0, 15).forEach((d) => console.log(`     ${d.id}  ${d.get("nombre") || ""}`));
  if (faltan.length > 15) console.log(`     …y ${faltan.length - 15} más`);

  if (dryRun) { console.log("\nDRY-RUN — nada escrito. Corre con --write para aplicar."); return; }

  let n = 0;
  for (let i = 0; i < faltan.length; i += 400) {
    const batch = db.batch();
    faltan.slice(i, i + 400).forEach((d) => {
      batch.update(d.ref, {
        activo: true,
        activo_fuente: "backfill_activo_2026-09-09",
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      n++;
    });
    await batch.commit();
  }
  console.log(`\n${n} cliente(s) marcados activo:true`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
