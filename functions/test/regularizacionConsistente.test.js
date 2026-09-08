// Candado del anexo de regularización (lib/gestiones.regularizacionConsistente):
// la suma de cantidades tiene que ser exactamente el número de seriales.
const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-gestiones" });
const { regularizacionConsistente } = require("../src/lib/gestiones");

test("no aplica a un aumento normal", () => {
  const r = regularizacionConsistente({ lineas: [{ cantidad: 3 }] });
  assert.equal(r.ok, true);
  assert.equal(r.aplica, false);
});

test("consistente: 2 seriales, líneas que suman 2", () => {
  const r = regularizacionConsistente({ es_regularizacion: true, lineas: [{ cantidad: 1 }, { cantidad: 1 }], regulariza_seriales: [{ serial: "A1" }, { serial: "A2" }] });
  assert.equal(r.ok, true);
  assert.equal(r.total, 2);
  assert.equal(r.seriales, 2);
});

test("inconsistente: radios nuevos colados (líneas 3, seriales 2)", () => {
  const r = regularizacionConsistente({ es_regularizacion: true, lineas: [{ cantidad: 3 }], regulariza_seriales: [{ serial: "A1" }, { serial: "A2" }] });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /suman 3.*seriales regularizados son 2/);
});

test("inconsistente: sin seriales declarados o seriales vacíos", () => {
  assert.equal(regularizacionConsistente({ es_regularizacion: true, lineas: [{ cantidad: 1 }] }).ok, false);
  assert.equal(regularizacionConsistente({ es_regularizacion: true, lineas: [{ cantidad: 1 }], regulariza_seriales: [{ serial: "" }] }).ok, false);
});

test("cantidades no numéricas cuentan como 0", () => {
  const r = regularizacionConsistente({ es_regularizacion: true, lineas: [{ cantidad: "x" }, { cantidad: 2 }], regulariza_seriales: [{ serial: "A1" }, { serial: "A2" }] });
  assert.equal(r.ok, true);
});
