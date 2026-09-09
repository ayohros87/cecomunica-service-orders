/**
 * analiza-casos-viejos.js — SOLO LECTURA. ¿Cuántas reparaciones terminadas
 * lleva la casa sin cerrar, y de qué son de verdad?
 *
 * LA PREGUNTA QUE CONTESTA
 *   La válvula de "Casos viejos" (2026-09-09) parte cada caso en dos: "ya se
 *   entregó y nadie lo marcó" o "el cliente no vino". Antes de tocar la señal
 *   "lista para entregar" —que hoy los cuenta a todos— hace falta saber
 *   cuántos son y qué tan viejos. Sin ese número, cambiar la señal es
 *   adivinar.
 *
 * QUÉ CUENTA (mismo predicado que public/js/pages/ordenes-casos-viejos.js):
 *   REPARACIÓN, no eliminada, en COMPLETADO (EN OFICINA), con el QC resuelto
 *   y ≥30 días desde fecha_completado.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/analiza-casos-viejos.js
 *   node scripts/analiza-casos-viejos.js --dias 30 --top 15
 *   node scripts/analiza-casos-viejos.js --excel C:/ruta/casos-viejos.xlsx
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DIAS = Number(flag("--dias", 30));
const TOP = Number(flag("--top", 12));
const EXCEL = flag("--excel", null);

const COMPLETADO = "COMPLETADO (EN OFICINA)";
const norm = (s) => String(s || "").trim().toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "");
const esReparacion = (o) => norm(o.tipo_de_servicio).includes("reparacion");

const aDate = (ts) => {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
};
const dias = (ts) => {
  const d = aDate(ts);
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
};

// Espeja PendientesDomain.qcPendiente: la marca exige QC y no hay aprobación
// vigente. Un caso con QC pendiente NO espera al cliente — espera al taller.
function qcPendiente(o) {
  if (o.qc_requerido !== true) return false;
  const qc = o.qc || {};
  if (qc.resultado !== "aprobado") return true;
  const n = qc.equipos_n;
  if (typeof n === "number" && n !== (Array.isArray(o.equipos) ? o.equipos.length : 0)) return true;
  return false;
}

const equiposActivos = (o) => (Array.isArray(o.equipos) ? o.equipos : []).filter(e => e && !e.eliminado);
const tandas = (o) => (o.entrega && Array.isArray(o.entrega.tandas)) ? o.entrega.tandas : [];
function pendientesDe(o) {
  const fuera = new Set();
  for (const t of tandas(o)) {
    for (const u of (Array.isArray(t.equipos) ? t.equipos : [])) {
      if (u && u.id) fuera.add(String(u.id));
      const s = String((u && u.serial) || "").trim().toUpperCase();
      if (s) fuera.add("s:" + s);
    }
  }
  return equiposActivos(o).filter(e => {
    if (e.id && fuera.has(String(e.id))) return false;
    const s = String(e.numero_de_serie || e.serial || "").trim().toUpperCase();
    return !(s && fuera.has("s:" + s));
  });
}

const pct = (n, t) => t ? ` (${Math.round(n * 100 / t)}%)` : "";

async function main() {
  const snap = await db.collection("ordenes_de_servicio")
    .where("estado_reparacion", "==", COMPLETADO).get();
  const todas = snap.docs.map(d => ({ ordenId: d.id, ...d.data() }))
    .filter(o => o.eliminado !== true);

  console.log(`\nÓrdenes en ${COMPLETADO}: ${todas.length}`);

  // Por tipo: para ver cuánto del atasco es siquiera de la válvula.
  const porTipo = new Map();
  for (const o of todas) {
    const t = (o.tipo_de_servicio || "sin tipo").toUpperCase();
    porTipo.set(t, (porTipo.get(t) || 0) + 1);
  }
  console.log("\nPor tipo:");
  for (const [t, n] of [...porTipo].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${t}`);
  }

  const reparaciones = todas.filter(esReparacion);
  const conQc = reparaciones.filter(o => qcPendiente(o));
  const listas = reparaciones.filter(o => !qcPendiente(o));

  console.log(`\nREPARACIONES completadas: ${reparaciones.length}`);
  console.log(`  esperando QC (no son casos viejos): ${conQc.length}`);
  console.log(`  con el QC resuelto: ${listas.length}`);

  // Reparto por antigüedad — la pregunta real es cuántas de las que suenan en
  // la señal son viejas de verdad.
  const cortes = [
    ["0-2 días (aún no suenan)", (d) => d !== null && d < 3],
    ["3-6 días", (d) => d >= 3 && d < 7],
    ["7-29 días", (d) => d >= 7 && d < DIAS],
    [`${DIAS}+ días (CASOS VIEJOS)`, (d) => d >= DIAS],
    ["sin fecha", (d) => d === null],
  ];
  console.log("\nReparaciones con QC resuelto, por antigüedad desde fecha_completado:");
  for (const [etiqueta, test] of cortes) {
    const n = listas.filter(o => test(dias(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion))).length;
    console.log(`  ${String(n).padStart(4)}${pct(n, listas.length).padEnd(7)} ${etiqueta}`);
  }

  const viejos = listas.filter(o => {
    const d = dias(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion);
    return d !== null && d >= DIAS;
  }).sort((a, b) => (dias(b.fecha_completado) || 0) - (dias(a.fecha_completado) || 0));

  const equipos = viejos.reduce((s, o) => s + pendientesDe(o).length, 0);
  const conTanda = viejos.filter(o => tandas(o).length > 0);
  console.log(`\n── CASOS VIEJOS (${DIAS}+ días): ${viejos.length} órdenes · ${equipos} equipos sin retirar`);
  console.log(`   con alguna entrega parcial ya hecha: ${conTanda.length}`);

  if (viejos.length) {
    const mas = dias(viejos[0].fecha_completado);
    const menos = dias(viejos[viejos.length - 1].fecha_completado);
    console.log(`   antigüedad: de ${menos} a ${mas} días`);

    // Concentración por cliente: si diez casos son del mismo cliente, es UNA
    // llamada, no diez decisiones.
    const porCliente = new Map();
    for (const o of viejos) {
      const c = o.cliente_nombre || "(sin cliente)";
      const v = porCliente.get(c) || { n: 0, eq: 0 };
      v.n++; v.eq += pendientesDe(o).length;
      porCliente.set(c, v);
    }
    const ranking = [...porCliente].sort((a, b) => b[1].n - a[1].n);
    console.log(`\n   ${porCliente.size} clientes distintos. Los ${Math.min(TOP, ranking.length)} con más casos:`);
    for (const [c, v] of ranking.slice(0, TOP)) {
      console.log(`     ${String(v.n).padStart(3)} órdenes · ${String(v.eq).padStart(3)} equipos  ${c}`);
    }
    const top5 = ranking.slice(0, 5).reduce((s, [, v]) => s + v.n, 0);
    console.log(`   los 5 primeros concentran ${top5} de ${viejos.length}${pct(top5, viejos.length)}`);

    console.log(`\n   Los ${Math.min(TOP, viejos.length)} más viejos:`);
    for (const o of viejos.slice(0, TOP)) {
      const d = dias(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion);
      const p = pendientesDe(o).length;
      console.log(`     ${o.ordenId}  ${String(d).padStart(4)} d · ${String(p).padStart(2)} eq · ${(o.cliente_nombre || "—").slice(0, 40)}`);
    }
  }

  // Órdenes SIN equipos activos: no tienen nada que entregar y aun así están
  // en COMPLETADO. No son un caso de la válvula (no hay radio que decidir):
  // hay que mirarlas aparte.
  const sinEquipos = listas.filter(o => equiposActivos(o).length === 0);
  if (sinEquipos.length) {
    console.log(`\n── OJO: ${sinEquipos.length} reparación(es) completadas SIN equipos activos`);
    for (const o of sinEquipos) {
      const total = (Array.isArray(o.equipos) ? o.equipos : []).length;
      const d = dias(o.fecha_completado || o.fecha_creacion);
      console.log(`     ${o.ordenId}  ${String(d).padStart(4)} d · ${total} línea(s) en total · ${(o.cliente_nombre || "—").slice(0, 40)}`);
    }
    console.log("     No hay radio que entregar ni que dejar en custodia: se cierran o se corrigen, no van por la válvula.");
  }

  // Lo que hoy suena en el recordatorio. OJO: la señal real
  // (PendientesDomain.esListaParaEntregar) cuenta PROGRAMACIÓN **y**
  // REPARACIÓN — medir solo reparaciones daría un número más bonito que el
  // que ve la gente en el correo diario.
  const deLaSenal = todas.filter(o => /programa|repara/.test(norm(o.tipo_de_servicio)));
  const suenan = deLaSenal.filter(o => !qcPendiente(o)).filter(o => {
    const d = dias(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion);
    return d !== null && d >= 3;
  });
  const suenanRep = suenan.filter(esReparacion).length;
  console.log(`\n── La señal "lista para entregar" (≥3 días, PROGRAMACIÓN + REPARACIÓN): ${suenan.length}`);
  console.log(`   reparaciones: ${suenanRep} · programaciones: ${suenan.length - suenanRep}`);
  console.log(`   casos viejos que ya se cierran desde la hoja: ${viejos.length}${pct(viejos.length, suenan.length)}`);
  console.log(`   seguirían sonando aunque se cerraran todos: ${suenan.length - viejos.length}\n`);

  if (EXCEL) await exportar(viejos);
}

// ── Excel para trabajar la lista ─────────────────────────────────────────
// Dos hojas porque son dos maneras de atacarlo: "Casos" para ir orden por
// orden, y "Por cliente" porque el trabajo real son llamadas — cinco clientes
// concentran la mayoría, y llamar una vez por radio sería absurdo.
async function exportar(viejos) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "C Comunica · sistema de órdenes";
  wb.created = new Date();

  const fecha = (ts) => { const d = aDate(ts); return d ? d.toISOString().slice(0, 10) : ""; };
  const ws = wb.addWorksheet("Casos");
  ws.columns = [
    { header: "Orden", key: "orden", width: 14 },
    { header: "Cliente", key: "cliente", width: 46 },
    { header: "Días sin retirar", key: "dias", width: 16 },
    { header: "Terminada el", key: "completado", width: 14 },
    { header: "Equipos", key: "n", width: 9 },
    { header: "Seriales", key: "seriales", width: 40 },
    { header: "Modelos", key: "modelos", width: 30 },
    { header: "Técnico", key: "tecnico", width: 22 },
    { header: "Motivo de la orden", key: "obs", width: 50 },
    { header: "Decisión (llenar)", key: "decision", width: 22 },
    { header: "Notas de la llamada", key: "notas", width: 34 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const o of viejos) {
    const p = pendientesDe(o);
    const fila = ws.addRow({
      orden: o.ordenId,
      cliente: o.cliente_nombre || "(sin cliente)",
      dias: dias(o.fecha_completado || o.fecha_creacion),
      completado: fecha(o.fecha_completado || o.fecha_creacion),
      n: p.length,
      seriales: p.map(e => e.numero_de_serie || e.serial || "—").join(", "),
      modelos: [...new Set(p.map(e => e.modelo).filter(Boolean))].join(", "),
      tecnico: o.tecnico_asignado || "",
      obs: String(o.observaciones || "").replace(/\s+/g, " ").slice(0, 300),
      decision: "",
      notas: "",
    });
    // Los de 60+ días en rojo: son los que ya no se explican solos.
    const d = dias(o.fecha_completado || o.fecha_creacion);
    if (d >= 60) fila.getCell("dias").font = { color: { argb: "FFB91C1C" }, bold: true };
  }
  ws.autoFilter = { from: "A1", to: "K1" };
  // La columna de decisión, con las DOS puertas de la hoja de Casos viejos.
  ws.dataValidations.add(`J2:J${viejos.length + 1}`, {
    type: "list", allowBlank: true,
    formulae: ['"Ya se entregó,No vino - dejar en custodia,El cliente viene tal día"'],
    showErrorMessage: false,
  });

  const ws2 = wb.addWorksheet("Por cliente");
  ws2.columns = [
    { header: "Cliente", key: "cliente", width: 50 },
    { header: "Órdenes", key: "n", width: 10 },
    { header: "Equipos", key: "eq", width: 10 },
    { header: "Más viejo (días)", key: "max", width: 17 },
    { header: "Órdenes", key: "ordenes", width: 44 },
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.views = [{ state: "frozen", ySplit: 1 }];
  const porCliente = new Map();
  for (const o of viejos) {
    const c = o.cliente_nombre || "(sin cliente)";
    const v = porCliente.get(c) || { n: 0, eq: 0, max: 0, ordenes: [] };
    v.n++; v.eq += pendientesDe(o).length;
    v.max = Math.max(v.max, dias(o.fecha_completado || o.fecha_creacion) || 0);
    v.ordenes.push(o.ordenId);
    porCliente.set(c, v);
  }
  [...porCliente].sort((a, b) => b[1].eq - a[1].eq || b[1].n - a[1].n)
    .forEach(([cliente, v]) => ws2.addRow({ ...v, cliente, ordenes: v.ordenes.join(", ") }));

  await wb.xlsx.writeFile(String(EXCEL));
  console.log(`Excel escrito: ${EXCEL}  (${viejos.length} casos · ${porCliente.size} clientes)\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
