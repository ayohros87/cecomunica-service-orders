// Alta de consolas de despacho (public/js/pages/poc-nueva-consola.js).
//
// Reporte de recepción (26-ago-2026, P.H. PLAZA DEL ESTE, ALQ20260825-01):
// "el cliente tiene contempladas 2 consolas además de los 18 radios; al cargar
// el archivo JSON el batch únicamente reconoce los 18". Es correcto que no las
// vea: en el contrato las consolas van en `cargos` (concepto "Consola",
// cantidad 2), NO en `equipos`, y no tienen serial — así que nunca están en
// contratos/{id}/seriales ni en el archivo del vendedor.
//
// Esta pantalla las crea con la convención de las consolas que ya existen en
// poc_devices: serial "CONSOLA", unit_id de TEXTO (ANATI1, FEMSA1, MACHETAZO
// C4 → unit_id_num null) y sin modelo. Lo que se prueba aquí es justamente eso,
// más el conteo contra los cargos del contrato.
//
// Corre con `npm test` (node --test). Sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// El script solo declara funciones y registra DOMContentLoaded al final; con un
// document mínimo basta para quedarnos con los helpers.
function cargar() {
  const sandbox = {
    console,
    document: { addEventListener: () => {}, getElementById: () => null, createElement: () => ({ dataset: {}, style: {} }) },
    firebase: { auth: () => ({ onAuthStateChanged: () => {} }) },
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(leer("public", "js", "services", "pocService.js"), sandbox, { filename: "pocService.js" });
  vm.runInContext(leer("public", "js", "domain", "consolasContrato.js"), sandbox, { filename: "consolasContrato.js" });
  vm.runInContext(leer("public", "js", "pages", "poc-nueva-consola.js"), sandbox, { filename: "poc-nueva-consola.js" });
  return sandbox;
}

// El contrato real del incidente: 18 HYT-P50 como equipos, 2 consolas como cargo.
const CONTRATO = {
  id: "docALQ",
  contrato_id: "ALQ20260825-01",
  equipos: [{ modelo: "HYT-P50", cantidad: 18, precio: 20 }],
  cargos: [{ concepto: "Consola", cantidad: 2, monto: 20, recurrente: false }],
};

test("las consolas se cuentan de los CARGOS, no de los equipos", () => {
  const s = cargar();
  assert.equal(s.ConsolasContrato.contratadas(CONTRATO), 2);
  assert.equal(s.ConsolasContrato.contratadas({ equipos: [{ cantidad: 18 }], cargos: [] }), 0,
    "18 radios no son 18 consolas");
  assert.equal(s.ConsolasContrato.contratadas({ cargos: [{ concepto: "Consola de despacho" }] }), 1,
    "sin cantidad explícita cuenta como una");
  assert.equal(s.ConsolasContrato.contratadas({ cargos: [{ concepto: "Instalación", cantidad: 3 }] }), 0);
  assert.equal(s.ConsolasContrato.contratadas(null), 0);
});

test("una consola se reconoce por su serial, que es el cajón de sastre", () => {
  const s = cargar();
  assert.equal(s.ConsolasContrato.esConsola({ serial: "CONSOLA" }), true);
  assert.equal(s.ConsolasContrato.esConsola({ serial: " consola " }), true, "recepción no teclea siempre igual");
  assert.equal(s.ConsolasContrato.esConsola({ serial: "26314A1691" }), false);
  assert.equal(s.ConsolasContrato.esConsola({}), false);
});

test("el conteo de creadas ignora borradas y sabe separar por contrato", () => {
  const s = cargar();
  const devices = [
    { serial: "CONSOLA", contrato_doc_id: "docALQ" },
    { serial: "CONSOLA", contrato_doc_id: "docALQ", deleted: true },
    { serial: "CONSOLA", contrato_doc_id: "docOTRO" },
    { serial: "26314A1691", contrato_doc_id: "docALQ" },
  ];
  assert.equal(s.ConsolasContrato.creadas(devices), 2, "del cliente: las dos vivas");
  assert.equal(s.ConsolasContrato.creadas(devices, "docALQ"), 1, "de este contrato: una");
});

test("el Unit ID no puede chocar con otro equipo vivo del cliente", () => {
  const s = cargar();
  const devices = [
    { unit_id: "275479" },
    { unit_id: "PLAZA1" },
    { unit_id: "PLAZA9", deleted: true },
  ];
  assert.equal(s.unitIdEnUso("PLAZA1", devices), true);
  assert.equal(s.unitIdEnUso(" plaza1 ", devices), true, "mismo ID escrito distinto sigue siendo el mismo");
  assert.equal(s.unitIdEnUso("275479", devices), true, "tampoco puede pisar a un radio");
  assert.equal(s.unitIdEnUso("PLAZA2", devices), false);
  assert.equal(s.unitIdEnUso("PLAZA9", devices), false, "una borrada libera su ID");
  assert.equal(s.unitIdEnUso("", devices), false);
});

test("el nombre sugerido se numera cuando ya hay consolas", () => {
  const s = cargar();
  assert.equal(s.nombreSugerido("P.H. PLAZA DEL ESTE"), "CONSOLA P.H. PLAZA DEL ESTE");
  assert.equal(s.nombreSugerido("P.H. PLAZA DEL ESTE", 1), "CONSOLA P.H. PLAZA DEL ESTE 2");
});

test("los grupos del cliente salen del catálogo Y de lo que usan sus equipos", () => {
  const s = cargar();
  const grupos = s.gruposDelCliente(
    ["TORRE A", "RONDIN"],
    [
      { grupos: ["RONDIN", "OPERACIONES"] },
      { grupos: ["Rondin"] },                       // mismo grupo, otra caja
      { grupos: ["MANTENIMIENTO"], deleted: true }, // equipo borrado: no aporta
    ]);
  // Spread a un array del realm de este test: los arrays creados dentro del vm
  // tienen otro prototipo y deepEqual los rechazaría por eso, no por contenido.
  assert.deepEqual([...grupos], ["OPERACIONES", "RONDIN", "TORRE A"],
    "unión sin repetidos y ordenada; un grupo vivo fuera del catálogo también cuenta");
});

test("el doc que se guarda respeta la convención de las consolas", () => {
  const s = cargar();
  const doc = s.construirDocConsola({
    clienteId: "Hx43", clienteNombre: "P.H. PLAZA DEL ESTE",
    contratoDocId: "docALQ", contratoRef: "ALQ20260825-01",
    ip: "main.cecomunica.net", unitId: " PLAZA1 ", nombre: " CONSOLA PLAZA DEL ESTE ",
    grupos: ["TORRE A"], notas: "garita", uid: "u1", email: "recep@cecomunica.com", ts: "TS",
  });

  assert.equal(doc.serial, "CONSOLA", "el serial es el cajón de sastre, no uno inventado");
  assert.equal(doc.unit_id, "PLAZA1", "unit_id siempre string y sin espacios (candado de rules)");
  assert.equal(doc.unit_id_num, null, "un unit_id de texto NO tiene espejo numérico");
  assert.equal(doc.modelo_id, "", "sin modelo: una consola no es un radio del catálogo");
  assert.equal(doc.modelo, "");
  assert.equal(doc.gps, false);
  assert.equal(doc.radio_name, "CONSOLA PLAZA DEL ESTE");
  assert.equal(doc.contrato_doc_id, "docALQ");
  assert.equal(doc.contrato_id, "ALQ20260825-01");
  assert.deepEqual([...doc.grupos], ["TORRE A"]);
  assert.equal(doc.activo, true);
  assert.equal(doc.deleted, false);
  assert.equal(doc.created_at, "TS");
  assert.equal(doc.updated_at, "TS");
});

test("una consola sin contrato no arrastra referencias vacías", () => {
  const s = cargar();
  const doc = s.construirDocConsola({
    clienteId: "Hx43", clienteNombre: "X", unitId: "X1", nombre: "CONSOLA X", ts: null,
  });
  assert.equal(doc.contrato_doc_id, null);
  assert.equal(doc.contrato_id, null);
  assert.deepEqual([...doc.grupos], []);
});

test("un unit_id numérico sí lleva espejo numérico", () => {
  const s = cargar();
  const doc = s.construirDocConsola({ clienteId: "c", clienteNombre: "X", unitId: "275497", nombre: "CONSOLA X" });
  assert.equal(doc.unit_id, "275497");
  assert.equal(doc.unit_id_num, 275497, "si la plataforma le dio un número, la lista debe poder ordenarla");
});
