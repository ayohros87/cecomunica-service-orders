/**
 * analiza-huecos-seriales.js — SOLO LECTURA. Dónde están los equipos de
 * contratos VIGENTES que no tienen serial ligado, y cuáles de esos huecos se
 * cierran desde el escritorio en vez de yendo al cliente.
 *
 * LA PREGUNTA QUE CONTESTA
 *   "¿A qué clientes hay que ir a levantar seriales?" — y la respuesta útil no
 *   es la lista de huecos, sino la lista PARTIDA EN DOS:
 *     · pareable  — el radio YA está en el pool, con el cliente correcto, pero
 *       sin contrato asignado (herencia de las migraciones POC y de órdenes:
 *       1,776 fichas `en_cliente` sin `asignacion.contrato_doc_id` a
 *       2026-08-27). Eso es conciliación de escritorio.
 *     · ir a campo — no hay candidato en el sistema. Ahí sí hay que levantar
 *       el serial en sitio.
 *   Sin esa partición, el trabajo se ve tres veces más grande de lo que es.
 *
 * TRAMPA MEDIDA (2026-08-27): parear por TEXTO de modelo da CERO. El contrato
 * dice "PNC360S" y el pool "HYTERA PNC360S". Hay que parear por `modelo_id`
 * primero y caer a comparación tolerante (contención), como hace el resto del
 * sistema. Con texto exacto el informe decía "0 pareables"; con el criterio
 * correcto, 410.
 *
 * USAGE (desde functions/):
 *   node scripts/analiza-huecos-seriales.js                 # resumen + top
 *   node scripts/analiza-huecos-seriales.js --todos         # todos los clientes
 *   node scripts/analiza-huecos-seriales.js --cliente <id>  # detalle de uno
 *   node scripts/analiza-huecos-seriales.js --excel <ruta>  # exporta el detalle
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const P = require("./_pareo-huecos");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || true) : null; };
const TODOS = args.includes("--todos");
const CLIENTE = flag("--cliente");
const EXCEL = flag("--excel");

(async () => {
  const [cSnap, pSnap] = await Promise.all([
    db.collection("contratos").get(),
    db.collection("equipos_pool").get(),
  ]);

  const vigentes = P.contratosVigentes(cSnap);
  const { asignadas, huerfanas, nombre } = P.leerPool(pSnap);
  const huecos = P.huecosPorCliente(vigentes, asignadas, nombre);

  // Pareo por cliente. Cada huérfana se usa una sola vez.
  const filas = [];
  const detalle = [];
  for (const [cli, items] of huecos) {
    const disp = huerfanas.get(cli) || [];
    const pare = P.parear(items, disp);
    for (const it of items) {
      detalle.push({
        cliente: nombre.get(cli) || cli, cliente_id: cli,
        contrato: it.contrato, seriales_estado: it.seriales_estado,
        modelo: it.modelo,
        candidato: it.candidato ? it.candidato.serial : "",
        candidato_modelo: it.candidato ? it.candidato.modelo : "",
        accion: it.candidato ? "parear (escritorio)" : "levantar en campo",
      });
    }
    filas.push({
      cliente: nombre.get(cli) || cli, cliente_id: cli,
      falta: items.length, pare, ir: items.length - pare,
      sobran: disp.filter((x) => !x.usada).length,
    });
  }
  let sobranTotal = 0;
  for (const [, disp] of huerfanas) sobranTotal += disp.filter((x) => !x.usada).length;

  const totF = filas.reduce((s, f) => s + f.falta, 0);
  const totP = filas.reduce((s, f) => s + f.pare, 0);
  const pct = (n) => (totF ? Math.round((n / totF) * 100) : 0);

  if (CLIENTE) {
    const mios = detalle.filter((d) => d.cliente_id === CLIENTE || d.cliente === CLIENTE);
    console.log(`\n=== ${mios.length ? mios[0].cliente : CLIENTE} — ${mios.length} equipo(s) sin serial ===\n`);
    mios.forEach((d) => console.log(
      `  ${d.accion === "parear (escritorio)" ? "PAREAR " : "CAMPO  "} ${d.contrato.padEnd(18)} ${d.modelo.padEnd(22)} ${d.candidato ? `→ ${d.candidato} (${d.candidato_modelo})` : ""}`));
    const sob = (huerfanas.get(CLIENTE) || []).filter((x) => !x.usada);
    if (sob.length) {
      console.log(`\n  Huérfanas sin reclamar (${sob.length}) — o son de contratos vencidos, o el contrato no las declara:`);
      sob.slice(0, 40).forEach((h) => console.log(`    ${h.serial}  ${h.modelo}`));
    }
    console.log();
  } else {
    console.log("\n=== HUECOS DE SERIALES · contratos vigentes ===\n");
    console.log(`Contratos vigentes                              : ${vigentes.length}`);
    console.log(`Equipos sin serial ligado                       : ${totF}`);
    console.log(`  · con candidato ya en el pool del cliente     : ${totP} (${pct(totP)}%)  → pareo de escritorio`);
    console.log(`  · sin candidato en el sistema                 : ${totF - totP} (${pct(totF - totP)}%)  → levantamiento en campo`);
    console.log(`Huérfanas que quedan sin reclamar               : ${sobranTotal}`);

    const auto = filas.filter((f) => f.falta > 0 && f.ir === 0).sort((a, b) => b.pare - a.pare);
    console.log(`\n── Clientes que se cierran SIN salir de la oficina: ${auto.length} · ${auto.reduce((s, f) => s + f.pare, 0)} equipos ──`);
    auto.forEach((f) => console.log(`  ${String(f.pare).padStart(4)} · ${f.cliente}${f.sobran ? `  (sobran ${f.sobran})` : ""}`));

    const campo = filas.filter((f) => f.ir > 0).sort((a, b) => b.ir - a.ir);
    const muestra = TODOS ? campo : campo.slice(0, 20);
    console.log(`\n── Levantamiento en campo, por volumen (${campo.length} clientes${TODOS ? "" : `, top ${muestra.length}`}) ──`);
    muestra.forEach((f) => console.log(`  ir:${String(f.ir).padStart(4)}  pareable:${String(f.pare).padStart(4)}  ${f.cliente}`));
    if (!TODOS && campo.length > muestra.length) console.log(`  … y ${campo.length - muestra.length} clientes más (--todos)`);
    console.log("\nDetalle por cliente: --cliente <cliente_id> · Exportar: --excel <ruta.xlsx>\n");
  }

  if (EXCEL) {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Huecos de seriales");
    ws.columns = [
      { header: "Cliente", key: "cliente", width: 46 },
      { header: "Contrato", key: "contrato", width: 20 },
      { header: "Estado seriales", key: "seriales_estado", width: 16 },
      { header: "Modelo declarado", key: "modelo", width: 26 },
      { header: "Acción", key: "accion", width: 20 },
      { header: "Serial candidato", key: "candidato", width: 18 },
      { header: "Modelo del candidato", key: "candidato_modelo", width: 26 },
    ];
    ws.getRow(1).font = { bold: true };
    detalle.sort((a, b) => a.cliente.localeCompare(b.cliente) || a.contrato.localeCompare(b.contrato));
    detalle.forEach((d) => ws.addRow(d));
    ws.autoFilter = { from: "A1", to: "G1" };
    await wb.xlsx.writeFile(String(EXCEL));
    console.log(`Excel escrito: ${EXCEL}  (${detalle.length} filas)\n`);
  }
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
