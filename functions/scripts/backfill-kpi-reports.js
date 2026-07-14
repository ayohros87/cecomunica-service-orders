/**
 * backfill-kpi-reports.js
 *
 * Seeds/updates the `kpi_reports` collection (Reporte KPIs Junta module)
 * from a "Financial Report MM-YYYY.xlsx" workbook. One doc per month
 * (ID "YYYY-MM"), from 2022-01 onward — earlier series are excluded for
 * capture inconsistencies (see the report's methodological note).
 *
 * Reuses the frontend parser (public/js/domain/kpiImport.js) so the
 * one-off backfill and the admin importer share a single source of truth.
 *
 * USAGE (from the `functions/` directory; needs `xlsx` resolvable, e.g.
 * via NODE_PATH, since it is not a functions dependency):
 *   node backfill-kpi-reports.js "<path to xlsx>" --dry-run
 *   node backfill-kpi-reports.js "<path to xlsx>"
 *
 * SAFETY:
 *   - Idempotent: months whose metrics already match are skipped.
 *   - merge:true — existing comentarios/estado are preserved on update.
 *   - All months are marked estado=publicado (historical, already
 *     presented) EXCEPT the cut month (latest in file), which starts as
 *     borrador pending management comments.
 */

const admin = require("firebase-admin");
const path = require("path");
const XLSX = require("xlsx");

// El parser del frontend expone window.KpiImport — se emula window.
global.window = {};
require(path.join(__dirname, "../../public/js/domain/kpiImport.js"));
const KpiImport = global.window.KpiImport;

const DRY_RUN = process.argv.includes("--dry-run");
const FILE = process.argv[2];
if (!FILE || FILE.startsWith("--")) {
  console.error("Uso: node backfill-kpi-reports.js \"<ruta del xlsx>\" [--dry-run]");
  process.exit(1);
}

admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const METRICAS = ["recurrente", "kenwood", "hytera", "ventas", "otros", "ajustes",
  "total_ingresos", "act_brutas", "bajas", "total_subs", "churn"];

// Comentarios de gerencia del rediseño (redactados para el corte jun-2026);
// se siembran SOLO en ese mes y solo si aún no tiene comentarios.
const COMENTARIOS_JUN_2026 = {
  ingresos: "El acumulado cierra 1.0% por debajo de 2025. Mayo y junio registran ventas de equipos por $250,654 cada uno [detallar proyecto]; el comparativo 2025 incluye una venta extraordinaria de $344,935 en mayo. Sin ventas de equipos, el ingreso base se mantiene estable.",
  recurrente: "La contracción de Kenwood (−16.0% YTD) continúa la tendencia de los últimos tres años y es absorbida por el crecimiento de Hytera (+7.6%). [Agregar plan de migración de la base Kenwood restante.]",
  suscriptores: "La base aún no recupera el nivel previo a la baja de 412 suscriptores de agosto 2025 [detallar cliente/contrato]. Las bajas de 2026 (396) superan las activaciones (336); abril y junio concentran la pérdida. [Agregar acciones de retención.]",
};

async function run() {
  console.log(`[backfill-kpi-reports] DRY_RUN=${DRY_RUN} file=${FILE}`);

  const wb = XLSX.readFile(FILE);
  const candidates = wb.SheetNames
    .filter((n) => /^CC Executive Report/i.test(n))
    .sort((a, b) => (+(b.match(/\((\d+)\)/) || [0, 0])[1]) - (+(a.match(/\((\d+)\)/) || [0, 0])[1]));
  const sheetName = candidates[0] || wb.SheetNames[0];
  console.log(`[backfill-kpi-reports] hoja: ${sheetName}`);

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
  const { meses, avisos } = KpiImport.parse(rows);
  avisos.forEach((a) => console.log(`  aviso: ${a}`));

  const keys = Object.keys(meses).sort();
  const corte = keys[keys.length - 1];
  console.log(`[backfill-kpi-reports] ${keys.length} meses (${keys[0]} → ${corte})`);

  const existing = {};
  (await db.collection("kpi_reports").get()).docs.forEach((d) => { existing[d.id] = d.data(); });

  let created = 0, updated = 0, skipped = 0;
  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !DRY_RUN) await batch.commit(); batch = db.batch(); ops = 0; };

  for (const mes of keys) {
    const data = meses[mes];
    const cur = existing[mes];
    const unchanged = cur && METRICAS.every((f) => {
      const a = data[f] ?? null, b = cur[f] ?? null;
      if (a == null || b == null) return a === b;
      return Math.abs(a - b) < 0.005;
    });
    if (unchanged) { skipped++; continue; }

    const doc = {
      ...data,
      fuente: "import",
      source_file: path.basename(FILE),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_by: "backfill-kpi-reports",
    };
    if (!cur) {
      // Meses históricos ya presentados → publicado; el corte queda en borrador
      // (comentarios de gerencia pendientes de revisión antes de publicar).
      doc.estado = mes === corte ? "borrador" : "publicado";
      doc.comentarios = (mes === "2026-06") ? COMENTARIOS_JUN_2026 : {};
    }

    batch.set(db.collection("kpi_reports").doc(mes), doc, { merge: true });
    ops++;
    cur ? updated++ : created++;
    if (ops >= 400) await flush();
  }
  await flush();

  console.log(`[backfill-kpi-reports] creados=${created} actualizados=${updated} sin-cambios=${skipped}${DRY_RUN ? " (dry-run, nada escrito)" : ""}`);

  if (!DRY_RUN) {
    const snap = await db.collection("kpi_reports").get();
    console.log(`[backfill-kpi-reports] verificación: ${snap.size} docs en kpi_reports`);
  }
}

run().then(() => process.exit(0)).catch((err) => {
  console.error("[backfill-kpi-reports] ERROR:", err);
  process.exit(1);
});
