/**
 * shirley-venta-y-serv-2026-11-16.js — la venta de SHIRLEY DE LA ROSA
 * CASTAÑEDAS VALENTIN entró por los DOS caminos de una factura de venta.
 *
 * QUÉ PASÓ
 *   13-nov 18:41  Salomón crea SERV20261113-01 (6 PNC360S-R, línea propio).
 *   13-nov 20:32  Recepción pide la misma venta por "Venta facturada: pedir
 *                 seriales" (pedidos_venta rH5FNGULcocIyMMK1EZi, factura 11349).
 *   16-nov 14:31  Solís asigna 6 seriales al pedido → vendido; el trigger crea
 *                 la OS 2026111601 como "venta directa, no aplica contrato".
 *   16-nov 14:36  Solís asigna los MISMOS 6 seriales al SERV → asignado_contrato.
 *
 *   Pool y seriales cuadran (6 y 6, mismos radios). Lo que queda mal: la OS no
 *   cuelga del contrato, así que el feed "Órdenes por crear" pediría una
 *   SEGUNDA orden de programación para el SERV, y el contrato no tiene la
 *   factura 11349 registrada.
 *
 * QUÉ HACE
 *   1. Repunta la OS 2026111601 al SERV (igual que OrdenesService.
 *      repuntarContratoOrden). No toca estado, equipos, QC ni pool.
 *   2. Registra factura_venta 11349 en el contrato (igual que
 *      ContratosService.registrarFacturaVenta).
 *
 * USAGE (desde functions/):
 *   node scripts/shirley-venta-y-serv-2026-11-16.js           # dry-run
 *   node scripts/shirley-venta-y-serv-2026-11-16.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const POR = "script:shirley-venta-y-serv-2026-11-16";

const ORDEN = "2026111601";
const CONTRATO_DOC = "N2Sebv1youZyp50IEAIC";
const CONTRATO_ID = "SERV20261113-01";
const FACTURA = "11349";
const MOTIVO = "la venta se pidió por pedidos_venta y también se hizo el SERV con línea propio; mismos 6 seriales";

const key = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  console.log(`Modo: ${APPLY ? "APPLY" : "dry-run"}\n`);
  const oRef = db.collection("ordenes_de_servicio").doc(ORDEN);
  const cRef = db.collection("contratos").doc(CONTRATO_DOC);
  const [oSnap, cSnap, sers] = await Promise.all([oRef.get(), cRef.get(), cRef.collection("seriales").get()]);
  const o = oSnap.data() || {}; const c = cSnap.data() || {};
  const deOrden = new Set((o.equipos || []).filter((e) => e && !e.eliminado).map((e) => key(e.serial || e.numero_de_serie)));
  const delContrato = new Set(sers.docs.map((d) => key(d.data().serial)));
  const iguales = deOrden.size === delContrato.size && [...deOrden].every((s) => delContrato.has(s));

  const chequeos = [
    [oSnap.exists && o.eliminado !== true, "la orden existe y no está eliminada"],
    [!o.contrato?.contrato_doc_id, "la orden no cuelga hoy de ningún contrato"],
    [o.origen_venta?.factura_qbo === FACTURA, `la orden nace de la factura ${FACTURA}`],
    [c.contrato_id === CONTRATO_ID && ["aprobado", "activo"].includes(c.estado), `${CONTRATO_ID} vigente (${c.estado})`],
    [c.cliente_id === o.cliente_id, "mismo cliente en orden y contrato"],
    [iguales, `los ${deOrden.size} seriales de la orden son exactamente los ${delContrato.size} del contrato`],
    [!c.factura_venta || c.factura_venta.numero === FACTURA, "el contrato no tiene otra factura de venta"],
  ];
  let ok = true;
  for (const [pasa, desc] of chequeos) { console.log(`  ${pasa ? "✓" : "✗"} ${desc}`); if (!pasa) ok = false; }
  if (!ok) throw new Error("no pasa los candados — nada escrito");

  if (!APPLY) { console.log("\ndry-run: nada escrito. Corre con --apply."); return; }

  await oRef.update({
    contrato: { aplica: true, contrato_doc_id: CONTRATO_DOC, contrato_id: CONTRATO_ID, motivo_no_aplica: null },
    contrato_repuntado_desde: "—",
    contrato_repuntado_at: admin.firestore.FieldValue.serverTimestamp(),
    os_logs: admin.firestore.FieldValue.arrayUnion({
      action: "REPUNTAR_CONTRATO", by: POR, at: admin.firestore.Timestamp.now(),
      nota: `De — (venta directa ${FACTURA}) a ${CONTRATO_ID} — ${MOTIVO}`,
    }),
  });
  console.log(`✓ OS ${ORDEN} → ${CONTRATO_ID}`);

  if (!c.factura_venta) {
    await cRef.update({
      factura_venta: { numero: FACTURA, nota: `Registrada por script: ${MOTIVO}`, at: admin.firestore.FieldValue.serverTimestamp(), por_uid: null, por_email: POR },
      factura_venta_historial: admin.firestore.FieldValue.arrayUnion({ numero: FACTURA, at: admin.firestore.Timestamp.now(), por_email: POR }),
    });
    console.log(`✓ ${CONTRATO_ID}: factura de venta ${FACTURA}`);
  }
  console.log("\nHECHO.");
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
