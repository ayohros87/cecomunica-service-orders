// Lectura de la hoja de bodega en el importador
// (public/js/ui/asistente-importar.js).
//
// Los cuatro CSV son los que bodega mandó el 2026-08-12/13, byte por byte:
// BOM al inicio, separador `;` (Excel en español), una columna de numeración
// que abre la fila, otra que repite el modelo, y a veces dos listas de seriales
// en la misma hoja. Cada filtro del detector está aquí porque una de estas
// hojas lo rompió.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// El importador solo necesita normalizarSerial/esSerialValido del servicio para
// leer la hoja; se carga el servicio de verdad para no duplicar esas reglas.
function cargar() {
  const raiz = path.join(__dirname, "..", "..");
  const sandbox = { window: {}, firebase: {}, console, document: undefined };
  vm.createContext(sandbox);
  for (const rel of [["public", "js", "services", "equiposPoolService.js"],
                     ["public", "js", "domain", "serialPatron.js"],
                     ["public", "js", "ui", "asistente-importar.js"]]) {
    vm.runInContext(fs.readFileSync(path.join(raiz, ...rel), "utf8"), sandbox,
      { filename: rel[rel.length - 1] });
  }
  return sandbox.window.AsistenteImportar;
}
const AI = cargar();

// Catálogo mínimo, como el que carga el paso 1: hace falta para que el detector
// reconozca los títulos de columna ("NX-410-R", "TK-D240-R") como nombres de
// modelo y no como seriales.
const CATALOGO = [
  { id: "m1", label: "KENWOOD NX-410-R", modelo: "NX-410-R", estado: "R" },
  { id: "m2", label: "KENWOOD NX410", modelo: "NX410", estado: "N" },
  { id: "m3", label: "INRICO TM-7PLUSS-R", modelo: "TM-7PLUSS-R", estado: "R" },
  { id: "m4", label: "HYTERA PD786G-R", modelo: "PD786G-R", estado: "R" },
  { id: "m5", label: "KENWOOD TK-D240-R", modelo: "TK-D240-R", estado: "R" },
];

// Lee la hoja, detecta columnas y devuelve lo que el paso 1 mostraría.
function leer(csv) {
  const ctx = AI._ctx;
  ctx.modelos = CATALOGO;
  ctx.filas = AI._parsearCSV(csv);
  AI._detectar();
  const col = ctx.colSerial;
  return {
    filas: ctx.filas.length,
    colSerial: col,
    colNota: ctx.colNota,
    seriales: col < 0 ? [] : ctx.filas
      .map((f) => (f[col] || "").trim())
      .filter((v) => AI._pareceSerial(v)),
  };
}

const BOM = "﻿";

// Hoja "NX410-R Y NX410": DOS listas de seriales, cada una con su numeración.
const NX410 = BOM + [
  ";REUSO;;NUEVOS",
  ";NX-410-R;;NX410",
  "1;B2700052;1;B2700129",
  "2;B1200018;2;B2700123",
  "3;B1200091;3;B2700125",
  "4;B27000/84;4;B2700127",
  "5;B2700068;5;B2700115",
  "6;B1400013;6;B2700128",
  "7;B1100097;7;B1400080",
  "8;B2700063;8;B2700120",
  "9;B2700074;9;B2700126",
  "10;B2700091;10;B1B00199",
  "11;B2101234;;",
  "12;B2101233;;",
].join("\r\n");

test("hoja con dos listas: gana la columna con más seriales distintos", () => {
  const r = leer(NX410);
  assert.equal(r.colSerial, 1, "la lista de REUSO tiene 12 y la de NUEVOS 10");
  assert.equal(r.seriales.length, 12);
  assert.ok(r.seriales.includes("B27000/84"), "el serial con barra sigue entrando: lo limpia normalizarSerial");
});

test("la columna de numeración (1,2,3…) nunca gana", () => {
  const r = leer(NX410);
  assert.notEqual(r.colSerial, 0);
  assert.notEqual(r.colSerial, 2);
});

// Hoja "TM-7PLUS-R": la columna 1 repite el modelo en cada fila. Normalizado
// "TM7PLUSR" es alfanumérico y trae dígito — sin el filtro de espacios y el
// conteo por distintos, empataba con la columna buena.
const TM7 = BOM + [
  ";BASES REUSO;;",
  "1;TM-7PLUS R;7TM27PA2460;",
  "2;TM-7PLUS R;7TM27PA3013;",
  "3;TM-7PLUS R;7TM27PA3033;",
  "4;TM-7PLUS R;7TM27PA3041;",
  "5;TM-7PLUS R;7TM27PA3101;",
  ";;;",
  ";BASE DAÑADAS;;",
  "1;TM-7PLUS R;7TM07PA2970;DAÑADA",
  "2;TM-7PLUS R;7TM27PA3182;DAÑADA",
].join("\r\n");

test("la columna que repite el modelo no se confunde con la de seriales", () => {
  const r = leer(TM7);
  assert.equal(r.colSerial, 2);
  assert.equal(r.seriales.length, 7);
  assert.ok(!r.seriales.includes("TM-7PLUS R"));
});

test("detecta la columna de notas por el texto DAÑADA", () => {
  const r = leer(TM7);
  assert.equal(r.colNota, 3);
});

// Hoja "RADIOS PD786G-R": encabezado "30 RADIOS" DENTRO de la columna de
// seriales. Sin el filtro de espacios entraba como una unidad más.
const PD786 = BOM + [
  ";;HYTERA RADIO PD786G-R;",
  ";;30 RADIOS ;",
  "1;PD786G R;16O13D0998;BODEGA ",
  "2;PD786G R;20229C0013;BODEGA ",
  "3;PD786G R;20229C0014;BODEGA ",
  "4;PD786G R;20229C0015;BODEGA ",
  "5;PD786G R;20912A0443;BODEGA ",
].join("\r\n");

test("un encabezado dentro de la columna de seriales no entra como unidad", () => {
  const r = leer(PD786);
  assert.equal(r.colSerial, 2);
  assert.ok(!r.seriales.some((s) => /RADIOS/i.test(s)), '"30 RADIOS" no puede colarse');
  assert.equal(r.seriales.length, 5);
});

test("BODEGA en la columna de notas no la convierte en columna de seriales", () => {
  const r = leer(PD786);
  assert.equal(r.colNota, 3);
});

// Hoja "TK-D240-R": la simple — numeración + seriales, sin más.
test("hoja simple de dos columnas", () => {
  const r = leer(BOM + [
    ";TK-D240-R",
    "1;B6211094", "2;B6211167", "3;B6211136", "4;B6211169", "5;B6111177",
  ].join("\r\n"));
  assert.equal(r.colSerial, 1);
  assert.equal(r.seriales.length, 5);
  assert.equal(r.colNota, -1, "sin columna de estado no debe inventarse una");
});

test("el separador se detecta solo (coma en vez de punto y coma)", () => {
  const r = leer("num,serial\n1,B6211094\n2,B6211167\n3,B6211136\n4,B6211169");
  assert.equal(r.colSerial, 1);
  assert.equal(r.seriales.length, 4);
});

test("el BOM no se cuela en el primer valor", () => {
  const filas = AI._parsearCSV(BOM + "A;B\n1;B6211094");
  assert.equal(filas[0][0], "A", "un BOM pegado dejaría '\\ufeffA'");
});
