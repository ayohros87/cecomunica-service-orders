/**
 * devolucion-demos-retenidos.js — Crea las órdenes de DEVOLUCIÓN de los
 * DEMO/TEMP vigentes que AÚN RETIENEN equipos con el cliente (instrucción de
 * Alberto 2026-08-28: los demos/temporales no se renuevan — se cierran con la
 * recuperación del equipo; el saneo cerró los verificados y estos son el resto).
 *
 * Por contrato: unidades del pool que siguen colgando de él (asignado_contrato/
 * en_cliente/en_demo) y que NO estén ya cubiertas por una orden de DEVOLUCIÓN
 * abierta. Usa el creador compartido (src/lib/ordenDevolucion — mismo correo a
 * vendedor+recepción y mismo check-in) y estampa orden_devolucion_id en el
 * contrato. Cuando la devolución cierre y el pool quede en cero, re-correr
 * sanea-demos-temps-reemps.js los cierra.
 *
 * Excluye el demo de MEDICINA LEGAL creado el 2026-08-28 (vivo a propósito).
 *
 * USAGE (desde functions/): node scripts/devolucion-demos-retenidos.js [--write]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const VIG = require("../src/lib/vigencia");
const { crearOrdenDevolucion } = require("../src/lib/ordenDevolucion");

const WRITE = process.argv.includes("--write");
const EXCLUIR = new Set(["DEMO20260827-01"]); // Medicina Legal, vivo
// Seriales verificados contra órdenes (2026-08-28): ya tienen ENTRADA CERRADA
// posterior (3 de ellos hasta reentregados a OTRO cliente) — el radio YA volvió
// y lo desfasado es el pool, no el cliente. A estos no les toca DEVOLUCIÓN;
// van a corrección de pool aparte.
const EXCLUIR_SERIALES = new Set([
  "23706A0395",  // DEMO20260507-02: ENTRADA 2026052004 → reentregado a CEMENTO BAYANO (2026063001)
  "23706A0420",  // TEMP20260505-01: ENTRADA 2026051806 → reentregado a ONCOR (2026063010)
  "24O31A0948",  // TEMP20260609-02: ENTRADA 2026061806 → reentregado a FETRATEDA (2026062302)
  "18610A0014",  // DEMO20260602-01: ENTRADA 2026063013 CERRADA
  "18610A0018",  // DEMO20260602-01: ENTRADA 2026063013 CERRADA
]);
const normS = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  const [conSnap, poolSnap, devSnap] = await Promise.all([
    db.collection("contratos").get(),
    db.collection("equipos_pool").get(),
    db.collection("ordenes_de_servicio").where("tipo_de_servicio", "==", "DEVOLUCION").get(),
  ]);

  // Seriales ya cubiertos por una DEVOLUCIÓN abierta (no duplicar tiquetes).
  const cubiertos = new Set();
  devSnap.forEach((d) => {
    const o = d.data();
    if (o.eliminado) return;
    if ((o.estado_reparacion || "").toUpperCase() === "CERRADA (DEVOLUCION)") return;
    (o.devolucion?.esperados || []).forEach((e) => { const n = normS(e.serial); if (n) cubiertos.add(n); });
  });

  const porContrato = new Map();
  poolSnap.forEach((d) => {
    const u = { id: d.id, ...d.data() };
    const cid = u.asignacion?.contrato_doc_id;
    if (cid && ["asignado_contrato", "en_cliente", "en_demo"].includes(u.estado)) {
      if (!porContrato.has(cid)) porContrato.set(cid, []);
      porContrato.get(cid).push(u);
    }
  });

  const objetivo = [];
  conSnap.forEach((d) => {
    const c = d.data();
    if (c.deleted || !["activo", "aprobado"].includes(c.estado)) return;
    const cod = VIG.codigoTipo(c);
    if (cod !== "DEMO" && cod !== "TEMP") return;
    if (EXCLUIR.has(c.contrato_id)) return;
    const unidades = (porContrato.get(d.id) || [])
      .filter((u) => !cubiertos.has(normS(u.serial || u.id)))
      .filter((u) => !EXCLUIR_SERIALES.has(normS(u.serial || u.id)));
    if (!unidades.length) return;
    objetivo.push({ id: d.id, c, unidades });
  });

  console.log(`DEMO/TEMP con equipos por recuperar (sin orden abierta que los cubra): ${objetivo.length}`);
  objetivo.forEach(({ c, unidades }) =>
    console.log(`  ${(c.contrato_id || "?").padEnd(18)} ${String(c.cliente_nombre || "?").padEnd(45)} ${unidades.length} unid: ${unidades.map((u) => u.serial).join(", ")}`));

  if (!WRITE) { console.log("\nDRY-RUN — nada escrito. Repite con --write."); return; }

  for (const { id, c, unidades } of objetivo) {
    const ordenId = await crearOrdenDevolucion({
      clienteId: c.cliente_id,
      clienteNombre: c.cliente_nombre || "",
      contratoDocId: id,
      contratoId: c.contrato_id || id,
      contratoOrigenIds: [],
      modo: "recuperacion",
      origen: { tipo: "demo_temp_saneo", ref_id: id },
      unidades: unidades.map((u) => ({
        serial: u.serial || u.id, modelo: u.modelo_label || "", modelo_id: u.modelo_id || null, pool_doc_id: u.id,
      })),
      motivo: `Cierre de ${VIG.codigoTipo(c) === "DEMO" ? "demo" : "temporal"} — los demos/temporales no se renuevan, se cierran recuperando el equipo (saneo 2026-08-28)`,
    });
    if (ordenId) {
      await db.collection("contratos").doc(id).update({
        orden_devolucion_id: ordenId,
        fecha_modificacion: new Date(),
      });
      console.log(`  OK ${c.contrato_id} → orden ${ordenId} (${unidades.length} unid.)`);
    } else {
      console.log(`  FALLO ${c.contrato_id}: no se pudo crear la orden`);
    }
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
