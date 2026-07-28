/**
 * anular-contrato.js — Anula un contrato desde consola, igual que el botón
 * "Anular" de Contratos (public/js/pages/contratos-list.js), para los casos que
 * la UI no cubre bien: contratos viejos/legacy que quedaron abiertos y nadie
 * cierra. El sistema no tiene estado "finalizado": cerrar = anular con motivo.
 *
 * Dispara onAnnulment (correo + orden de DEVOLUCIÓN en modo confirmación para
 * las unidades del pool asignadas A ESTE contrato). Por eso el dry-run imprime
 * PRIMERO qué unidades cuelgan de él: si la unidad ya está asignada a otro
 * contrato, la anulación no la toca y no se crea tiquete.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/anular-contrato.js DEMO20260629-01 "motivo…"
 *   node scripts/anular-contrato.js DEMO20260629-01 "motivo…" --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const args = process.argv.slice(2).filter((a) => a !== "--execute");
const EXECUTE = process.argv.includes("--execute");
const CONTRATO_ID = args[0];
const MOTIVO = (args[1] || "").trim();
const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  if (!CONTRATO_ID || !MOTIVO) {
    console.error('USO: node scripts/anular-contrato.js <contrato_id> "<motivo>" [--execute]');
    process.exit(1);
  }
  const q = await db.collection("contratos").where("contrato_id", "==", CONTRATO_ID).get();
  if (q.size !== 1) {
    console.error(`Se esperaba 1 contrato con contrato_id=${CONTRATO_ID}, hay ${q.size}.`);
    process.exit(1);
  }
  const doc = q.docs[0];
  const c = doc.data();
  console.log(`${c.contrato_id} · ${doc.id} [${c.codigo_tipo || c.tipo_contrato}|${c.estado}] · ${c.cliente_nombre}`);
  if (!["activo", "aprobado"].includes(c.estado)) {
    console.error(`Solo se anula un contrato ACTIVO o APROBADO (está "${c.estado}").`);
    process.exit(1);
  }

  const ser = await doc.ref.collection("seriales").get();
  console.log(`\nSeriales listados: ${ser.size}`);
  let colgando = 0;
  for (const s of ser.docs) {
    const n = norm(s.data().serial);
    const fichas = await db.collection("equipos_pool").where("serial_norm", "==", n).get();
    const suyas = fichas.docs.filter((f) => f.data().asignacion?.contrato_doc_id === doc.id);
    colgando += suyas.length;
    console.log(`  ${s.data().serial} · ${suyas.length ? "ASIGNADA A ESTE CONTRATO → entraría al tiquete de devolución"
      : `asignada a ${fichas.docs[0]?.data().asignacion?.cliente_nombre || "nadie"} → la anulación no la toca`}`);
  }
  console.log(`\nUnidades que colgarían de la devolución: ${colgando}`
    + (colgando ? "" : "  (no se creará orden de DEVOLUCIÓN)"));
  console.log(`Motivo: ${MOTIVO}`);
  if (!EXECUTE) { console.log("\nDRY-RUN — nada escrito."); return; }

  const update = {
    estado: "anulado",
    anulado: true,
    anulado_motivo: MOTIVO,
    anulado_fecha: admin.firestore.Timestamp.now(),
    anulado_por_uid: null,          // cierre administrativo por script
    anulado_ref: c.contrato_id || doc.id,
    fecha_modificacion: admin.firestore.Timestamp.now(),
  };
  if (c.firmado || c.firmado_url) {
    Object.assign(update, {
      firmado_anulado: true,
      firmado_url_anulado: c.firmado_url || null,
      firmado_nombre_anulado: c.firmado_nombre || null,
      firmado_storage_path_anulado: c.firmado_storage_path || null,
      firmado_fecha_anulado: c.firmado_fecha || null,
      firmado: false, firmado_url: null, firmado_nombre: null,
    });
  }
  await doc.ref.set(update, { merge: true });
  console.log("\nESCRITURA — contrato anulado. onAnnulment enviará el correo a recepción.");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
