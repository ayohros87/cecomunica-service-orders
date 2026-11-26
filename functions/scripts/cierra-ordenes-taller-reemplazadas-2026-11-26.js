/**
 * cierra-ordenes-taller-reemplazadas-2026-11-26.js
 *
 * Correo de Brenda (2026-11-26): órdenes de REPARACIÓN cuyo radio el taller
 * propuso reemplazar se quedan en "Completado" con "Entregar" aunque el
 * reemplazo ya se le entregó al cliente (Asamblea Nacional 2026111104 y más).
 *
 * Desde hoy, al entregarse el reemplazo, lib/gestiones.cerrarSalienteEnOrdenOrigen
 * saca al saliente de la orden, lo deja por revisar y cierra la orden si no
 * queda nada por entregar (CERRADA (REEMPLAZADO)). Este script le aplica ESA
 * MISMA función a los reemplazos ya entregados antes del cambio.
 *
 * Solo toca gestiones de reemplazo propuestas por el taller, con la entrega
 * registrada, no anuladas, cuya orden de origen sigue abierta. No manda correo.
 *
 * USAGE (desde functions/):
 *   node scripts/cierra-ordenes-taller-reemplazadas-2026-11-26.js          # dry-run
 *   node scripts/cierra-ordenes-taller-reemplazadas-2026-11-26.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const { db } = require("../src/lib/admin");
const G = require("../src/lib/gestiones");

const WRITE = process.argv.includes("--write");

(async () => {
  const snap = await db.collection("gestiones").where("tipo", "==", "reemplazo").get();
  let n = 0;
  for (const d of snap.docs) {
    const g = d.data();
    if (g.deleted || g.estado === "anulada" || g.origen?.tipo !== "taller" || !g.origen?.orden_id) continue;
    if (g.cierre?.entrega !== true) continue;
    const entrega = g.ordenes?.programacion_id || (g.ordenes?.programacion_ids || [])[0] || null;
    const oSnap = await db.collection("ordenes_de_servicio").doc(g.origen.orden_id).get();
    if (!oSnap.exists) continue;
    const o = oSnap.data();
    const plan = G.planSalienteEnOrdenOrigen(o, g, d.id, { ordenEntregaId: entrega });
    if (!plan) continue;
    n++;
    const resumen = `${d.id} · orden ${g.origen.orden_id} (${o.cliente_nombre}) · sale ${plan.salientes.join(", ") || "(ya quitado)"}`
      + ` · ${plan.cierra ? "CIERRA" : `sigue abierta por ${plan.pendientes.join(", ")}`}`;
    if (!WRITE) { console.log(`[dry] ${resumen}`); continue; }
    const r = await G.cerrarSalienteEnOrdenOrigen(d.id, g, { ordenEntregaId: entrega, por: "script:cierra-ordenes-taller-reemplazadas" });
    console.log(r ? `✔ ${resumen}` : `✘ ${resumen} — no aplicó al escribir`);
  }
  console.log(`\n${n} reemplazo(s) ${WRITE ? "aplicados" : "por aplicar (dry-run)"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
