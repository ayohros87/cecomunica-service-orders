/**
 * link-contrato-poc-lista.js — vincula a UN contrato los equipos POC de su
 * cliente que quedaron sueltos (sin `contrato_doc_id`).
 *
 * A diferencia del backfill global `linkContratoPoc` (runBackfill), que cruza
 * contra `equipos_pool.asignacion` y barre TODA la colección, este script:
 *   · se limita a un solo contrato (y a los equipos de SU cliente), y
 *   · cruza contra `contratos/{id}/seriales` — el contrato manda sobre POC
 *     (decisión 2026-07-27), así que no depende de que el pool esté al día ni
 *     tropieza con seriales compartidos entre dos modelos.
 *
 * Motivo (2026-07-30): cargar el archivo del vendedor en POC · Nuevo batch
 * reconstruía el <select> de contratos y borraba el que recepción ya había
 * elegido a mano; el lote de UDELAS (REEMP20260728-02) se creó sin vínculo y no
 * hay forma de re-vincularlo desde la UI. La causa raíz quedó arreglada en
 * public/js/pages/nuevo-batch.js.
 *
 * Conservador — NUNCA adivina:
 *   · device borrado o `activo !== true`            → se salta (reporta)
 *   · device ya vinculado a OTRO contrato           → se salta (reporta)
 *   · serial que no está en el contrato             → se salta
 *   · serial del contrato sin device POC            → se reporta
 * Aditivo e idempotente. Escribir `contrato_doc_id` no re-dispara
 * onPocDeviceWritePool (solo reacciona a cambios de serial).
 *
 * USAGE (desde functions/):
 *   node scripts/link-contrato-poc-lista.js REEMP20260728-02            → dry-run
 *   node scripts/link-contrato-poc-lista.js REEMP20260728-02 --write    → escribe
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const normSerial = (raw) =>
  (raw ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const arg = process.argv[2];
const write = process.argv.includes("--write");

// Acepta el docId de Firestore o la referencia visible (ALQ…/REEMP…).
async function resolverContrato(ref) {
  const porId = await db.collection("contratos").doc(ref).get();
  if (porId.exists) return { id: porId.id, ...porId.data() };
  const q = await db.collection("contratos").where("contrato_id", "==", ref).get();
  if (q.empty) return null;
  if (q.size > 1) {
    throw new Error(`"${ref}" corresponde a ${q.size} contratos (${q.docs.map(d => d.id).join(", ")}). Usa el docId.`);
  }
  return { id: q.docs[0].id, ...q.docs[0].data() };
}

(async () => {
  if (!arg) {
    console.error("Falta el contrato. USAGE: node scripts/link-contrato-poc-lista.js <contrato_id|docId> [--write]");
    process.exit(1);
  }

  const contrato = await resolverContrato(arg);
  if (!contrato) { console.error(`No existe el contrato "${arg}".`); process.exit(1); }
  const ref = contrato.contrato_id || contrato.id;
  console.log(`Contrato ${ref} [${contrato.id}] · ${contrato.tipo_contrato || "?"} · estado=${contrato.estado}`);
  console.log(`Cliente: ${contrato.cliente_nombre || contrato.cliente || "?"} [${contrato.cliente_id || "sin cliente_id"}]`);
  if (!contrato.cliente_id) { console.error("El contrato no tiene cliente_id — no se puede acotar la búsqueda."); process.exit(1); }

  // Seriales del contrato (fuente de verdad).
  const serSnap = await db.collection("contratos").doc(contrato.id).collection("seriales").get();
  const delContrato = new Map(); // norm → serial tal cual
  serSnap.forEach(d => {
    const s = (d.data().serial || "").toString().trim();
    if (s) delContrato.set(normSerial(s), s);
  });
  console.log(`Seriales en el contrato: ${delContrato.size} (de ${serSnap.size} filas)\n`);
  if (!delContrato.size) { console.error("El contrato no tiene seriales asignados."); process.exit(1); }

  // Equipos POC del MISMO cliente.
  const devSnap = await db.collection("poc_devices").where("cliente_id", "==", contrato.cliente_id).get();

  const aVincular = [], yaEste = [], otroContrato = [], inactivos = [];
  const vistos = new Set();
  devSnap.forEach(doc => {
    const d = doc.data() || {};
    if (d.deleted === true) return;
    const norm = normSerial(d.serial);
    if (!norm || !delContrato.has(norm)) return;
    vistos.add(norm);
    const actual = (d.contrato_doc_id || "").toString().trim();
    const linea = `${(d.serial || "").padEnd(14)} unit=${(d.unit_id ?? "").toString().padEnd(8)}`;
    if (actual === contrato.id) { yaEste.push(linea); return; }
    if (actual) { otroContrato.push(`${linea} → ${d.contrato_id || actual}`); return; }
    if (d.activo !== true) { inactivos.push(`${linea} (activo=${d.activo})`); return; }
    aVincular.push({ ref: doc.ref, linea });
  });

  const sinDevice = [...delContrato.entries()].filter(([n]) => !vistos.has(n)).map(([, s]) => s);

  console.log(`── ${write ? "ESCRITURA" : "DRY-RUN"} ──────────────────────────────`);
  console.log(`equipos POC del cliente:        ${devSnap.size}`);
  console.log(`  · ya vinculados a ${ref}:  ${yaEste.length}`);
  console.log(`  · vinculados a OTRO:          ${otroContrato.length}`);
  console.log(`  · inactivos (se saltan):      ${inactivos.length}`);
  console.log(`  · seriales sin equipo POC:    ${sinDevice.length}`);
  console.log(`  → SE VINCULAN:                ${aVincular.length}`);
  console.log("──────────────────────────────────────────────\n");

  if (aVincular.length)   { console.log("Se vinculan:");                   aVincular.forEach(v => console.log("  ✓ " + v.linea)); }
  if (otroContrato.length){ console.log("\nYa están en OTRO contrato (NO se tocan):"); otroContrato.forEach(l => console.log("  ! " + l)); }
  if (inactivos.length)   { console.log("\nInactivos (NO se tocan):");      inactivos.forEach(l => console.log("  – " + l)); }
  if (sinDevice.length)   { console.log("\nSeriales del contrato sin equipo POC:"); sinDevice.forEach(s => console.log("  · " + s)); }

  if (!write) { console.log("\n(dry-run — nada escrito. Repite con --write para aplicar.)"); process.exit(0); }
  if (!aVincular.length)  { console.log("\nNada que escribir."); process.exit(0); }

  let batch = db.batch(), ops = 0, escritos = 0;
  for (const v of aVincular) {
    batch.set(v.ref, {
      contrato_doc_id: contrato.id,
      contrato_id: contrato.contrato_id || null,
      contrato_vinculado_por: "script:link-contrato-poc-lista",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    if (++ops >= 400) { await batch.commit(); escritos += ops; batch = db.batch(); ops = 0; }
  }
  if (ops) { await batch.commit(); escritos += ops; }
  console.log(`\n✅ ${escritos} equipo(s) vinculados a ${ref}.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
