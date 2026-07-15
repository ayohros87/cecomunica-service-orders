/**
 * analiza-match-fechas.js — SOLO LECTURA. Tier C (evidencia por FECHA): para
 * los contratos legacy que AÚN tienen seriales faltantes tras el match v2,
 * evalúa cuánto se resolvería usando las órdenes del cliente SIN vínculo a
 * contrato cuya fecha cae en la vigencia del contrato (desde fecha_creacion
 * − 30 días en adelante).
 *
 * Evidencia más débil que la orden vinculada (la orden solo prueba que el
 * cliente TENÍA ese radio en esas fechas, no a qué contrato pertenece), así
 * que aplica las mismas reglas estrictas del match:
 *   · rivalidad: si otro contrato pendiente del cliente pide el mismo modelo → skip
 *   · sobre-oferta: candidatos > faltantes → skip
 *   · excluye seriales ya amparados en el pool o evidenciados por órdenes
 *     vinculadas de otro contrato
 *
 * USAGE (desde functions/): node scripts/analiza-match-fechas.js [--csv out.csv]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const csvIdx = process.argv.indexOf("--csv");
const csvOut = csvIdx > -1 ? process.argv[csvIdx + 1] : null;

const normName = (s) => String(s || "").trim().toLowerCase()
  .normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/\s+/g, " ");
const esNoAplica = (m) => {
  const t = String(m || "").toLowerCase().replace(/[^a-z]/g, "");
  return !t || t === "noaplica" || t === "na";
};
const mm = (aId, aLabel, bId, bLabel) =>
  pool.mismoModelo({ modelo_id: aId, modelo_label: aLabel }, bId, bLabel);
const fechaDe = (t) => (t?.toDate ? t.toDate() : (t ? new Date(t) : null));

(async () => {
  const [contratosSnap, serialesSnap, poolSnap, ordenesSnap] = await Promise.all([
    db.collection("contratos").where("seriales_estado", "==", "legacy").get(),
    db.collectionGroup("seriales").get(),
    db.collection("equipos_pool").get(),
    db.collection("ordenes_de_servicio").get(),
  ]);

  const serialesDe = new Map();
  serialesSnap.docs.forEach((d) => {
    const parent = d.ref.parent.parent;
    if (!parent || d.ref.parent.parent.parent.id !== "contratos") return;
    const s = d.data();
    if ((s.serial || "").trim()) {
      (serialesDe.get(parent.id) || serialesDe.set(parent.id, []).get(parent.id)).push(s);
    }
  });

  const poolPorNorm = new Map();
  poolSnap.docs.forEach((d) => {
    const v = d.data();
    (poolPorNorm.get(v.serial_norm) || poolPorNorm.set(v.serial_norm, []).get(v.serial_norm)).push(v);
  });
  const yaAmparado = (norm) => {
    const docs = poolPorNorm.get(norm) || [];
    return docs.some((v) => ["asignado_contrato", "en_cliente", "baja"].includes(v.estado));
  };

  const claveCliente = (id, nombre) => id || `n:${normName(nombre)}`;

  // Órdenes: sin vínculo → por cliente; vinculadas → sus seriales quedan
  // reservados a ese contrato (excluidos del tier por fecha).
  const ordenesLibresDe = new Map();  // clave → [{fecha, numero, equipos[]}]
  const reservadoPorVinculo = new Set(); // norm evidenciado por orden vinculada
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
    if (o.contrato?.aplica && o.contrato?.contrato_doc_id) {
      equipos.forEach((e) => reservadoPorVinculo.add(pool.normSerial(e.serial)));
      return;
    }
    const k = claveCliente(o.cliente_id, o.cliente_nombre);
    if (!k) return;
    (ordenesLibresDe.get(k) || ordenesLibresDe.set(k, []).get(k)).push({
      fecha: fechaDe(o.fecha_creacion), numero: o.numero_orden || d.id, equipos,
    });
  });
  ordenesLibresDe.forEach((arr) => arr.sort((a, b) => (b.fecha?.getTime() || 0) - (a.fecha?.getTime() || 0)));

  const contratos = contratosSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => c.deleted !== true && ["activo", "aprobado"].includes(c.estado));
  const porCliente = new Map();
  contratos.forEach((c) => {
    const k = claveCliente(c.cliente_id, c.cliente_nombre);
    (porCliente.get(k) || porCliente.set(k, []).get(k)).push(c);
  });

  const stats = { contratosPendientes: 0, faltanTotal: 0, unidadesAsignables: 0,
    contratosBeneficiados: 0, contratosCompletables: 0,
    renglonesRivalidad: 0, renglonesSobran: 0, renglonesSinCandidatos: 0 };
  const reporte = [];

  for (const [kCliente, cs] of porCliente) {
    const libres = ordenesLibresDe.get(kCliente) || [];
    const usados = new Set();

    const renglones = [];
    for (const c of cs) {
      const cancelado = c.baja_cancelado || {};
      const existentes = serialesDe.get(c.id) || [];
      existentes.forEach((s) => usados.add(pool.normSerial(s.serial)));
      for (const eq of (c.equipos || [])) {
        if (esNoAplica(eq.modelo)) continue;
        const key = String(eq.modelo_id || eq.modelo);
        const activos = Math.max(0, Number(eq.cantidad || 0) - Number(cancelado[key] || 0));
        if (!activos) continue;
        const puestos = existentes.filter((s) => mm(s.modelo_id, s.modelo, eq.modelo_id, eq.modelo)).length;
        const faltan = Math.max(0, activos - puestos);
        if (faltan) renglones.push({ c, modelo_id: eq.modelo_id || null, modelo: eq.modelo || "", faltan });
      }
    }
    if (!renglones.length) continue;

    const contratosCliente = new Set(renglones.map((r) => r.c.id));
    contratosCliente.forEach(() => {});
    const faltanPorContrato = new Map();
    renglones.forEach((r) => faltanPorContrato.set(r.c.id, (faltanPorContrato.get(r.c.id) || 0) + r.faltan));
    stats.contratosPendientes += contratosCliente.size;
    stats.faltanTotal += renglones.reduce((a, r) => a + r.faltan, 0);

    const asignadoPorContrato = new Map();
    for (const r of renglones) {
      const rivales = renglones.filter((o) => o !== r && o.c.id !== r.c.id
        && mm(o.modelo_id, o.modelo, r.modelo_id, r.modelo));
      // Candidatos: seriales de órdenes libres dentro de la vigencia del contrato
      const ini = fechaDe(r.c.fecha_creacion);
      const desde = ini ? new Date(ini.getTime() - 30 * 24 * 3600 * 1000) : null;
      const vistos = new Set();
      const candidatos = [];
      for (const o of libres) {
        if (desde && (!o.fecha || o.fecha < desde)) continue;
        for (const e of o.equipos) {
          const n = pool.normSerial(e.serial);
          if (vistos.has(n)) continue;
          vistos.add(n);
          if (usados.has(n) || reservadoPorVinculo.has(n) || yaAmparado(n)) continue;
          if (!mm(e.modelo_id, e.modelo, r.modelo_id, r.modelo)) continue;
          candidatos.push({ ...e, orden: o.numero });
        }
      }
      const base = { contrato: r.c.contrato_id || r.c.id, cliente: r.c.cliente_nombre || "",
        renglon: r.modelo, faltan: r.faltan, candidatos: candidatos.length };
      if (rivales.length) { stats.renglonesRivalidad++; reporte.push({ ...base, resultado: "SKIP: mismo modelo en varios contratos" }); continue; }
      if (!candidatos.length) { stats.renglonesSinCandidatos++; reporte.push({ ...base, resultado: "SKIP: sin candidatos en ventana" }); continue; }
      if (candidatos.length > r.faltan) { stats.renglonesSobran++; reporte.push({ ...base, resultado: `SKIP: ${candidatos.length} candidatos para ${r.faltan}` }); continue; }
      candidatos.forEach((e) => usados.add(pool.normSerial(e.serial)));
      stats.unidadesAsignables += candidatos.length;
      asignadoPorContrato.set(r.c.id, (asignadoPorContrato.get(r.c.id) || 0) + candidatos.length);
      reporte.push({ ...base, resultado: `ASIGNARÍA ${candidatos.length}`,
        seriales: candidatos.map((x) => `${x.serial}(OS ${x.orden})`).join(" ") });
    }
    stats.contratosBeneficiados += asignadoPorContrato.size;
    for (const [cid, n] of asignadoPorContrato) {
      if (n >= (faltanPorContrato.get(cid) || 0)) stats.contratosCompletables++;
    }
  }

  console.log(JSON.stringify(stats, null, 2));
  if (csvOut) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + ["Contrato;Cliente;Renglón;Faltan;Candidatos;Resultado;Seriales",
      ...reporte.map((f) => [f.contrato, f.cliente, f.renglon, f.faltan, f.candidatos, f.resultado, f.seriales || ""].map(esc).join(";"))].join("\r\n");
    require("fs").writeFileSync(csvOut, csv, "utf8");
    console.log(`Detalle → ${csvOut}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
