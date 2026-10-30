// Caso SKY CHEFS / B3600302 (Solangel, 2026-10-30): el QC de la reparación
// 2026102208 lo descartó el 2026-10-28 (destino Cecomunica, garantía), pero el
// pool lo seguía mostrando "en taller" porque la cuarentena solo se aplicaba al
// ENTREGAR la orden. El trigger ya lo hace al firmar el QC; este script aplica
// la misma transición a los radios descartados en órdenes vivas firmadas ANTES
// del cambio.
//
//   cd functions
//   NODE_PATH=./node_modules node ../scripts/fix-descarte-qc-sky-chefs-2026-10-30.js            (solo mira)
//   NODE_PATH=./node_modules node ../scripts/fix-descarte-qc-sky-chefs-2026-10-30.js --aplicar  (escribe)
//
// Barre las órdenes de servicio NO entregadas/cerradas con qc.equipos_descartados
// y mueve a devuelto_revision (mov descarte_qc) las fichas que sigan en_taller
// enlazadas a esa orden y cuyo descarte tenga destino Cecomunica.
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const pool = require("../functions/src/domain/equiposPool");
const descarte = require("../functions/src/domain/descarteEntrega");
const { db } = require("../functions/src/lib/admin");

const APLICAR = process.argv.includes("--aplicar");
const TERMINALES = new Set(["ENTREGADO AL CLIENTE", "CERRADA (ENTRADA)", "CERRADA (VISITA)", "CERRADA (SIN RETIRAR)", "ANULADA"]);

(async () => {
  const snap = await db.collection("ordenes_de_servicio").where("qc.equipos_descartados", "!=", []).get();
  let candidatos = 0, movidos = 0;
  for (const doc of snap.docs) {
    const o = doc.data();
    if (o.eliminado === true) continue;
    if (TERMINALES.has(String(o.estado_reparacion || "").trim().toUpperCase())) continue;
    const descartes = descarte.descartesPorSerial(o);
    for (const e of (o.equipos || [])) {
      if (!e || e.eliminado) continue;
      const serial = e.numero_de_serie || e.serial || "";
      const d = descartes.get(pool.normSerial(serial));
      if (!d || d.destino !== "cecomunica") continue;
      const { data } = await pool.resolver(serial, e.modelo_id || null, e.modelo || "");
      if (!data) { console.log(`  ${doc.id} ${serial}: SIN FICHA`); continue; }
      if (data.estado !== pool.ESTADOS.EN_TALLER || data.orden_actual_id !== doc.id) {
        console.log(`  ${doc.id} ${serial}: ya está en ${data.estado} (orden ${data.orden_actual_id || "-"}), no se toca`);
        continue;
      }
      candidatos++;
      console.log(`  ${doc.id} ${o.cliente_nombre} · ${serial} (${data.modelo_label || e.modelo}): en_taller → devuelto_revision · ${d.causa || "-"} · ${d.nota}`);
      if (!APLICAR) continue;
      const r = await pool.transicionar(serial, e.modelo_id || null, e.modelo || "", {
        aEstado: pool.ESTADOS.DEVUELTO,
        soloDesde: [pool.ESTADOS.EN_TALLER],
        condicion: (x) => x.orden_actual_id === doc.id,
        tipo: "descarte_qc",
        refMov: { tipo: "orden", id: doc.id, label: o.numero_orden || doc.id },
        notas: ("Descartado en control de calidad — se queda en Cecomunica"
          + (d.causa ? ` (${descarte.CAUSAS[d.causa]})` : "")
          + (d.nota ? `: ${d.nota}` : "")
          + " — regularizado 2026-10-30: el QC se firmó antes de que la cuarentena fuera inmediata").slice(0, 300),
        extra: { orden_actual_id: null },
      });
      console.log(`    → ${r}`);
      if (r === "transicion") movidos++;
    }
  }
  console.log(`\n${snap.size} órdenes con descartados · ${candidatos} radios en taller por mover · ${movidos} movidos${APLICAR ? "" : " (simulación: pasa --aplicar)"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
