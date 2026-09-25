// RUC panameño por partes y DV de la DGI (public/js/domain/rucPanama.js).
// Puro: sin red ni credenciales.
//
// Los casos de DV son los de github.com/juancorradine/Panama-RUC-DV-Calculator
// (implementa "Algoritmo para el cálculo del DV", DGI versión 201805). Además,
// el 2026-09-25 el port se cruzó contra esa implementación con ~5,500 RUC
// generados al azar (con y sin ceros a la izquierda) y los 457 de producción:
// cero diferencias.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../public/js/domain/rucPanama.js");

// (Su caso "0-0-0" → 19 se quitó: su propia implementación da 00, igual que
// esta — la prueba de allá registra el fallo sin reprobarlo.)
const CASOS_DGI = [
  ["juridica", "155720753-2-2022", "39"],
  ["juridica", "2588017-1-831938", "20"],
  ["juridica", "1489806-1-645353", "68"],
  ["juridica", "1956569-1-732877", "00"],
  ["juridica", "797609-1-493865", "12"],
  ["juridica", "15565624-2-2017", "63"],
  ["juridica", "10102-64-103462", "30"],   // antiguo (referencia cruzada)
  ["juridica", "1102-85-117211", "95"],    // antiguo
  ["juridica", "41425-516-58123", "41"],   // antiguo
  ["juridica", "32425-254-85621", "68"],   // antiguo
  ["juridica", "12388-184-921", "62"],     // antiguo
  ["juridica", "0-NT-0-0", "31"],
  ["juridica", "8-NT-1-13656", "43"],
  ["juridica", "1-NT-45-56544", "03"],
  ["juridica", "5-NT-478-2351", "94"],
  ["juridica", "7-NT-102-33575", "03"],
  ["juridica", "11-NT-958-2182101", "82"],
  ["juridica", "8-NT-1-1234567", "49"],
  ["juridica", "11-NT-958-218210", "73"],
  ["juridica", "11-NT-958-2182104", "82"],
  ["juridica", "8-NT-1-123456", "52"],
  ["natural", "8-769-1080", "56"],
  ["natural", "5-257-218", "09"],
  ["natural", "6-108-289", "79"],
  ["natural", "8-28-1284", "33"],
  ["natural", "2-7-89", "20"],
  ["natural", "2-1234-123456789", "01"],
  ["natural", "0AV-0-0", "10"],
  ["natural", "8AV-1-196", "90"],
  ["natural", "2AV-1234-12345", "26"],
  ["natural", "2AV-1234-123", "33"],
  ["natural", "2AV-123-123456", "28"],
  ["natural", "8AV-123-123456", "78"],
  ["natural", "2AV-1234-1234", "02"],
  ["natural", "E-0-0", "75"],
  ["natural", "E-8-127702", "16"],
  ["natural", "E-8-127703", "05"],
  ["natural", "E-8-12770", "72"],
  ["natural", "E-1234-12770", "98"],
  ["natural", "E-1235-12770", "23"],
  ["natural", "E-1-11", "63"],
  ["natural", "E-7824-53189", "90"],
  ["natural", "E-9624-41065", "80"],
  ["natural", "E-6521-53249", "99"],
  ["natural", "E-5056-27219", "16"],
  ["natural", "E-123-1277012", "65"],
  ["natural", "E-8-96407", "29"],
  ["natural", "E-1234-123456789", "26"],
  ["natural", "N-0-0", "76"],
  ["natural", "N-19-1821", "11"],
  ["natural", "N-1-24", "89"],
  ["natural", "N-1234-12345", "00"],
  ["natural", "N-7824-53189", "73"],
  ["natural", "N-9624-41065", "63"],
  ["natural", "N-6521-53249", "72"],
  ["natural", "0-NT-0-0", "09"],
  ["natural", "8-NT-1-24", "33"],
  ["natural", "3-NT-465-45624", "03"],
  ["natural", "9-NT-2-421578", "50"],
  ["natural", "6-NT-227-888555", "09"],
  ["natural", "12-NT-45-2154", "17"],
  ["natural", "PE-0-0", "14"],
  ["natural", "PE-1-19", "60"],
  ["natural", "PE-123-12345", "42"],
  ["natural", "PE-842-3681", "51"],
  ["natural", "PE-712-5789", "82"],
  ["natural", "PE-523-8262", "37"],
  ["natural", "0PI-0-0", "57"],
  ["natural", "13PI-1-196", "58"],
  ["natural", "8PI-1-80", "05"],
  ["natural", "8PI-23-65", "91"],
  ["natural", "2PI-23-65", "41"],
  ["natural", "2PI-123-1234", "41"],
  ["natural", "2PI-1234-12345", "26"],
  ["natural", "2PI-1234-123", "33"],
  ["natural", "2PI-123-123456", "65"],
  ["natural", "2PI-1234-1234", "02"],
  ["natural", "8PI-1234-1234", "02"],
  ["natural", "8PI-1234-12345", "26"],
];

test("DV: los casos de referencia de la DGI", () => {
  let probados = 0;
  for (const [tipo, ruc, dv] of CASOS_DGI) {
    const p = R.descomponer(ruc, { tipo });
    // Provincia 0 ("no asignada") está en la tabla de la DGI pero el
    // formulario no la ofrece: esos RUC no se pueden capturar.
    if (/^0(AV|PI)?-/.test(ruc) && tipo === "natural" || /^0-NT/.test(ruc)) {
      assert.match(R.problemaPartes(p) || "", /provincia/, `${ruc}: provincia 0 no se captura`);
      continue;
    }
    assert.equal(R.problemaPartes(p), null, `${ruc} debería leerse completo`);
    assert.equal(p.tipo, tipo, `${ruc}: tipo`);
    assert.equal(R.calcularDV(p), dv, `DV de ${ruc} (${tipo})`);
    probados++;
  }
  assert.equal(probados, CASOS_DGI.length - 4);
});

// Segunda fuente, independiente de la primera: github.com/apple314159/panama-dv.
// Sus casos AV/PI (1AV-432-658 y 4PI-234-123 → 96) NO están: esa versión arma
// la tira con la provincia en 3 posiciones ("…005008 15…", 23 de largo) y el
// documento de la DGI la pone en 2 (ejemplo 10: "N 0 8 A V 0 0 1 0 0 1 9 6",
// 20 posiciones). Aquí se sigue el documento.
test("DV: casos de una segunda implementación", () => {
  for (const [ruc, dv] of [
    ["61302-14-123411", "22"], ["1102-85-117211", "95"], ["2486589-1-816994", "62"],
    ["1830234-1-710357", "82"], ["41369-85-283456", "73"], ["64296-75-357434", "00"],
    ["203141-1-17214", "60"], ["1075137-1-553125", "18"],
    ["8-442-445", "08"], ["PE-10-442", "50"], ["N-45-832", "58"], ["E-12-342", "10"],
  ]) {
    assert.equal(R.calcularDV(R.descomponer(ruc)), dv, ruc);
  }
});

test("DV: el RUC del PNUD y el de la casa", () => {
  const pnud = R.descomponer("8-NT-2-39271", { tipo: "juridica" });
  assert.deepEqual([pnud.tipo, pnud.letra, pnud.provincia, pnud.tomo, pnud.asiento], ["juridica", "NT", "8", "2", "39271"]);
  assert.match(R.calcularDV(pnud), /^\d\d$/);
  const cc = R.descomponer("32977-27-249966");
  assert.equal(cc.tipo, "juridica");
  assert.equal(R.calcularDV(cc), "39", "C COMUNICA, S.A. RUC 32977-27-249966 DV 39");
});

test("NT natural y NT jurídico se escriben igual y dan DV distinto", () => {
  const nat = R.descomponer("8-NT-1-24", { tipo: "natural" });
  const jur = R.descomponer("8-NT-1-24", { tipo: "juridica" });
  assert.equal(R.componer(nat), R.componer(jur));
  assert.notEqual(R.calcularDV(nat), R.calcularDV(jur));
  // Sin tipo guardado, el DV desempata.
  assert.equal(R.descomponer("8-NT-1-24", { dv: R.calcularDV(nat) }).tipo, "natural");
  assert.equal(R.descomponer("8-NT-1-24", { dv: R.calcularDV(jur) }).tipo, "juridica");
});

test("componer: cada formato con sus guiones y letras", () => {
  assert.equal(R.componer({ tipo: "natural", provincia: "8", letra: "", tomo: "712", asiento: "1043" }), "8-712-1043");
  assert.equal(R.componer({ tipo: "natural", provincia: "8", letra: "E", tomo: "8", asiento: "127702" }), "E-8-127702", "E/N/PE van sin provincia");
  assert.equal(R.componer({ tipo: "natural", provincia: "", letra: "PE", tomo: "5", asiento: "614" }), "PE-5-614");
  assert.equal(R.componer({ tipo: "natural", provincia: "8", letra: "AV", tomo: "130", asiento: "765" }), "8AV-130-765");
  assert.equal(R.componer({ tipo: "natural", provincia: "4", letra: "PI", tomo: "12", asiento: "345" }), "4PI-12-345");
  assert.equal(R.componer({ tipo: "juridica", provincia: "8", letra: "NT", tomo: "2", asiento: "39271" }), "8-NT-2-39271");
  assert.equal(R.componer({ tipo: "juridica", letra: "", p1: "155612345", p2: "2", p3: "2015" }), "155612345-2-2015");
  assert.equal(R.componer({ tipo: "otro", texto: " xdb 367055 " }), "XDB367055");
});

test("componer: incompleto o combinación imposible → vacío", () => {
  assert.equal(R.componer({ tipo: "natural", provincia: "8", tomo: "712" }), "");
  assert.equal(R.componer({ tipo: "natural", letra: "", tomo: "712", asiento: "1043" }), "", "sin provincia");
  assert.equal(R.componer({ tipo: "juridica", letra: "AV", provincia: "8", tomo: "1", asiento: "2" }), "", "AV no es de jurídica");
  assert.equal(R.componer({ tipo: "", tomo: "1", asiento: "2" }), "");
});

test("problemaPartes: dice qué falta o qué sobra", () => {
  assert.equal(R.problemaPartes({ tipo: "" }), "Elige el tipo de contribuyente.");
  assert.equal(R.problemaPartes({ tipo: "natural", provincia: "8", letra: "", tomo: "712" }), "Falta el asiento.");
  assert.equal(R.problemaPartes({ tipo: "natural", letra: "", tomo: "", asiento: "" }), "Falta la provincia, el tomo y el asiento.");
  assert.equal(R.problemaPartes({ tipo: "natural", letra: "E", tomo: "8", asiento: "1" }), null, "la E no pide provincia");
  assert.match(R.problemaPartes({ tipo: "juridica", letra: "NT", provincia: "8", tomo: "1234", asiento: "1" }), /el tomo \(máx\. 3/);
  assert.equal(R.problemaPartes({ tipo: "natural", letra: "", provincia: "14", tomo: "1", asiento: "1" }), "Revisa la provincia.");
  assert.equal(R.problemaPartes({ tipo: "otro", texto: "-" }), "El número lleva letras, números y guiones (de 4 a 20).");
});

test("descomponer: lo que hay en producción", () => {
  // DV pegado al RUC (100+ fichas): se separa.
  for (const [crudo, ruc, dv] of [
    ["8-496-731:84", "8-496-731", "84"],
    ["3-87-2598 DV 53", "3-87-2598", "53"],
    ["342-240-75526:50", "342-240-75526", "50"],
    ["8-NT-2-4878:29", "8-NT-2-4878", "29"],
    ["3-106-903:5", "3-106-903", "5"],
    ["8-484-580 D.V.30", "8-484-580", "30"],
  ]) {
    const p = R.descomponer(crudo);
    assert.equal(R.componer(p), ruc, crudo);
    assert.equal(p.dvPegado, dv, crudo);
  }
  // NT sin su guion.
  assert.equal(R.componer(R.descomponer("8NT-1-14694:22")), "8-NT-1-14694");
  // Minúsculas y espacios.
  assert.equal(R.componer(R.descomponer(" e-8-150107 ")), "E-8-150107");
  // Cédula (provincia 1–13 delante) contra sociedad.
  assert.equal(R.descomponer("8-712-1043").tipo, "natural");
  assert.equal(R.descomponer("155612345-2-2015").tipo, "juridica");
  assert.equal(R.descomponer("56-505-861").tipo, "juridica", "56 no es provincia");
  // El tipo guardado manda.
  assert.equal(R.descomponer("8-712-1043", { tipo: "juridica" }).tipo, "juridica");
  // Lo que no encaja queda como "otro", tal cual.
  const raro = R.descomponer("15575157922024");
  assert.deepEqual([raro.tipo, raro.texto], ["otro", "15575157922024"]);
  assert.equal(R.descomponer("8-1-22685-000").tipo, "otro");
  assert.equal(R.descomponer("").vacio, true);
});

test("verificarDV: ok, no cuadra, sin DV", () => {
  const p = R.descomponer("32977-27-249966");
  assert.deepEqual(R.verificarDV(p, "39"), { estado: "ok", esperado: "39" });
  assert.deepEqual(R.verificarDV(p, "93"), { estado: "no_cuadra", esperado: "39" }, "dígitos cambiados");
  assert.deepEqual(R.verificarDV(p, ""), { estado: "sin_dv", esperado: "39" });
  // Un DV de un dígito vale con el cero delante (3-106-903 DV 05 en producción).
  assert.equal(R.verificarDV(R.descomponer("3-106-903"), "5").estado, "ok");
  assert.equal(R.verificarDV({ tipo: "otro", texto: "XDB367055" }, "1").estado, "no_aplica");
});

test("sugerirCorreccion: el NT que se cayó (casos de producción)", () => {
  // Ministerio de Trabajo, MINSA, un P.H.: guardados sin NT; el DV solo cuadra con él.
  for (const [ruc, dv, esperado] of [
    ["8-1-12607", "01", "8-NT-1-12607"],
    ["8-2-34949", "90", "8-NT-2-34949"],
    ["8-1-23412", "41", "8-NT-1-23412"],
  ]) {
    const s = R.sugerirCorreccion(R.descomponer(ruc), dv);
    assert.ok(s, ruc);
    assert.equal(s.ruc, esperado);
    assert.equal(s.partes.tipo, "juridica");
    assert.equal(R.calcularDV(s.partes), dv);
  }
  // DV "00" = relleno: no se inventa un NT (1-721-966 es una persona natural).
  assert.equal(R.sugerirCorreccion(R.descomponer("1-721-966"), "00"), null);
  // Si el DV cuadra, no hay nada que sugerir.
  assert.equal(R.sugerirCorreccion(R.descomponer("32977-27-249966"), "39"), null);
  // Dígitos cambiados: sin lectura vecina que cuadre, no se sugiere nada.
  assert.equal(R.sugerirCorreccion(R.descomponer("32977-27-249966"), "93"), null);
});

test("esValido (regla del kit): formatos DGI y 'otro'; lo viejo con DV pegado no se marca", () => {
  assert.equal(R.esValido("8-NT-2-39271"), true);
  assert.equal(R.esValido("155612345-2-2015"), true);
  assert.equal(R.esValido("E-8-127702"), true);
  assert.equal(R.esValido("XDB367055"), true, "pasaporte");
  assert.equal(R.esValido("8-496-731:84"), true, "ficha vieja: el componente ofrece acomodarla");
  assert.equal(R.esValido("-"), false);
  assert.equal(R.esValido("ABC"), false);
  assert.equal(R.esValido(""), true, "lo obligatorio lo decide required");
});
