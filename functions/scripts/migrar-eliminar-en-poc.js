/**
 * migrar-eliminar-en-poc.js — Migra las fichas del pool con estado `en_poc` a
 * su ubicación física real. Decisión 2026-07-24: POC es la PLATAFORMA de
 * airtime (base de datos), no una ubicación — el estado en_poc se elimina y la
 * membresía POC queda solo en `poc_device_id`.
 *
 * Regla de destino, por ficha en_poc (todas tienen device activo con cliente):
 *   1. Su serial está en una orden ABIERTA (no eliminada, estado_reparacion no
 *      cerrado):
 *        · orden ENTRADA:
 *            - hay SALIDA posterior (orden entregada después, o device POC
 *              creado después)         → en_cliente (la ENTRADA es papeleo sin
 *              cerrar; el radio volvió a salir)
 *            - ENTRADA ≤ 60 días       → devuelto_revision + orden_actual_id
 *              (pendiente de inspección, flujo del rediseño 2026-07-21)
 *            - ENTRADA > 60 días       → en_bodega (regla de negocio 2026-07-24:
 *              lo que entra se guarda en bodega; se limpia asignación/orden,
 *              condición reuso, ingreso_bodega_at para el FIFO del picker)
 *        · VISITA TECNICA              → en_cliente (el servicio fue EN SITIO;
 *          el radio nunca entró al taller)
 *        · otra orden de ≤ 60 días     → en_taller + orden_actual_id
 *        · orden más vieja (rezagada)  → en_cliente (la orden quedó sin cerrar;
 *          el device POC activo pesa más que una orden de hace meses)
 *      Si otra ficha del MISMO serial (duplicado sufijado) ya reclama esa orden
 *      en orden_actual_id, la orden no se hereda → en_cliente.
 *   2. Sin orden abierta → en_cliente.
 * La asignación existente (cliente/contrato) NUNCA se toca. Cada cambio deja
 * movimiento correccion_migracion con de_estado en_poc (reversible por kardex).
 *
 * USAGE (desde functions/):
 *   node scripts/migrar-eliminar-en-poc.js            # dry-run (no escribe)
 *   node scripts/migrar-eliminar-en-poc.js --execute  # escribe
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const DIAS_ORDEN_VIVA = 60;
const CERRADAS = new Set(["ENTREGADO AL CLIENTE", "CERRADA (ENTRADA)",
  "CERRADA (DEVOLUCION)", "CERRADA (VISITA)", "ANULADA"]);

const toDate = (v) => !v ? null : (typeof v.toDate === "function" ? v.toDate() : new Date(v));
const inc = (o, k) => { o[k = k || "(vacio)"] = (o[k] || 0) + 1; };

(async () => {
  const enPocSnap = await db.collection("equipos_pool").where("estado", "==", "en_poc").get();
  const fichas = enPocSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Fichas en_poc: ${fichas.length} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (!fichas.length) return;

  // Órdenes: mapa serial_norm → abierta más reciente {id, tipo, dias, f} y
  // fecha de la última ENTREGA (orden ENTREGADO AL CLIENTE) por serial.
  const ordSnap = await db.collection("ordenes_de_servicio")
    .orderBy("fecha_creacion", "desc").limit(2000).get();
  const ordenAbierta = new Map();
  const ultimaEntrega = new Map(); // serial_norm → Date de la entrega más reciente
  for (const d of ordSnap.docs) {
    const o = d.data();
    if (o.eliminado === true) continue;
    const er = String(o.estado_reparacion || "").trim().toUpperCase();
    const cerrada = CERRADAS.has(er);
    const f = toDate(o.fecha_creacion);
    const dias = f ? Math.round((Date.now() - f.getTime()) / 864e5) : null;
    for (const e of (o.equipos || [])) {
      if (e && e.eliminado) continue;
      const n = pool.normSerial((e && (e.numero_de_serie || e.serial)) || "");
      if (!n) continue;
      // Las órdenes vienen DESC: la primera vista por serial es la más reciente.
      if (!cerrada && !ordenAbierta.has(n)) {
        ordenAbierta.set(n, { id: d.id, numero: o.numero_orden || d.id,
          tipo: String(o.tipo_de_servicio || "").toUpperCase(), dias, f });
      }
      if (er === "ENTREGADO AL CLIENTE" && f && !ultimaEntrega.has(n)) ultimaEntrega.set(n, f);
    }
  }

  // Device POC más reciente por serial (created_at) — para detectar salida
  // posterior a una ENTRADA (el radio volvió a la plataforma).
  const pocSnap = await db.collection("poc_devices").get();
  const deviceCreado = new Map(); // serial_norm → Date
  for (const d of pocSnap.docs) {
    const p = d.data();
    if (p.deleted === true) continue;
    const n = pool.normSerial(p.serial || "");
    const c = toDate(p.created_at) || toDate(p.fecha_creacion);
    if (!n || !c) continue;
    const prev = deviceCreado.get(n);
    if (!prev || c > prev) deviceCreado.set(n, c);
  }

  // orden ya reclamada por otra ficha del mismo serial (duplicado sufijado)
  const ordenReclamada = new Map(); // serial_norm → Set<orden_id> de fichas NO en_poc
  const todasSnap = await db.collection("equipos_pool")
    .where("orden_actual_id", "!=", null).get().catch(() => null);
  if (todasSnap) {
    for (const d of todasSnap.docs) {
      const p = d.data();
      if (p.estado === "en_poc") continue;
      const n = p.serial_norm || d.id.split("__")[0];
      if (!ordenReclamada.has(n)) ordenReclamada.set(n, new Set());
      ordenReclamada.get(n).add(p.orden_actual_id);
    }
  }

  const plan = []; // {id, aEstado, ordenId|null, motivo, aBodega}
  const resumen = { destino: {}, motivo: {} };
  for (const f of fichas) {
    const n = f.serial_norm || f.id.split("__")[0];
    const ord = ordenAbierta.get(n);
    let aEstado = pool.ESTADOS.EN_CLIENTE, ordenId = null, motivo = "sin_orden_abierta", aBodega = false;
    if (ord) {
      const reclamada = ordenReclamada.get(n) && ordenReclamada.get(n).has(ord.id);
      if (reclamada) {
        motivo = "orden_reclamada_por_duplicado";
      } else if (ord.tipo === "ENTRADA") {
        const entrega = ultimaEntrega.get(n);
        const dev = deviceCreado.get(n);
        const salioDespues = (entrega && ord.f && entrega > ord.f) || (dev && ord.f && dev > ord.f);
        if (salioDespues) {
          motivo = "entrada_con_salida_posterior"; // volvió a salir: papeleo sin cerrar
        } else if (ord.dias !== null && ord.dias <= DIAS_ORDEN_VIVA) {
          aEstado = pool.ESTADOS.DEVUELTO; ordenId = ord.id; motivo = "entrada_reciente";
        } else {
          aEstado = pool.ESTADOS.EN_BODEGA; motivo = "entrada_vieja_a_bodega"; aBodega = true;
        }
      } else if (ord.tipo.includes("VISITA")) {
        motivo = "visita_en_sitio"; // el radio siguió con el cliente
      } else if (ord.dias !== null && ord.dias <= DIAS_ORDEN_VIVA) {
        aEstado = pool.ESTADOS.EN_TALLER; ordenId = ord.id; motivo = `orden_reciente_${ord.tipo || "?"}`;
      } else {
        motivo = "orden_rezagada_>60d";
      }
    }
    plan.push({ id: f.id, serial: f.serial, aEstado, ordenId, motivo, aBodega });
    inc(resumen.destino, aEstado); inc(resumen.motivo, motivo);
  }

  console.log(JSON.stringify(resumen, null, 1));
  console.log("Muestras:", JSON.stringify(plan.filter(p => p.aEstado !== "en_cliente").slice(0, 10), null, 1));

  if (!EXECUTE) { console.log("Dry-run: no se escribió nada. Corre con --execute para aplicar."); return; }

  let escritos = 0;
  for (let i = 0; i < plan.length; i += 240) {
    const batch = db.batch();
    for (const p of plan.slice(i, i + 240)) {
      const ref = db.collection("equipos_pool").doc(p.id);
      const update = { estado: p.aEstado, updated_at: admin.firestore.FieldValue.serverTimestamp() };
      if (p.ordenId) update.orden_actual_id = p.ordenId;
      if (p.aBodega) {
        // Regresa al stock: sin asignación ni orden; reuso (ya estuvo en campo);
        // ingreso_bodega_at para el FIFO del picker de seriales.
        update.asignacion = null;
        update.orden_actual_id = null;
        update.condicion = "reuso";
        update.ingreso_bodega_at = admin.firestore.FieldValue.serverTimestamp();
      }
      batch.set(ref, update, { merge: true });
      batch.set(ref.collection("movimientos").doc(), {
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: null,
        tipo: "correccion_migracion", de_estado: "en_poc", a_estado: p.aEstado,
        ref: p.ordenId ? { tipo: "orden", id: p.ordenId, label: "" } : null,
        notas: "Eliminación del estado En POC — POC es plataforma, no ubicación física" +
          (p.motivo !== "sin_orden_abierta" ? ` (${p.motivo})` : ""),
      });
    }
    await batch.commit();
    escritos += Math.min(240, plan.length - i);
    console.log(`  escritos ${escritos}/${plan.length}`);
  }
  console.log("Migración completa.");
})().catch(e => { console.error("FATAL", e); process.exit(1); });
