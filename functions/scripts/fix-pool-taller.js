/**
 * fix-pool-taller.js — Corrección one-shot del estado en_taller del pool.
 *
 * La siembra marcó en_taller todo equipo de órdenes "vivas" (< 1 año, no
 * ENTREGADO). Pero "ENTREGADO AL CLIENTE" es una función RECIENTE: las órdenes
 * viejas quedaron en "COMPLETADO (EN OFICINA)"/"COMPLETO" para siempre aunque
 * el cliente ya retiró el equipo, y hay órdenes abiertas estancadas hace meses.
 * Regla de corrección (unidad en_taller → en_cliente):
 *   · orden COMPLET* con última actividad > 30 días  (retirada sin registro)
 *   · orden abierta con última actividad > 90 días   (estancada/abandonada)
 * Lo demás (cola activa reciente) se queda en_taller. Cada corrección deja
 * movimiento 'salida_taller' con nota. Idempotente.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-pool-taller.js            # dry-run
 *   node scripts/fix-pool-taller.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");

(async () => {
  const [poolSnap, ordenesSnap] = await Promise.all([
    db.collection("equipos_pool").where("estado", "==", "en_taller").get(),
    db.collection("ordenes_de_servicio").get(),
  ]);
  const ordenes = new Map();
  ordenesSnap.forEach((d) => ordenes.set(d.id, d.data()));

  const ahora = Date.now();
  const dias = (t) => (t?.toDate ? Math.floor((ahora - t.toDate().getTime()) / 86400000) : null);

  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  const r = { revisados: poolSnap.size, completadaRetirada: 0, estancada: 0, quedanEnTaller: 0 };
  for (const doc of poolSnap.docs) {
    const oid = doc.data().orden_actual_id;
    const o = oid ? ordenes.get(oid) : null;
    let motivo = null;
    if (o) {
      const est = String(o.estado_reparacion || "").trim().toUpperCase();
      const edad = dias(o.fecha_modificacion) ?? dias(o.updated_at) ?? dias(o.fecha_creacion) ?? 9999;
      const completada = est.startsWith("COMPLET");
      if (completada && edad > 30) { motivo = "Orden completada sin registro de entrega (función 'Entregado al cliente' es reciente)"; r.completadaRetirada++; }
      else if (!completada && edad > 90) { motivo = "Orden estancada sin actividad > 90 días"; r.estancada++; }
    } else {
      motivo = "Orden vinculada inexistente"; r.estancada++;
    }
    if (!motivo) { r.quedanEnTaller++; continue; }

    batch.update(doc.ref, {
      estado: "en_cliente",
      orden_actual_id: null,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(doc.ref.collection("movimientos").doc(), {
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null,
      tipo: "salida_taller", de_estado: "en_taller", a_estado: "en_cliente",
      ref: oid ? { tipo: "orden", id: oid, label: o?.numero_orden || oid } : null,
      notas: `Corrección histórica: ${motivo}`,
    });
    ops += 2;
    if (ops >= 400) await flush();
  }
  await flush();

  console.log(`fix-pool-taller — ${dryRun ? "DRY-RUN" : "ESCRITURA REAL"}`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
