/**
 * diag-vencimientos-pendientes.js — Excel de análisis de los dos residuos del
 * deep-dive de vencimientos (2026-08-27), para decisión de negocio:
 *
 *   1. Aprobados vencidos — contratos en estado 'aprobado' (nunca pasaron a
 *      'activo' — sin firmado subido) cuya fecha de vencimiento ya pasó.
 *      ¿Se renuevan, se terminan o se activan tarde?
 *   2. Sin duración — contratos vigentes ALQ/PROP/REEMP sin duración parseable
 *      (el bug histórico de la duración "Otro" vacía: ' meses'), con la
 *      duración del contrato ORIGEN como sugerencia cuando existe.
 *
 * Solo lectura. USAGE (desde functions/): node scripts/diag-vencimientos-pendientes.js
 * Salida: Escritorio (vencimientos-pendientes-YYYY-MM-DD.xlsx).
 */
const path = require("path");
const os = require("os");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const ExcelJS = require("exceljs");
const VIG = require("../src/lib/vigencia");

const fecha = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d : null; };
const iso = (t) => { const d = fecha(t); return d ? d.toISOString().slice(0, 10) : ""; };

(async () => {
  const now = new Date();
  const snap = await db.collection("contratos").get();
  const todos = new Map();
  snap.forEach((d) => todos.set(d.id, { id: d.id, ...d.data() }));

  const aprobadosVencidos = [];
  const sinDuracion = [];

  for (const c of todos.values()) {
    if (c.deleted) continue;
    const vigente = ["activo", "aprobado"].includes(c.estado);
    if (!vigente || !VIG.aplicaVencimiento(c)) continue;

    const fv = fecha(c.fecha_vencimiento);
    if (c.estado === "aprobado" && fv && fv < now) {
      const renovadores = (c.renovado_por_ids || [])
        .map((id) => todos.get(id))
        .filter((r) => r && ["activo", "aprobado"].includes(r.estado))
        .map((r) => r.contrato_id || r.id);
      aprobadosVencidos.push({
        contrato: c.contrato_id || c.id, docId: c.id,
        cliente: c.cliente_nombre || "", tipo: c.tipo_contrato || c.codigo_tipo || "",
        accion: c.accion || "", duracion: c.duracion || "",
        creado: iso(c.fecha_creacion), aprobado: iso(c.fecha_aprobacion),
        vencio: iso(c.fecha_vencimiento),
        diasVencido: Math.floor((now - fv) / 86400000),
        unidades: (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0),
        mensual: Number(c.total_mensual ?? c.total_con_itbms ?? 0),
        renovadoPor: renovadores.join(", "),
        firmado: c.firmado ? "sí" : "no",
        obs: (c.observaciones || "").slice(0, 200),
      });
    }

    const meses = VIG.parseDuracionMeses(c.duracion);
    if (!meses && !fv) {
      // Sin duración NI vencimiento estampado (los REEMP con herencia ya
      // quedaron cubiertos por el backfill; estos son el residuo real).
      const origenes = (c.contrato_origen_ids || (c.contrato_origen_id ? [c.contrato_origen_id] : []))
        .map((id) => todos.get(id)).filter(Boolean);
      const sugerencia = origenes.map((o) =>
        `${o.contrato_id || o.id}: ${o.duracion || "sin duración"}`).join(" · ");
      sinDuracion.push({
        contrato: c.contrato_id || c.id, docId: c.id,
        cliente: c.cliente_nombre || "", tipo: c.tipo_contrato || c.codigo_tipo || "",
        estado: c.estado, accion: c.accion || "",
        duracionCruda: JSON.stringify(c.duracion ?? null),
        creado: iso(c.fecha_creacion),
        unidades: (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0),
        mensual: Number(c.total_mensual ?? c.total_con_itbms ?? 0),
        origenSugerencia: sugerencia,
        obs: (c.observaciones || "").slice(0, 200),
      });
    }
  }

  aprobadosVencidos.sort((a, b) => b.diasVencido - a.diasVencido);
  sinDuracion.sort((a, b) => (a.cliente || "").localeCompare(b.cliente || ""));

  const wb = new ExcelJS.Workbook();
  const wsR = wb.addWorksheet("Resumen");
  wsR.addRows([
    ["Diagnóstico de vencimientos pendientes", new Date().toISOString().slice(0, 10)],
    [],
    ["Aprobados vencidos", aprobadosVencidos.length, "Contratos aprobados (sin firmado→activo) cuya fecha de vencimiento ya pasó. Decidir: renovar, terminar o activar tarde."],
    ["Sin duración", sinDuracion.length, "Vigentes ALQ/PROP/REEMP sin duración parseable ni vencimiento. La columna 'Origen (sugerencia)' trae la duración del contrato origen cuando existe."],
  ]);
  wsR.getColumn(1).width = 24; wsR.getColumn(2).width = 8; wsR.getColumn(3).width = 110;

  const ws1 = wb.addWorksheet("Aprobados vencidos");
  ws1.columns = [
    { header: "Contrato", key: "contrato", width: 20 }, { header: "Cliente", key: "cliente", width: 34 },
    { header: "Tipo", key: "tipo", width: 12 }, { header: "Acción", key: "accion", width: 12 },
    { header: "Duración", key: "duracion", width: 11 }, { header: "Creado", key: "creado", width: 12 },
    { header: "Aprobado", key: "aprobado", width: 12 }, { header: "Venció", key: "vencio", width: 12 },
    { header: "Días vencido", key: "diasVencido", width: 12 }, { header: "Unid.", key: "unidades", width: 7 },
    { header: "Mensual $", key: "mensual", width: 11 }, { header: "Renovado por", key: "renovadoPor", width: 22 },
    { header: "Firmado", key: "firmado", width: 9 }, { header: "Observaciones", key: "obs", width: 50 },
    { header: "Doc ID", key: "docId", width: 24 },
  ];
  ws1.addRows(aprobadosVencidos);

  const ws2 = wb.addWorksheet("Sin duración");
  ws2.columns = [
    { header: "Contrato", key: "contrato", width: 20 }, { header: "Cliente", key: "cliente", width: 34 },
    { header: "Tipo", key: "tipo", width: 12 }, { header: "Estado", key: "estado", width: 11 },
    { header: "Acción", key: "accion", width: 12 }, { header: "Duración cruda", key: "duracionCruda", width: 15 },
    { header: "Creado", key: "creado", width: 12 }, { header: "Unid.", key: "unidades", width: 7 },
    { header: "Mensual $", key: "mensual", width: 11 },
    { header: "Origen (sugerencia)", key: "origenSugerencia", width: 44 },
    { header: "Observaciones", key: "obs", width: 50 }, { header: "Doc ID", key: "docId", width: 24 },
  ];
  ws2.addRows(sinDuracion);

  [ws1, ws2].forEach(ws => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; });

  const out = path.join(os.homedir(), "Desktop", `vencimientos-pendientes-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`OK → ${out}`);
  console.log(`Aprobados vencidos: ${aprobadosVencidos.length} · Sin duración: ${sinDuracion.length}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
