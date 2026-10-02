/**
 * regulariza-reemplazo-cemento-bayano-2026-10-02.js — Cierra el reemplazo de
 * 24O31A0939 por 22610A4066 en CEMENTO BAYANO CONCRETO, reportado por José
 * Solís el 2026-10-01.
 *
 * CONTEXTO. 24O31A0939 (OS 2026062306) se descartó por humedad y se reemplazó
 * con 22610A4066 en la OS 2026070104 (PROGRAMACIÓN). El radio se entregó, pero
 * la orden quedó en COMPLETADO (EN OFICINA). Para sacarlo de "por retirar",
 * bodega usó "Corrección de migración" (28-sep), cuyo ÚNICO destino es
 * en_bodega: el radio figura disponible para alquilar estando donde el
 * cliente, y ya sin orden_actual_id — entregar la orden ahora no lo mueve
 * (onOrdenWritePool solo saca a en_cliente desde en_taller y amarrado a la OS).
 *
 *   1) 22610A4066: en_bodega → en_cliente con custodia del cliente (sin
 *      contrato: la OS se abrió con "contrato no aplica"). Limpia `proveedor`
 *      ("cemento bayano", escrito ahí por error el 2026-10-01). Solo si sigue
 *      en bodega y sin asignación — si alguien ya lo tomó, no se toca.
 *   2) OS 2026070104: COMPLETADO (EN OFICINA) → ENTREGADO AL CLIENTE, con
 *      `correccion_terminal` (sin correo ni estadísticas; ver onComplete). La
 *      fecha real de la entrega no consta: fecha_entrega = hoy y queda dicho
 *      en notas_entrega.
 *
 * USAGE (desde functions/):
 *   node scripts/regulariza-reemplazo-cemento-bayano-2026-10-02.js            # dry-run
 *   node scripts/regulariza-reemplazo-cemento-bayano-2026-10-02.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const ORDEN = "2026070104";
const SERIAL = "22610A4066";
const ORIGEN = "regulariza-reemplazo-cemento-bayano-2026-10-02";

(async () => {
  console.log(`Modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);

  const oRef = db.collection("ordenes_de_servicio").doc(ORDEN);
  const o = (await oRef.get()).data();
  if (!o) throw new Error(`OS ${ORDEN} no existe`);
  console.log(`OS ${ORDEN}: ${o.cliente_nombre} · ${o.tipo_de_servicio} · ${o.estado_reparacion}`);

  // ── 1) El radio vuelve a estar donde está: en el cliente ──────────────────
  const { data: eq } = await pool.resolver(SERIAL, o.equipos[0].modelo_id, o.equipos[0].modelo);
  console.log(`${SERIAL}: estado=${eq?.estado} asignacion=${JSON.stringify(eq?.asignacion)} proveedor="${eq?.proveedor}"`);
  if (!eq || eq.estado !== pool.ESTADOS.EN_BODEGA || eq.asignacion) {
    console.log("  ✋ ya no está libre en bodega: no se toca");
  } else if (EXECUTE) {
    const r = await pool.transicionar(SERIAL, eq.modelo_id, eq.modelo_label, {
      aEstado: pool.ESTADOS.EN_CLIENTE,
      soloDesde: [pool.ESTADOS.EN_BODEGA],
      condicion: (d) => !d.asignacion,
      tipo: "correccion",
      refMov: { tipo: "orden", id: ORDEN, label: ORDEN },
      notas: "Reemplazo de 24O31A0939 entregado al cliente (OS 2026070104). " +
             "La 'Corrección de migración' del 28-sep lo había mandado a bodega.",
      extra: {
        asignacionSiFalta: { contrato_doc_id: null, contrato_id: "",
          cliente_id: o.cliente_id, cliente_nombre: o.cliente_nombre },
        orden_actual_id: null,
        proveedor: "",
        verificado: true,
      },
    });
    console.log(`  → ${r}`);
  } else {
    console.log("  → en_cliente (dry-run)");
  }

  // ── 2) La OS se cierra como entregada ─────────────────────────────────────
  if (o.estado_reparacion !== "COMPLETADO (EN OFICINA)") {
    console.log(`OS ${ORDEN}: ya no está COMPLETADO (EN OFICINA) — no se toca`);
  } else if (EXECUTE) {
    await oRef.update({
      estado_reparacion: "ENTREGADO AL CLIENTE",
      fecha_entrega: admin.firestore.FieldValue.serverTimestamp(),
      notas_entrega: "Cierre administrativo: el radio ya estaba en el cliente " +
        "(reporte de José Solís, 2026-10-01). La fecha real de la entrega no consta.",
      correccion_terminal: true,
      correccion_terminal_at: admin.firestore.FieldValue.serverTimestamp(),
      correccion_terminal_de: ORIGEN,
      os_logs: admin.firestore.FieldValue.arrayUnion({ action: "ENTREGAR", by: ORIGEN }),
    });
    console.log(`OS ${ORDEN} → ENTREGADO AL CLIENTE`);
  } else {
    console.log(`OS ${ORDEN} → ENTREGADO AL CLIENTE (dry-run)`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
