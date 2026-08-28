/**
 * cierra-contratos-drenados.js — Cierre de contratos que ya cumplieron su
 * ciclo físico (Alberto 2026-08-28, caso Comité Olímpico: ~31 alquileres de
 * EVENTO de 1 mes quedaron 'aprobado' para siempre; la flota volvió toda).
 *
 * A) CIERRE AUTOMÁTICO (con --write): contratos vigentes ALQ/PROP/REEMP de
 *    duración CORTA (≤ 3 meses — funcionalmente temporales/evento), vencidos
 *    hace más de 30 días y con CERO unidades del pool colgando. Igual que los
 *    DEMO/TEMP: se cierran con la recuperación. estado='vencido' +
 *    estado_previo + motivo + evidencia. Se salta: anulados, renovados por
 *    una renovación real, y cualquier contrato con radios aún colgando.
 *
 * B) PROPUESTA (solo reporte + Excel): contratos vigentes de CUALQUIER
 *    duración cuyo cliente tiene la flota COMPLETA de vuelta (cero unidades
 *    en campo en todo el cliente — caso Supermercados Xtra tras el barrido de
 *    drift). NO se cierran solos: la lista va al Escritorio para decisión.
 *
 * USAGE (desde functions/): node scripts/cierra-contratos-drenados.js [--write]
 */
const path = require("path");
const os = require("os");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const VIG = require("../src/lib/vigencia");
const ExcelJS = require("exceljs");

const WRITE = process.argv.includes("--write");
const aDate = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d : null; };
const fmt = (d) => (d ? d.toISOString().slice(0, 10) : "—");

(async () => {
  const [conSnap, poolSnap] = await Promise.all([
    db.collection("contratos").get(),
    db.collection("equipos_pool").get(),
  ]);

  const colgando = new Map();       // contrato_doc_id → n
  const enCampoCliente = new Map(); // cliente_id → n (cualquier unidad en campo)
  poolSnap.forEach((d) => {
    const u = d.data();
    if (!["asignado_contrato", "en_cliente", "en_demo"].includes(u.estado)) return;
    const cid = u.asignacion?.contrato_doc_id;
    if (cid) colgando.set(cid, (colgando.get(cid) || 0) + 1);
    const cli = u.asignacion?.cliente_id;
    if (cli) enCampoCliente.set(cli, (enCampoCliente.get(cli) || 0) + 1);
  });

  const todos = new Map();
  conSnap.forEach((d) => todos.set(d.id, { id: d.id, ref: d.ref, ...d.data() }));
  const renovadoReal = (c) => (c.renovado_por_ids || []).some((rid) => {
    const r = todos.get(rid);
    return r && ["activo", "aprobado"].includes(r.estado) && VIG.codigoTipo(r) !== "REEMP";
  });

  const now = Date.now();
  const cerrar = [], propuesta = [];

  for (const c of todos.values()) {
    if (c.deleted || !["activo", "aprobado"].includes(c.estado)) continue;
    const cod = VIG.codigoTipo(c);
    if (!["ALQ", "PROP", "REEMP"].includes(cod)) continue;  // DEMO/TEMP: su propio saneo
    if (renovadoReal(c)) continue;
    const n = colgando.get(c.id) || 0;
    const fv = aDate(c.fecha_vencimiento);
    const meses = VIG.parseDuracionMeses(c.duracion);
    const diasVencido = fv ? Math.floor((now - fv.getTime()) / 86400000) : null;

    // A) corto + vencido >30d + cero colgando → cierre automático
    if (meses && meses <= 3 && diasVencido !== null && diasVencido > 30 && n === 0) {
      cerrar.push({ c, diasVencido });
      continue;
    }
    // B) contrato VENCIDO con la flota del CLIENTE completa de vuelta →
    // propuesta. El filtro "vencido" es clave: un contrato reciente con flota
    // en cero suele estar AÚN SIN ENTREGAR (nada que cerrar); la devolución
    // completa solo significa ciclo terminado cuando el período ya venció.
    if (n === 0 && diasVencido !== null && diasVencido > 0
        && (enCampoCliente.get(c.cliente_id) || 0) === 0) {
      propuesta.push({ c, diasVencido });
    }
  }

  cerrar.sort((a, b) => String(a.c.cliente_nombre || "").localeCompare(String(b.c.cliente_nombre || "")));
  propuesta.sort((a, b) => String(a.c.cliente_nombre || "").localeCompare(String(b.c.cliente_nombre || "")));

  console.log(`A) CIERRE AUTO (≤3 meses, vencido >30d, 0 colgando): ${cerrar.length}`);
  const porCliente = new Map();
  cerrar.forEach((x) => porCliente.set(x.c.cliente_nombre, (porCliente.get(x.c.cliente_nombre) || 0) + 1));
  [...porCliente.entries()].forEach(([k, v]) => console.log(`   ${String(v).padStart(3)}  ${k}`));

  console.log(`\nB) PROPUESTA (flota del cliente completa de vuelta): ${propuesta.length}`);
  propuesta.slice(0, 25).forEach((x) => console.log(
    `   ${(x.c.contrato_id || "?").padEnd(18)} ${String(x.c.cliente_nombre || "?").slice(0, 40).padEnd(41)} dur=${String(x.c.duracion || "—").padEnd(9)} fv=${fmt(aDate(x.c.fecha_vencimiento))} $${Number(x.c.total_mensual ?? 0).toFixed(2)}`));
  if (propuesta.length > 25) console.log(`   … y ${propuesta.length - 25} más`);

  // Excel de la propuesta (decisión de Alberto).
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Propuesta de cierre");
  ws.columns = [
    { header: "Cliente", key: "cliente", width: 42 }, { header: "Contrato", key: "contrato", width: 18 },
    { header: "Tipo", key: "tipo", width: 11 }, { header: "Estado", key: "estado", width: 10 },
    { header: "Duración", key: "dur", width: 11 }, { header: "Vence", key: "fv", width: 12 },
    { header: "Días vencido", key: "dias", width: 12 }, { header: "Mensual $", key: "mensual", width: 11 },
    { header: "Unid. líneas", key: "unid", width: 11 }, { header: "Seriales reg.", key: "sers", width: 11 },
    { header: "Doc ID", key: "docId", width: 26 },
  ];
  propuesta.forEach((x) => ws.addRow({
    cliente: x.c.cliente_nombre || "", contrato: x.c.contrato_id || x.c.id, tipo: x.c.codigo_tipo || x.c.tipo_contrato || "",
    estado: x.c.estado, dur: x.c.duracion || "", fv: fmt(aDate(x.c.fecha_vencimiento)),
    dias: x.diasVencido ?? "", mensual: Number(x.c.total_mensual ?? 0),
    unid: (x.c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0),
    sers: Number(x.c.seriales_count || 0), docId: x.c.id,
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const out = path.join(os.homedir(), "Desktop", `cierre-propuestas-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`\nExcel de propuesta → ${out}`);

  if (!WRITE) { console.log("DRY-RUN — nada escrito. Repite con --write (cierra SOLO la categoría A)."); return; }

  const FV = admin.firestore.FieldValue;
  for (const { c, diasVencido } of cerrar) {
    await c.ref.update({
      estado: "vencido",
      estado_previo: c.estado,
      vencido_at: FV.serverTimestamp(),
      vencido_motivo: `Saneo 2026-08-28: contrato corto (${c.duracion}) vencido hace ${diasVencido} días con la flota devuelta (0 unidades colgando en el pool) — los alquileres de evento se cierran con la recuperación, igual que DEMO/TEMP`,
      fecha_modificacion: new Date(),
    });
  }
  console.log(`OK: ${cerrar.length} contratos cortos cerrados (estado 'vencido').`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
