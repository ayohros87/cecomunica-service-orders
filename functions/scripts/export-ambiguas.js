/**
 * export-ambiguas.js — Excel de análisis de las unidades AMBIGUAS del barrido
 * de custodia (en_cliente sin contrato con VARIOS contratos candidatos), para
 * decidir a mano a qué contrato amarrar cada una (pedido de Alberto 2026-08-26).
 *
 * Solo lectura. Hojas:
 *   1. Resumen     — conteos del barrido y guía de lectura.
 *   2. Ambiguas    — 1 fila por unidad: ficha del pool, última orden, kardex
 *                    resumido y la lista de contratos candidatos con su cupo.
 *   3. Candidatos  — 1 fila por unidad × contrato candidato, con fechas,
 *                    vencimiento, entrega, línea del modelo y cupo libre.
 *   4. Kardex      — últimos 6 movimientos por unidad (órdenes/contratos por
 *                    los que pasó — el contexto para decidir).
 *
 * USAGE (desde functions/): node scripts/export-ambiguas.js
 * Salida: Escritorio (ambiguas-custodia-YYYY-MM-DD.xlsx).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");
const ExcelJS = require("exceljs");

const vigente = (c) => ["activo", "aprobado"].includes(c.estado) && !c.deleted;
const fecha = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d : null; };
const codigo = (c) => c.codigo_tipo || ({ "Alquiler": "ALQ", "Propio": "PROP", "Reemplazo": "REEMP", "Demo": "DEMO", "Temporal": "TEMP" }[c.tipo_contrato]) || (String(c.contrato_id || "").match(/^[A-Z]+/) || ["?"])[0];

(async () => {
  // ── Recolección (misma lógica de pareo del barrido) ──
  const poolSnap = await db.collection("equipos_pool").where("estado", "==", "en_cliente").get();
  const unidades = [];
  poolSnap.forEach((d) => {
    const u = d.data();
    if (!u.asignacion?.cliente_id || u.asignacion?.contrato_doc_id) return;
    unidades.push({ id: d.id, ref: d.ref, ...u });
  });

  const conSnap = await db.collection("contratos").get();
  const porCliente = new Map();
  conSnap.forEach((d) => {
    const c = d.data();
    if (!vigente(c) || !c.cliente_id) return;
    if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, []);
    porCliente.get(c.cliente_id).push({ id: d.id, ...c });
  });

  const filasCache = new Map();
  const filasDe = async (cid) => {
    if (!filasCache.has(cid)) {
      const s = await db.collection("contratos").doc(cid).collection("seriales").get();
      filasCache.set(cid, s.docs.map((d) => {
        const x = d.data() || {};
        return { serial_norm: pool.normSerial(x.serial || ""), modelo_id: x.modelo_id || null, modelo: x.modelo || "" };
      }));
    }
    return filasCache.get(cid);
  };

  const ambiguas = [];
  for (const u of unidades) {
    const contratos = porCliente.get(u.asignacion.cliente_id) || [];
    if (!contratos.length) continue;
    if (!u.modelo_id && !(u.modelo_label || "").trim()) continue;
    const candidatos = [];
    for (const c of contratos) {
      for (const l of (c.equipos || [])) {
        if (!pool.mismoModelo(u, l.modelo_id || null, l.modelo || "")) continue;
        const filas = await filasDe(c.id);
        const filasModelo = filas.filter((f) =>
          (f.modelo_id && l.modelo_id && f.modelo_id === l.modelo_id) ||
          String(f.modelo || "").trim().toUpperCase() === String(l.modelo || "").trim().toUpperCase()).length;
        const bajaModelo = Number((c.baja_cancelado || {})[String(l.modelo_id || l.modelo || "").trim()] || 0);
        const cupo = Number(l.cantidad || 0) - bajaModelo - filasModelo;
        if (cupo > 0) { candidatos.push({ c, linea: l, cupo, filasModelo, bajaModelo }); break; }
      }
    }
    if (candidatos.length > 1) ambiguas.push({ u, candidatos });
  }
  console.log(`Ambiguas: ${ambiguas.length} unidades. Leyendo kardex…`);

  // ── Kardex (últimos 6 movimientos por unidad) ──
  for (const a of ambiguas) {
    try {
      const mv = await a.u.ref.collection("movimientos").orderBy("at", "desc").limit(6).get();
      a.movs = mv.docs.map((d) => d.data());
    } catch (e) { a.movs = []; }
  }

  // ── Excel ──
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const header = (ws, cols) => {
    ws.columns = cols;
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2A47" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  const r = wb.addWorksheet("Resumen");
  r.columns = [{ width: 110 }];
  [
    `Barrido de custodia sin contrato — unidades AMBIGUAS · ${new Date().toLocaleDateString("es-PA")}`,
    "",
    `Unidades en cliente SIN contrato: ${unidades.length}. De ellas, ${ambiguas.length} son AMBIGUAS: su cliente tiene VARIOS`,
    "contratos vigentes con cupo para el modelo, así que el amarre automático no puede elegir por ti.",
    "",
    "Cómo usarlo: en la hoja 'Candidatos' cada unidad aparece una vez por contrato posible, con fechas, vencimiento,",
    "cupo libre y estado de entrega. El 'Kardex' trae las órdenes y movimientos por los que pasó la unidad — la pista",
    "más útil suele ser la última orden de programación. Decidido el contrato: registra el serial en su página de",
    "seriales (o pásame la lista serial→contrato y lo aplico por script).",
    "",
    "OJO: amarrar a un contrato SIN entrega confirmada y no-legacy mueve la unidad a 'Asignada' (deja de contar como",
    "en la calle). Para esos, confirmar primero la entrega real del contrato.",
  ].forEach((t) => r.addRow([t]));
  r.getRow(1).font = { bold: true, size: 14 };

  const wa = wb.addWorksheet("Ambiguas");
  header(wa, [
    { header: "Serial", key: "serial", width: 16 },
    { header: "Modelo", key: "modelo", width: 22 },
    { header: "Cliente", key: "cliente", width: 34 },
    { header: "Propiedad", key: "prop", width: 12 },
    { header: "Condición", key: "cond", width: 10 },
    { header: "Origen ficha", key: "origen", width: 16 },
    { header: "Verificado", key: "verif", width: 10 },
    { header: "Ingreso bodega", key: "ingreso", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Últ. actualización", key: "upd", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Últ. orden (kardex)", key: "orden", width: 18 },
    { header: "Órdenes en kardex", key: "ordenes", width: 26 },
    { header: "Pend. devolución", key: "pend", width: 12 },
    { header: "Reemplaza a", key: "reemp", width: 14 },
    { header: "# Candidatos", key: "n", width: 11 },
    { header: "Contratos candidatos (cupo libre)", key: "cands", width: 60 },
  ]);
  const wc = wb.addWorksheet("Candidatos");
  header(wc, [
    { header: "Serial", key: "serial", width: 16 },
    { header: "Cliente", key: "cliente", width: 34 },
    { header: "Contrato", key: "contrato", width: 18 },
    { header: "Tipo", key: "tipo", width: 8 },
    { header: "Estado", key: "estado", width: 10 },
    { header: "Acción", key: "accion", width: 12 },
    { header: "Creado", key: "creado", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Vence", key: "vence", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Venc. estado", key: "vest", width: 12 },
    { header: "Entrega conf.", key: "entrega", width: 11 },
    { header: "Seriales estado", key: "sest", width: 13 },
    { header: "Modelo línea", key: "lmodelo", width: 22 },
    { header: "Cant. línea", key: "lcant", width: 10 },
    { header: "Precio/mes", key: "lprecio", width: 11, style: { numFmt: '"$"#,##0.00' } },
    { header: "Bajas modelo", key: "lbaja", width: 11 },
    { header: "Seriales ya registrados", key: "lfilas", width: 18 },
    { header: "CUPO LIBRE", key: "cupo", width: 11 },
    { header: "Seguro amarrar (estado intacto)", key: "seguro", width: 24 },
  ]);
  const wk = wb.addWorksheet("Kardex");
  header(wk, [
    { header: "Serial", key: "serial", width: 16 },
    { header: "Fecha", key: "at", width: 15, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Movimiento", key: "tipo", width: 20 },
    { header: "De → A", key: "dea", width: 26 },
    { header: "Ref", key: "ref", width: 26 },
    { header: "Notas", key: "notas", width: 70 },
  ]);

  for (const a of ambiguas) {
    const u = a.u;
    const ordenes = [...new Set((a.movs || [])
      .filter((m) => m.ref?.tipo === "orden" && m.ref?.id)
      .map((m) => m.ref.id))];
    const ultimaOrden = (a.movs || []).find((m) => m.ref?.tipo === "orden" && m.ref?.id);
    wa.addRow({
      serial: u.serial || u.id,
      modelo: u.modelo_label || "",
      cliente: u.asignacion?.cliente_nombre || "",
      prop: u.propiedad || "",
      cond: u.condicion || "",
      origen: u.origen || "",
      verif: u.verificado ? "sí" : "no",
      ingreso: fecha(u.ingreso_bodega_at),
      upd: fecha(u.updated_at),
      orden: ultimaOrden ? ultimaOrden.ref.id : (u.orden_actual_id || ""),
      ordenes: ordenes.join(", "),
      pend: u.pendiente_devolucion ? "sí" : "",
      reemp: u.reemplaza_a || "",
      n: a.candidatos.length,
      cands: a.candidatos.map((x) => `${x.c.contrato_id} (cupo ${x.cupo})`).join(" | "),
    });
    for (const x of a.candidatos) {
      const seguro = x.c.seriales_estado === "legacy" || x.c.entrega_confirmada === true;
      wc.addRow({
        serial: u.serial || u.id,
        cliente: u.asignacion?.cliente_nombre || "",
        contrato: x.c.contrato_id || x.c.id,
        tipo: codigo(x.c),
        estado: x.c.estado,
        accion: x.c.accion || "",
        creado: fecha(x.c.fecha_creacion),
        vence: fecha(x.c.fecha_vencimiento),
        vest: x.c.vencimiento_estado || "",
        entrega: x.c.entrega_confirmada ? "sí" : "no",
        sest: x.c.seriales_estado || "",
        lmodelo: x.linea.modelo || "",
        lcant: Number(x.linea.cantidad || 0),
        lprecio: Number(x.linea.precio || 0),
        lbaja: x.bajaModelo,
        lfilas: x.filasModelo,
        cupo: x.cupo,
        seguro: seguro ? "SÍ" : "NO — confirmar entrega primero",
      });
    }
    for (const m of (a.movs || [])) {
      wk.addRow({
        serial: u.serial || u.id,
        at: fecha(m.at),
        tipo: m.tipo || "",
        dea: [m.de_estado, m.a_estado].filter(Boolean).join(" → "),
        ref: m.ref ? `${m.ref.tipo || ""} ${m.ref.id || ""}`.trim() : "",
        notas: m.notas || "",
      });
    }
  }

  let dir = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(dir)) dir = process.cwd();
  const out = path.join(dir, `ambiguas-custodia-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`Listo: ${out}`);
  console.log(`Unidades ambiguas: ${ambiguas.length} · filas candidatos: ${wc.rowCount - 1} · filas kardex: ${wk.rowCount - 1}`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
