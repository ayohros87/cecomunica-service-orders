/**
 * analiza-seriales-por-ordenes.js — SOLO LECTURA. Para los contratos legacy
 * con seriales faltantes, busca evidencia en las ÓRDENES DE SERVICIO (todas,
 * incluidas entregadas y viejas):
 *
 *   Tier A — orden VINCULADA al contrato (orden.contrato.contrato_doc_id):
 *     los seriales de sus equipos pertenecen a ESE contrato — evidencia
 *     directa que resuelve la ambigüedad multi-contrato del cliente.
 *   Tier B — orden del mismo cliente SIN vínculo, con fecha dentro de la
 *     vigencia del contrato (fecha_creacion − 30d en adelante): evidencia
 *     circunstancial, solo se reporta (útil si el cliente tiene UN contrato).
 *
 * Reporta por contrato cuántas casillas faltantes se cubrirían con Tier A
 * (respetando modelo del renglón y capacidad) y qué aporta Tier B.
 *
 * USAGE (desde functions/):
 *   node scripts/analiza-seriales-por-ordenes.js [--csv out.csv]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const csvIdx = process.argv.indexOf("--csv");
const csvOut = csvIdx > -1 ? process.argv[csvIdx + 1] : null;

const normName = (s) => String(s || "").trim().toLowerCase()
  // eslint-disable-next-line no-control-regex -- intencional: recorta todo lo no-ASCII
  .normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/\s+/g, " ");
const esNoAplica = (m) => {
  const t = String(m || "").toLowerCase().replace(/[^a-z]/g, "");
  return !t || t === "noaplica" || t === "na";
};
const mm = (aId, aLabel, bId, bLabel) =>
  pool.mismoModelo({ modelo_id: aId, modelo_label: aLabel }, bId, bLabel);
const fechaDe = (t) => (t?.toDate ? t.toDate() : (t ? new Date(t) : null));

(async () => {
  const [contratosSnap, serialesSnap, ordenesSnap] = await Promise.all([
    db.collection("contratos").where("seriales_estado", "==", "legacy").get(),
    db.collectionGroup("seriales").get(),
    db.collection("ordenes_de_servicio").get(),
  ]);

  // Seriales ya registrados por contrato
  const serialesDe = new Map();
  serialesSnap.docs.forEach((d) => {
    const parent = d.ref.parent.parent;
    if (!parent || d.ref.parent.parent.parent.id !== "contratos") return;
    const s = d.data();
    if ((s.serial || "").trim()) {
      (serialesDe.get(parent.id) || serialesDe.set(parent.id, []).get(parent.id)).push(s);
    }
  });

  // Órdenes: por contrato vinculado y por cliente
  const ordenesPorContrato = new Map(); // cid → [{fecha, numero, equipos[]}]
  const ordenesPorCliente = new Map();  // clave → idem (sin vínculo a contrato)
  const claveCliente = (id, nombre) => id || `n:${normName(nombre)}`;
  ordenesSnap.docs.forEach((d) => {
    const o = d.data();
    if (o.eliminado === true) return;
    const equipos = (o.equipos || [])
      .filter((e) => e && !e.eliminado)
      .map((e) => ({
        serial: (e.serial || e.SERIAL || e.numero_de_serie || "").toString().trim(),
        modelo_id: e.modelo_id || null,
        modelo: (e.modelo || e.MODEL || e.modelo_nombre || "").toString().trim(),
      }))
      .filter((e) => e.serial && pool.esSerialValido(pool.normSerial(e.serial)));
    if (!equipos.length) return;
    const item = { fecha: fechaDe(o.fecha_creacion), numero: o.numero_orden || d.id, equipos };
    const cid = o.contrato?.aplica && o.contrato?.contrato_doc_id ? o.contrato.contrato_doc_id : null;
    if (cid) {
      (ordenesPorContrato.get(cid) || ordenesPorContrato.set(cid, []).get(cid)).push(item);
    } else {
      const k = claveCliente(o.cliente_id, o.cliente_nombre);
      if (k) (ordenesPorCliente.get(k) || ordenesPorCliente.set(k, []).get(k)).push(item);
    }
  });

  // Análisis por contrato legacy pendiente
  const contratos = contratosSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => c.deleted !== true && ["activo", "aprobado"].includes(c.estado));

  const filas = [];
  const tot = { contratos: 0, faltanTotal: 0, cubribleTierA: 0,
    contratosConTierA: 0, contratosCompletablesTierA: 0, tierBcontratos: 0, serialesEnDosContratos: 0 };

  // Serial → contratos que lo evidencian por Tier A (para detectar conflictos)
  const evidencia = new Map();

  for (const c of contratos) {
    const cancelado = c.baja_cancelado || {};
    const existentes = serialesDe.get(c.id) || [];
    const registradosNorm = new Set(existentes.map((s) => pool.normSerial(s.serial)));

    // Renglones con faltantes
    const renglones = [];
    for (const eq of (c.equipos || [])) {
      if (esNoAplica(eq.modelo)) continue;
      const key = String(eq.modelo_id || eq.modelo);
      const activos = Math.max(0, Number(eq.cantidad || 0) - Number(cancelado[key] || 0));
      if (!activos) continue;
      const puestos = existentes.filter((s) => mm(s.modelo_id, s.modelo, eq.modelo_id, eq.modelo)).length;
      const faltan = Math.max(0, activos - puestos);
      if (faltan) renglones.push({ modelo_id: eq.modelo_id || null, modelo: eq.modelo || "", faltan });
    }
    if (!renglones.length) continue;
    tot.contratos++;
    const faltanContrato = renglones.reduce((a, r) => a + r.faltan, 0);
    tot.faltanTotal += faltanContrato;

    // Tier A: seriales de órdenes vinculadas, más reciente primero
    const vinculadas = (ordenesPorContrato.get(c.id) || [])
      .sort((a, b) => (b.fecha?.getTime() || 0) - (a.fecha?.getTime() || 0));
    const vistoA = new Set();
    const tierA = [];
    for (const o of vinculadas) {
      for (const e of o.equipos) {
        const n = pool.normSerial(e.serial);
        if (vistoA.has(n) || registradosNorm.has(n)) continue;
        vistoA.add(n);
        tierA.push({ ...e, orden: o.numero, fecha: o.fecha });
      }
    }
    // ¿Cuántas casillas cubre Tier A respetando modelo y capacidad?
    let cubre = 0;
    const detalleA = [];
    for (const r of renglones) {
      const cand = tierA.filter((e) => mm(e.modelo_id, e.modelo, r.modelo_id, r.modelo));
      const usa = cand.slice(0, r.faltan);
      cubre += usa.length;
      usa.forEach((e) => {
        detalleA.push(`${e.serial}→${r.modelo} (OS ${e.orden})`);
        const n = pool.normSerial(e.serial);
        (evidencia.get(n) || evidencia.set(n, new Set()).get(n)).add(c.contrato_id || c.id);
      });
    }
    if (cubre) tot.contratosConTierA++;
    if (cubre >= faltanContrato) tot.contratosCompletablesTierA++;
    tot.cubribleTierA += cubre;

    // Tier B: órdenes del cliente sin vínculo, en vigencia (desde -30d de creación)
    const ini = fechaDe(c.fecha_creacion);
    const desde = ini ? new Date(ini.getTime() - 30 * 24 * 3600 * 1000) : null;
    const sinVinculo = (ordenesPorCliente.get(claveCliente(c.cliente_id, c.cliente_nombre)) || [])
      .filter((o) => !desde || (o.fecha && o.fecha >= desde));
    const serialesB = new Set();
    sinVinculo.forEach((o) => o.equipos.forEach((e) => {
      const n = pool.normSerial(e.serial);
      if (!registradosNorm.has(n) && !vistoA.has(n)) serialesB.add(n);
    }));
    if (serialesB.size) tot.tierBcontratos++;

    filas.push({
      contrato: c.contrato_id || c.id, cliente: c.cliente_nombre || "",
      faltan: faltanContrato, ordenesVinculadas: vinculadas.length,
      cubreTierA: cubre, tierB: serialesB.size,
      completable: cubre >= faltanContrato ? "SI" : (cubre ? "PARCIAL" : "NO"),
      detalle: detalleA.slice(0, 6).join(" | "),
    });
  }

  tot.serialesEnDosContratos = [...evidencia.values()].filter((s) => s.size > 1).length;

  filas.sort((a, b) => b.cubreTierA - a.cubreTierA || b.faltan - a.faltan);
  console.log(JSON.stringify(tot, null, 2));
  console.log("\nTop contratos por cobertura Tier A:");
  filas.filter((f) => f.cubreTierA).slice(0, 15).forEach((f) =>
    console.log(` ${f.contrato} · ${f.cliente.slice(0, 34).padEnd(34)} faltan ${String(f.faltan).padStart(3)} · órdenes ${f.ordenesVinculadas} · cubre ${String(f.cubreTierA).padStart(3)} (${f.completable}) · tierB ${f.tierB}`));

  if (csvOut) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + ["Contrato;Cliente;Faltan;Órdenes vinculadas;Cubre Tier A;Completable;Tier B (candidatos por fecha);Detalle Tier A (muestra)",
      ...filas.map((f) => [f.contrato, f.cliente, f.faltan, f.ordenesVinculadas, f.cubreTierA, f.completable, f.tierB, f.detalle].map(esc).join(";"))].join("\r\n");
    require("fs").writeFileSync(csvOut, csv, "utf8");
    console.log(`\nDetalle → ${csvOut}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
