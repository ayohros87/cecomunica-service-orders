/**
 * config-email-renovaciones.js — Configura empresa/config.email_renovaciones,
 * el buzón del digest diario "Contratos por vencer" (recordatorioOperativo
 * sección H). Sin esta clave el cron loguea "sin buzón" y la señal queda solo
 * en la app.
 *
 * USAGE (desde functions/):
 *   node scripts/config-email-renovaciones.js [--email=buzon@dominio] [--write]
 *
 * Default: ventas@cecomunica.net (el mismo buzón comercial de las bajas
 * aprobadas). Sin --write solo muestra el estado actual y lo que haría.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const WRITE = process.argv.includes("--write");
const emailArg = (process.argv.find(a => a.startsWith("--email=")) || "").slice(8).trim();
const EMAIL = emailArg || "ventas@cecomunica.net";

(async () => {
  const ref = db.collection("empresa").doc("config");
  const cfg = (await ref.get()).data() || {};
  console.log("email_renovaciones actual:", cfg.email_renovaciones || "(vacío)");
  if (cfg.email_renovaciones && !emailArg) {
    console.log("Ya está configurado — no se toca (pasa --email= para cambiarlo).");
    return;
  }
  if (!WRITE) { console.log(`DRY-RUN: escribiría email_renovaciones = ${EMAIL}`); return; }
  await ref.update({ email_renovaciones: EMAIL });
  console.log(`OK: email_renovaciones = ${EMAIL}`);
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
