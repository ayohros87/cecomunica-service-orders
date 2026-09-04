// Aplicación del plan de seriales de una RENOVACIÓN al APROBARSE el contrato
// (2026-09-04, pedido de Alberto — caso CENTRO CULTURAL CHINO PANAMEÑO).
//
// El problema: en una renovación (sobre todo SIN equipo, donde los radios
// siguen con el cliente y solo se hace refurbished) nadie decía QUÉ seriales
// siguen con el cliente y cuáles no. El wizard del Centro solo listaba las
// fichas colgadas de un contrato de origen del sistema — y los contratos
// viejos (legacy) no tienen seriales, así que la tabla salía vacía. Mientras,
// el pool tenía 22 fichas amarradas al cliente por la migración POC, sin
// verificar, y la cuenta seguía "debiendo" radios que quizá nunca tuvo.
//
// Ahora el vendedor declara en la venta, por serial, el destino de TODO lo
// que el sistema cree que el cliente tiene — y puede AGREGAR seriales que el
// cliente sí tiene y el sistema no sabía. Este módulo aplica esa declaración
// al aprobarse el contrato (mismo momento en que jalarSerialesPropios amarra
// la custodia propia), para que el Anexo A que el cliente firma ya traiga
// exactamente esos seriales:
//   · 'continua'  → fila en contratos/{cid}/seriales (onSerialWrite hace el
//                   sync al pool: la unidad queda del contrato nuevo; si no
//                   existía en el pool, nace por contacto).
//   · 'no_tiene'  → la ficha se SUELTA del cliente (pool.soltarDelCliente →
//                   por_clasificar, sin asignación, verificado:false).
//   · 'devuelve' / 'reemplaza' → nada aquí: los ejecuta onEntregaTransicion
//                   al confirmarse la entrega (o la activación, si es sin
//                   equipo).
//
// Idempotente por HASH del plan: si el vendedor corrige el plan antes de la
// firma (Centro → "Seriales de la cuenta"), onPlanRenovacion vuelve a aplicar
// solo la diferencia — las filas que ya existen no se duplican y una unidad
// que pasó de 'continua' a 'no_tiene' pierde su fila y se suelta.
"use strict";

const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { admin } = require("./admin");
const pool = require("../domain/equiposPool");

const SOURCE = "plan_renovacion";
const norm = (s) => pool.normSerial(s || "");

function hashPlan(plan) {
  const us = ((plan && plan.unidades) || [])
    .map((u) => `${norm(u.serial_norm || u.serial)}:${u.destino || ""}`)
    .sort();
  return crypto.createHash("sha1").update(us.join("|")).digest("hex").slice(0, 16);
}

/**
 * Decisión PURA (test/planRenovacion.test.js): qué filas crear, qué filas
 * del plan quitar y qué unidades soltar, dado el plan y las filas existentes.
 * @param {Object|null} plan — contrato.transicion_plan
 * @param {Array} filas — filas de contratos/{cid}/seriales: [{id, serial, source}]
 * @returns {{crear: Array, quitar: Array<{id, serial}>, soltar: Array}}
 */
function decidirAplicacion(plan, filas) {
  const out = { crear: [], quitar: [], soltar: [] };
  if (!plan || plan.nivel !== "serial" || !Array.isArray(plan.unidades)) return out;

  const existentes = new Map();
  for (const f of (filas || [])) {
    const k = norm(f.serial);
    if (k && !existentes.has(k)) existentes.set(k, f);
  }
  const enPlan = new Map();
  for (const u of plan.unidades) {
    const k = norm(u.serial_norm || u.serial);
    if (!k || enPlan.has(k)) continue;
    enPlan.set(k, u);
    if (u.destino === "continua") {
      if (!existentes.has(k)) out.crear.push(u);
    } else if (u.destino === "no_tiene") {
      out.soltar.push(u);
    }
  }
  // Filas que ESTE módulo creó y que el plan ya no dice 'continua' (el
  // vendedor corrigió antes de la firma). Filas de otras fuentes (bodega,
  // custodia propia, regularización) no se tocan: no son de este plan.
  for (const [k, f] of existentes) {
    if (f.source !== SOURCE) continue;
    const u = enPlan.get(k);
    if (!u || u.destino !== "continua") out.quitar.push({ id: f.id, serial: f.serial });
  }
  return out;
}

/**
 * Aplica el plan al contrato. Best-effort por unidad; deja `plan_aplicado`
 * en el contrato con el hash del plan aplicado y el resumen.
 * @returns {null|{creadas:number, quitadas:number, soltadas:number}}
 */
async function aplicarPlanRenovacion(contratoRef, contrato, cid, { motivo = "aprobacion" } = {}) {
  const plan = contrato.transicion_plan;
  if (!plan || plan.nivel !== "serial" || !Array.isArray(plan.unidades) || !plan.unidades.length) return null;
  if (contrato.accion !== "Renovación") return null;
  const hash = hashPlan(plan);
  if (contrato.plan_aplicado?.hash === hash) return null; // ya aplicado tal cual

  const filasSnap = await contratoRef.collection("seriales").get();
  const filas = filasSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const dec = decidirAplicacion(plan, filas);

  const refMov = { tipo: "contrato", id: cid, label: contrato.contrato_id || "" };
  let creadas = 0, quitadas = 0, soltadas = 0;
  const soltarDetalle = [];

  for (const u of dec.crear) {
    try {
      await contratoRef.collection("seriales").add({
        serial: u.serial || u.serial_norm,
        modelo: u.modelo || "",
        modelo_id: u.modelo_id || null,
        contrato_doc_id: cid,
        contrato_id: contrato.contrato_id || "",
        cliente_id: contrato.cliente_id || "",
        cliente_nombre: contrato.cliente_nombre || "",
        source: SOURCE,
        fuente_plan: u.fuente || null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        created_by: `trigger:${SOURCE}`,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: `trigger:${SOURCE}`,
      });
      creadas++;
    } catch (e) {
      logger.warn("[planRenovacion] no se pudo crear la fila", { cid, serial: u.serial, message: e.message });
    }
  }
  for (const q of dec.quitar) {
    try {
      await contratoRef.collection("seriales").doc(q.id).delete();
      quitadas++;
    } catch (e) {
      logger.warn("[planRenovacion] no se pudo quitar la fila", { cid, serial: q.serial, message: e.message });
    }
  }
  for (const u of dec.soltar) {
    try {
      const r = await pool.soltarDelCliente(u.serial || u.serial_norm, u.modelo_id || null, u.modelo || "", {
        cliente_id: contrato.cliente_id || "",
        refMov,
        notas: `El cliente declaró NO tener este equipo al renovar (${contrato.contrato_id || cid}) — soltado de la cuenta; ubicación por confirmar`,
      });
      soltarDetalle.push({ serial: u.serial || u.serial_norm, resultado: r });
      if (r === "liberado") soltadas++;
    } catch (e) {
      logger.warn("[planRenovacion] no se pudo soltar la unidad", { cid, serial: u.serial, message: e.message });
      soltarDetalle.push({ serial: u.serial || u.serial_norm, resultado: "error" });
    }
  }

  await contratoRef.set({
    plan_aplicado: {
      hash,
      at: admin.firestore.FieldValue.serverTimestamp(),
      motivo,
      creadas, quitadas, soltadas,
      no_tiene_total: dec.soltar.length,
      soltar_detalle: soltarDetalle.slice(0, 60),
      por: `trigger:${SOURCE}`,
    },
  }, { merge: true });

  logger.info("[planRenovacion] plan aplicado", { cid, contrato: contrato.contrato_id, motivo, creadas, quitadas, soltadas });
  return { creadas, quitadas, soltadas };
}

// Seriales que el plan declara con destino ≠ 'continua' — para que los
// amarres automáticos de custodia (onRenovacionActivada, jalarSerialesPropios)
// no vuelvan a amarrar lo que el vendedor dijo que se devuelve o no está.
function serialesExcluidosPorPlan(plan) {
  const set = new Set();
  if (!plan || plan.nivel !== "serial") return set;
  for (const u of (plan.unidades || [])) {
    if (u.destino === "continua") continue;
    const k = norm(u.serial_norm || u.serial);
    if (k) set.add(k);
  }
  return set;
}

module.exports = { SOURCE, hashPlan, decidirAplicacion, aplicarPlanRenovacion, serialesExcluidosPorPlan };
