// proponerModeloSinFicha — para fichas del pool sin modelo (las ~2,000 de
// `migracion_poc`, pedido de Brenda 2026-10-06), el servidor PROPONE el modelo
// con la evidencia que hay, y bodega acepta por grupo desde Almacén ·
// Existencias (plan de autoservicio 2026-10-07, P4/D1). Nada se escribe aquí:
// la corrección la hace el navegador con EquiposPoolService.reclasificarModelo
// (kardex `correccion_modelo` con el nombre de quien aceptó).
//
// Evidencia, por fuerza:
//   1. la fila de seriales del contrato al que la ficha está amarrada;
//   2. las órdenes de servicio que listan el serial (searchTokens);
//   3. el PREFIJO del serial (6 caracteres, Hytera): si en el pool ≥ 90 % de
//      las fichas con ese prefijo son de una misma familia y hay ≥ 10, se
//      propone esa familia (confianza media — es estadística, no prueba).
// Regla de negocio (Alberto 2026-10-06): "PNC360" no existe, es PNC360S;
// "PNC360R" es PNC360S-R. La fila N/R se elige por la condición de la ficha.
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../lib/admin");
const pool = require("../domain/equiposPool");
const { catalogo, ModeloFamilia } = require("../domain/modeloCatalogo");

const ROLES = new Set(["administrador", "inventario", "gerente"]);
const MAX_IDS = 80;
const PREFIJO_MIN = 10;
const PREFIJO_UMBRAL = 0.9;

const ALIAS = { PNC360: "PNC360S", PNC360R: "PNC360S-R", PNC360SR: "PNC360S-R" };
function textoConAlias(t) {
  const k = String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ALIAS[k] || t;
}
function filaPara(ref, condicion) {
  // ref: { modelo_id, modelo } → fila del catálogo según condición (N/R).
  const texto = textoConAlias(ref.modelo || "");
  const fam = ModeloFamilia.familiaDe({ modelo_id: ref.modelo_id || null, modelo: texto });
  if (!fam || fam.startsWith("~")) return null;
  return ModeloFamilia.filaDe(fam, condicion === "reuso" ? "reuso" : "nuevo")
    || ModeloFamilia.filaDe(fam, condicion === "reuso" ? "nuevo" : "reuso") || null;
}
const etiqueta = (f) => `${f.marca || ""} ${f.modelo || ""}`.trim();
const prefijoDe = (sn) => (String(sn || "").length >= 8 ? String(sn).slice(0, 6) : null);

async function evidenciaContrato(ficha) {
  const cid = ficha.asignacion?.contrato_doc_id;
  if (!cid) return null;
  const serial = ficha.serial || ficha.serial_norm || ficha.id;
  const snap = await db.collection("contratos").doc(cid).collection("seriales").where("serial", "==", serial).limit(1).get();
  if (snap.empty) return null;
  const s = snap.docs[0].data() || {};
  if (!s.modelo_id && !s.modelo) return null;
  return { modelo_id: s.modelo_id || null, modelo: s.modelo || "", detalle: `contrato ${ficha.asignacion?.contrato_id || cid}` };
}
async function evidenciaOrdenes(ficha) {
  const sn = String(ficha.serial_norm || pool.normSerial(ficha.serial || ficha.id)).toLowerCase();
  if (!sn) return null;
  const snap = await db.collection("ordenes_de_servicio").where("searchTokens", "array-contains", sn).limit(6).get();
  const votos = new Map();
  for (const d of snap.docs) {
    const o = d.data() || {};
    if (o.eliminado === true) continue;
    for (const e of (o.equipos || [])) {
      if (!e || pool.normSerial(e.numero_de_serie || e.serial || "") !== pool.normSerial(sn)) continue;
      if (!e.modelo_id && !e.modelo) continue;
      const k = e.modelo_id || String(e.modelo).toUpperCase();
      const v = votos.get(k) || { modelo_id: e.modelo_id || null, modelo: e.modelo || "", ordenes: [] };
      v.ordenes.push(d.id); votos.set(k, v);
    }
  }
  if (!votos.size) return null;
  const lista = [...votos.values()].sort((a, b) => b.ordenes.length - a.ordenes.length);
  // Dos modelos distintos en órdenes = ambiguo, salvo que sean la misma familia.
  const fams = new Set(lista.map((v) => ModeloFamilia.familiaDe({ modelo_id: v.modelo_id, modelo: textoConAlias(v.modelo) })));
  if (fams.size > 1) return { ambiguo: true, detalle: lista.map((v) => `${v.modelo || v.modelo_id} (${v.ordenes.join(", ")})`).join(" vs ") };
  return { ...lista[0], detalle: `orden ${lista[0].ordenes.slice(0, 3).join(", ")}` };
}
async function estadisticaPrefijos(prefijos) {
  const out = new Map();
  for (const p of prefijos) {
    const snap = await db.collection("equipos_pool").where("serial_norm", ">=", p).where("serial_norm", "<", p + "").limit(400).get();
    const cuenta = new Map(); let total = 0;
    for (const d of snap.docs) {
      const x = d.data() || {};
      if (!x.modelo_id && !x.modelo_label) continue;
      const fam = ModeloFamilia.familiaDe({ modelo_id: x.modelo_id || null, modelo: x.modelo_label || "" });
      if (!fam || fam.startsWith("~")) continue;
      total++; cuenta.set(fam, (cuenta.get(fam) || 0) + 1);
    }
    if (total < PREFIJO_MIN) { out.set(p, null); continue; }
    const [fam, n] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0];
    out.set(p, n / total >= PREFIJO_UMBRAL ? { familia: fam, n, total } : null);
  }
  return out;
}

async function ejecutar({ ids }) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpsError("invalid-argument", "Falta la lista de fichas.");
  if (ids.length > MAX_IDS) throw new HttpsError("invalid-argument", `Máximo ${MAX_IDS} fichas por llamada.`);
  await catalogo();
  const fichas = [];
  for (const id of ids) {
    const d = await db.collection("equipos_pool").doc(String(id)).get();
    if (d.exists) fichas.push({ id: d.id, ...d.data() });
  }
  const prefijos = new Set(fichas.map((f) => prefijoDe(f.serial_norm || pool.normSerial(f.serial || f.id))).filter(Boolean));
  const stats = await estadisticaPrefijos([...prefijos]);
  const propuestas = []; const sinPista = []; const ambiguas = [];
  for (const f of fichas) {
    if (f.modelo_id || String(f.modelo_label || "").trim()) { sinPista.push({ id: f.id, serial: f.serial || f.id, motivo: "ya tiene modelo" }); continue; }
    const cond = f.condicion === "reuso" ? "reuso" : "nuevo";
    let ev = null; let fuente = null; let confianza = "alta";
    ev = await evidenciaContrato(f); if (ev) fuente = "contrato";
    if (!ev) { const eo = await evidenciaOrdenes(f); if (eo?.ambiguo) { ambiguas.push({ id: f.id, serial: f.serial || f.id, motivo: `órdenes con modelos distintos: ${eo.detalle}` }); continue; } if (eo) { ev = eo; fuente = "orden"; } }
    if (!ev) {
      const p = prefijoDe(f.serial_norm || pool.normSerial(f.serial || f.id));
      const st = p && stats.get(p);
      if (st) { ev = { modelo_id: st.familia, modelo: "", detalle: `prefijo ${p}: ${st.n} de ${st.total} fichas son ${ModeloFamilia.familiaLabel(st.familia)}` }; fuente = "prefijo"; confianza = "media"; }
    }
    if (!ev) { sinPista.push({ id: f.id, serial: f.serial || f.id, motivo: "sin contrato, sin orden y prefijo sin mayoría" }); continue; }
    const fila = filaPara(ev, cond);
    if (!fila) { sinPista.push({ id: f.id, serial: f.serial || f.id, motivo: `"${ev.modelo || ev.modelo_id}" no está en el catálogo` }); continue; }
    propuestas.push({ id: f.id, serial: f.serial || f.id, estado: f.estado || null, modelo_id: fila.id, modelo_label: etiqueta(fila), condicion: cond, fuente, confianza, detalle: ev.detalle });
  }
  return { propuestas, sinPista, ambiguas };
}

module.exports = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) throw new HttpsError("permission-denied", "Solo bodega o administración completa modelos.");
    return ejecutar({ ids: request.data?.ids });
  },
);
module.exports.ejecutar = ejecutar;
module.exports._textoConAlias = textoConAlias;
