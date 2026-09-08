// Regularización de cuentas — la parte que CALCULA con datos vivos y escribe
// `clientes/{id}.regularizacion` (plan docs/plans/PLAN_REGULARIZACION_CUENTAS.md).
// La regla vive en domain/regularizacion.js (compartida con el front); aquí
// solo se cargan los datos, se agrupan por cuenta y se escribe si cambió.
//
// Dos entradas:
//   · barridoCompleto(): todas las cuentas, con TRES lecturas grandes
//     (contratos, pool en campo, gestiones) agrupadas por cliente — mucho más
//     barato que consultar cuenta por cuenta (≈3k unidades, ≈800 contratos).
//   · barridoMarcados(): solo las cuentas con `regularizacion_dirty_at`
//     (las marcan los triggers de pool/contratos/gestiones), cuenta por cuenta.
// Los scripts de corrección pueden llamar a recalcularCuenta(id) a demanda.
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const R = require("./regularizacion");

const ESTADOS_POOL = ["en_cliente", "asignado_contrato", "por_clasificar"];

// Umbrales desde empresa/config (fallback: DEFAULTS del módulo).
async function config() {
  let cfg = {};
  try { const s = await db.collection("empresa").doc("config").get(); cfg = s.exists ? (s.data() || {}) : {}; } catch (e) { /* defaults */ }
  const n = (k, d) => (Number(cfg[k]) > 0 ? Number(cfg[k]) : d);
  return {
    leve_max_d1: n("regularizacion_leve_max_d1", R.DEFAULTS.leve_max_d1),
    critica_min_d1: n("regularizacion_critica_min_d1", R.DEFAULTS.critica_min_d1),
    max_puntuales: n("regularizacion_max_puntuales", R.DEFAULTS.max_puntuales),
    max_dias: n("regularizacion_max_dias", R.DEFAULTS.max_dias),
    email_gerencia: String(cfg.regularizacion_email_gerencia || cfg.email_gerencia || "").trim(),
  };
}

function _cidUnidad(u) {
  if (!u) return null;
  if (u.estado === "por_clasificar") return u.ultima_asignacion?.cliente_id || u.asignacion?.cliente_id || null;
  return u.asignacion?.cliente_id || null;
}

// Doc que se guarda: lo del módulo + dueño + fechas como Timestamp.
function _docGuardado(reg, cliente) {
  const ts = (d) => (d instanceof Date && !isNaN(d) ? admin.firestore.Timestamp.fromDate(d) : null);
  return {
    ...reg,
    primera_marca_at: ts(reg.primera_marca_at),
    ultima_gestion_puntual_at: ts(reg.ultima_gestion_puntual_at),
    vendedor_uid: cliente?.vendedor_asignado || null,
    vendedor_email: cliente?.vendedor_email || null,
    calculado_at: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// Escribe solo si cambió lo que importa (o si cambió el dueño). Devuelve
// { escrito, antes, despues } para que el barrido cuente y detecte los que
// PASAN a exceder el margen (digest a gerencia).
async function _guardar(ref, cliente, reg) {
  const antes = cliente?.regularizacion || null;
  const mismoDueno = (antes?.vendedor_uid || null) === (cliente?.vendedor_asignado || null);
  const dirty = !!cliente?.regularizacion_dirty_at;
  if (antes && R.igual(antes, reg) && mismoDueno && !dirty) return { escrito: false, antes, despues: reg };
  const upd = { regularizacion: _docGuardado(reg, cliente) };
  if (dirty) upd.regularizacion_dirty_at = admin.firestore.FieldValue.delete();
  await ref.update(upd);
  return { escrito: true, antes, despues: reg };
}

// ── Una cuenta ────────────────────────────────────────────────────────────
async function cargarCuenta(clienteId) {
  const [cliSnap, conSnap, poolA, poolB, gesSnap] = await Promise.all([
    db.collection("clientes").doc(clienteId).get(),
    db.collection("contratos").where("cliente_id", "==", clienteId).get(),
    db.collection("equipos_pool").where("asignacion.cliente_id", "==", clienteId).get(),
    db.collection("equipos_pool").where("ultima_asignacion.cliente_id", "==", clienteId).where("estado", "==", "por_clasificar").get(),
    db.collection("gestiones").where("cliente_id", "==", clienteId).get(),
  ]);
  const vistos = new Set();
  const unidades = [];
  for (const d of poolA.docs.concat(poolB.docs)) {
    if (vistos.has(d.id)) continue;
    vistos.add(d.id);
    const u = d.data();
    if (ESTADOS_POOL.includes(u.estado)) unidades.push({ id: d.id, ...u });
  }
  return {
    ref: cliSnap.ref,
    cliente: cliSnap.exists ? { id: cliSnap.id, ...cliSnap.data() } : null,
    contratos: conSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    unidades,
    gestiones: gesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

async function recalcularCuenta(clienteId, cfg = null) {
  const c = cfg || await config();
  const { ref, cliente, contratos, unidades, gestiones } = await cargarCuenta(clienteId);
  if (!cliente || cliente.deleted) return null;
  const reg = R.calcular({ contratos, unidades, gestiones, opts: c });
  const r = await _guardar(ref, cliente, reg);
  return { clienteId, nombre: cliente.nombre || "", ...r };
}

// Marca "hay que recalcular" — la llaman los triggers. Best-effort.
async function marcar(clienteId, motivo = "") {
  if (!clienteId) return;
  try {
    await db.collection("clientes").doc(clienteId).update({ regularizacion_dirty_at: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    // El cliente puede no existir (fichas huérfanas del pool): no es error.
    if (e?.code !== 5 && !/NOT_FOUND/i.test(String(e?.message || ""))) logger.warn("[regularizacion] no se pudo marcar", { clienteId, motivo, message: e?.message });
  }
}

// ── Barrido de marcados (cada pocos minutos) ──────────────────────────────
async function barridoMarcados({ max = 60 } = {}) {
  const cfg = await config();
  const snap = await db.collection("clientes").orderBy("regularizacion_dirty_at").limit(max).get();
  const out = { revisadas: 0, escritas: 0, errores: 0 };
  for (const d of snap.docs) {
    out.revisadas++;
    try { const r = await recalcularCuenta(d.id, cfg); if (r?.escrito) out.escritas++; }
    catch (e) { out.errores++; logger.warn("[regularizacion] marcado falló", { id: d.id, message: e?.message }); }
  }
  return out;
}

// ── Barrido completo (diario) ─────────────────────────────────────────────
async function barridoCompleto() {
  const cfg = await config();
  const [cliSnap, conSnap, poolSnap, gesSnap] = await Promise.all([
    db.collection("clientes").get(),
    db.collection("contratos").get(),
    db.collection("equipos_pool").where("estado", "in", ESTADOS_POOL).get(),
    db.collection("gestiones").get(),
  ]);
  const porCuenta = new Map();
  const cta = (id) => { if (!porCuenta.has(id)) porCuenta.set(id, { contratos: [], unidades: [], gestiones: [] }); return porCuenta.get(id); };
  conSnap.docs.forEach(d => { const c = d.data(); if (c.cliente_id) cta(c.cliente_id).contratos.push({ id: d.id, ...c }); });
  poolSnap.docs.forEach(d => { const u = d.data(); const cid = _cidUnidad(u); if (cid) cta(cid).unidades.push({ id: d.id, ...u }); });
  gesSnap.docs.forEach(d => { const g = d.data(); if (g.cliente_id) cta(g.cliente_id).gestiones.push({ id: d.id, ...g }); });

  const out = { cuentas: 0, escritas: 0, con_deuda: 0, criticas: 0, exceden: 0, nuevas_exceden: [], sin_vendedor: 0, errores: 0,
    puntos: 0, d1: 0, d2: 0 };
  for (const d of cliSnap.docs) {
    const cliente = { id: d.id, ...d.data() };
    if (cliente.deleted) continue;
    out.cuentas++;
    const datos = porCuenta.get(d.id) || { contratos: [], unidades: [], gestiones: [] };
    try {
      const reg = R.calcular({ ...datos, opts: cfg });
      const r = await _guardar(d.ref, cliente, reg);
      if (r.escrito) out.escritas++;
      if (reg.puntos > 0) {
        out.con_deuda++; out.puntos += reg.puntos; out.d1 += reg.d1; out.d2 += reg.d2;
        if (!cliente.vendedor_asignado) out.sin_vendedor++;
      }
      if (reg.nivel === "critica") out.criticas++;
      if (reg.excede_margen) {
        out.exceden++;
        if (!r.antes?.excede_margen) out.nuevas_exceden.push({ id: d.id, nombre: cliente.nombre || "", vendedor: cliente.vendedor_email || "", puntos: reg.puntos, puntuales: reg.gestiones_puntuales });
      }
    } catch (e) { out.errores++; logger.warn("[regularizacion] cuenta falló", { id: d.id, message: e?.message }); }
  }
  return out;
}

module.exports = { config, cargarCuenta, recalcularCuenta, marcar, barridoMarcados, barridoCompleto };
