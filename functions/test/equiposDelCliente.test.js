// Equipos que TRAE el cliente (Almacén · Más, 2026-10-07).
//
// Un cliente trae sus propios radios para meterlos en su contrato (línea "Del
// cliente"). Bodega los registra: quedan en bodega con propiedad 'cliente' y
// `propietario`. Lo que se protege aquí:
//   · clasificarDelCliente no convierte flota nuestra ni radios de otro
//     cliente / de otro contrato en "del cliente";
//   · motivoNoDisponible no ofrece el radio de un cliente a otro (ni a una
//     venta, que no trae cliente).
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function cargarFrontend() {
  const sandbox = { window: {}, firebase: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "core", "serial.js"), "utf8"), sandbox, { filename: "serial.js" });
  sandbox.Serial = sandbox.window.Serial;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "services", "equiposPoolService.js"), "utf8"), sandbox, { filename: "equiposPoolService.js" });
  return sandbox.window.EquiposPoolService;
}
const S = cargarFrontend();
const plain = (x) => JSON.parse(JSON.stringify(x));

const NX = "modelo-nx410";
const item = (s) => ({ raw: s, norm: s });
const ctx = { modelo_id: NX, modelo_label: "KENWOOD NX-410", cliente_id: "CLI-A" };
const ficha = (o) => ({ id: o.serial_norm || "X", modelo_id: NX, modelo_label: "KENWOOD NX-410", ...o });

test("serial sin ficha → nuevo", () => {
  const r = S.clasificarDelCliente([item("A1")], new Map([["A1", []]]), ctx);
  assert.deepEqual(plain(r.nuevos).map(v => v.norm), ["A1"]);
  assert.equal(r.bloqueados.length, 0);
});

test("flota de Cecomunica en bodega → bloqueado (no se regala)", () => {
  const r = S.clasificarDelCliente([item("A1")],
    new Map([["A1", [ficha({ serial_norm: "A1", estado: "en_bodega", propiedad: "cecomunica" })]]]), ctx);
  assert.equal(r.reclamables.length, 0);
  assert.match(r.bloqueados[0].motivo, /flota de Cecomunica/);
});

test("radio del cliente en un contrato vivo → bloqueado", () => {
  const r = S.clasificarDelCliente([item("A1")], new Map([["A1", [ficha({ serial_norm: "A1",
    estado: "en_cliente", propiedad: "cliente",
    asignacion: { contrato_doc_id: "c1", contrato_id: "SERV-1", cliente_id: "CLI-A", cliente_nombre: "A" } })]]]), ctx);
  assert.match(r.bloqueados[0].motivo, /contrato SERV-1/);
});

test("radio vendido a OTRO cliente → bloqueado", () => {
  const r = S.clasificarDelCliente([item("A1")], new Map([["A1", [ficha({ serial_norm: "A1",
    estado: "vendido", propiedad: "cliente", venta: { cliente_id: "CLI-B", cliente_nombre: "B" } })]]]), ctx);
  assert.match(r.bloqueados[0].motivo, /otro cliente: B/);
});

test("radio vendido a ESTE cliente / custodia sin contrato → reclamable", () => {
  const r = S.clasificarDelCliente([item("A1"), item("A2")], new Map([
    ["A1", [ficha({ serial_norm: "A1", estado: "vendido", propiedad: "cliente", venta: { cliente_id: "CLI-A" } })]],
    ["A2", [ficha({ serial_norm: "A2", estado: "en_cliente", propiedad: "desconocida", asignacion: { cliente_id: "CLI-A" } })]],
  ]), ctx);
  assert.deepEqual(plain(r.reclamables).map(v => [v.norm, v.estado]), [["A1", "vendido"], ["A2", "en_cliente"]]);
});

test("en taller → bloqueado (lo mueve la orden, no bodega)", () => {
  const r = S.clasificarDelCliente([item("A1")], new Map([["A1", [ficha({ serial_norm: "A1",
    estado: "en_taller", propiedad: "cliente", orden_actual_id: "OS-9" })]]]), ctx);
  assert.match(r.bloqueados[0].motivo, /OS-9/);
});

test("ya registrado a nombre de este cliente → yaEstaban", () => {
  const r = S.clasificarDelCliente([item("A1")], new Map([["A1", [ficha({ serial_norm: "A1",
    estado: "en_bodega", propiedad: "cliente", propietario: { cliente_id: "CLI-A" } })]]]), ctx);
  assert.equal(r.yaEstaban.length, 1);
});

test("mismo serial con otro modelo → bloqueado, no se crea ficha aparte", () => {
  const r = S.clasificarDelCliente([item("A1")], new Map([["A1", [{ id: "A1", serial_norm: "A1",
    modelo_id: "modelo-pd606", modelo_label: "HYTERA PD606", estado: "en_bodega", propiedad: "cecomunica" }]]]), ctx);
  assert.equal(r.nuevos.length, 0);
  assert.match(r.bloqueados[0].motivo, /ya existe como HYTERA PD606/);
});

test("motivoNoDisponible: el radio del cliente solo se ofrece a su dueño", () => {
  const u = { serial: "A1", estado: "en_bodega", propiedad: "cliente", propietario: { cliente_id: "CLI-A", cliente_nombre: "A" } };
  assert.equal(S.motivoNoDisponible(u, { clienteId: "CLI-A" }), null);
  assert.match(S.motivoNoDisponible(u, { clienteId: "CLI-B" }), /es del cliente A/);
  // Sin cliente (venta, flujos sin dueño): nunca disponible.
  assert.match(S.motivoNoDisponible(u, {}), /es del cliente A/);
  // La flota y los radios del cliente SIN propietario (comprados, custodia) siguen igual.
  assert.equal(S.motivoNoDisponible({ serial: "B1", estado: "en_bodega", propiedad: "cecomunica" }, {}), null);
  assert.equal(S.motivoNoDisponible({ serial: "B2", estado: "en_bodega", propiedad: "cliente" }, {}), null);
});

// ── Servidor: la línea "alquiler" no vuelve flota un radio que trajo el cliente
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-equipos-cliente" });
const pool = require("../src/domain/equiposPool");

test("declaracionManda: alquiler no pisa a un radio con propietario", () => {
  const traido = { propiedad: "cliente", propietario: { cliente_id: "CLI-A" } };
  assert.equal(pool.declaracionManda(traido, "cecomunica", true), false);
  assert.equal(pool.declaracionManda(traido, "cliente", true), true);
  // Sin propietario (backfill FORTUNATO MANGRAVITA): la línea sigue mandando.
  assert.equal(pool.declaracionManda({ propiedad: "cliente" }, "cecomunica", true), true);
  // Sin declaración no manda nunca.
  assert.equal(pool.declaracionManda({ propiedad: "cecomunica" }, "cliente", false), false);
});
