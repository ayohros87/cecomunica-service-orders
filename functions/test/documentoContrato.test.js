// esDocumentoV2 (lib/documentoContrato.js): qué contratos usan el documento
// nuevo — el correo a activaciones no debe adjuntar el PDF del formato
// anterior a un contrato v2 (2026-09-04, caso Chino Panameño).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { esDocumentoV2, CORTE_V2 } = require("../src/lib/documentoContrato");

const ANTES   = new Date(CORTE_V2 - 86400000); // un día antes del corte
const DESPUES = new Date(CORTE_V2 + 60000);    // un minuto después
const ts = (d) => ({ toMillis: () => d.getTime() });

test("SERV (maestro de cuenta del Centro) es v2 aunque no traiga la marca", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "SERV" }), true);
  assert.equal(esDocumentoV2({ tipo_contrato: "Servicio" }), true);
});

test("la marca explícita y la firma digital también son v2", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", documento_version: "v2" }), true);
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", firma_solicitud_id: "abc" }), true);
  assert.equal(esDocumentoV2({ codigo_tipo: "PROP", firmado_tipo: "digital" }), true);
});

test("ALQ/PROP/REEMP históricos sin marca siguen en el formato anterior", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", tipo_contrato: "Alquiler" }), false);
  assert.equal(esDocumentoV2({ tipo_contrato: "Reemplazo" }), false);
  assert.equal(esDocumentoV2(null), false);
});

// ── El corte (2026-09-09) ─────────────────────────────────────────────
test("un ALQ creado ANTES del corte conserva el formato anterior", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", fecha_creacion: ts(ANTES) }), false);
});

test("un ALQ creado DESPUÉS del corte es v2 aunque nadie lo estampe", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", fecha_creacion: ts(DESPUES) }), true);
});

test("acepta Timestamp, Date, millis y string ISO como fecha_creacion", () => {
  assert.equal(esDocumentoV2({ fecha_creacion: DESPUES }), true);
  assert.equal(esDocumentoV2({ fecha_creacion: DESPUES.getTime() }), true);
  assert.equal(esDocumentoV2({ fecha_creacion: DESPUES.toISOString() }), true);
  assert.equal(esDocumentoV2({ fecha_creacion: { seconds: Math.floor(DESPUES.getTime() / 1000) } }), true);
  assert.equal(esDocumentoV2({ fecha_creacion: ANTES }), false);
});

test("'v1' es la salida explícita: gana sobre el corte y sobre SERV", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", documento_version: "v1", fecha_creacion: ts(DESPUES) }), false);
  assert.equal(esDocumentoV2({ codigo_tipo: "SERV", documento_version: "v1" }), false);
});

test("un contrato sin fecha_creacion no se vuelve v2 por accidente", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ" }), false);
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", fecha_creacion: null }), false);
});
