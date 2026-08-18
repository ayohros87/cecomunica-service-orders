/**
 * importa-modelos-precios.js — carga la hoja de precios de vuelta al catálogo.
 *
 * Lee el CSV que produce exporta-modelos-sin-precio.js y escribe SOLO tres
 * campos: `precio_venta`, `precio_alquiler` y `descripcion`. Nada más se toca,
 * aunque el CSV traiga otras columnas — marca, modelo, tipo y condición van en
 * la hoja para que sea legible, no para editarse desde ahí.
 *
 *   node scripts/importa-modelos-precios.js modelos-precios.csv          (simulacro)
 *   node scripts/importa-modelos-precios.js modelos-precios.csv --escribir
 *
 * Por defecto NO escribe: imprime el diff campo por campo para revisarlo. Nada
 * llega a Firestore hasta que se pasa --escribir.
 *
 * Una celda VACÍA no borra el valor que ya está guardado: se ignora. Para
 * poner un precio en cero hay que escribir 0 explícitamente.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });

const args = process.argv.slice(2);
const ESCRIBIR = args.includes("--escribir");
const RUTA = args.find((a) => !a.startsWith("--"));
if (!RUTA) { console.error("Uso: node scripts/importa-modelos-precios.js <archivo.csv> [--escribir]"); process.exit(1); }

// Parser CSV mínimo pero correcto: respeta comillas, comillas escapadas ("")
// y saltos de línea dentro de un campo entrecomillado. Una descripción con
// coma es el caso normal, no el raro.
function parseCSV(texto) {
  const filas = [];
  let campo = "", fila = [], enComillas = false;
  const t = texto.replace(/^﻿/, "");        // BOM que pone Excel
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\r") { /* se ignora: el salto lo marca \n */ }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((c) => String(c).trim() !== ""));
}

// "1,234.50" y "1234,50" son las dos formas que salen de Excel es-PA.
function num(s) {
  const v = String(s == null ? "" : s).trim().replace(/[$\s]/g, "");
  if (!v) return null;
  const norm = v.includes(",") && !v.includes(".") ? v.replace(",", ".") : v.replace(/,/g, "");
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

(async () => {
  const filas = parseCSV(fs.readFileSync(RUTA, "utf8"));
  if (filas.length < 2) { console.error("El CSV no tiene filas de datos."); process.exit(1); }
  const cols = filas[0].map((c) => c.trim().toLowerCase());
  const iId = cols.indexOf("id");
  if (iId < 0) { console.error('Falta la columna "id" — es la llave del documento.'); process.exit(1); }
  const idx = {
    precio_venta: cols.indexOf("precio_venta"),
    precio_alquiler: cols.indexOf("precio_alquiler"),
    descripcion: cols.indexOf("descripcion"),
  };

  const db = admin.firestore();
  const snap = await db.collection("modelos").get();
  const vivos = new Map();
  snap.forEach((d) => vivos.set(d.id, d.data()));

  const cambios = [];
  const problemas = [];

  for (let r = 1; r < filas.length; r++) {
    const f = filas[r];
    const id = (f[iId] || "").trim();
    if (!id) continue;
    const m = vivos.get(id);
    if (!m) { problemas.push(`fila ${r + 1}: el modelo ${id} ya no existe en el catálogo`); continue; }

    const patch = {};
    for (const campo of ["precio_venta", "precio_alquiler"]) {
      if (idx[campo] < 0) continue;
      const crudo = f[idx[campo]];
      if (String(crudo == null ? "" : crudo).trim() === "") continue;   // vacío no borra
      const v = num(crudo);
      if (Number.isNaN(v)) { problemas.push(`fila ${r + 1} (${m.marca} ${m.modelo}): ${campo} ilegible "${crudo}"`); continue; }
      if (Number(m[campo]) !== v) patch[campo] = v;
    }
    if (idx.descripcion >= 0) {
      const d = String(f[idx.descripcion] == null ? "" : f[idx.descripcion]).trim().slice(0, 140);
      if (d && d !== (m.descripcion || "")) patch.descripcion = d;
    }
    if (Object.keys(patch).length) cambios.push({ id, nombre: `${m.marca || ""} ${m.modelo || ""}`.trim(), patch, antes: m });
  }

  console.log(`Leídas ${filas.length - 1} filas · ${cambios.length} con cambios\n`);
  for (const c of cambios) {
    const detalle = Object.entries(c.patch)
      .map(([k, v]) => {
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
