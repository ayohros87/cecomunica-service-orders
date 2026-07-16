/**
 * run-link-contrato-poc.js — ejecuta el backfill linkContratoPoc (la MISMA
 * lógica del callable runBackfill) en modo ESCRITURA desde local, sin pasar
 * por auth de onCall. Vincula poc_devices ACTIVOS a su contrato cruzando el
 * serial contra equipos_pool.asignacion; ambiguos y sospechosos no se tocan.
 *
 * USAGE (desde functions/):
 *   node scripts/run-link-contrato-poc.js            → dry-run
 *   node scripts/run-link-contrato-poc.js --write    → escritura real
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });

const { backfillLinkContratoPoc } = require("../src/callable/runBackfill");

const write = process.argv.includes("--write");

(async () => {
  const r = await backfillLinkContratoPoc(!write);
  console.log(`\nlinkContratoPoc ${write ? "ESCRITURA" : "dry-run"}:`);
  const { detalle, ...counters } = r;
  console.table(counters);
  if (detalle?.ambiguos)    { console.log(detalle.ambiguos.titulo);    detalle.ambiguos.muestra.forEach(m => console.log("  ? " + m)); }
  if (detalle?.sospechosos) { console.log(detalle.sospechosos.titulo); detalle.sospechosos.muestra.forEach(m => console.log("  ! " + m)); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
