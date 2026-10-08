// Reglas puras de la reposición de un radio alquilado (lib/reposicionAlquiler.js):
// qué perdido se acepta y cómo se parea con lo que asignó bodega.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "demo-reposicion" });
const R = require("../src/lib/reposicionAlquiler");

const conCliente = (extra = {}) => ({
  estado: "en_cliente", propiedad: "cecomunica",
  asignacion: { cliente_id: "GOLY", cliente_nombre: "GOLY", contrato_doc_id: "ct1", contrato_id: "REEMP-1" }, ...extra,
});

test("un radio alquilado del cliente se acepta como perdido", () => {
  assert.equal(R.validarPerdido(conCliente(), "GOLY"), null);
  assert.equal(R.validarPerdido(conCliente({ estado: "asignado_contrato" }), "GOLY"), null);
});

test("lo que no es alquiler del cliente se rechaza con el motivo", () => {
  assert.match(R.validarPerdido(null, "GOLY"), /inventario/);
  assert.match(R.validarPerdido(conCliente({ propiedad: "cliente" }), "GOLY"), /venta/);
  assert.match(R.validarPerdido(conCliente({ estado: "en_bodega" }), "GOLY"), /en_bodega/);
  assert.match(R.validarPerdido(conCliente(), "OTRO"), /con GOLY/);
  assert.match(R.validarPerdido(conCliente({ asignacion: { cliente_id: "GOLY" } }), "GOLY"), /contrato/);
});

test("parea por modelo exacto antes que por familia, y deja lo que sobra", () => {
  const familia = (a, b) => String(a.modelo).replace(/-R$/, "") === String(b.modelo).replace(/-R$/, "");
  const perdidos = [{ serial: "P1", modelo_id: "m460", modelo: "PNC460" }, { serial: "P2", modelo_id: "m360", modelo: "PNC360S" }, { serial: "P3", modelo_id: "mX", modelo: "X" }];
  const entrantes = [{ serial: "E1", modelo_id: "m360r", modelo: "PNC360S-R" }, { serial: "E2", modelo_id: "m460", modelo: "PNC460" }, { serial: "E3", modelo_id: "mZ", modelo: "Z" }];
  const r = R.parear(perdidos, entrantes, familia);
  assert.deepEqual(r.pares.map(x => `${x.perdido.serial}>${x.entrante.serial}`), ["P1>E2", "P2>E1"]);
  assert.deepEqual(r.perdidosSinPar.map(x => x.serial), ["P3"]);
  assert.deepEqual(r.entrantesSinPar.map(x => x.serial), ["E3"]);
});
