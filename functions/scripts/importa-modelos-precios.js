/**
 * importa-modelos-precios.js — carga la hoja de precios de vuelta al catálogo.
 *
 * Lee el .xlsx que produce exporta-modelos-sin-precio.js (o un .csv con las
 * mismas columnas) y escribe SOLO tres campos: `precio_venta`,
 * `precio_alquiler` y `descripcion`. Nada más se toca, aunque el archivo traiga
 * otras columnas — marca, modelo, tipo y condición van en la hoja para que sea
 * legible, no para editarse desde ahí.
 *
 *   node scripts/importa-modelos-precios.js precios-catalogo.xlsx            (simulacro)
 *   node scripts/importa-modelos-precios.js precios-catalogo.xlsx --escribir
 *
 * Por defecto NO escribe: imprime el diff campo por campo para revisarlo. Nada
 * llega a Firestore hasta que se pasa --escribir.
 *
 * Una celda VACÍA no borra el valor que ya está guardado: se ignora. Para
 * poner un precio en cero hay que escribir 0 explícitamente.
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });

const args = process.argv.slice(2);
const ESCRIBIR = args.includes("--escribir");
const RUTA = args.find((a) => !a.startsWith("--"));
if (!RUTA) {
  console.error("Uso: node scripts/importa-modelos-precios.js <archivo.xlsx|.csv> [--escribir]");
  process.exit(1);
}
if (!fs.existsSync(RUTA)) { console.error(`No existe el archivo: ${RUTA}`); process.exit(1); }

// "1,234.50" y "1234,50" son las dos formas que salen de Excel es-PA. Una celda
// de Excel ya viene como número; esto es para el caso texto y para CSV.
function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : NaN;
  const s = String(v).trim().replace(/[$\s]/g, "");
  if (!s) return null;
  const norm = s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

// Una celda de exceljs puede traer texto plano, un objeto de texto enriquecido
// o una fórmula ya calculada. Se normaliza a string.
function texto(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(v);
}

function parseCSV(t) {
  const filas = [];
  let campo = "", fila = [], enComillas = false;
  const s = t.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (enComillas) {
      if (c === '"') { if (s[i + 1] === '"') { campo += '"'; i++; } else enComillas = false; }
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\r") { /* el salto lo marca \n */ }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((c) => String(c).trim() !== ""));
}

// Devuelve [{ id, precio_venta, precio_alquiler, descripcion }] leyendo por
// NOMBRE de columna, no por posición: si alguien mueve una columna en Excel el
// import tiene que seguir funcionando.
async function leerFilas(ruta) {
  const cabeceraDe = (s) => String(s || "").trim().toLowerCase();
  const mapear = (cabeceras) => {
    const idx = {};
    cabeceras.forEach((h, i) => {
      const c = cabeceraDe(h);
      if (c === "id") idx.id = i;
      else if (c.startsWith("precio de venta") || c === "precio_venta") idx.precio_venta = i;
      else if (c.startsWith("alquiler por mes") || c === "precio_alquiler") idx.precio_alquiler = i;
      else if (c.startsWith("descripci")) idx.descripcion = i;
    });
    return idx;
  };

  if (path.extname(ruta).toLowerCase() === ".csv") {
    const filas = parseCSV(fs.readFileSync(ruta, "utf8"));
    const idx = mapear(filas[0] || []);
    if (idx.id == null) throw new Error('Falta la columna "id" — es la llave del documento.');
    return filas.slice(1).map((f) => ({
      id: String(f[idx.id] || "").trim(),
      precio_venta: idx.precio_venta != null ? f[idx.precio_venta] : undefined,
      precio_alquiler: idx.precio_alquiler != null ? f[idx.precio_alquiler] : undefined,
      descripcion: idx.descripcion != null ? f[idx.descripcion] : undefined,
    }));
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);
  const ws = wb.getWorksheet("Precios") || wb.worksheets.find((w) => w.name !== "Instrucciones") || wb.worksheets[0];
  if (!ws) throw new Error("El archivo no tiene ninguna hoja legible.");

  const cabeceras = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { cabeceras[i - 1] = texto(c.value); });
  const idx = mapear(cabeceras);
  if (idx.id == null) throw new Error('Falta la columna "id" en la hoja — es la llave del documento.');

  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const celda = (i) => (i == null ? undefined : row.getCell(i + 1).value);
    const id = texto(celda(idx.id)).trim();
    if (!id) return;
    out.push({
      id,
      precio_venta: celda(idx.precio_venta),
      precio_alquiler: celda(idx.precio_alquiler),
      descripcion: celda(idx.descripcion),
    });
  });
  return out;
}

(async () => {
  const filas = await leerFilas(RUTA);
  if (!filas.length) { console.error("El archivo no tiene filas de datos."); process.exit(1); }

  const db = admin.firestore();
  const snap = await db.collection("modelos").get();
  const vivos = new Map();
  snap.forEach((d) => vivos.set(d.id, d.data()));

  const cambios = [];
  const problemas = [];

  filas.forEach((f, i) => {
    const fila = i + 2;   // +1 por la cabecera, +1 porque Excel cuenta desde 1
    const m = vivos.get(f.id);
    if (!m) { problemas.push(`fila ${fila}: el modelo ${f.id} ya no existe en el catálogo`); return; }

    const patch = {};
    for (const campo of ["precio_venta", "precio_alquiler"]) {
      const crudo = f[campo];
      if (crudo === undefined || String(crudo == null ? "" : crudo).trim() === "") continue;   // vacío no borra
      const v = num(crudo);
      if (Number.isNaN(v)) {
        problemas.push(`fila ${fila} (${m.marca} ${m.modelo}): ${campo} ilegible "${texto(crudo)}"`);
        continue;
      }
      if (v != null && Number(m[campo]) !== v) patch[campo] = v;
    }
    const d = texto(f.descripcion).trim().slice(0, 140);
    if (d && d !== (m.descripcion || "")) patch.descripcion = d;

    if (Object.keys(patch).length) {
      cambios.push({ id: f.id, nombre: `${m.marca || ""} ${m.modelo || ""}`.trim(), patch, antes: m });
    }
  });

  console.log(`Leídas ${filas.length} filas · ${cambios.length} con cambios\n`);
  for (const c of cambios) {
    const detalle = Object.entries(c.patch).map(([k, v]) => {
      const antes = c.antes[k] === undefined || c.antes[k] === "" ? "—" : c.antes[k];
      return `${k}: ${antes} → ${v}`;
    }).join(" · ");
    console.log(`  ${c.nombre.padEnd(28)} ${detalle}`);
  }
  if (problemas.length) {
    console.log(`\n${problemas.length} problema(s):`);
    problemas.forEach((p) => console.log("  ⚠ " + p));
  }

  if (!ESCRIBIR) {
    console.log(`\nSIMULACRO — no se escribió nada. Repite con --escribir para aplicar.`);
    process.exit(0);
  }
  if (!cambios.length) { console.log("\nNada que escribir."); process.exit(0); }

  // Firestore tope 500 por batch; el catálogo son ~113 docs, pero el batching
  // deja el script servible si el catálogo crece.
  let escritos = 0;
  for (let i = 0; i < cambios.length; i += 400) {
    const lote = cambios.slice(i, i + 400);
    const batch = db.batch();
    lote.forEach((c) => batch.update(db.collection("modelos").doc(c.id), {
      ...c.patch,
      actualizado_en: admin.firestore.FieldValue.serverTimestamp(),
    }));
    await batch.commit();
    escritos += lote.length;
  }
  console.log(`\n${escritos} modelos actualizados.`);
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
