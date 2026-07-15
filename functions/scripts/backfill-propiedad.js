/**
 * backfill-propiedad.js — Inferencia one-shot de la PROPIEDAD de cada unidad
 * del pool (equipos_pool.propiedad: 'cecomunica' | 'cliente' | 'desconocida').
 *
 * Reglas (en orden):
 *   1. Asignada a un contrato → según tipo_contrato: "Propio" (venta con
 *      contrato de servicio) = cliente; Alquiler/Temporal/Demo/Reemplazo =
 *      cecomunica.
 *   2. Vinculada a un poc_device → cecomunica (flota PoC propia).
 *   3. Origen bodega / toma_fisica / import_excel → cecomunica.
 *   4. Entró solo por orden de servicio y su serial NO existe en POC ni está
 *      amparado por contrato → cliente (la flota propia siempre vive en POC o
 *      en un contrato; lo que solo se ve en taller es equipo del cliente).
 *   5. Resto (p.ej. serial presente en POC sin vínculo — modelo conflictivo)
 *      → desconocida, para revisión humana.
 * Nunca pisa una propiedad ya definida distinta de 'desconocida'. Idempotente.
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-propiedad.js            # dry-run
 *   node scripts/backfill-propiedad.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");

(async () => {
  const poolLib = require("../src/domain/equiposPool");
  const [poolSnap, contratosSnap, pocSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("contratos").get(),
    db.collection("poc_devices").get(),
  ]);
  const contratos = new Map();
  contratosSnap.forEach((d) => contratos.set(d.id, d.data()));
  const serialesEnPoc = new Set();
  pocSnap.forEach((d) => {
    const v = d.data();
    if (v.deleted !== true && v.serial) serialesEnPoc.add(poolLib.normSerial(v.serial));
  });

  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  const r = { revisados: poolSnap.size, yaClasificados: 0,
    cecomunicaPorContrato: 0, clientePorContrato: 0, cecomunicaPorPoc: 0,
    cecomunicaPorBodega: 0, clienteSoloTaller: 0, desconocida: 0 };

  for (const doc of poolSnap.docs) {
    const v = doc.data();
    if (v.propiedad && v.propiedad !== "desconocida") { r.yaClasificados++; continue; }

    let propiedad = null;
    const c = v.asignacion?.contrato_doc_id ? contratos.get(v.asignacion.contrato_doc_id) : null;
    if (c) {
      const esPropio = c.tipo_contrato === "Propio" || c.codigo_tipo === "PROP";
      propiedad = esPropio ? "cliente" : "cecomunica";
      if (esPropio) r.clientePorContrato++; else r.cecomunicaPorContrato++;
    } else if (v.poc_device_id) {
      propiedad = "cecomunica"; r.cecomunicaPorPoc++;
    } else if (["bodega", "toma_fisica", "import_excel"].includes(v.origen)) {
      propiedad = "cecomunica"; r.cecomunicaPorBodega++;
    } else if (v.origen === "migracion_orden" && !serialesEnPoc.has(v.serial_norm)) {
      propiedad = "cliente"; r.clienteSoloTaller++;
    } else {
      propiedad = "desconocida"; r.desconocida++;
    }

    if ((v.propiedad || null) === propiedad) continue; // sin cambio
    batch.update(doc.ref, { propiedad, updated_at: admin.firestore.FieldValue.serverTimestamp() });
    ops++;
    if (ops >= 400) await flush();
  }
  await flush();

  console.log(`backfill-propiedad — ${dryRun ? "DRY-RUN" : "ESCRITURA REAL"}`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
