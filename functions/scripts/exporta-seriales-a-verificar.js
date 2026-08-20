/**
 * exporta-seriales-a-verificar.js — hoja de trabajo para que bodega confirme
 * los seriales que el sistema tiene con algo raro adentro.
 *
 * CONTEXTO. El serial que se MUESTRA y el que se USA para buscar son dos cosas:
 * `serial_norm` (solo A-Z0-9) es el que manda, y está bien derivado en todos los
 * casos, así que hoy nada está roto — las búsquedas y el anti-duplicados
 * funcionan. Lo que está mal es el texto que ve la gente: trae espacios,
 * guiones de más, un acento grave que se coló al teclear, o directamente el
 * MODELO metido dentro del número ("20301A0818 pnc 550").
 *
 * Eso importa porque el serial es lo que bodega lee en la etiqueta del radio.
 * Si en pantalla dice una cosa y en el equipo dice otra, la próxima toma física
 * lo cuenta como un radio que "no aparece" y se abre un caso que no existe.
 *
 * QUÉ HACE. Escribe un .xlsx para mandar por correo. NO escribe en Firestore.
 * Las dos columnas a llenar van en amarillo y el resto de la hoja bloqueada,
 * para que nadie pise por accidente el serial que hay que comparar.
 *
 *   node scripts/exporta-seriales-a-verificar.js [--salida ruta.xlsx]
 *
 * Ordena por dónde está la unidad: primero lo que bodega puede ir a mirar
 * (bodega y taller), después lo que está con un cliente o vendido, que no se
 * revisa yendo al estante sino con la orden o el contrato en la mano.
 */
const path = require("path");
const ExcelJS = require("exceljs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const SALIDA = (process.argv.find((a) => a.startsWith("--salida")) || "").split("=")[1]
  || process.argv[process.argv.indexOf("--salida") + 1]
  || "seriales-a-verificar.xlsx";

const NAVY = "FF1F3B57";
const AMBAR_SUAVE = "FFFFF7DC";
const GRIS_SUAVE = "FFF4F6F8";
const ROJO_SUAVE = "FFFDECEC";

const ESTADOS = {
  en_bodega: "En bodega", en_taller: "En taller", en_cliente: "Con el cliente",
  asignado_contrato: "Asignado a contrato", devuelto_revision: "Devuelto, por revisar",
  por_clasificar: "No se sabe dónde está", vendido: "Vendido", baja: "Dado de baja",
};
// Lo que bodega puede verificar yendo al estante.
const ALCANZABLE = new Set(["en_bodega", "en_taller", "devuelto_revision"]);

const norm = (s) => (s || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");

// Por qué está en la lista. El texto va en la hoja: sin él, bodega no sabe si
// tiene que corregir algo o solo confirmar que el número es así.
function motivo(serial, modeloLabel) {
  const s = (serial || "").toString();
  if (/[`´'"]/.test(s)) return "Tiene un símbolo raro al inicio (se coló al teclear)";
  const modeloSuelto = (modeloLabel || "").replace(/^HYTERA |^KENWOOD |^INRICO |^NIPPON-?R /i, "");
  const tokens = modeloSuelto.split(/[\s-]+/).filter((t) => t.length >= 3);
  if (tokens.some((t) => new RegExp(`(^|[\\s-])${t}([\\s-]|$)`, "i").test(s))) {
    return "El MODELO quedó escrito dentro del número de serie";
  }
  if (/[()]/.test(s)) return "Trae texto entre paréntesis: ¿cuál es el número solo?";
  if (norm(s).length < 5) return "No parece un número de serie: ¿qué equipo es?";
  if (/\s/.test(s.trim())) return "Tiene un espacio en medio del número";
  if (/-/.test(s)) return "Tiene guión: confirmar si la etiqueta lo trae o no";
  return "Confirmar que el número es exactamente así";
}

// Sugerencia SOLO cuando es mecánica y no cambia el número: espacios y símbolos
// sueltos. Con guiones y paréntesis no se propone nada — ahí hay que mirar la
// etiqueta, y una sugerencia se acepta sin pensar.
function sugerencia(serial) {
  const s = (serial || "").toString().trim();
  const limpio = s.replace(/[\s`´'"]/g, "");
  if (limpio === s) return "";
  if (/[()-]/.test(limpio)) return "";
  // Menos de 5 caracteres no es un serial sino un marcador ("XX 1"): proponer
  // "XX1" invita a aceptar como bueno algo que hay que ir a averiguar.
  if (norm(limpio).length < 5) return "";
  return limpio;
}

(async () => {
  const snap = await db.collection("equipos_pool").get();
  const filas = [];
  snap.forEach((d) => {
    const x = d.data();
    const s = (x.serial || "").toString().trim();
    if (!s || s.toUpperCase() === norm(s)) return;
    filas.push({
      serial: s,
      modelo: x.modelo_label || "(sin modelo)",
      donde: ESTADOS[x.estado] || x.estado || "?",
      cliente: x.asignacion?.cliente_nombre || "",
      alcanzable: ALCANZABLE.has(x.estado),
      motivo: motivo(s, x.modelo_label),
      sugerencia: sugerencia(s),
    });
  });

  filas.sort((a, b) => (b.alcanzable - a.alcanzable)
    || a.modelo.localeCompare(b.modelo) || a.serial.localeCompare(b.serial));
  filas.forEach((f, i) => { f.n = i + 1; });

  const wb = new ExcelJS.Workbook();
  wb.creator = "CECOMUNICA";
  const ws = wb.addWorksheet("Seriales a verificar", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "#", key: "n", width: 5 },
    { header: "Serial como está en el sistema", key: "serial", width: 26 },
    { header: "Modelo", key: "modelo", width: 22 },
    { header: "Dónde está", key: "donde", width: 20 },
    { header: "Cliente", key: "cliente", width: 30 },
    { header: "Qué hay que revisar", key: "motivo", width: 40 },
    { header: "Serial correcto (escriba aquí)", key: "correcto", width: 26 },
    { header: "Observación (escriba aquí)", key: "obs", width: 30 },
  ];

  const cabecera = ws.getRow(1);
  cabecera.height = 34;
  cabecera.eachCell((c) => {
    c.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  filas.forEach((f) => ws.addRow({ ...f, correcto: f.sugerencia, obs: "" }));

  const EDITABLES = new Set(["correcto", "obs"]);
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const f = filas[n - 2];
    row.height = 20;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = ws.getColumn(col).key;
      // 12pt: la hoja la lee gente que no quiere pelear con la letra chica.
      cell.font = { name: "Calibri", size: 12, color: { argb: "FF1C232B" } };
      cell.border = { bottom: { style: "hair", color: { argb: "FFDDE4EB" } } };
      cell.alignment = { vertical: "middle", wrapText: key === "motivo" };

      if (EDITABLES.has(key)) {
        cell.protection = { locked: false };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBAR_SUAVE } };
      } else {
        cell.protection = { locked: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS_SUAVE } };
      }
      if (key === "serial") {
        cell.font = { name: "Consolas", size: 12, bold: true, color: { argb: "FF1C232B" } };
      }
      if (key === "correcto") cell.font = { name: "Consolas", size: 12 };
      // Lo que NO se puede ir a mirar al estante se marca: se revisa distinto.
      if (key === "donde" && f && !f.alcanzable) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROJO_SUAVE } };
        cell.font = { name: "Calibri", size: 12, color: { argb: "FF9B2C2C" } };
      }
    });
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: filas.length + 1, column: 8 } };
  await ws.protect("", {
    selectLockedCells: true, selectUnlockedCells: true,
    autoFilter: true, sort: true, formatColumns: true, formatRows: true,
  });

  const destino = path.resolve(SALIDA);
  await wb.xlsx.writeFile(destino);
  const enEstante = filas.filter((f) => f.alcanzable).length;
  console.log(`Excel escrito: ${destino}`);
  console.log(`  ${filas.length} seriales · ${enEstante} se pueden ver en bodega/taller · ${filas.length - enEstante} están con cliente o vendidos`);
  console.log(`  con sugerencia automática: ${filas.filter((f) => f.sugerencia).length}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
