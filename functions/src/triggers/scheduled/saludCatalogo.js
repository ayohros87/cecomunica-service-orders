// saludCatalogo — reporte diario "una familia, dos filas" (2026-09-07).
//
// Finanzas · Modelos muestra un panel "Salud del catálogo" con lo que rompe
// el pareo N/R o la facturación. Las comprobaciones que solo miran el catálogo
// las hace el navegador; las que cruzan el POOL (7,500 fichas) y los CONTRATOS
// vivos se calculan aquí una vez al día y se guardan en
// admin_reportes/salud_catalogo (lectura: administrador y contabilidad).
//
// Secciones del reporte:
//   · r_sin_base          — filas R sin variante_de cuya base existe por nombre
//   · r_sin_qbo / r_sin_precio_venta / r_sin_precio_alquiler
//   · fichas_condicion    — fichas cuya condición contradice la fila (N con
//                            reuso, R con nuevo), por modelo, con seriales
//   · fichas_sin_fila_r   — fichas marcadas refurbished en una familia sin fila R
//   · contratos_puente    — contratos vivos con radios que solo casan con su
//                            línea por familia (N/R): informativo
//   · contratos_sin_linea — radios de contratos vivos sin línea ni por familia
"use strict";

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { catalogo, ModeloFamilia } = require("../../domain/modeloCatalogo");

const MAX_SERIALES = 40;
const label = (m) => `${m.marca || ""} ${m.modelo || ""}`.trim();

async function calcularSaludCatalogo() {
  const { lista } = await catalogo({ force: true });
  const activos = lista.filter((m) => m.activo !== false);

  // ── Catálogo ──
  const r_sin_base = [], r_sin_qbo = [], r_sin_precio_venta = [], r_sin_precio_alquiler = [];
  for (const m of activos) {
    if (String(m.estado || "N").toUpperCase() !== "R") continue;
    const fam = ModeloFamilia.familiaDe({ modelo_id: m.id });
    if (!m.variante_de && fam && fam !== m.id) r_sin_base.push({ id: m.id, modelo: label(m), base_id: fam, base: ModeloFamilia.familiaLabel(fam) });
    if (!m.qbo_item_alquiler_id) r_sin_qbo.push({ id: m.id, modelo: label(m) });
    if (!(Number(m.precio_venta) > 0)) r_sin_precio_venta.push({ id: m.id, modelo: label(m), base_tiene: !!ModeloFamilia.precioReferencia({ modelo_id: m.id }, "precio_venta").valor });
    if (m.es_alquiler === true && !(Number(m.precio_alquiler) > 0)) r_sin_precio_alquiler.push({ id: m.id, modelo: label(m) });
  }

  // ── Pool ──
  const poolSnap = await db.collection("equipos_pool").get();
  const porModeloCond = new Map(); // modelo → { fila, ficha, n, seriales[] }
  const sinFilaR = new Map();
  for (const d of poolSnap.docs) {
    const u = d.data();
    if (u.estado === "baja" || u.estado === "vendido") continue;
    const fila = ModeloFamilia.filaPorId(u.modelo_id);
    if (!fila) continue;
    const esperada = fila.estado === "R" ? "reuso" : "nuevo";
    if (u.condicion && u.condicion !== esperada) {
      const k = label(fila);
      const cur = porModeloCond.get(k) || { modelo_id: fila.id, modelo: k, fila: esperada, ficha: u.condicion, n: 0, seriales: [] };
      cur.n++;
      if (cur.seriales.length < MAX_SERIALES) cur.seriales.push(u.serial || d.id);
      porModeloCond.set(k, cur);
    }
    if (u.familia_sin_fila_r === true) {
      const k = label(fila);
      const cur = sinFilaR.get(k) || { modelo_id: fila.id, modelo: k, n: 0, seriales: [] };
      cur.n++;
      if (cur.seriales.length < MAX_SERIALES) cur.seriales.push(u.serial || d.id);
      sinFilaR.set(k, cur);
    }
  }

  // ── Contratos vivos ──
  const conSnap = await db.collection("contratos").where("estado", "in", ["activo", "aprobado"]).get();
  const contratos = new Map();
  conSnap.forEach((d) => { const c = d.data(); if (!c.deleted) contratos.set(d.id, { id: d.id, ...c }); });
  const puente = new Map(), sinLinea = new Map();
  for (const d of poolSnap.docs) {
    const u = d.data();
    const cid = u.asignacion && u.asignacion.contrato_doc_id;
    const c = cid && contratos.get(cid);
    if (!c) continue;
    const lineas = c.equipos || [];
    const ref = { modelo_id: u.modelo_id || null, modelo: u.modelo_label || "", propiedad: u.propiedad };
    const cands = ModeloFamilia.lineasCompatibles(ref, lineas);
    const k = `${c.contrato_id || c.id}`;
    if (!cands.length) {
      const cur = sinLinea.get(k) || { contrato_doc_id: c.id, contrato_id: k, cliente: c.cliente_nombre || "", cliente_id: c.cliente_id || "", n: 0, seriales: [] };
      cur.n++; if (cur.seriales.length < MAX_SERIALES) cur.seriales.push(`${u.serial || d.id} (${u.modelo_label || "?"})`);
      sinLinea.set(k, cur);
    } else if (!cands[0].exacto) {
      const cur = puente.get(k) || { contrato_doc_id: c.id, contrato_id: k, cliente: c.cliente_nombre || "", cliente_id: c.cliente_id || "", n: 0 };
      cur.n++; puente.set(k, cur);
    }
  }

  const ordenar = (m) => [...m.values()].sort((a, b) => b.n - a.n);
  return {
    generado_at: admin.firestore.FieldValue.serverTimestamp(),
    modelos_activos: activos.length,
    fichas: poolSnap.size,
    contratos_vivos: contratos.size,
    r_sin_base, r_sin_qbo, r_sin_precio_venta, r_sin_precio_alquiler,
    fichas_condicion: ordenar(porModeloCond),
    fichas_condicion_total: [...porModeloCond.values()].reduce((s, x) => s + x.n, 0),
    fichas_sin_fila_r: ordenar(sinFilaR),
    contratos_puente: ordenar(puente).slice(0, 60),
    contratos_puente_total: [...puente.values()].reduce((s, x) => s + x.n, 0),
    contratos_sin_linea: ordenar(sinLinea).slice(0, 60),
    contratos_sin_linea_total: [...sinLinea.values()].reduce((s, x) => s + x.n, 0),
  };
}

async function guardarSaludCatalogo() {
  const rep = await calcularSaludCatalogo();
  await db.collection("admin_reportes").doc("salud_catalogo").set(rep);
  logger.info("[saludCatalogo] reporte guardado", {
    r_sin_base: rep.r_sin_base.length, r_sin_qbo: rep.r_sin_qbo.length,
    fichas_condicion: rep.fichas_condicion_total, puente: rep.contratos_puente_total, sin_linea: rep.contratos_sin_linea_total,
  });
  return rep;
}

module.exports = onSchedule(
  { schedule: "every day 06:45", timeZone: "America/Panama", region: "us-central1", memory: "512MiB", timeoutSeconds: 300 },
  async () => { await guardarSaludCatalogo(); },
);
module.exports.calcularSaludCatalogo = calcularSaludCatalogo;
module.exports.guardarSaludCatalogo = guardarSaludCatalogo;
