/**
 * verifica-seriales-lista.js — SOLO LECTURA. Verifica una lista de seriales
 * contra equipos_pool comparando modelo y condición esperados, y diagnostica
 * cada discrepancia. La condición REUSO en este sistema no es solo el campo
 * `condicion`: el catálogo modela nuevo y reuso como DOS filas ("PNC360S" con
 * estado N y "PNC360S-R" con estado R), así que una ficha solo está bien
 * cuando el FK (`modelo_id`) apunta a la fila R **y** `condicion` == 'reuso'.
 * Una ficha con FK a la fila N pero condicion 'reuso' es inconsistente:
 * fix-condicion-modelo.js la volvería a 'nuevo' (deriva del catálogo).
 *
 * USAGE (desde functions/):
 *   node scripts/verifica-seriales-lista.js <archivo-seriales.txt> <modeloBase> [condicion]
 *   OUT_CSV=ruta.csv para elegir la salida.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ARCHIVO    = process.argv[2];
const MODELO_ESP = process.argv[3] || "PNC360S";
const COND_ESP   = (process.argv[4] || "reuso").toLowerCase();

function tight(s) {
  return (s || "").toString().toLowerCase()
    // eslint-disable-next-line no-control-regex -- intencional: recorta lo no-ASCII
    .normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "");
}

(async () => {
  const lineas = fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((l) => l.trim()).filter(Boolean);

  // Catálogo: fila base (estado N) y su variante de reuso (estado R).
  const modelosSnap = await db.collection("modelos").get();
  const nombreDe = (m) => (m.nombre || m.modelo || m.label || m.descripcion || "").toString().trim();
  const modelos = [];
  modelosSnap.forEach((d) => modelos.push({ id: d.id, ...d.data() }));
  const base = modelos.find((m) =>
    tight(nombreDe(m)) === tight(MODELO_ESP) && (m.estado || "").toUpperCase() === "N");
  const variante = modelos.find((m) =>
    (m.estado || "").toUpperCase() === "R" && base && m.variante_de === base.id);
  const idEsperado = COND_ESP === "reuso" ? (variante && variante.id) : (base && base.id);
  const nombreEsperado = COND_ESP === "reuso" ? (variante && nombreDe(variante)) : (base && nombreDe(base));
  console.log(`Catalogo: base=${base ? `${nombreDe(base)} (${base.id})` : "NO ENCONTRADA"}` +
    ` | reuso=${variante ? `${nombreDe(variante)} (${variante.id})` : "NO ENCONTRADA"}` +
    ` | esperado modelo_id=${idEsperado || "?"}`);

  const filas = [];
  for (const raw of lineas) {
    const norm = pool.normSerial(raw);
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();

    if (snap.empty) {
      filas.push({ serial: raw, diagnostico: "SIN FICHA EN POOL", accion: "crear ficha o revisar serial" });
      continue;
    }

    for (const doc of snap.docs) {
      const d = doc.data();
      const label = (d.modelo_label || "").trim();
      const cond = (d.condicion || "").toLowerCase();
      const asig = d.asignacion || {};
      const mid = d.modelo_id || "";

      let diagnostico, accion;
      if (mid === idEsperado && cond === COND_ESP) {
        diagnostico = "OK"; accion = "";
      } else if (!label && !mid) {
        diagnostico = cond === COND_ESP ? "SIN MODELO (condicion ok)" : "SIN MODELO + CONDICION ERRADA";
        accion = `poner modelo_id=${idEsperado} / label ${nombreEsperado || ""}` +
          (cond === COND_ESP ? "" : ` + condicion=${COND_ESP}`);
      } else if (base && mid === base.id) {
        diagnostico = cond === COND_ESP
          ? "FK A FILA NUEVA, condicion dice reuso (INCONSISTENTE)"
          : "FK A FILA NUEVA + condicion nuevo";
        accion = `repuntar modelo_id a ${idEsperado} (${nombreEsperado || ""})` +
          (cond === COND_ESP ? "" : ` + condicion=${COND_ESP}`);
      } else {
        diagnostico = `MODELO DISTINTO (${label || mid})`;
        accion = "revisar a mano";
      }

      filas.push({
        serial: raw, doc_id: doc.id, modelo: label || "(sin modelo)", modelo_id: mid || "(sin id)",
        condicion: cond || "(vacia)", estado_pool: d.estado || "", origen: d.origen || "",
        propiedad: d.propiedad || "", cliente: asig.cliente_nombre || "", contrato: asig.contrato_id || "",
        poc_device_id: d.poc_device_id || "", diagnostico, accion,
      });
    }
  }

  const cols = ["serial", "doc_id", "diagnostico", "accion", "modelo", "modelo_id", "condicion",
    "estado_pool", "origen", "propiedad", "cliente", "contrato", "poc_device_id"];
  const csv = [cols.join(",")].concat(filas.map((f) =>
    cols.map((c) => `"${String(f[c] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
  const out = process.env.OUT_CSV || "verifica-seriales.csv";
  fs.writeFileSync(out, csv, "utf8");

  const porDiag = {};
  filas.forEach((f) => { porDiag[f.diagnostico] = (porDiag[f.diagnostico] || 0) + 1; });
  console.log(`\n=== ${lineas.length} seriales | ${filas.length} fichas | esperado ${MODELO_ESP} / ${COND_ESP} ===`);
  Object.entries(porDiag).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(String(v).padStart(3), k));
  console.log(`\nCSV: ${out}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
