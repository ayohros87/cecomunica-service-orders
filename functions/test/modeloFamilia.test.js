// ModeloFamilia — "una familia, dos filas". Paridad byte a byte entre la copia
// del back y la del front, y la conducta pura sobre un catálogo de prueba.
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MF = require("../src/domain/modeloFamilia");

test("la copia del navegador es idéntica a la del back", () => {
  const back = fs.readFileSync(path.join(__dirname, "..", "src", "domain", "modeloFamilia.js"), "utf8");
  const front = fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "domain", "modeloFamilia.js"), "utf8");
  assert.equal(front, back, "public/js/domain/modeloFamilia.js difiere de functions/src/domain/modeloFamilia.js — copia una sobre la otra");
});

const CAT = [
  { id: "n360", marca: "HYTERA", modelo: "PNC360S", estado: "N", precio_venta: 180, qbo_item_alquiler_id: "32", aliases: ["PNC 360S"] },
  { id: "r360", marca: "HYTERA", modelo: "PNC360S-R", estado: "R", variante_de: "n360" },
  { id: "n460", marca: "HYTERA", modelo: "PNC460", estado: "N", precio_venta: 250 },
  { id: "r460", marca: "HYTERA", modelo: "PNC460-R", estado: "R" },            // sin variante_de: se resuelve por texto
  { id: "r370", marca: "HYTERA", modelo: "PNC370-R", estado: "R" },            // familia SOLO refurbished
  { id: "k420", marca: "KENWOOD", modelo: "NX-420", estado: "N" },
  { id: "k920", marca: "KENWOOD", modelo: "NX-920", estado: "N" },
  { id: "old780", marca: "HYTERA", modelo: "SC780", estado: "N", activo: false },
  { id: "new780", marca: "HYTERA", modelo: "SC780", estado: "N" },
];

test("familia: la fila R resuelve a su base por variante_de, y por texto si nadie la vinculó", () => {
  MF.cargar(CAT);
  assert.equal(MF.familiaDe({ modelo_id: "r360" }), "n360");
  assert.equal(MF.familiaDe({ modelo_id: "n360" }), "n360");
  assert.equal(MF.familiaDe({ modelo_id: "r460" }), "n460");
  assert.equal(MF.familiaDe({ modelo_id: "r370" }), "r370");           // sin base: es su propia familia
  assert.equal(MF.familiaDe({ modelo: "HYTERA PNC360S-R" }), "n360");  // por texto, con marca y sufijo
  assert.equal(MF.familiaDe({ modelo: "PNC 360S" }), "n360");          // alias
  assert.equal(MF.familiaDe({ modelo: "" }), null);
});

test("mismaFamilia: N y R son el mismo modelo; NX-420 y NX-920 no", () => {
  MF.cargar(CAT);
  assert.equal(MF.mismaFamilia({ modelo_id: "n360", modelo: "PNC360S" }, { modelo_id: "r360", modelo: "PNC360S-R" }), true);
  assert.equal(MF.mismaFamilia({ modelo_id: "n360" }, { modelo: "HYTERA PNC360S-R" }), true);
  assert.equal(MF.mismaFamilia({ modelo_id: "k420" }, { modelo_id: "k920" }), false);
  assert.equal(MF.mismaFamilia({ modelo: "NX-420" }, { modelo: "NX-920" }), false);
  // Caso Chino Panameño: ficha en la fila N vs línea -R.
  assert.equal(MF.mismaFamilia({ modelo_id: "n360", modelo_label: "HYTERA PNC360S" }, { modelo_id: "r360", modelo: "PNC360S-R" }), true);
});

test("sin catálogo cargado cae a texto: marca por delante, -R por detrás, contención ≥4", () => {
  MF.cargar([]);
  assert.equal(MF.mismaFamilia({ modelo: "HYTERA PNC360S-R" }, { modelo: "PNC360S" }), true);
  assert.equal(MF.mismaFamilia({ modelo: "PNC360S" }, { modelo: "PNC460" }), false);
  assert.equal(MF.mismaFamilia({ modelo: "HYT-P50" }, { modelo: "T338" }), false);
  assert.equal(MF.mismaFamilia({ modelo: "PD6" }, { modelo: "PD606" }), false);   // 3 chars: demasiado corto
  assert.equal(MF.mismaFamilia({ modelo: "PD606" }, { modelo: "HYTERA PD606" }), true);
  assert.equal(MF.familiaDe({ modelo: "HYTERA PNC360S-R" }), "~HYTERAPNC360S"); // sin catálogo no se conoce la marca
});

test("condición: la fila manda; el texto solo cuando no hay fila", () => {
  MF.cargar(CAT);
  assert.equal(MF.condicionDe({ modelo_id: "r360" }), "reuso");
  assert.equal(MF.condicionDe({ modelo_id: "n360" }), "nuevo");
  assert.equal(MF.condicionDe({ modelo: "MOTOROLA DGP8550-R" }), null);
  assert.equal(MF.condicionDerivada({ modelo: "MOTOROLA DGP8550-R" }), "reuso");
  assert.equal(MF.condicionDerivada({ modelo: "MOTOROLA DGP8550" }), "nuevo");
  assert.equal(MF.condicionDerivada({ modelo: "SEPURA STP9038R" }), "nuevo"); // R pegada: no es el sufijo
});

test("filaDe / filaRefurbishedDe: la fila R de la familia, o null si no existe", () => {
  MF.cargar(CAT);
  assert.equal(MF.filaDe("n360", "reuso").id, "r360");
  assert.equal(MF.filaDe("n360", "nuevo").id, "n360");
  assert.equal(MF.filaDe("n460", "reuso").id, "r460");
  assert.equal(MF.filaDe("r370", "reuso").id, "r370");
  assert.equal(MF.filaDe("r370", "nuevo"), null);
  assert.equal(MF.filaDe("k420", "reuso"), null);
  assert.equal(MF.filaRefurbishedDe({ modelo_id: "n360", modelo_label: "HYTERA PNC360S" }).id, "r360");
  assert.equal(MF.filaRefurbishedDe({ modelo: "KENWOOD NX-420" }), null);
});

test("precioReferencia cae a la base cuando la fila R no tiene precio", () => {
  MF.cargar(CAT);
  assert.deepEqual(MF.precioReferencia({ modelo_id: "r360" }, "precio_venta").valor, 180);
  assert.equal(MF.precioReferencia({ modelo_id: "r360" }, "precio_venta").origen, "base");
  assert.equal(MF.precioReferencia({ modelo_id: "n460" }, "precio_venta").origen, "fila");
  assert.equal(MF.precioReferencia({ modelo_id: "r370" }, "precio_venta").valor, null);
  assert.equal(MF.campoReferencia({ modelo_id: "r360" }, "qbo_item_alquiler_id").valor, "32");
});

test("lineasCompatibles: exacta primero, luego familia; la modalidad filtra", () => {
  MF.cargar(CAT);
  const lineas = [
    { modelo_id: "r360", modelo: "PNC360S-R", cantidad: 10, precio: 27, modalidad: "alquiler" },
    { modelo_id: "n360", modelo: "PNC360S", cantidad: 5, precio: 30, modalidad: "alquiler" },
    { modelo_id: "n360", modelo: "PNC360S", cantidad: 2, precio: 12, modalidad: "propio" },
  ];
  const fichaN = { modelo_id: "n360", modelo_label: "HYTERA PNC360S" };
  assert.deepEqual(MF.lineasCompatibles(fichaN, lineas).map((x) => x.idx), [1, 0]);
  assert.equal(MF.lineaPara(fichaN, lineas), 1);
  assert.equal(MF.lineaPara(fichaN, lineas, [10, 0, 2]), 0);          // la exacta está llena → cae a la familia
  assert.equal(MF.lineaPara({ ...fichaN, propiedad: "cliente" }, lineas), 2);
  assert.equal(MF.lineaPara({ modelo_id: "k420", modelo_label: "KENWOOD NX-420" }, lineas), -1);
  // Línea legacy sin modelo_id y ficha con texto de otra grafía.
  assert.equal(MF.lineaPara({ modelo: "HYTERA PNC360S-R" }, [{ modelo: "PNC360S", cantidad: 1 }]), 0);
  // Línea legacy SIN modalidad acepta un equipo del cliente.
  assert.equal(MF.lineaPara({ modelo: "PNC360S", propiedad: "cliente" }, [{ modelo: "PNC360S", cantidad: 1 }]), 0);
});

test("resolver prefiere la fila activa cuando hay duplicados del catálogo", () => {
  MF.cargar(CAT);
  assert.equal(MF.resolver({ modelo: "HYTERA SC780" }).id, "new780");
  assert.equal(MF.etiqueta({ modelo_id: "r360" }), "HYTERA PNC360S-R");
  assert.equal(MF.familiaLabel("n360"), "HYTERA PNC360S");
});
