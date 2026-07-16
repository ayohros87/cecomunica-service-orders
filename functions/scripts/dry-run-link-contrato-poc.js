/**
 * dry-run-link-contrato-poc.js — SOLO LECTURA. Replica la lógica del backfill
 * linkContratoPoc (runBackfill) en modo dry-run y muestra el reporte completo:
 * cuántos devices POC se vincularían a su contrato cruzando el serial contra
 * equipos_pool.asignacion, más las muestras de ambiguos y sospechosos.
 *
 * USAGE (desde functions/): node scripts/dry-run-link-contrato-poc.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const normSerial = (raw) =>
  (raw ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  // Índice serial_norm → contratos asignados en el pool.
  const poolSnap = await db.collection("equipos_pool").get();
  const porSerial = new Map();
  for (const doc of poolSnap.docs) {
    const u = doc.data() || {};
    const cid = u.asignacion?.contrato_doc_id;
    const norm = u.serial_norm || normSerial(u.serial);
    if (!cid || !norm) continue;
    if (!porSerial.has(norm)) porSerial.set(norm, new Map());
    porSerial.get(norm).set(cid, {
      contrato_id: u.asignacion?.contrato_id || "",
      cliente_id: u.asignacion?.cliente_id || "",
      cliente_nombre: u.asignacion?.cliente_nombre || "",
    });
  }
  console.log(`Pool: ${poolSnap.size} docs, ${porSerial.size} seriales con contrato asignado.`);

  let scanned = 0, skippedDeleted = 0, skippedInactivos = 0, yaVinculados = 0, sinSerial = 0;
  let sinContrato = 0, ambiguos = 0, sospechosos = 0, vinculados = 0;
  const muestraAmbiguos = [];
  const muestraSospechosos = [];
  const muestraVinculados = [];

  const snap = await db.collection("poc_devices").get();
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (d.deleted === true) { skippedDeleted++; continue; }
    if (d.activo !== true) { skippedInactivos++; continue; }
    scanned++;
    if ((d.contrato_doc_id || "").toString().trim()) { yaVinculados++; continue; }

    const norm = normSerial(d.serial);
    if (!norm) { sinSerial++; continue; }

    const candidatos = porSerial.get(norm);
    if (!candidatos || candidatos.size === 0) { sinContrato++; continue; }
    if (candidatos.size > 1) {
      ambiguos++;
      if (muestraAmbiguos.length < 25) {
        muestraAmbiguos.push(`${d.serial}: ${[...candidatos.values()].map(c => c.contrato_id || "?").join(" / ")}`);
      }
      continue;
    }

    const [contratoDocId] = candidatos.keys();
    const info = candidatos.get(contratoDocId);
    if (info.cliente_id && d.cliente_id && info.cliente_id !== d.cliente_id) {
      sospechosos++;
      if (muestraSospechosos.length < 25) {
        muestraSospechosos.push(`${d.serial}: POC=${d.cliente_nombre || d.cliente_id} vs pool=${info.cliente_nombre || info.cliente_id} (${info.contrato_id || contratoDocId})`);
      }
      continue;
    }

    vinculados++;
    if (muestraVinculados.length < 15) {
      muestraVinculados.push(`${d.serial}: ${d.cliente_nombre || d.cliente_id || "?"} → ${info.contrato_id || contratoDocId}`);
    }
  }

  console.log(`
── linkContratoPoc DRY-RUN ─────────────────────────────
POC escaneados (activos):      ${scanned}
  · saltados (borrados):       ${skippedDeleted}
  · saltados (inactivos):      ${skippedInactivos}
  · ya vinculados:             ${yaVinculados}
  · sin serial:                ${sinSerial}
  · sin contrato en el pool:   ${sinContrato}
  · AMBIGUOS (2+ contratos):   ${ambiguos}
  · SOSPECHOSOS (cliente ≠):   ${sospechosos}
  → SE VINCULARÍAN:            ${vinculados}
────────────────────────────────────────────────────────`);

  if (muestraVinculados.length) {
    console.log("\nEjemplos que se vincularían:");
    muestraVinculados.forEach(m => console.log("  ✓ " + m));
  }
  if (muestraAmbiguos.length) {
    console.log("\nAmbiguos (NO se escriben):");
    muestraAmbiguos.forEach(m => console.log("  ? " + m));
  }
  if (muestraSospechosos.length) {
    console.log("\nSospechosos (NO se escriben):");
    muestraSospechosos.forEach(m => console.log("  ! " + m));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
