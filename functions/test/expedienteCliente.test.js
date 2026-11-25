// Expediente legal del cliente (2026-11-25): qué documentos se piden y cuándo
// está completo.
//
// La regla existe DUPLICADA a propósito (sin build step compartido):
//   · public/js/domain/expedienteCliente.js      (Centro, directorio, /documentos/)
//   · functions/src/domain/expedienteCliente.js  (callable y trigger del resumen)
// Si se separan, la ficha diría "completo" y el directorio "falta", o el
// enlace le pediría al cliente lo que Cobros ya tiene.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backend = require("../src/domain/expedienteCliente");

const RUTA_FRONT = path.join(__dirname, "..", "..", "public", "js", "domain", "expedienteCliente.js");
const RUTA_BACK = path.join(__dirname, "..", "src", "domain", "expedienteCliente.js");

function cargarFrontend() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(RUTA_FRONT, "utf8"), sandbox, { filename: "expedienteCliente.js" });
  return sandbox.window.ExpedienteCliente;
}

// De "(function () {" hacia abajo, sin importar los finales de línea.
const cuerpo = (ruta) => {
  const s = fs.readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
  // Al inicio de línea: los comentarios de cabecera pueden nombrar la función.
  return s.slice(s.search(/^\(function \(\) \{$/m));
};

test("expediente: el espejo de functions es IDÉNTICO al del frontend", () => {
  assert.equal(cuerpo(RUTA_BACK), cuerpo(RUTA_FRONT),
    "functions/src/domain/expedienteCliente.js se separó de public/js/domain/expedienteCliente.js: copia el cuerpo de uno al otro");
});

const doc = (tipo, extra = {}) => ({ tipo, deleted: false, ...extra });
const DEL_CLIENTE = { revision: { estado: "pendiente" } };

const CASOS = [
  [],
  [doc("registro_publico")],
  [doc("aviso_operacion"), doc("cedula_representante"), doc("comprobante_direccion")],
  [doc("aviso_operacion", DEL_CLIENTE), doc("cedula_representante")],
  [doc("cedula_representante", DEL_CLIENTE), doc("cedula_representante", { revision: { estado: "ok" } })],
  [doc("comprobante_direccion", { deleted: true })],
  [doc("poder"), doc("otro", DEL_CLIENTE)],
];

test("expediente: frontend y backend dan el mismo resumen", () => {
  const F = cargarFrontend();
  for (const docs of CASOS) {
    assert.deepEqual(JSON.parse(JSON.stringify(F.resumen(docs))), backend.resumen(docs), JSON.stringify(docs));
  }
});

test("expediente: sin documentos faltan los tres", () => {
  const r = backend.resumen([]);
  assert.deepEqual(r.faltan, ["constitucion", "cedula", "direccion"]);
  assert.equal(r.completo, false);
  assert.equal(r.por_revisar, 0);
});

test("expediente: el Aviso de Operación O el Registro Público cumplen el mismo requisito", () => {
  assert.equal(backend.resumen([doc("aviso_operacion")]).constitucion, "ok");
  assert.equal(backend.resumen([doc("registro_publico")]).constitucion, "ok");
  assert.equal(backend.requisitoDeTipo("aviso_operacion"), "constitucion");
  assert.equal(backend.requisitoDeTipo("poder"), null);
});

test("expediente: lo que subió el cliente no cuenta hasta que Cobros lo revisa", () => {
  const antes = backend.resumen([doc("aviso_operacion", DEL_CLIENTE), doc("cedula_representante", DEL_CLIENTE), doc("comprobante_direccion", DEL_CLIENTE)]);
  assert.equal(antes.completo, false);
  assert.equal(antes.por_revisar, 3);
  assert.deepEqual(antes.faltan, [], "ya no FALTA: está por revisar");
  assert.equal(antes.cedula, "por_revisar");

  const ok = { revision: { estado: "ok", por_uid: "u1" } };
  const despues = backend.resumen([doc("aviso_operacion", ok), doc("cedula_representante", ok), doc("comprobante_direccion", ok)]);
  assert.equal(despues.completo, true);
  assert.equal(despues.por_revisar, 0);
});

test("expediente: lo que sube el personal desde la ficha cuenta de una vez", () => {
  const r = backend.resumen([doc("registro_publico"), doc("cedula_representante"), doc("comprobante_direccion")]);
  assert.equal(r.completo, true);
});

test("expediente: un documento rechazado (borrado lógico) vuelve a dejar el requisito en falta", () => {
  const r = backend.resumen([doc("cedula_representante", { deleted: true, revision: { estado: "rechazado", motivo: "no se lee" } })]);
  assert.equal(r.cedula, "falta");
  assert.equal(r.por_revisar, 0);
});

test("expediente: uno revisado manda sobre otro pendiente del mismo requisito", () => {
  const r = backend.resumen([doc("cedula_representante"), doc("cedula_representante", DEL_CLIENTE)]);
  assert.equal(r.cedula, "ok");
  assert.equal(r.por_revisar, 1, "el pendiente igual hay que abrirlo");
});

test("expediente: un cliente sin el campo se lee como 'faltan los tres'", () => {
  for (const vacio of [undefined, null, "", {}, 7]) {
    const e = backend.leer(vacio);
    assert.deepEqual(e.faltan, ["constitucion", "cedula", "direccion"]);
    assert.equal(e.completo, false);
  }
  const e = backend.leer({ constitucion: "ok", cedula: "por_revisar", direccion: "cualquier cosa", por_revisar: 1 });
  assert.equal(e.constitucion, "ok");
  assert.equal(e.direccion, "falta", "un valor desconocido no se da por bueno");
  assert.deepEqual(e.faltan, ["direccion"]);
});

test("expediente: mismoResumen ignora la fecha y detecta el cambio de estado", () => {
  const a = backend.resumen([doc("cedula_representante", DEL_CLIENTE)]);
  assert.equal(backend.mismoResumen({ ...a, actualizado_at: new Date() }, a), true);
  assert.equal(backend.mismoResumen(a, backend.resumen([doc("cedula_representante")])), false);
  assert.equal(backend.mismoResumen(undefined, backend.resumen([])), true);
});

test("expediente: qué se le pide al cliente — lo marcado o, sin marcar, lo que falta", () => {
  const exp = backend.resumen([doc("registro_publico")]);
  assert.deepEqual(backend.pedidos([], exp), ["cedula", "direccion"]);
  assert.deepEqual(backend.pedidos(undefined, exp), ["cedula", "direccion"]);
  // El personal puede pedir uno actualizado aunque ya esté; el orden es el canónico.
  assert.deepEqual(backend.pedidos(["direccion", "constitucion", "inventado", "direccion"], exp), ["constitucion", "direccion"]);
});

test("expediente: la frase de lo que falta se lee como una oración", () => {
  assert.equal(backend.fraseFaltan([]), "");
  assert.equal(backend.fraseFaltan(["cedula"]), "Cédula del representante");
  assert.equal(backend.fraseFaltan(["cedula", "direccion"]), "Cédula del representante y Recibo de servicio");
  assert.equal(backend.fraseFaltan(["constitucion", "cedula", "direccion"]),
    "Aviso de Operación / Registro Público, Cédula del representante y Recibo de servicio");
});

test("expediente: los tipos del requisito existen en el catálogo del servicio de documentos", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "services", "clienteDocumentosService.js"), "utf8");
  for (const q of backend.REQUISITOS) {
    for (const t of q.tipos) assert.match(src, new RegExp(`value:\\s*"${t}"`), `falta el tipo ${t} en ClienteDocumentosService.TIPOS`);
  }
});
