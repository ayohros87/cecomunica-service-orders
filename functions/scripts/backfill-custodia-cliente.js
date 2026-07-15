/**
 * backfill-custodia-cliente.js — Estampa la CUSTODIA (con qué cliente está la
 * unidad) en los docs del pool que no tienen asignación. La asignación de
 * contrato nunca se toca; esto solo llena los huecos con
 * { contrato_doc_id: null, cliente_id, cliente_nombre }.
 *
 * Fuentes de la custodia (en orden):
 *   1. poc_device_id → cliente del device POC.
 *   2. Serial presente en poc_devices (aunque el doc no tenga el link) →
 *      cliente del device + se enlaza poc_device_id.
 *   3. Orden de servicio MÁS RECIENTE que contiene el serial → cliente de la
 *      orden (aplica a los que entraron por taller).
 * Idempotente: solo toca docs sin asignación. Dry-run por defecto.
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-custodia-cliente.js            # dry-run
 *   node scripts/backfill-custodia-cliente.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const dryRun = !process.argv.includes("--write");
const fechaDe = (t) => (t?.toDate ? t.toDate().getTime() : 0);

(async () => {
  const [poolSnap, pocSnap, ordenesSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("poc_devices").get(),
    db.collection("ordenes_de_servicio").get(),
  ]);

  // POC por id y por serial_norm
  const pocPorId = new Map(), pocPorSerial = new Map();
  pocSnap.forEach((d) => {
    const v = d.data();
    if (v.deleted === true) return;
    const info = {
      id: d.id,
      cliente_id: v.cliente_id || "",
      cliente_nombre: v.cliente_nombre || v.cliente || "",
    };
    pocPorId.set(d.id, info);
    const n = pool.normSerial(v.serial);
    if (n && !pocPorSerial.has(n)) pocPorSerial.set(n, info);
  });

  // Última orden por serial_norm
  const ultimaOrden = new Map(); // norm → {fecha, cliente_id, cliente_nombre}
  ordenesSnap.forEach((d) => {
    const o = d.data();
    if (o.eliminado === true) return;
    const f = fechaDe(o.fecha_creacion);
    for (const e of (o.equipos || [])) {
      if (!e || e.eliminado) continue;
      const n = pool.normSerial(e.serial || e.SERIAL || e.numero_de_serie);
      if (!n) continue;
      const cur = ultimaOrden.get(n);
      if (!cur || f > cur.fecha) {
        ultimaOrden.set(n, { fecha: f, cliente_id: o.cliente_id || "", cliente_nombre: o.cliente_nombre || "" });
      }
    }
  });

  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  const r = { revisados: poolSnap.size, conAsignacion: 0, porPocLink: 0,
    porPocSerial: 0, porOrden: 0, sinFuente: 0 };

  for (const doc of poolSnap.docs) {
    const v = doc.data();
    if (v.asignacion?.cliente_nombre || v.asignacion?.cliente_id) { r.conAsignacion++; continue; }

    let cliente = null, extra = {};
    const porLink = v.poc_device_id ? pocPorId.get(v.poc_device_id) : null;
    const porSerial = pocPorSerial.get(v.serial_norm);
    const porOrden = ultimaOrden.get(v.serial_norm);
    if (porLink && (porLink.cliente_nombre || porLink.cliente_id)) {
      cliente = porLink; r.porPocLink++;
    } else if (porSerial && (porSerial.cliente_nombre || porSerial.cliente_id)) {
      cliente = porSerial; r.porPocSerial++;
      if (!v.poc_device_id) extra.poc_device_id = porSerial.id;
    } else if (porOrden && (porOrden.cliente_nombre || porOrden.cliente_id)) {
      cliente = porOrden; r.porOrden++;
    } else {
      r.sinFuente++; continue;
    }

    batch.update(doc.ref, {
      asignacion: {
        contrato_doc_id: null, contrato_id: "",
        cliente_id: cliente.cliente_id || "",
        cliente_nombre: cliente.cliente_nombre || "",
      },
      ...extra,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    ops++;
    if (ops >= 400) await flush();
  }
  await flush();

  console.log(`backfill-custodia-cliente — ${dryRun ? "DRY-RUN" : "ESCRITURA REAL"}`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
