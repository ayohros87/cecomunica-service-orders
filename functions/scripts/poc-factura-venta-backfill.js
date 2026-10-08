/**
 * poc-factura-venta-backfill.js — deja `venta_factura` (y `venta_pedido_id`) en
 * las fichas PoC de los radios vendidos por factura, sin contrato.
 *
 * Motivo (Brenda, 2026-10-08): un radio de venta directa no tenía nada bajo el
 * cliente en la lista de PoC; la factura solo quedaba en las notas (Goly,
 * factura 11076). Desde hoy nuevo-batch la escribe al elegir la factura como
 * fuente; este script cubre las fichas creadas antes.
 *
 * Conservador — por cada unidad `vendido` del pool con venta.factura:
 *   · ficha viva (activo, no borrada) con ese serial y el MISMO cliente
 *   · sin contrato_doc_id / contrato_id (si tiene contrato, manda el contrato)
 *   · sin venta_factura (idempotente)
 * Escribir venta_factura no re-dispara onPocDeviceWritePool (solo reacciona a
 * cambios de serial).
 *
 * USAGE (desde functions/):
 *   node scripts/poc-factura-venta-backfill.js            → dry-run
 *   node scripts/poc-factura-venta-backfill.js --write    → escribe
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const write = process.argv.includes("--write");

(async () => {
  const pool = await db.collection("equipos_pool").where("estado", "==", "vendido").get();
  let aplicar = 0, saltados = 0;
  for (const doc of pool.docs) {
    const p = doc.data();
    const factura = String(p.venta?.factura || "").trim();
    const clienteId = p.venta?.cliente_id || p.asignacion?.cliente_id || "";
    if (!factura || !clienteId || !p.serial) continue;
    const fichas = await db.collection("poc_devices").where("serial", "==", p.serial).get();
    const vivas = fichas.docs.filter(f => {
      const d = f.data();
      return d.activo !== false && d.deleted !== true && d.cliente_id === clienteId;
    });
    for (const f of vivas) {
      const d = f.data();
      if (d.venta_factura) continue;
      if (d.contrato_doc_id || d.contrato_id) {
        saltados++;
        console.log(`  salto ${p.serial} (unit ${d.unit_id}): tiene contrato ${d.contrato_id || d.contrato_doc_id}`);
        continue;
      }
      aplicar++;
      console.log(`${write ? "ESCRIBO" : "aplicaría"} ${p.serial} unit ${d.unit_id} · ${d.cliente_nombre || clienteId} → ${factura}`);
      if (write) {
        await f.ref.update({
          venta_factura: factura,
          venta_pedido_id: p.venta?.pedido_id || null,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }
  console.log(`\n${aplicar} ficha(s) ${write ? "actualizadas" : "por actualizar"} · ${saltados} con contrato (sin tocar)`);
})().catch(e => { console.error(e); process.exit(1); });
