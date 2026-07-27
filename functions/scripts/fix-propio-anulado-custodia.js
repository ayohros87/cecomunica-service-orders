/**
 * fix-propio-anulado-custodia.js — Suelta del contrato ANULADO las fichas de
 * equipos que son propiedad del CLIENTE (contratos "Propio": venta con contrato
 * de servicio).
 *
 * onAnnulment nunca los devuelve —correcto, son del cliente— pero hasta el fix
 * 2026-07-27 dejaba la asignación apuntando al contrato muerto: la ficha seguía
 * diciendo "contratado" para siempre y la conciliación semanal la reportaba
 * como drift (chequeo D). Este script aplica a lo ya ocurrido la misma
 * degradación que ahora hace el trigger: mismo cliente, sin contrato.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/fix-propio-anulado-custodia.js            # dry-run
 *   node scripts/fix-propio-anulado-custodia.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const EN_CLIENTE = "en_cliente";
const CANDIDATOS = new Set(["asignado_contrato", EN_CLIENTE]);

(async () => {
  const snap = await db.collection("equipos_pool").where("propiedad", "==", "cliente").get();
  console.log(`Fichas propiedad del cliente: ${snap.size} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}`);

  const contratoCache = new Map();
  const getContrato = async (cid) => {
    if (!contratoCache.has(cid)) {
      const c = await db.collection("contratos").doc(cid).get();
      contratoCache.set(cid, c.exists ? c.data() : null);
    }
    return contratoCache.get(cid);
  };

  let tocadas = 0;
  for (const d of snap.docs) {
    const u = d.data();
    const cid = u.asignacion?.contrato_doc_id;
    if (!cid || !CANDIDATOS.has(u.estado)) continue;
    const c = await getContrato(cid);
    if (!c || String(c.estado || "").toLowerCase() !== "anulado") continue;

    console.log(`  ${u.serial} [${u.estado}] · ${c.contrato_id || cid} (${c.codigo_tipo || c.tipo_contrato || "?"}) → custodia de ${u.asignacion?.cliente_nombre || c.cliente_nombre || "?"}`);
    tocadas++;
    if (!EXECUTE) continue;

    await d.ref.set({
      estado: EN_CLIENTE,
      asignacion: {
        contrato_doc_id: null,
        contrato_id: "",
        cliente_id:     u.asignacion?.cliente_id     || c.cliente_id     || "",
        cliente_nombre: u.asignacion?.cliente_nombre || c.cliente_nombre || "",
      },
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await d.ref.collection("movimientos").add({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null, tipo: "liberacion",
      de_estado: u.estado || null, a_estado: EN_CLIENTE,
      ref: { tipo: "contrato", id: cid, label: c.contrato_id || cid },
      notas: "Contrato anulado — equipo propiedad del cliente: queda en su custodia, sin devolución",
    });
  }

  console.log(`\n${EXECUTE ? "ESCRITURA" : "DRY-RUN"} — fichas a soltar del contrato anulado: ${tocadas}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
