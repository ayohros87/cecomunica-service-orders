/**
 * analiza-listas-sin-retirar.js — SOLO LECTURA. ¿Cuántas órdenes están en
 * "Listas para entregar" hoy, por edad, y cuántas de ellas parecen YA
 * entregadas sin que nadie las marcara?
 *
 * Pedido de Alberto (2026-11-11), antes de construir la escalación a 15 días
 * de la propuesta de Solangel: las cifras de agosto/septiembre ya no sirven.
 *
 * QUÉ CUENTA: el mismo predicado que la señal ENT del home y la sección E del
 * correo diario (domain/pendientes.esListaParaEntregar con entregaDias = 0):
 * PROGRAMACIÓN o REPARACIÓN, no eliminada, COMPLETADO (EN OFICINA), QC
 * aprobado y vigente si se exigía. Cortes: <15 · 15–30 · >30 días desde
 * fecha_completado.
 *
 * SEÑALES DE "YA SE ENTREGÓ Y NADIE LO MARCÓ" (por orden, se acumulan):
 *   P  el pool dice que algún serial de la orden está en_cliente /
 *      asignado_contrato / vendido, o cuelga de OTRA orden más nueva.
 *      Mientras la orden está viva el pool lo tiene en_taller: si ya salió,
 *      algo posterior lo movió (otra orden, renovación, entrega tardía).
 *   O  existe otra orden del mismo serial creada DESPUÉS de completarse esta.
 *   C  (PROGRAMACIÓN) el contrato de la orden se firmó o registró entrega
 *      después de fecha_completado — el cliente firmó al recibir.
 *   T  la orden tiene tandas de entrega parcial (algo ya salió).
 *   F  hay aviso de facturación de la orden (se crea al entregar/activar).
 *
 * USAGE (desde functions/, con NODE_PATH=node_modules):
 *   node scripts/analiza-listas-sin-retirar.js
 *   node scripts/analiza-listas-sin-retirar.js --csv C:/ruta/salida.csv
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const PEND = require("../src/domain/pendientes");

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const CSV = flag("--csv", null);
const now = new Date();

const aDate = (ts) => {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
};
const dias = (ts) => { const d = aDate(ts); return d ? Math.floor((now - d) / 86400000) : null; };
const normSerial = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function serialesDe(o) {
  const out = new Set();
  for (const e of (Array.isArray(o.equipos) ? o.equipos : [])) {
    if (!e || e.eliminado) continue;
    const s = normSerial(e.numero_de_serie || e.serial);
    if (s) out.add(s);
  }
  return [...out];
}

// Un doc de contrato puede guardar la firma de varias formas según la época.
function fechaFirmaContrato(c) {
  if (!c) return null;
  const cands = [c.firmado_at, c.firma_at, c.firma && c.firma.firmado_at, c.firma && c.firma.at,
    c.firma_cliente && c.firma_cliente.at, c.fecha_firma, c.entrega_confirmada_at,
    c.entrega && c.entrega.at, c.entrega && c.entrega.fecha];
  for (const v of cands) { const d = aDate(v); if (d) return d; }
  return null;
}

async function main() {
  const snap = await db.collection("ordenes_de_servicio")
    .where("estado_reparacion", "==", "COMPLETADO (EN OFICINA)").get();
  const listas = snap.docs.map(d => ({ ordenId: d.id, ...d.data() }))
    .filter(o => PEND.esListaParaEntregar(o, now, 0));

  console.log(`\nEn COMPLETADO (EN OFICINA): ${snap.size} · Listas para entregar (PROG+REP, QC ok): ${listas.length}`);

  // ── Pool por serial (una lectura por serial, en lotes) ───────────────
  const seriales = new Set();
  for (const o of listas) serialesDe(o).forEach(s => seriales.add(s));
  const pool = new Map();
  const ids = [...seriales];
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map(s => db.collection("equipos_pool").doc(s));
    const docs = await db.getAll(...refs);
    docs.forEach(d => { if (d.exists) pool.set(d.id, d.data()); });
  }
  console.log(`Seriales distintos en esas órdenes: ${ids.length} · con ficha en el pool: ${pool.size}`);

  // ── Órdenes posteriores por serial: todas las órdenes creadas desde la
  //    orden lista más vieja (acotado) ──────────────────────────────────
  const masVieja = listas.reduce((m, o) => { const d = aDate(o.fecha_completado); return d && (!m || d < m) ? d : m; }, null);
  const posteriores = [];
  if (masVieja) {
    const s2 = await db.collection("ordenes_de_servicio")
      .where("fecha_creacion", ">=", admin.firestore.Timestamp.fromDate(masVieja)).get();
    s2.forEach(d => posteriores.push({ ordenId: d.id, ...d.data() }));
  }
  const porSerialPosterior = new Map(); // serial → [{ordenId, fecha}]
  for (const p of posteriores) {
    for (const s of serialesDe(p)) {
      if (!porSerialPosterior.has(s)) porSerialPosterior.set(s, []);
      porSerialPosterior.get(s).push({ ordenId: p.ordenId, fecha: aDate(p.fecha_creacion) });
    }
  }

  // ── Contratos de las PROGRAMACIÓN ─────────────────────────────────────
  const contratoIds = new Set();
  for (const o of listas) {
    const cid = o.contrato && (o.contrato.contrato_doc_id || o.contrato.doc_id || o.contrato.contrato_id);
    if (cid) contratoIds.add(String(cid));
  }
  const contratos = new Map();
  const cids = [...contratoIds];
  for (let i = 0; i < cids.length; i += 300) {
    const docs = await db.getAll(...cids.slice(i, i + 300).map(c => db.collection("contratos").doc(c)));
    docs.forEach(d => { if (d.exists) contratos.set(d.id, d.data()); });
  }
  // Los que no se encontraron por doc id: buscar por contrato_id (número).
  const faltan = cids.filter(c => !contratos.has(c));
  for (const c of faltan) {
    const q = await db.collection("contratos").where("contrato_id", "==", c).limit(1).get();
    if (!q.empty) contratos.set(c, q.docs[0].data());
  }

  // ── Avisos de facturación por orden ───────────────────────────────────
  const avisos = new Set();
  for (let i = 0; i < listas.length; i += 30) {
    const lote = listas.slice(i, i + 30).map(o => o.ordenId);
    const q = await db.collection("facturacion_avisos").where("orden_id", "in", lote).get();
    q.forEach(d => avisos.add(String(d.data().orden_id)));
  }

  // ── Clasificación ──────────────────────────────────────────────────────
  const filas = [];
  for (const o of listas) {
    const fc = aDate(o.fecha_completado) || aDate(o.fecha_modificacion) || aDate(o.fecha_creacion);
    const edad = fc ? Math.floor((now - fc) / 86400000) : null;
    const corte = edad == null ? "sin fecha" : edad < 15 ? "<15" : edad <= 30 ? "15-30" : ">30";
    const senales = [];
    const ss = serialesDe(o);
    let fueraPool = 0, otraOrden = 0, sinFicha = 0;
    for (const s of ss) {
      const f = pool.get(s);
      if (!f) { sinFicha++; continue; }
      const enOtra = f.orden_actual_id && String(f.orden_actual_id) !== o.ordenId;
      if (["en_cliente", "asignado_contrato", "vendido"].includes(f.estado) || enOtra) fueraPool++;
      const post = (porSerialPosterior.get(s) || []).filter(p => p.ordenId !== o.ordenId && p.fecha && fc && p.fecha > fc);
      if (post.length) otraOrden++;
    }
    if (ss.length && fueraPool === ss.length) senales.push("P");
    else if (fueraPool) senales.push("p");
    if (otraOrden) senales.push("O");
    const cid = o.contrato && (o.contrato.contrato_doc_id || o.contrato.doc_id || o.contrato.contrato_id);
    const c = cid ? contratos.get(String(cid)) : null;
    const ff = fechaFirmaContrato(c);
    if (ff && fc && ff > fc) senales.push("C");
    if (o.entrega && Array.isArray(o.entrega.tandas) && o.entrega.tandas.length) senales.push("T");
    if (avisos.has(o.ordenId)) senales.push("F");
    const fuerte = senales.some(x => ["P", "O", "C"].includes(x));
    filas.push({
      ordenId: o.ordenId, cliente: o.cliente_nombre || "—", tipo: (o.tipo_de_servicio || "").toUpperCase(),
      edad, corte, equipos: ss.length, sinFicha, senales: senales.join(""), fuerte,
      vendedor: o.vendedor_nombre || o.vendedor_asignado || "",
    });
  }

  const cortes = ["<15", "15-30", ">30", "sin fecha"];
  console.log("\nPor edad desde fecha_completado (todas las listas):");
  console.log("  corte      total   PROG   REP   con señal fuerte (P/O/C)   con alguna señal");
  for (const k of cortes) {
    const f = filas.filter(r => r.corte === k);
    if (!f.length) continue;
    const prog = f.filter(r => r.tipo.includes("PROGRAMA")).length;
    const fuertes = f.filter(r => r.fuerte).length;
    const alguna = f.filter(r => r.senales).length;
    console.log(`  ${k.padEnd(9)} ${String(f.length).padStart(5)}  ${String(prog).padStart(5)} ${String(f.length - prog).padStart(5)}   ${String(fuertes).padStart(10)}               ${String(alguna).padStart(6)}`);
  }
  const tot = filas.length, fuertes = filas.filter(r => r.fuerte).length, alguna = filas.filter(r => r.senales).length;
  console.log(`  TOTAL     ${String(tot).padStart(5)}                     ${String(fuertes).padStart(10)}               ${String(alguna).padStart(6)}`);
  const sinSerial = filas.filter(r => r.equipos === 0).length;
  const sinFichaTotal = filas.filter(r => r.equipos && r.sinFicha === r.equipos).length;
  console.log(`\n  órdenes sin ningún serial (no se puede leer el pool): ${sinSerial}`);
  console.log(`  órdenes cuyos seriales no tienen ficha en el pool: ${sinFichaTotal}`);

  console.log("\nDetalle (señales: P=todos los seriales fuera del taller según el pool, p=algunos, O=otra orden posterior con el serial, C=contrato firmado después, T=entrega parcial, F=aviso de facturación):");
  filas.sort((a, b) => (b.edad ?? -1) - (a.edad ?? -1));
  for (const r of filas) {
    console.log(`  ${r.ordenId}  ${String(r.edad ?? "?").padStart(4)} d  ${r.tipo.slice(0, 12).padEnd(12)} ${String(r.equipos).padStart(2)} eq  ${(r.senales || "·").padEnd(5)} ${r.cliente.slice(0, 44)}`);
  }

  if (CSV) {
    const fs = require("fs");
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["orden", "cliente", "tipo", "vendedor", "dias", "corte", "equipos", "senales"];
    const lines = [head.join(",")].concat(filas.map(r => [r.ordenId, r.cliente, r.tipo, r.vendedor, r.edad, r.corte, r.equipos, r.senales].map(esc).join(",")));
    fs.writeFileSync(CSV, "\ufeff" + lines.join("\n"), "utf8");
    console.log(`\nCSV: ${CSV}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
