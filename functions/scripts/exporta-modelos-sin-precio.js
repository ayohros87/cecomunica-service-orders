/**
 * exporta-modelos-sin-precio.js — hoja de trabajo para precios de catálogo.
 *
 * CONTEXTO. El editor de cotizaciones ya lee `precio_venta` de cada modelo,
 * pero al 18-ago-2026 el campo no existía en NINGUNO de los 113 documentos: el
 * selector ofrecía todo a $0.00 y el vendedor tecleaba cada precio a mano.
 * `precio_alquiler` sí existe, pero se creó para el mapeo de QuickBooks y solo
 * 12 de los 28 modelos marcados "se alquila" tienen tarifa.
 *
 * QUÉ HACE. Exporta un CSV con los modelos ACTIVOS y sus precios actuales para
 * que bodega y ventas lo llenen fuera del sistema. No escribe nada.
 *
 *   node scripts/exporta-modelos-sin-precio.js [--todos] [--salida ruta.csv]
 *
 *   --todos    incluye también los inactivos (por defecto solo activos)
 *   --salida   ruta del CSV (por defecto modelos-precios.csv en el cwd)
 *
 * Para cargarlo de vuelta: importa-modelos-precios.js (lee el mismo formato y
 * exige la columna id intacta — es la llave del documento).
 *
 * OJO CON LOS PERMISOS: firestore.rules deja escribir `modelos` solo a
 * administrador/contabilidad. Quien llene la hoja no necesita acceso; la carga
 * la hace el script con credenciales de admin.
 */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });

const args = process.argv.slice(2);
const TODOS = args.includes("--todos");
const iSalida = args.indexOf("--salida");
const SALIDA = iSalida >= 0 && args[iSalida + 1] ? args[iSalida + 1] : "modelos-precios.csv";

// Escapa un campo CSV: comillas dobles duplicadas y envoltura si hace falta.
// Excel en es-PA abre CSV con coma sin preguntar, así que el separador es coma.
function csv(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const TIPOS = { P: "Portátil", M: "Móvil", B: "Base", R: "Repetidora", A: "Accesorio" };

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
      se_alquila: m.es_alquiler === true ? "SI" : "NO",
      precio_venta: Number.isFinite(m.precio_venta) ? m.precio_venta : "",
      precio_alquiler: Number.isFinite(m.precio_alquiler) ? m.precio_alquiler : "",
      descripcion: m.descripcion || "",
    });
  });

  // Orden de trabajo: primero lo que falta, y dentro de eso por marca y modelo.
  // Así quien llene la hoja no tiene que buscar los huecos.
  const falta = (f) => (f.precio_venta === "" ? 0 : 1);
  filas.sort((a, b) =>
    falta(a) - falta(b) ||
    (a.marca || "").localeCompare(b.marca || "", "es") ||
    (a.modelo || "").localeCompare(b.modelo || "", "es"));

  const COLS = ["id", "marca", "modelo", "tipo", "condicion", "se_alquila",
    "precio_venta", "precio_alquiler", "descripcion"];
  const lineas = [COLS.join(",")];
  filas.forEach((f) => lineas.push(COLS.map((c) => csv(f[c])).join(",")));

  const destino = path.resolve(SALIDA);
  // BOM: sin él Excel en Windows rompe los acentos de marca/descripción.
  fs.writeFileSync(destino, "﻿" + lineas.join("\r\n") + "\r\n", "utf8");

  const sinVenta = filas.filter((f) => f.precio_venta === "").length;
  const alqSinTarifa = filas.filter((f) => f.se_alquila === "SI" && f.precio_alquiler === "").length;
  console.log(`CSV escrito: ${destino}`);
  console.log(`  ${filas.length} modelos${TODOS ? " (incluye inactivos)" : " activos"}`);
  console.log(`  ${sinVenta} sin precio de venta  ← las primeras filas del archivo`);
  console.log(`  ${alqSinTarifa} de alquiler sin tarifa mensual`);
  console.log(`\nNo cambies la columna "id": es la llave del documento al cargar.`);
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
