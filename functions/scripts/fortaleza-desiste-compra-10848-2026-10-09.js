/**
 * fortaleza-desiste-compra-10848-2026-10-09.js — FORTALEZA SECURITY desistió
 * de comprar los 5 HYTERA PNC360S-R de la factura 10848 (nota de crédito ya
 * emitida). Los radios NUNCA se entregaron: se esperaba el pago.
 *
 * Caso (Brenda, 2026-10-09): Zuleika anuló la gestión GA20260925-01 (aumento
 * de 5 líneas "propio" al contrato PROP20260727-02) y el POC siguió mostrando
 * 15 radios activos en vez de 10, y bodega los seguía viendo vendidos.
 *
 * Por qué la anulación no los soltó: los radios NO salieron por la gestión.
 * La gestión quedó con `seriales_asignados: []` y `ordenes: {}`; bodega
 * registró la VENTA directa en el pool (vendido, FACTURA 10848) y recepción
 * abrió la PROGRAMACIÓN 2026092801 sin contrato ("la factura contiene la venta
 * y la mensualidad"). limpiarAnulacion solo limpia lo que cuelga de la
 * gestión, así que no había nada que soltar. El contrato PROP20260727-02 no se
 * tocó nunca (el anexo no se firmó) y sigue con sus 5 equipos.
 *
 * Deshace las tres piezas con las herramientas de siempre:
 *   · pool ×5: vendido → en_bodega, propiedad cecomunica (lo que hace
 *     EquiposPoolService.anularVenta). La venta queda en `venta_anulada` y
 *     el kardex la registra con la factura.
 *   · OS 2026092801: ANULADA con motivo (lo que hace OrdenesService.anularOrden).
 *     Va DESPUÉS del pool: onOrdenWritePool solo mueve radios en_taller /
 *     asignado que sigan apuntando a la orden, así que aquí no toca nada.
 *   · POC ×5: cerrarFichasPoc (lib/pocCierre) — cierra la ficha y da de alta
 *     el SIM en el pool como disponible.
 *
 * Idempotente: cada paso revisa el estado antes de escribir.
 * USAGE (desde functions/): node scripts/fortaleza-desiste-compra-10848-2026-10-09.js [--write]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const pool = require("../src/domain/equiposPool");
const { cerrarFichasPoc } = require("../src/lib/pocCierre");
const write = process.argv.includes("--write");

const CLIENTE_ID = "Qd7OK7YlgMFvuWaPBuSe";
const CLIENTE = "FORTALEZA SECURITY, S.A";
const SERIALES = ["24708A1183", "24708A1167", "24220A2338", "22806A0307", "22610A4088"];
const FACTURA = "FACTURA 10848";
const ORDEN = "2026092801";
const GESTION = "GA20260925-01";
const POR = "ayohros@gmail.com";
const MOTIVO = `El cliente desistió de la compra (correo del 2026-10-08); factura 10848 reversada con nota de crédito y gestión ${GESTION} anulada. Los radios nunca se entregaron.`;

(async () => {
  console.log(write ? "== ESCRIBIENDO ==" : "== DRY-RUN (usa --write para aplicar) ==");
  const g = (await db.collection("gestiones").doc(GESTION).get()).data();
  const o = (await db.collection("ordenes_de_servicio").doc(ORDEN).get()).data();
  const fichas = await db.collection("equipos_pool").where(admin.firestore.FieldPath.documentId(), "in", SERIALES).get();

  const checks = [
    [g?.estado === "anulada", `gestión ${GESTION} anulada`],
    [o && !o.contrato?.aplica, `OS ${ORDEN} sin contrato`],
    [fichas.size === 5, "5 fichas en el pool"],
  ];
  checks.forEach(([ok, txt]) => console.log(ok ? "ok   " : "FALLA", txt));
  if (checks.some(([ok]) => !ok)) { process.exitCode = 1; return; }

  // 1) Pool
  for (const d of fichas.docs) {
    const x = d.data();
    if (x.estado !== pool.ESTADOS.VENDIDO) { console.log("pool ", d.id, `ya ${x.estado} — no se toca`); continue; }
    if (x.venta?.factura !== FACTURA || x.venta?.cliente_id !== CLIENTE_ID) {
      console.log("FALLA", d.id, "vendido con otra factura/cliente:", x.venta?.factura, x.venta?.cliente_nombre); continue;
    }
    console.log("pool ", d.id, "vendido → en_bodega");
    if (!write) continue;
    const r = await pool.transicionarPorId(d.id, {
      aEstado: pool.ESTADOS.EN_BODEGA,
      soloDesde: [pool.ESTADOS.VENDIDO],
      tipo: "correccion_venta",
      refMov: { tipo: "factura_qbo", id: FACTURA, label: FACTURA },
      notas: `Venta anulada (${FACTURA}) — ${MOTIVO}`.slice(0, 300),
      extra: {
        propiedad: "cecomunica",
        asignacion: null,
        orden_actual_id: null,
        verificado: false,
        venta: FV.delete(),
        venta_anulada: { ...x.venta, motivo: "desistimiento", gestion_id: GESTION, at: FV.serverTimestamp(), por_email: POR },
      },
    });
    console.log("      →", r);
  }

  // 2) Orden
  if (o.estado_reparacion === "ANULADA") console.log("OS   ", ORDEN, "ya ANULADA");
  else {
    console.log("OS   ", ORDEN, `${o.estado_reparacion} → ANULADA`);
    if (write) {
      await db.collection("ordenes_de_servicio").doc(ORDEN).update({
        estado_reparacion: "ANULADA",
        estado_previo: o.estado_reparacion || null,
        anulada_motivo: MOTIVO,
        anulada_por_contrato: null,
        anulada_at: FV.serverTimestamp(),
        os_logs: FV.arrayUnion({ action: "ANULAR", by: POR, at: admin.firestore.Timestamp.now(), equipos: SERIALES.length, nota: MOTIVO }),
      });
    }
  }

  // 3) POC
  for (const s of SERIALES) {
    if (!write) {
      const vivas = await db.collection("poc_devices").where("serial", "==", s).get();
      const mias = vivas.docs.filter(d => d.data().cliente_id === CLIENTE_ID && d.data().activo !== false && d.data().deleted !== true);
      console.log("POC  ", s, mias.map(d => `${d.id} unit ${d.data().unit_id} SIM ${d.data().sim_number}`).join(", ") || "sin ficha viva");
      continue;
    }
    const r = await cerrarFichasPoc({
      serial: s, poolDocId: s, clienteId: CLIENTE_ID, clienteNombre: CLIENTE,
      motivo: MOTIVO, ref: { tipo: "orden", id: ORDEN }, usuario: POR,
    }, db);
    console.log("POC  ", s, "cerradas:", r.cerradas.map(c => `${c.unit_id} (SIM ${c.sim_number})`).join(", ") || "ninguna",
      r.simsAjenos.length ? `· SIM en otro radio: ${r.simsAjenos}` : "", r.deOtros ? `· ${r.deOtros} ficha(s) de otro cliente sin tocar` : "");
  }

  if (write) {
    await db.collection("gestiones").doc(GESTION).collection("eventos").add({
      accion: "regularizacion", detalle: `Saneo posterior a la anulación: los 5 radios de la ${FACTURA} vuelven a bodega, OS ${ORDEN} anulada y fichas POC cerradas (salieron por venta directa, no por la gestión).`,
      por_uid: null, por_email: POR, at: FV.serverTimestamp(),
    });
  }
})();
