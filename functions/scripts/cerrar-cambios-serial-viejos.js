/**
 * cerrar-cambios-serial-viejos.js — Cierra las solicitudes del canal VIEJO de
 * cambio de serial (`contratos/{cid}/seriales_cambios`), que quedó sustituido
 * por la gestión `cambio_serial` del Centro (2026-09-15).
 *
 * Por qué hace falta: el canal viejo se quedó SIN PUERTA el 2026-09-09, cuando
 * /contratos/ pasó a ser archivo de solo lectura y el menú perdió "Solicitar
 * cambio de serial". Las solicitudes que quedaron en 'pendiente' ya no las
 * puede resolver nadie, pero siguen encendiendo el chip de la lista y la cola
 * de bodega (`seriales_cambio_pendiente`) para siempre.
 *
 * Qué hace: las pasa a 'anulado' (NO a 'resuelto': resolver dispara el correo
 * de corrección a activaciones, y aquí no se corrigió nada por este camino).
 * El trigger onSerialCambio recalcula solo el flag del contrato.
 *
 * Antes de anular AVISA si la solicitud sigue teniendo sentido: si el contrato
 * todavía lista el serial que se pedía cambiar, el caso está vivo y hay que
 * rehacerlo como gestión en el Centro en vez de barrerlo.
 *
 * USAGE (desde functions/):
 *   node scripts/cerrar-cambios-serial-viejos.js            # dry-run
 *   node scripts/cerrar-cambios-serial-viejos.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const normSerial = (raw) => (raw ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// Se entra por los CONTRATOS con el flag encendido, no por un collectionGroup
// sobre seriales_cambios: esa consulta pide un índice de grupo que no existe
// (y no vale la pena crear para un script de una vez). El flag lo mantiene
// onSerialCambio en cada escritura, así que es exactamente el mismo conjunto
// — y además es el que enciende el chip y la cola de bodega.
(async () => {
  const contratos = await db.collection("contratos").where("seriales_cambio_pendiente", "==", true).get();
  console.log(`${contratos.size} contrato(s) con una solicitud pendiente del canal viejo`);
  if (contratos.empty) return;

  let anuladas = 0;
  const vivas = [];

  const pendientes = [];
  for (const cDoc of contratos.docs) {
    const qs = await cDoc.ref.collection("seriales_cambios").where("estado", "==", "pendiente").get();
    qs.docs.forEach((d) => pendientes.push(d));
  }
  console.log(`${pendientes.length} solicitud(es) pendiente(s) en total`);

  for (const d of pendientes) {
    const req = d.data();
    const cRef = d.ref.parent.parent;
    const cSnap = await cRef.get();
    const c = cSnap.exists ? cSnap.data() : {};
    const contratoVis = c.contrato_id || req.contrato_id || cRef.id;

    // ¿El contrato todavía lista los seriales que se pedían cambiar?
    const seriales = await cRef.collection("seriales").get();
    const enContrato = new Set(seriales.docs.map((s) => normSerial(s.data()?.serial)));
    const pedidos = (req.items || []).map((i) => normSerial(i.serial)).filter(Boolean);
    const sigueVivo = pedidos.some((s) => enContrato.has(s));

    console.log(`\n${contratoVis} · ${req.cliente_nombre || "—"} · ${d.id}`);
    console.log(`  pedía cambiar: ${pedidos.join(", ") || "(sin items)"}`);
    console.log(`  motivo: ${[req.motivo_tipo, req.motivo].filter(Boolean).join(" — ") || "—"}`);
    console.log(`  ${sigueVivo
      ? "⚠ EL CASO SIGUE VIVO: el contrato todavía lista ese serial. Rehacerlo como gestión en el Centro."
      : "✓ ya no aplica: el contrato no lista ese serial (se corrigió por otra vía o se duplicó la solicitud)."}`);

    if (sigueVivo) { vivas.push({ contrato: contratoVis, cliente: req.cliente_nombre || "", req: d.id, seriales: pedidos }); continue; }

    if (!dryRun) {
      await d.ref.set({
        estado: "anulado",
        anulado_at: admin.firestore.FieldValue.serverTimestamp(),
        anulado_motivo: "Canal viejo cerrado (2026-09-15): el cambio de serial es una gestión del Centro. "
          + "Esta solicitud ya no aplicaba — el contrato no lista el serial que pedía cambiar.",
      }, { merge: true });
    }
    anuladas++;
  }

  console.log(`\n${dryRun ? "[dry-run] " : ""}${anuladas} anulada(s), ${vivas.length} que siguen vivas.`);
  if (vivas.length) {
    console.log("\nRehacer como gestión de cambio de serial en el Centro:");
    vivas.forEach((v) => console.log(`  · ${v.contrato} (${v.cliente}) → ${v.seriales.join(", ")}`));
  }
  if (dryRun) console.log("\nNada escrito. Corre con --write para aplicar.");
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
