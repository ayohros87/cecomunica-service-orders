// Cuadre de verificaciones/ contra contratos/: recorre TODAS las
// verificaciones y repara las que no dicen lo que dice su contrato
// (domain/verificacionEstado). Lo usan el backfill del panel admin
// (runBackfill cuadrarVerificaciones) y el cuadre semanal
// (triggers/scheduled/cuadreVerificaciones). Idempotente: la segunda vuelta
// no escribe nada.
//
// Una verificación sin contrato (el doc se borró físicamente) no se toca: se
// reporta en `sinContrato` para que alguien decida.
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { patchVerificacion } = require("../domain/verificacionEstado");

const BATCH_SIZE = 400;
const GETALL_CHUNK = 300;

async function cuadrarVerificaciones({ dryRun = false, tag = "cuadreVerificaciones" } = {}) {
  const startedAt = Date.now();
  const snap = await db.collection("verificaciones").get();

  // Contratos en lotes de getAll (una verificación por contrato: ~500 docs).
  const contratos = new Map();
  const refs = snap.docs.map(d => db.collection("contratos").doc(d.id));
  for (let i = 0; i < refs.length; i += GETALL_CHUNK) {
    const docs = await db.getAll(...refs.slice(i, i + GETALL_CHUNK));
    docs.forEach(d => { if (d.exists) contratos.set(d.id, d.data() || {}); });
  }

  let scanned = 0, sinContrato = 0, skippedUnchanged = 0, toWrite = 0, written = 0, errors = 0;
  let estadoCorregido = 0, numeroCorregido = 0;
  const porCambio = {};
  const muestra = [];

  let batch = db.batch();
  let opsInBatch = 0;
  const flushBatch = async () => {
    if (opsInBatch === 0) return;
    if (dryRun) { written += opsInBatch; batch = db.batch(); opsInBatch = 0; return; }
    try { await batch.commit(); written += opsInBatch; }
    catch (err) { logger.error(`[${tag}] batch commit failed`, { err: err.message }); errors += opsInBatch; }
    batch = db.batch(); opsInBatch = 0;
  };

  for (const doc of snap.docs) {
    scanned++;
    const c = contratos.get(doc.id);
    if (!c) { sinContrato++; continue; }
    const v = doc.data() || {};
    const patch = patchVerificacion({
      verificacion: v, contrato: c, docId: doc.id,
      ahora: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (!patch) { skippedUnchanged++; continue; }
    toWrite++;
    if (patch.estado !== undefined) {
      estadoCorregido++;
      const k = `${v.estado || "(sin)"} → ${patch.estado}`;
      porCambio[k] = (porCambio[k] || 0) + 1;
      if (muestra.length < 25) muestra.push(`${c.contrato_id || doc.id}: ${k}`);
    }
    if (patch.contrato_id !== undefined) numeroCorregido++;
    batch.update(doc.ref, patch);
    opsInBatch++;
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  const detalle = {};
  if (muestra.length) {
    detalle.estados = {
      titulo: `Estado corregido — ${estadoCorregido}: ${Object.entries(porCambio).map(([k, n]) => `${k} (${n})`).join(", ")}`,
      muestra,
    };
  }
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { scanned, sinContrato, skippedUnchanged, toWrite, estadoCorregido, numeroCorregido, written, errors, porCambio, detalle, elapsedSec };
}

module.exports = { cuadrarVerificaciones };
