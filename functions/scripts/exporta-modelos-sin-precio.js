/**
 * exporta-modelos-sin-precio.js — hoja de trabajo para precios de catálogo.
 *
 * CONTEXTO. El editor de cotizaciones ya lee `precio_venta` de cada modelo,
 * pero al 18-ago-2026 el campo no existía en NINGUNO de los 113 documentos: el
 * selector ofrecía todo a $0.00 y el vendedor tecleaba cada precio a mano.
 * `precio_alquiler` sí existe, pero se creó para el mapeo de QuickBooks y solo
 * 12 de los 28 modelos marcados "se alquila" tienen tarifa.
 *
 * QUÉ HACE. Escribe un .xlsx listo para mandar por correo a quien pone los
 * precios. No escribe nada en Firestore.
 *
 *   node scripts/exporta-modelos-sin-precio.js [--todos] [--salida ruta.xlsx]
 *
 *   --todos    incluye también los inactivos (por defecto solo activos)
 *   --salida   ruta del archivo (por defecto precios-catalogo.xlsx en el cwd)
 *
 * POR QUÉ XLSX Y NO CSV. El CSV se rompe solo: Excel se come los acentos, parte
 * las descripciones en la primera coma y convierte el id en notación
 * científica. Aquí las tres columnas a llenar van resaltadas, el resto de la
 * hoja va BLOQUEADA (así el id no se puede tocar) y los precios ya vienen con
 * formato de moneda.
 *
 * Para cargarlo de vuelta: importa-modelos-precios.js lee este mismo archivo.
 */
const path = require("path");
const ExcelJS = require("exceljs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });

const args = process.argv.slice(2);
const TODOS = args.includes("--todos");
const iSalida = args.indexOf("--salida");
const SALIDA = iSalida >= 0 && args[iSalida + 1] ? args[iSalida + 1] : "precios-catalogo.xlsx";

const TIPOS = { P: "Portátil", M: "Móvil", B: "Base", R: "Repetidora", A: "Accesorio" };

// Paleta de la marca (design-system/colors_and_type.css) para que la hoja se
// vea de la casa y no a plantilla genérica de Excel.
const NAVY = "FF0B2A47";
const AMBAR_SUAVE = "FFFDF6E7";
const GRIS_SUAVE = "FFF7F9FB";
const VERDE_BORDE = "FFA8DCC4";

(async () => {
  const snap = await admin.firestore().collection("modelos").get();
  const filas = [];
  snap.forEach((d) => {
    const m = d.data();
    if (!TODOS && m.activo === false) return;
    filas.push({
      id: d.id,
      marca: m.marca || "",
      modelo: m.modelo || "",
      tipo: TIPOS[m.tipo] || m.tipo || "",
      condicion: (m.estado || "N").toUpperCase() === "R" ? "Refurbished" : "Nuevo",
      se_alquila: m.es_alquiler === true ? "Sí" : "No",
      precio_venta: Number.isFinite(m.precio_venta) ? m.precio_venta : null,
      precio_alquiler: Number.isFinite(m.precio_alquiler) ? m.precio_alquiler : null,
      descripcion: m.descripcion || "",
    });
  });

  // Orden de trabajo: primero lo que falta. Quien llena la hoja no tiene que
  // ir buscando los huecos.
  const falta = (f) => (f.precio_venta == null ? 0 : 1);
  filas.sort((a, b) =>
    falta(a) - falta(b) ||
    (a.marca || "").localeCompare(b.marca || "", "es") ||
    (a.modelo || "").localeCompare(b.modelo || "", "es"));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Cecomunica · Service Orders";
  wb.created = new Date();

  // ── Hoja 1: instrucciones ────────────────────────────────────────────────
  const ins = wb.addWorksheet("Instrucciones", { properties: { tabColor: { argb: NAVY } } });
  ins.getColumn(1).width = 100;
  const lineas = [
    ["Precios del catálogo de equipos", "titulo"],
    ["", ""],
    ["Qué hay que llenar: las tres columnas de fondo amarillo en la hoja «Precios».", "p"],
    ["", ""],
    ["  1. Precio de venta — lo que cobramos por el equipo en una venta de contado.", "p"],
    ["  2. Alquiler por mes — solo para los modelos que dicen «Sí» en la columna «¿Se alquila?».", "p"],
    ["  3. Descripción — opcional. Es la línea que el CLIENTE ve impresa debajo del nombre", "p"],
    ["     del equipo en la propuesta. Ejemplo: «Portátil digital UHF · incluye batería y cargador».", "p"],
    ["", ""],
    ["Los modelos que faltan por precio están arriba del todo.", "p"],
    ["", ""],
    ["Si de algún modelo no tenemos precio o ya no se vende, déjalo en blanco.", "p"],
    ["Es mejor un espacio vacío que un precio de referencia que después salga en una cotización real.", "p"],
    ["", ""],
    ["El resto de la hoja está bloqueada a propósito: cada fila lleva un código interno oculto", "p"],
    ["que la amarra con su ficha en el sistema. Solo hace falta escribir en las celdas amarillas.", "p"],
    ["", ""],
    ["Al terminar, guarda el archivo y devuélvelo por correo. Gracias.", "p"],
  ];
  lineas.forEach(([txt, tipo], i) => {
    const row = ins.getRow(i + 2);
    const c = row.getCell(1);
    c.value = txt;
    if (tipo === "titulo") {
      c.font = { name: "Calibri", size: 16, bold: true, color: { argb: NAVY } };
      row.height = 24;
    } else {
      c.font = { name: "Calibri", size: 11, color: { argb: "FF2F3942" } };
    }
    c.alignment = { vertical: "middle" };
  });

  // ── Hoja 2: los datos ────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Precios", {
    properties: { tabColor: { argb: "FF0091D7" } },
    views: [{ state: "frozen", ySplit: 1, xSplit: 0 }],   // encabezado siempre visible
  });

  ws.columns = [
    { header: "id", key: "id", width: 24 },
    { header: "Marca", key: "marca", width: 22 },
    { header: "Modelo", key: "modelo", width: 20 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Condición", key: "condicion", width: 13 },
    { header: "¿Se alquila?", key: "se_alquila", width: 12 },
    { header: "Precio de venta", key: "precio_venta", width: 16 },
    { header: "Alquiler por mes", key: "precio_alquiler", width: 16 },
    { header: "Descripción (la ve el cliente)", key: "descripcion", width: 52 },
  ];

  // La columna del id se oculta: no es asunto de quien pone precios, y oculta
  // no se puede editar por accidente pero viaja pegada a su fila si ordenan.
  ws.getColumn("id").hidden = true;

  const cabecera = ws.getRow(1);
  cabecera.height = 26;
  cabecera.eachCell((c) => {
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: NAVY } } };
  });

  filas.forEach((f) => ws.addRow(f));

  const EDITABLES = new Set(["precio_venta", "precio_alquiler", "descripcion"]);
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = ws.getColumn(col).key;
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF1C232B" } };
      cell.border = { bottom: { style: "hair", color: { argb: "FFDDE4EB" } } };

      if (EDITABLES.has(key)) {
        // Amarillo suave = "escribe aquí". Desbloqueadas para que la
        // protección de hoja no las alcance.
        cell.protection = { locked: false };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBAR_SUAVE } };
      } else {
        cell.protection = { locked: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS_SUAVE } };
        cell.font = { name: "Calibri", size: 11, color: { argb: "FF4A5560" } };
      }

      if (key === "precio_venta" || key === "precio_alquiler") {
        cell.numFmt = '"$"#,##0.00';
        cell.alignment = { horizontal: "right" };
      }
      if (key === "se_alquila") {
        cell.alignment = { horizontal: "center" };
        // Los que se alquilan se marcan: es la señal de qué filas necesitan
        // además la tarifa mensual.
        if (cell.value === "Sí") {
          cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F6B47" } };
          cell.border = { ...cell.border, left: { style: "thick", color: { argb: VERDE_BORDE } } };
        }
      }
      if (key === "descripcion") cell.alignment = { wrapText: false, horizontal: "left" };
    });
  });

  // Los precios no pueden ser negativos ni texto. El aviso sale en el momento,
  // no cuando ya se devolvió el archivo.
  const ultima = filas.length + 1;
  ["G", "H"].forEach((col) => {
    for (let r = 2; r <= ultima; r++) {
      ws.getCell(`${col}${r}`).dataValidation = {
        type: "decimal", operator: "greaterThanOrEqual", formulae: [0],
        allowBlank: true, showErrorMessage: true,
        errorTitle: "Precio inválido",
        error: "Escribe un número igual o mayor que cero. Si no hay precio, deja la celda vacía.",
      };
    }
  });

  ws.autoFilter = { from: { row: 1, column: 2 }, to: { row: ultima, column: 9 } };

  // Protección SIN contraseña: es una malla contra el error de dedo, no un
  // candado. Quien sepa quitarla puede, pero nadie borra el id sin querer.
  await ws.protect("", {
    selectLockedCells: true, selectUnlockedCells: true,
    autoFilter: true, sort: true, formatColumns: true, formatRows: true,
  });

  const destino = path.resolve(SALIDA);
  await wb.xlsx.writeFile(destino);

  const sinVenta = filas.filter((f) => f.precio_venta == null).length;
  const alqSinTarifa = filas.filter((f) => f.se_alquila === "Sí" && f.precio_alquiler == null).length;
  console.log(`Excel escrito: ${destino}`);
  console.log(`  ${filas.length} modelos${TODOS ? " (incluye inactivos)" : " activos"}`);
  console.log(`  ${sinVenta} sin precio de venta  ← las primeras filas de la hoja`);
  console.log(`  ${alqSinTarifa} de alquiler sin tarifa mensual`);
  console.log(`\nLas celdas amarillas son las editables; el resto va bloqueado.`);
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
