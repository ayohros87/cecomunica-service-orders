/**
 * goly-reposicion-robo-2026-10-08.js — la "venta" de la factura 11076 era la
 * REPOSICIÓN de un radio alquilado que robaron.
 *
 * Caso (Brenda / Alberto, 2026-10-08): COMPAÑÍA GOLY reportó robado el PNC460
 * 23905A0436 (de CECOMUNICA, contrato REEMP20260303-01) el 2026-10-04 y pagó el
 * reemplazo con la factura 11076. Recepción lo pidió como "venta facturada"
 * (pedidos_venta L4laEI7uwoaYuMqJTH4K) y bodega asignó 25220A0521, que quedó
 * `vendido`, propiedad del cliente. Alberto: "goly es caso de alquiler, así que
 * el reemplazo que goly pagó queda como radio de cecomunica, el robado se da
 * de baja".
 *
 * Hace lo que habría hecho una gestión de reemplazo (mismo molde que
 * callable/regularizarReemplazoOrden, que no sirve aquí: el robado no está en
 * la orden y el entrante está vendido):
 *   · gestiones/GR…: reemplazo cerrado, origen regularización, con la OS
 *     2026100805 como su programación. `saliente_en_casa: true` para que la
 *     entrega de la OS no abra una devolución de un radio que no va a volver.
 *   · entrante 25220A0521: vendido → asignado_contrato, propiedad cecomunica,
 *     asignado a REEMP20260303-01, linaje reemplaza_a. La venta se guarda en
 *     `venta_anulada` (la factura sigue siendo el cobro de la reposición).
 *     Al entregarse la OS, onOrdenWritePool lo pasa a en_cliente como a
 *     cualquier radio de contrato.
 *   · saliente 23905A0436: baja por robo (sale del contrato en el pool; el
 *     contrato firmado NO se toca).
 *   · OS 2026100805: contrato aplica + gestion; observación del equipo.
 *   · pedido L4laEI7uwoaYuMqJTH4K: `reclasificado` (sigue `asignada`).
 *   · ficha PoC 275671: contrato y gestión en vez de la factura de venta.
 *
 * Idempotente: si el pedido ya está reclasificado, no hace nada.
 * USAGE (desde functions/): node scripts/goly-reposicion-robo-2026-10-08.js [--write]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const write = process.argv.includes("--write");

const PEDIDO = "L4laEI7uwoaYuMqJTH4K";
const ORDEN = "2026100805";
const ENT = "25220A0521";
const SAL = "23905A0436";
const CT_DOC = "MaFlXc7oYO93RXDlHrjq";
const CT_ID = "REEMP20260303-01";
const POC_ENT = "2ReHOOFARGern8XP4bOi";
const FACTURA = "11076";
const POR = "ayohros@gmail.com";
const MOTIVO = `Robo reportado el 2026-10-04: el cliente pagó la reposición con la factura ${FACTURA}. Radio de alquiler: el reemplazo es de CECOMUNICA (Alberto, 2026-10-08).`;

async function reservarNumero() {
  const fechaStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" }).replace(/-/g, "");
  const ref = db.collection("contadores").doc(`gestiones_GR_${fechaStr}`);
  const seq = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const siguiente = (snap.exists ? Number(snap.data().seq || 0) : 0) + 1;
    t.set(ref, { seq: siguiente, prefijo: "GR", fecha: fechaStr, actualizado_en: FV.serverTimestamp() }, { merge: true });
    return siguiente;
  });
  return `GR${fechaStr}-${String(seq).padStart(2, "0")}`;
}

(async () => {
  const pRef = db.collection("pedidos_venta").doc(PEDIDO);
  const p = (await pRef.get()).data();
  if (p.reclasificado) { console.log("Ya reclasificado:", JSON.stringify(p.reclasificado)); return; }
  const eRef = db.collection("equipos_pool").doc(ENT);
  const sRef = db.collection("equipos_pool").doc(SAL);
  const e = (await eRef.get()).data();
  const s = (await sRef.get()).data();
  const oRef = db.collection("ordenes_de_servicio").doc(ORDEN);
  const o = (await oRef.get()).data();

  // Precondiciones: el estado que se vio al decidir.
  const checks = [
    [e.estado === "vendido" && e.venta?.factura === FACTURA, `entrante vendido con factura ${FACTURA}`],
    [s.estado === "en_cliente" && s.asignacion?.contrato_doc_id === CT_DOC, `saliente en_cliente en ${CT_ID}`],
    [!o.gestion?.id && o.estado_reparacion !== "ANULADA", "OS sin gestión y viva"],
    [e.modelo_id === s.modelo_id, `mismo modelo (${e.modelo_label} / ${s.modelo_label})`],
  ];
  checks.forEach(([ok, txt]) => console.log(ok ? "ok  " : "FALLA", txt));
  if (checks.some(([ok]) => !ok)) process.exit(1);
  console.log(`OS ${ORDEN}: ${o.estado_reparacion}`);
  if (!write) { console.log("\nDry-run. Con --write aplica."); return; }

  const gid = await reservarNumero();
  const now = FV.serverTimestamp();
  const cliente = { id: p.cliente_id, nombre: p.cliente_nombre };
  const item = {
    serial_saliente: SAL, pool_doc_id_saliente: SAL, modelo: s.modelo_label || "", modelo_id: s.modelo_id || null,
    contrato_doc_id: CT_DOC, contrato_id: CT_ID,
    serial_nuevo: ENT, pool_doc_id_nuevo: ENT, modelo_id_nuevo: e.modelo_id || null, modelo_nuevo: e.modelo_label || "",
    saliente_en_casa: true, saliente_robado: true,
    elegibilidad: "regularizacion", motivo_codigo: "robo", motivo_detalle: MOTIVO,
  };
  const gref = db.collection("gestiones").doc(gid);
  await gref.set({
    tipo: "reemplazo", numero: gid, estado: "cerrada", regularizada: true,
    cliente_id: cliente.id, cliente_nombre: cliente.nombre,
    causa: "regularizacion", notas: MOTIVO,
    reposicion: { motivo: "robo", fecha_reporte: "2026-10-04", factura_qbo: FACTURA, pedido_venta_id: PEDIDO, pagada: true },
    origen: { tipo: "regularizacion", orden_id: ORDEN, por_uid: null, por_email: POR, at: now },
    aprobacion: { requiere: false, aprobado_por_email: POR, at: now, motivo: "Reposición por robo pagada por el cliente (factura " + FACTURA + ")" },
    items: [item], contratos_afectados: [CT_DOC],
    ordenes: { programacion_id: ORDEN, programacion_ids: [ORDEN] },
    cierre: { aprobacion: true, asignacion: true, programacion: false, entrega: false, entrada: true },
    cerrada_at: now, cerrada_por: POR, cerrada_motivo: "regularizacion",
    creado_por_uid: null, creado_por_email: POR, fecha_creacion: now, updated_at: now,
  });
  await gref.collection("mapeos").add({ saliente: SAL, entrante: ENT, modelo: e.modelo_label, modelo_id: e.modelo_id, contrato_doc_id: CT_DOC, contrato_id: CT_ID, auto: false, regularizado: true, at: now, por: POR });
  await gref.collection("eventos").add({ accion: "regularizacion", detalle: `Reemplazo registrado a posteriori: ${SAL} (robado) → ${ENT}, entregado con la orden ${ORDEN}. ${MOTIVO}`, at: now, por_uid: null, por_email: POR });
  console.log("gestión", gid);

  // Entrante: deshace la venta, queda asignado al contrato de alquiler.
  const refMov = { tipo: "gestion", id: gid, label: gid };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(eRef);
    if (snap.data().estado !== "vendido") throw new Error("el entrante cambió de estado");
    tx.set(eRef, {
      estado: "asignado_contrato",
      propiedad: "cecomunica",
      venta: FV.delete(),
      venta_anulada: { ...snap.data().venta, motivo: "reposicion_alquiler", gestion_id: gid, at: now, por_email: POR },
      asignacion: { contrato_doc_id: CT_DOC, contrato_id: CT_ID, cliente_id: cliente.id, cliente_nombre: cliente.nombre, gestion_doc_id: gid },
      reemplaza_a: SAL,
      reemplazo_origen: { gestion_id: gid, saliente: SAL, orden_entrega_id: ORDEN, contrato_doc_id: CT_DOC, contrato_id: CT_ID, at: now, regularizado: true },
      updated_at: now, updated_by_email: POR,
    }, { merge: true });
    tx.set(eRef.collection("movimientos").doc(), {
      at: now, por: POR, por_email: POR, tipo: "reemplazo", de_estado: "vendido", a_estado: "asignado_contrato", ref: refMov,
      notas: `No era venta: reposición del ${SAL} robado (contrato ${CT_ID}), pagada con la factura ${FACTURA}. Queda de CECOMUNICA en el contrato (gestión ${gid}).`,
    });
  });

  // Saliente: baja por robo.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(sRef);
    if (snap.data().estado !== "en_cliente") throw new Error("el saliente cambió de estado");
    tx.set(sRef, {
      estado: "baja", baja_motivo: `Robado (reportado 2026-10-04 por ${cliente.nombre}); repuesto por ${ENT}, gestión ${gid}, factura ${FACTURA}`,
      asignacion: null, orden_actual_id: null, pendiente_devolucion: FV.delete(),
      updated_at: now, updated_by_email: POR,
    }, { merge: true });
    tx.set(sRef.collection("movimientos").doc(), {
      at: now, por: POR, por_email: POR, tipo: "baja", de_estado: "en_cliente", a_estado: "baja", ref: refMov,
      notas: `Robado (reportado 2026-10-04). Sustituido por ${ENT} (gestión ${gid}); el cliente pagó la reposición (factura ${FACTURA}).`,
    });
  });

  // La orden.
  const equipos = (o.equipos || []).map(x => (x.serial === ENT || x.numero_de_serie === ENT)
    ? { ...x, observaciones: `Reposición del ${SAL} robado (contrato ${CT_ID}) — factura ${FACTURA}. ${String(x.observaciones || "").replace(/^Venta directa:?\s*/i, "")}`.trim() }
    : x);
  await oRef.set({
    contrato: { aplica: true, contrato_doc_id: CT_DOC, contrato_id: CT_ID, motivo_no_aplica: null },
    gestion: { id: gid, tipo: "reemplazo", regularizada: true },
    equipos,
    os_logs: FV.arrayUnion({ action: "REGULARIZAR_REEMPLAZO", by: POR, at: admin.firestore.Timestamp.now(), nota: `${SAL} (robado) → ${ENT} (gestión ${gid}); no era venta, factura ${FACTURA} = reposición` }),
  }, { merge: true });

  // El pedido y la ficha PoC.
  await pRef.set({ reclasificado: { como: "reposicion_alquiler", gestion_id: gid, contrato_id: CT_ID, motivo: MOTIVO, at: now, por_email: POR } }, { merge: true });
  await db.collection("poc_devices").doc(POC_ENT).set({
    contrato_doc_id: CT_DOC, contrato_id: CT_ID, gestion_id: gid, gestion_tipo: "reemplazo",
    venta_factura: FV.delete(), venta_pedido_id: FV.delete(), updated_at: now,
  }, { merge: true });
  await db.collection("poc_logs").add({ action: "REGULARIZAR_REEMPLAZO", device_id: POC_ENT, serial: ENT, detalle: `Contrato ${CT_ID} / gestión ${gid}: reposición del ${SAL} robado (factura ${FACTURA})`, by: POR, at: now });

  console.log("listo");
})().catch(err => { console.error(err); process.exit(1); });
