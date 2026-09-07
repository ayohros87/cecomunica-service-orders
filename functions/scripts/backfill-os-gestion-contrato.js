/**
 * backfill-os-gestion-contrato.js — OS de PROGRAMACIÓN nacidas de gestiones
 * (2026-09-07): completa lo que crearOrdenesProgramacion no estampaba antes.
 *
 *   · vendedor_asignado vacío → responsable_uid de la gestión (o el vendedor
 *     de la ficha del cliente). Sin esto el rol vendedor no veía la orden.
 *   · contrato.motivo_no_aplica 'demo' / 'gestion' → texto legible; la adenda
 *     a contrato en papel recupera el número manual en contrato.contrato_id.
 *
 * No toca órdenes con contrato interno (aplica=true) salvo el vendedor vacío.
 * Dry-run por defecto. USAGE (desde functions/):
 *   node scripts/backfill-os-gestion-contrato.js            (solo muestra)
 *   node scripts/backfill-os-gestion-contrato.js --apply    (escribe)
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");

(async () => {
  const gs = await db.collection("gestiones").get();
  let vistos = 0, cambios = 0;
  for (const gd of gs.docs) {
    const g = gd.data();
    const gid = gd.id;
    const ids = g.ordenes?.programacion_ids || (g.ordenes?.programacion_id ? [g.ordenes.programacion_id] : []);
    if (!ids.length) continue;

    let vendedorUid = g.responsable_uid || "";
    if (!vendedorUid && g.cliente_id) {
      const cli = await db.collection("clientes").doc(g.cliente_id).get();
      vendedorUid = (cli.exists && cli.data().vendedor_asignado) || "";
    }
    const esPapel = g.tipo === "aumento" && g.aumento?.contrato_papel === true && !g.aumento?.contrato_doc_id;
    const papelId = esPapel ? (g.aumento?.contrato_id || null) : null;

    for (const oid of ids) {
      const ref = db.collection("ordenes_de_servicio").doc(oid);
      const snap = await ref.get();
      if (!snap.exists) { console.log(`${oid} (${gid}): NO EXISTE`); continue; }
      const o = snap.data();
      vistos++;
      const patch = {};
      if (!o.vendedor_asignado && vendedorUid) patch.vendedor_asignado = vendedorUid;
      const c = o.contrato || {};
      if (c.aplica !== true) {
        const motivoViejo = String(c.motivo_no_aplica || "");
        if (["demo", "gestion", ""].includes(motivoViejo)) {
          patch["contrato.motivo_no_aplica"] = g.tipo === "demo"
            ? `Demo ${gid} — sin contrato por diseño`
            : esPapel
              ? `Contrato de papel (fuera del sistema)${papelId ? ` — ${papelId}` : ""}`
              : `Gestión ${gid} — equipo sin contrato interno`;
        }
        if (esPapel && papelId && !c.contrato_id) patch["contrato.contrato_id"] = papelId;
      }
      if (!Object.keys(patch).length) { console.log(`${oid} (${gid} ${g.tipo}): sin cambios`); continue; }
      cambios++;
      console.log(`${oid} (${gid} ${g.tipo}, ${o.estado_reparacion}):`, JSON.stringify(patch));
      if (APPLY) {
        patch.os_logs = admin.firestore.FieldValue.arrayUnion({
          action: "BACKFILL", by: "script:backfill-os-gestion-contrato",
          motivo: "vendedor y motivo de contrato de la gestión", at_iso: new Date().toISOString(),
        });
        await ref.update(patch);
      }
    }
  }
  console.log(`\n${vistos} OS revisadas, ${cambios} con cambios ${APPLY ? "APLICADOS" : "(dry-run — usa --apply)"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
